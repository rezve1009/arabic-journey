-- Phase 4 only. Existing vocabulary operations remain the transactional core.
begin;
create function app_private.normalize_arabic(value text, p_harakah boolean default true,
  p_tatweel boolean default true, p_unicode boolean default true) returns text
language plpgsql immutable strict set search_path='' as $$
declare result text:=value;
begin
  if p_unicode then result:=normalize(result,NFKC);end if;
  if p_harakah then result:=regexp_replace(result,U&'[\0610-\061A\064B-\065F\0670\06D6-\06ED]','','g');end if;
  if p_tatweel then result:=replace(result,U&'\0640','');end if;
  -- Explicit whitespace keeps client/server behavior independent of DB locale.
  return btrim(regexp_replace(result,U&'[\0009-\000D\0020\0085\2000-\2006\2008-\200A\2028\2029\205F\3000]+',' ','g'));
end $$;
revoke all on function app_private.normalize_arabic(text,boolean,boolean,boolean) from public,anon;
grant execute on function app_private.normalize_arabic(text,boolean,boolean,boolean) to authenticated;
create or replace function app_private.vocabulary_normalize(value text) returns text
language sql immutable strict set search_path='' as $$ select app_private.normalize_arabic(value) $$;

create function app_private.valid_arabic_list(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>20 then return false;end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}')) not between 1 and 200 then return false;end if;
  end loop;
  return true;
exception when others then return false;
end $$;
create function app_private.valid_root(value text[]) returns boolean
language sql immutable strict set search_path='' as $$
  select cardinality(value)=0 or (cardinality(value) in (3,4) and not exists
    (select 1 from unnest(value) letter where letter is null or letter !~ '^[ء-غف-يٮٯٱ-ۓ]$'))
