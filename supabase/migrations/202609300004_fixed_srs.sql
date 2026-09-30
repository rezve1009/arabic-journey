-- Phase 5 only: fixed scheduling. Review UI/session controls belong to Phase 6.
begin;
create function app_private.valid_rating_behavior(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  return jsonb_typeof(value)='object' and value ?& array['again_days','hard_factor','easy_skip']
    and (select count(*) from jsonb_object_keys(value))=3
    and jsonb_typeof(value->'again_days')='number' and (value->>'again_days')::numeric between 1 and 3650
    and (value->>'again_days')::numeric=trunc((value->>'again_days')::numeric)
    and jsonb_typeof(value->'hard_factor')='number' and (value->>'hard_factor')::numeric between 0.1 and 1
    and jsonb_typeof(value->'easy_skip')='number' and (value->>'easy_skip')::numeric between 0 and 10
    and (value->>'easy_skip')::numeric=trunc((value->>'easy_skip')::numeric);
exception when others then return false;end $$;
revoke all on function app_private.valid_rating_behavior(jsonb) from public,anon;
grant execute on function app_private.valid_rating_behavior(jsonb) to authenticated;
alter table public.user_settings add constraint rating_behavior_bounds check(app_private.valid_rating_behavior(rating_behavior)) not valid;
alter table public.review_history add column rating_snapshot jsonb;
alter table public.review_history add constraint rating_snapshot_bounds check(rating_snapshot is null or app_private.valid_rating_behavior(rating_snapshot));

create function public.save_fixed_schedule(p_revision bigint,p_intervals integer[],p_repeat_days integer,p_ratings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.user_settings;current_settings public.user_settings;next_schedule jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
  select * into current_settings from public.user_settings where user_id=auth.uid() for update;
  if not found or current_settings.revision is distinct from p_revision then raise exception 'Settings changed' using errcode='40001';end if;
  next_schedule:=jsonb_build_object('intervals',to_jsonb(p_intervals),'repeat_days',p_repeat_days,'version',(current_settings.revision_schedule->>'version')::integer+1);
  if app_private.valid_schedule(next_schedule) is distinct from true or app_private.valid_rating_behavior(p_ratings) is distinct from true then
    raise exception 'Invalid fixed schedule' using errcode='22023';end if;
  update public.user_settings set revision_algorithm='fixed',revision_schedule=next_schedule,rating_behavior=p_ratings
    where user_id=auth.uid() returning * into saved;
  return to_jsonb(saved);
end $$;
revoke all on function public.save_fixed_schedule(bigint,integer[],integer,jsonb) from public,anon;
grant execute on function public.save_fixed_schedule(bigint,integer[],integer,jsonb) to authenticated;

create function app_private.initialize_fixed_word() returns trigger
language plpgsql security definer set search_path='' as $$
declare settings public.user_settings;days integer;
begin
  select * into settings from public.user_settings where user_id=new.user_id;
  days:=(settings.revision_schedule->'intervals'->>0)::integer;
  insert into public.word_review_state(user_id,word_id,algorithm,schedule_version,stage,interval_days,next_review_at)
    values(new.user_id,new.id,'fixed',(settings.revision_schedule->>'version')::integer,0,days,new.created_at+days*interval '24 hours') on conflict do nothing;
  return new;
end $$;
revoke all on function app_private.initialize_fixed_word() from public,anon,authenticated;
create trigger initialize_fixed_word after insert on public.words for each row execute function app_private.initialize_fixed_word();
-- Initialize only missing fixed states; preserve authored vocabulary and every existing algorithm.
insert into public.word_review_state(user_id,word_id,algorithm,schedule_version,stage,interval_days,next_review_at)
  select w.user_id,w.id,'fixed',(s.revision_schedule->>'version')::integer,0,(s.revision_schedule->'intervals'->>0)::integer,
    w.created_at+(s.revision_schedule->'intervals'->>0)::integer*interval '24 hours'
  from public.words w join public.user_settings s on s.user_id=w.user_id where w.deleted_at is null on conflict do nothing;

create function public.fixed_review(p_operation uuid,p_word uuid,p_revision bigint,p_rating text,
  p_response_ms integer default null,p_mode text default 'scheduled') returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();payload text;prior app_private.sync_operations;state public.word_review_state;
  settings public.user_settings;event public.review_history;outcome jsonb;reviewed_at timestamptz:=statement_timestamp();
  stage_count integer;next_stage integer;days integer;snapshot jsonb;ratings jsonb;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode='42501';end if;
  if p_operation is null or p_word is null or p_revision is null or p_rating is null or p_rating not in ('again','hard','good','easy')
    or p_mode is null or p_mode not in ('scheduled','recorded_practice') or p_response_ms<0 then raise exception 'Invalid review request' using errcode='22023';end if;
  payload:=jsonb_build_array('fixed_review',p_word,p_revision,p_rating,p_response_ms,p_mode)::text;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||p_operation::text,0));
  select * into prior from app_private.sync_operations where user_id=owner_id and operation_id=p_operation;
  if found then
    if prior.payload_hash<>md5(payload) then raise exception 'Operation reused with different data' using errcode='22023';end if;
    return prior.result;
  end if;
  -- Serialize with vocabulary deletion/editing, then lock the state and settings.
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||'vocabulary',0));
  perform 1 from public.words where id=p_word and user_id=owner_id and deleted_at is null for update;
  if not found then raise exception 'Word unavailable' using errcode='40001';end if;
  select * into state from public.word_review_state where word_id=p_word and user_id=owner_id and algorithm='fixed' and deleted_at is null for update;
  if not found or state.revision<>p_revision then raise exception 'Review state changed' using errcode='40001';end if;
  if p_mode='scheduled' and state.next_review_at>reviewed_at then raise exception 'Word is not due' using errcode='22023';end if;
  select * into settings from public.user_settings where user_id=owner_id for share;
  if settings.revision_algorithm<>'fixed' then raise exception 'Fixed algorithm required' using errcode='22023';end if;
  snapshot:=settings.revision_schedule;ratings:=settings.rating_behavior;
  if app_private.valid_schedule(snapshot) is distinct from true or app_private.valid_rating_behavior(ratings) is distinct from true then raise exception 'Invalid schedule' using errcode='22023';end if;
  stage_count:=jsonb_array_length(snapshot->'intervals');next_stage:=least(state.stage,stage_count);
  if p_rating='again' then next_stage:=0;
  elsif p_rating in ('good','easy') then next_stage:=least(next_stage+1+case when p_rating='easy' then (ratings->>'easy_skip')::integer else 0 end,stage_count);end if;
  days:=case when next_stage=stage_count then (snapshot->>'repeat_days')::integer else (snapshot->'intervals'->>next_stage)::integer end;
  if p_rating='again' then days:=(ratings->>'again_days')::integer;
  elsif p_rating='hard' then days:=greatest(1,ceil(days*(ratings->>'hard_factor')::numeric)::integer);end if;
  insert into public.review_history(user_id,word_id,operation_id,occurred_at,algorithm,algorithm_version,schedule_snapshot,rating_snapshot,
    prior_stage,prior_interval,prior_due_at,rating,new_stage,new_interval,next_review_at,response_ms,activity_mode)
  values(owner_id,p_word,p_operation,reviewed_at,'fixed',1,snapshot,ratings,state.stage,state.interval_days,state.next_review_at,
    p_rating,next_stage,days,reviewed_at+days*interval '24 hours',p_response_ms,p_mode) returning * into event;
  update public.word_review_state set stage=next_stage,interval_days=days,next_review_at=event.next_review_at,last_reviewed_at=reviewed_at,
    schedule_version=(snapshot->>'version')::integer,algorithm_version=1,review_count=review_count+1,
    correct_count=correct_count+case when p_rating='again' then 0 else 1 end,incorrect_count=incorrect_count+case when p_rating='again' then 1 else 0 end,
    success_count=success_count+case when p_rating in ('good','easy') then 1 else 0 end,
    weak_score=greatest(0,weak_score+case p_rating when 'again' then 1 when 'hard' then 0.5 else -0.5 end),
    mastery_status=case when next_stage=stage_count then 'reviewing' else 'learning' end
    where word_id=p_word and user_id=owner_id and algorithm='fixed' returning * into state;
  outcome:=jsonb_build_object('state',to_jsonb(state),'event',to_jsonb(event));
  insert into app_private.sync_operations(user_id,operation_id,payload_hash,result) values(owner_id,p_operation,md5(payload),outcome);
  return outcome;
