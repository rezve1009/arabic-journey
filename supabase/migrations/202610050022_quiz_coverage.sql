begin;
create table public.quiz_cycles(user_id uuid primary key references auth.users(id) on delete cascade,round integer not null default 1 check(round>0));
create table public.quiz_coverage(user_id uuid not null references auth.users(id) on delete cascade,round integer not null,word_id uuid not null references public.words(id) on delete cascade,last_seen timestamptz not null default now(),primary key(user_id,round,word_id));
alter table public.quiz_cycles enable row level security;
alter table public.quiz_coverage enable row level security;
create policy own_cycles on public.quiz_cycles for select to authenticated using(user_id=(select auth.uid()));
create policy own_coverage on public.quiz_coverage for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.quiz_cycles,public.quiz_coverage from anon,authenticated;
grant select on public.quiz_cycles,public.quiz_coverage to authenticated;

create function public.quiz_coverage_status()returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();cycle integer;eligible integer;covered integer;begin
 if uid is null then raise exception 'Sign in required' using errcode='42501';end if;
 select coalesce((select round from public.quiz_cycles where user_id=uid),1) into cycle;
 with ids as materialized(select distinct word_id from app_private.quiz_bank(uid,array['multiple_choice']))
 select count(*),count(c.word_id) into eligible,covered from ids left join public.quiz_coverage c on c.user_id=uid and c.round=cycle and c.word_id=ids.word_id;
 return jsonb_build_object('round',cycle,'total',eligible,'covered',covered,'remaining',eligible-covered);
end $$;

create function public.quiz_plan_start(p_operation uuid,p_count integer default 10,p_new_percent integer default 60,p_directions text[] default array['bangla_arabic','arabic_bangla','arabic_english','english_arabic'],p_new boolean default true,p_mastered boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();payload text;prior app_private.sync_operations;cycle integer;status jsonb;questions jsonb;s public.user_settings;session public.quiz_sessions;begin
 if uid is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_operation is null or p_count is null or p_count not between 1 and 100 or p_new_percent is null or p_new_percent not between 1 and 100 or p_new is null or p_mastered is null or p_directions is null or cardinality(p_directions) not between 1 and 4 or array_position(p_directions,null) is not null or not p_directions<@array['bangla_arabic','arabic_bangla','arabic_english','english_arabic']::text[] then raise exception 'Invalid quiz options' using errcode='22023';end if;
 payload:=jsonb_build_array('quiz_plan_start',p_count,p_new_percent,p_directions,p_new,p_mastered)::text;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':quiz-cycle',0));
 select * into prior from app_private.sync_operations where user_id=uid and operation_id=p_operation;
 if found then if prior.payload_hash<>md5(payload) then raise exception 'Operation reused' using errcode='22023';end if;return prior.result;end if;
 insert into public.quiz_cycles(user_id)values(uid)on conflict do nothing;
 status:=public.quiz_coverage_status();cycle:=(status->>'round')::integer;
 if (status->>'total')::integer>0 and (status->>'remaining')::integer=0 then cycle:=cycle+1;update public.quiz_cycles set round=cycle where user_id=uid;end if;
 status:=public.quiz_coverage_status();
 select * into s from public.user_settings where user_id=uid;
 with bank as materialized(select * from app_private.quiz_bank(uid,array['multiple_choice'])),
 candidates as materialized(
  select b.word_id,b.value,c.last_seen,c.word_id is null fresh,
   row_number()over(partition by b.word_id order by random()) choice_rank,w.created_at
  from bank b join public.words w on w.id=b.word_id and w.user_id=uid
  left join public.quiz_coverage c on c.user_id=uid and c.round=cycle and c.word_id=b.word_id
  left join public.word_review_state r on r.user_id=uid and r.word_id=w.id and r.algorithm='fixed'
  where b.value->>'direction'=any(p_directions) and (p_new or coalesce(r.review_count,0)>0) and (p_mastered or r.mastery_status is distinct from 'mastered')
 ), ranked as(
  select *,row_number()over(partition by fresh order by case when fresh then created_at else last_seen end,word_id) position
  from candidates where choice_rank=1
 ), selected as(
  select * from ranked order by
   case when fresh and position<=ceil(p_count*p_new_percent/100.0) then 0
        when not fresh and position<=p_count-ceil(p_count*p_new_percent/100.0) then 1
        when fresh then 2 else 3 end,position limit p_count
 )select coalesce(jsonb_agg(value||jsonb_build_object('word_id',word_id,'id',gen_random_uuid(),'fresh',fresh) order by random()),'[]')into questions from selected;
 if jsonb_array_length(questions)=0 then return jsonb_build_object('empty',true);end if;
 insert into public.quiz_sessions(user_id,operation_id,started_at,timezone,settings_snapshot,question_count,questions)
 values(uid,p_operation,statement_timestamp(),s.timezone,jsonb_build_object('coverage_round',cycle,'coverage_total',status->'total','coverage_done',status->'covered','count',p_count,'new_percent',p_new_percent,'directions',p_directions,'include_new',p_new,'include_mastered',p_mastered),jsonb_array_length(questions),questions)returning * into session;
 insert into app_private.sync_operations values(uid,p_operation,md5(payload),to_jsonb(session),now());return to_jsonb(session);
end $$;

-- Keep server scoring and history intact; mark coverage only after completion.
alter function public.quiz_finish(uuid,uuid,jsonb)rename to quiz_finish_scored;
alter function public.quiz_finish_scored(uuid,uuid,jsonb)set schema app_private;
revoke all on function app_private.quiz_finish_scored(uuid,uuid,jsonb)from public,anon,authenticated;
create function public.quiz_finish(p_operation uuid,p_session uuid,p_answers jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;cycle integer;uid uuid:=auth.uid();begin
 if uid is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':quiz-cycle',0));
 result:=app_private.quiz_finish_scored(p_operation,p_session,p_answers);
 cycle:=(result->'settings_snapshot'->>'coverage_round')::integer;
 if cycle is not null then
  insert into public.quiz_coverage(user_id,round,word_id,last_seen)
  select uid,cycle,(q->>'word_id')::uuid,(result->>'completed_at')::timestamptz from jsonb_array_elements(result->'questions')q
  on conflict(user_id,round,word_id)do update set last_seen=greatest(public.quiz_coverage.last_seen,excluded.last_seen);
 end if;
 return result;
end $$;
revoke all on function public.quiz_plan_start(uuid,integer,integer,text[],boolean,boolean),public.quiz_coverage_status(),public.quiz_finish(uuid,uuid,jsonb)from public,anon;
grant execute on function public.quiz_plan_start(uuid,integer,integer,text[],boolean,boolean),public.quiz_coverage_status(),public.quiz_finish(uuid,uuid,jsonb)to authenticated;
notify pgrst,'reload schema';
commit;