$$;
create function app_private.valid_verb_data(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item record;
begin
  if jsonb_typeof(value) is distinct from 'object' then return false;end if;
  for item in select * from jsonb_each(value) loop
    if item.key='conjugations' then
      if not app_private.valid_conjugations(item.value) then return false;end if;
    elsif item.key='masdars' then
      if not app_private.valid_arabic_list(item.value) then return false;end if;
    elsif item.key='verb_form' then
      if item.value<>'null'::jsonb and (jsonb_typeof(item.value)<>'number' or (item.value#>>'{}')::numeric not between 1 and 10
        or (item.value#>>'{}')::numeric<>trunc((item.value#>>'{}')::numeric)) then return false;end if;
    elsif item.key in ('past_base','present_base','imperative','active_participle','passive_participle') then
      if jsonb_typeof(item.value)<>'string' or length(item.value#>>'{}')>200 then return false;end if;
    else return false;end if;
  end loop;
  return true;
exception when others then return false;
end $$;
create function app_private.valid_morphology(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item record;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>30000 then return false;end if;
  for item in select * from jsonb_each(value) loop
    if item.key in ('singular','dual','masculine','feminine') then
      if jsonb_typeof(item.value)<>'string' or length(item.value#>>'{}')>200 then return false;end if;
    elsif item.key in ('plurals','broken_plurals','synonyms','antonyms') then
      if not app_private.valid_arabic_list(item.value) then return false;end if;
    elsif item.key='_verb' then
      if not app_private.valid_verb_data(item.value) then return false;end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function app_private.valid_arabic_list(jsonb),app_private.valid_root(text[]),app_private.valid_verb_data(jsonb),app_private.valid_morphology(jsonb) from public,anon;
grant execute on function app_private.valid_arabic_list(jsonb),app_private.valid_root(text[]),app_private.valid_verb_data(jsonb),app_private.valid_morphology(jsonb) to authenticated;
-- NOT VALID preserves pre-existing manual data; new/updated rows must meet these bounds.
alter table public.words add constraint words_root_letters_check check(app_private.valid_root(root)) not valid;
alter table public.words add constraint words_morphology_bounds_check check(app_private.valid_morphology(morphology)) not valid;

alter function public.vocabulary_write(uuid,text,uuid,bigint,jsonb,uuid[],boolean) set schema app_private;
alter function app_private.vocabulary_write(uuid,text,uuid,bigint,jsonb,uuid[],boolean) rename to vocabulary_write_base;
revoke all on function app_private.vocabulary_write_base(uuid,text,uuid,bigint,jsonb,uuid[],boolean) from public,anon,authenticated;

create function public.vocabulary_write(p_operation uuid,p_action text,p_id uuid,
  p_revision bigint default null,p_values jsonb default '{}',p_tags uuid[] default '{}',
  p_allow_duplicate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid:=auth.uid();payload text;prior app_private.sync_operations;existing public.words;
  grammar_keys text[]:=array['root','root_meaning','wazn','verb_form','masdars','past_base','present_base','imperative','active_participle','passive_participle','morphology','conjugations','linguistic_provenance'];
  verb_keys text[]:=array['verb_form','masdars','past_base','present_base','imperative','active_participle','passive_participle','conjugations'];
  verbs jsonb;grammar jsonb;outcome jsonb;saved public.words;expected bigint:=p_revision;kind text;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode='42501';end if;
  if p_operation is null or p_id is null or p_values is null or p_tags is null or jsonb_typeof(p_values)<>'object' then
    raise exception 'Invalid morphology request' using errcode='22023';end if;
  payload:=jsonb_build_array(p_action,p_id,p_revision,p_values,p_tags,p_allow_duplicate)::text;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||p_operation::text,0));
  select * into prior from app_private.sync_operations where user_id=owner_id and operation_id=p_operation;
  if found then
    if prior.payload_hash<>md5(payload) then raise exception 'Operation reused with different data' using errcode='22023';end if;
    return prior.result;
  end if;
  if p_action<>'save' then
    return app_private.vocabulary_write_base(p_operation,p_action,p_id,p_revision,p_values,p_tags,p_allow_duplicate);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||'vocabulary',0));
  select * into existing from public.words where id=p_id and user_id=owner_id for update;
  if (p_revision is null and existing.id is not null) or
    (p_revision is not null and (existing.id is null or existing.deleted_at is not null or existing.revision<>p_revision)) then
    raise exception 'Word changed or unavailable' using errcode='40001';end if;
  kind:=coalesce(p_values->>'word_type','other');
  if existing.word_type='verb' then
    select jsonb_object_agg(key,value) into verbs from jsonb_each(to_jsonb(existing)) where key=any(verb_keys);
  else verbs:=coalesce(existing.morphology->'_verb','{}');end if;
  select coalesce(verbs,'{}')||coalesce(jsonb_object_agg(key,value),'{}') into verbs
    from jsonb_each(p_values) where key=any(verb_keys);
  grammar:=(coalesce(existing.morphology,'{}')||coalesce(p_values->'morphology','{}'))-'_verb';
  if not app_private.valid_verb_data(verbs) or not app_private.valid_morphology(grammar) then
    raise exception 'Invalid morphology fields' using errcode='22023';end if;
  if p_values ? 'root' and (jsonb_typeof(p_values->'root')<>'array' or not app_private.valid_root(array(select jsonb_array_elements_text(p_values->'root')))) then
    raise exception 'Invalid root letters' using errcode='22023';end if;
  if length(coalesce(p_values->>'root_meaning',''))>2000 or length(coalesce(p_values->>'wazn',''))>200 then
    raise exception 'Morphology field too long' using errcode='22023';end if;
  begin
    -- Retain authored grammar when changing type, satisfying the foundation constraint.
    if existing.word_type='verb' and kind<>'verb' and (existing.verb_form is not null or existing.conjugations<>'{}') then
      update public.words set verb_form=null,conjugations='{}' where id=p_id and user_id=owner_id returning revision into expected;
    end if;
    outcome:=app_private.vocabulary_write_base(p_operation,p_action,p_id,expected,p_values-grammar_keys,p_tags,p_allow_duplicate);
    if outcome ? 'duplicates' then raise exception 'Duplicate warning' using errcode='P0404';end if;
  exception when sqlstate 'P0404' then
    -- Subtransaction rolls back preparation; a warning changes no rows or revisions.
    return outcome;
  end;
  select * into saved from public.words where id=p_id and user_id=owner_id;
  if kind<>'verb' then grammar:=grammar||jsonb_build_object('_verb',verbs);end if;
  if p_values ?| grammar_keys or existing.word_type is distinct from kind then
    update public.words set
      root=case when p_values ? 'root' then array(select jsonb_array_elements_text(p_values->'root')) else saved.root end,
      root_meaning=coalesce(p_values->>'root_meaning',saved.root_meaning),wazn=coalesce(p_values->>'wazn',saved.wazn),
      verb_form=case when kind='verb' then (verbs->>'verb_form')::integer else null end,
      masdars=case when kind='verb' then array(select jsonb_array_elements_text(coalesce(verbs->'masdars','[]'))) else '{}' end,
      past_base=case when kind='verb' then coalesce(verbs->>'past_base','') else '' end,
      present_base=case when kind='verb' then coalesce(verbs->>'present_base','') else '' end,
      imperative=case when kind='verb' then coalesce(verbs->>'imperative','') else '' end,
      active_participle=case when kind='verb' then coalesce(verbs->>'active_participle','') else '' end,
      passive_participle=case when kind='verb' then coalesce(verbs->>'passive_participle','') else '' end,
      conjugations=case when kind='verb' then coalesce(verbs->'conjugations','{}') else '{}' end,
      morphology=grammar,linguistic_provenance=coalesce(p_values->>'linguistic_provenance',saved.linguistic_provenance)
      where id=p_id and user_id=owner_id returning * into saved;
    outcome:=jsonb_build_object('word',to_jsonb(saved));
  end if;
  update app_private.sync_operations set payload_hash=md5(payload),result=outcome where user_id=owner_id and operation_id=p_operation;
  return outcome;
end $$;
revoke all on function public.vocabulary_write(uuid,text,uuid,bigint,jsonb,uuid[],boolean) from public,anon;
grant execute on function public.vocabulary_write(uuid,text,uuid,bigint,jsonb,uuid[],boolean) to authenticated;

create function public.save_arabic_display(p_revision bigint,p_harakah_mode text,p_font_size integer,p_future_prefix text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.user_settings;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
  update public.user_settings set harakah_mode=p_harakah_mode,arabic_font_size=p_font_size,future_prefix=p_future_prefix
    where user_id=auth.uid() and revision=p_revision returning * into saved;
  if not found then raise exception 'Settings changed' using errcode='40001';end if;
  return to_jsonb(saved);
end $$;
revoke all on function public.save_arabic_display(bigint,text,integer,text) from public,anon;
grant execute on function public.save_arabic_display(bigint,text,integer,text) to authenticated;

-- Keep the existing RPC name/arguments compatible, adding optional search controls.
drop function public.vocabulary_list(text,text,text,uuid,boolean,date,date,integer);
create function public.vocabulary_list(p_search text default '',p_type text default '',
  p_status text default '',p_tag uuid default null,p_favorite boolean default false,
  p_from date default null,p_to date default null,p_page integer default 0,
  p_root text default '',p_harakah boolean default true,p_tatweel boolean default true,p_unicode boolean default true)
returns jsonb language sql stable security invoker set search_path='' as $$
  with matched as (
    select w.id,w.arabic_word,w.bangla_meaning,w.english_meaning,w.word_type,w.favorite,
      w.needs_details,w.created_at,w.revision,w.root,w.wazn
    from public.words w where w.user_id=auth.uid() and w.deleted_at is null
      and (coalesce(p_type,'')='' or w.word_type=p_type)
      and (not coalesce(p_favorite,false) or w.favorite)
      and (coalesce(p_status,'')='' or (p_status='needs-details' and w.needs_details)
        or (p_status='new' and not exists(select 1 from public.word_review_state r where r.word_id=w.id and r.user_id=w.user_id and r.deleted_at is null)))
      and (p_tag is null or exists(select 1 from public.word_tags wt join public.tags t on t.id=wt.tag_id and t.user_id=wt.user_id
        where wt.word_id=w.id and wt.user_id=w.user_id and wt.tag_id=p_tag and wt.deleted_at is null and t.deleted_at is null))
      and (p_from is null or w.created_at>=p_from::timestamp at time zone 'UTC')
      and (p_to is null or w.created_at<(p_to+1)::timestamp at time zone 'UTC')
      and (coalesce(btrim(p_root),'')='' or w.root=regexp_split_to_array(regexp_replace(app_private.vocabulary_normalize(p_root),'[[:space:],،—-]','','g'),''))
      and (coalesce(btrim(p_search),'')='' or strpos(lower(app_private.normalize_arabic(concat_ws(' ',w.arabic_word,w.arabic_meaning,w.bangla_meaning,w.english_meaning,
        w.transliteration,w.example_arabic,w.example_bangla,w.example_english,w.notes,w.root_meaning,w.wazn,array_to_string(w.root,''),array_to_string(w.masdars,' '),
        w.past_base,w.present_base,w.imperative,w.active_participle,w.passive_participle,
        w.morphology->>'singular',w.morphology->>'dual',w.morphology->>'masculine',w.morphology->>'feminine',
        w.morphology->>'plurals',w.morphology->>'broken_plurals',w.morphology->>'synonyms',w.morphology->>'antonyms',
        (select string_agg(t.name,' ') from public.word_tags wt join public.tags t on t.id=wt.tag_id and t.user_id=wt.user_id where wt.word_id=w.id and wt.user_id=w.user_id and wt.deleted_at is null and t.deleted_at is null)),p_harakah,p_tatweel,p_unicode)),
        lower(app_private.normalize_arabic(btrim(p_search),p_harakah,p_tatweel,p_unicode)))>0)
  ), selected as (select * from matched order by created_at desc,id desc limit 25 offset greatest(coalesce(p_page,0),0)*25)
  select jsonb_build_object('total',(select count(*) from matched),'words',coalesce((select jsonb_agg(to_jsonb(selected) order by created_at desc,id desc) from selected),'[]'))
$$;
revoke all on function public.vocabulary_list(text,text,text,uuid,boolean,date,date,integer,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.vocabulary_list(text,text,text,uuid,boolean,date,date,integer,text,boolean,boolean,boolean) to authenticated;
commit;