end $$;
revoke all on function public.fixed_review(uuid,uuid,bigint,text,integer,text) from public,anon;
grant execute on function public.fixed_review(uuid,uuid,bigint,text,integer,text) to authenticated;

create function public.fixed_due(p_page integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$
 with eligible as (
  select w.id,w.arabic_word,w.bangla_meaning,w.english_meaning,r.stage,r.interval_days,r.next_review_at,r.revision
   from public.word_review_state r join public.words w on w.id=r.word_id and w.user_id=r.user_id
   where r.user_id=auth.uid() and r.algorithm='fixed' and r.deleted_at is null and w.deleted_at is null
 ), selected as (select * from eligible where next_review_at<=statement_timestamp() order by next_review_at,id limit 25 offset greatest(coalesce(p_page,0),0)*25)
 select jsonb_build_object('as_of',statement_timestamp(),'total',(select count(*) from eligible where next_review_at<=statement_timestamp()),
  'words',coalesce((select jsonb_agg(to_jsonb(selected) order by next_review_at,id) from selected),'[]'),
  'upcoming',coalesce((select jsonb_agg(to_jsonb(u) order by next_review_at,id) from
    (select * from eligible where next_review_at>statement_timestamp() order by next_review_at,id limit 5) u),'[]'))
$$;
revoke all on function public.fixed_due(integer) from public,anon;
grant execute on function public.fixed_due(integer) to authenticated;
-- A scheduled-but-unreviewed word is still new. Retain all existing list options.
do $$declare definition text;begin
  select pg_get_functiondef('public.vocabulary_list(text,text,text,uuid,boolean,date,date,integer,text,boolean,boolean,boolean)'::regprocedure) into definition;
  definition:=replace(definition,'r.word_id=w.id and r.user_id=w.user_id and r.deleted_at is null','r.word_id=w.id and r.user_id=w.user_id and r.algorithm=''fixed'' and r.review_count>0 and r.deleted_at is null');
  execute definition;
end $$;
commit;
