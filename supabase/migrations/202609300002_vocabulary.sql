-- Phase 3: owner-scoped transactional vocabulary operations. No learning writes.
create function app_private.vocabulary_normalize(value text) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(normalize(value, NFKC),
    U&'[\0640\0610-\061A\064B-\065F\0670\06D6-\06ED]', '', 'g'), '\s+', ' ', 'g'))
$$;
grant execute on function app_private.vocabulary_normalize(text) to authenticated;

create function public.vocabulary_write(p_operation uuid, p_action text, p_id uuid,
  p_revision bigint default null, p_values jsonb default '{}', p_tags uuid[] default '{}',
  p_allow_duplicate boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid(); payload text; previous app_private.sync_operations;
  word public.words; tag public.tags; result jsonb; duplicates jsonb; normalized text;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_operation is null or p_id is null or p_values is null or p_tags is null
    or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Invalid vocabulary request' using errcode = '22023';
  end if;
  payload := jsonb_build_array(p_action,p_id,p_revision,p_values,p_tags,p_allow_duplicate)::text;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || p_operation::text, 0));
  select * into previous from app_private.sync_operations
    where user_id = owner_id and operation_id = p_operation;
  if found then
    if previous.payload_hash <> md5(payload) then
      raise exception 'Operation reused with different data' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || 'vocabulary', 0));
  if p_action in ('save','favorite','delete') then
    -- Serializes writes and duplicate checks for this account, including new IDs.
    select * into word from public.words where id = p_id and user_id = owner_id for update;
    if (p_revision is null and word.id is not null) or
       (p_revision is not null and (word.id is null or word.deleted_at is not null or word.revision <> p_revision)) then
      raise exception 'Word changed or unavailable' using errcode = '40001';
    end if;
    if p_action <> 'save' and word.id is null then
      raise exception 'Word unavailable' using errcode = '40001';
    end if;
    if p_action = 'save' then
      if exists (select 1 from jsonb_object_keys(p_values) as k where k not in
        ('arabic_word','bangla_meaning','english_meaning','arabic_meaning','transliteration',
         'word_type','example_arabic','example_bangla','example_english','notes','favorite','needs_details')) then
        raise exception 'Unsupported word field' using errcode = '22023';
      end if;
      if exists(select 1 from jsonb_each_text(p_values) as field
        where length(field.value) > case when field.key='notes' then 20000 else 2000 end) then
        raise exception 'Word field too long' using errcode='22023';
      end if;
      normalized := app_private.vocabulary_normalize(p_values->>'arabic_word');
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'arabic_word',arabic_word,
        'english_meaning',english_meaning,'bangla_meaning',bangla_meaning,'revision',revision)), '[]')
        into duplicates from (select * from public.words where user_id = owner_id
          and deleted_at is null and normalized_arabic = normalized and id <> p_id
          order by created_at desc limit 10) as matches;
      if jsonb_array_length(duplicates) > 0 and not p_allow_duplicate then
        return jsonb_build_object('duplicates',duplicates);
      end if;
      if cardinality(p_tags) > 100 or exists (select 1 from unnest(p_tags) as wanted
        where not exists (select 1 from public.tags where id = wanted and user_id = owner_id and deleted_at is null)) then
        raise exception 'Tag unavailable' using errcode = '22023';
      end if;
      if word.id is null then
        insert into public.words(id,user_id,arabic_word,normalized_arabic,bangla_meaning,english_meaning)
          values(p_id,owner_id,p_values->>'arabic_word',normalized,p_values->>'bangla_meaning',p_values->>'english_meaning');
      end if;
      update public.words set
        arabic_word=p_values->>'arabic_word', normalized_arabic=normalized, normalization_version=1,
        bangla_meaning=p_values->>'bangla_meaning', english_meaning=p_values->>'english_meaning',
        arabic_meaning=coalesce(p_values->>'arabic_meaning',''), transliteration=coalesce(p_values->>'transliteration',''),
        word_type=coalesce(p_values->>'word_type','other'), example_arabic=coalesce(p_values->>'example_arabic',''),
        example_bangla=coalesce(p_values->>'example_bangla',''), example_english=coalesce(p_values->>'example_english',''),
        notes=coalesce(p_values->>'notes',''), favorite=coalesce((p_values->>'favorite')::boolean,false),
        needs_details=coalesce((p_values->>'needs_details')::boolean,true)
        where id=p_id and user_id=owner_id returning * into word;
      update public.word_tags set deleted_at=clock_timestamp()
        where user_id=owner_id and word_id=p_id and deleted_at is null and not(tag_id=any(p_tags));
      insert into public.word_tags(user_id,word_id,tag_id)
        select owner_id,p_id,wanted from (select distinct unnest(p_tags) as wanted) as selected
        on conflict(user_id,word_id,tag_id) do update set deleted_at=null
        where public.word_tags.deleted_at is not null;
    elsif p_action = 'favorite' then
      update public.words set favorite=(p_values->>'favorite')::boolean
        where id=p_id and user_id=owner_id returning * into word;
    else
      update public.words set deleted_at=clock_timestamp() where id=p_id and user_id=owner_id returning * into word;
      update public.word_tags set deleted_at=clock_timestamp() where word_id=p_id and user_id=owner_id and deleted_at is null;
    end if;
    result := jsonb_build_object('word',to_jsonb(word));
  elsif p_action in ('tag-save','tag-delete') then
    select * into tag from public.tags where id=p_id and user_id=owner_id for update;
    if (p_revision is null and tag.id is not null) or
       (p_revision is not null and (tag.id is null or tag.deleted_at is not null or tag.revision <> p_revision)) then
      raise exception 'Tag changed or unavailable' using errcode = '40001';
    end if;
    if p_action='tag-save' then
      if tag.id is null then
        insert into public.tags(id,user_id,name,kind) values(p_id,owner_id,p_values->>'name',p_values->>'kind') returning * into tag;
      else
        update public.tags set name=p_values->>'name',kind=p_values->>'kind' where id=p_id and user_id=owner_id returning * into tag;
      end if;
    else
      if tag.id is null then raise exception 'Tag unavailable' using errcode='40001'; end if;
      update public.tags set deleted_at=clock_timestamp() where id=p_id and user_id=owner_id returning * into tag;
      update public.word_tags set deleted_at=clock_timestamp() where tag_id=p_id and user_id=owner_id and deleted_at is null;
    end if;
    result := jsonb_build_object('tag',to_jsonb(tag));
  else raise exception 'Unsupported vocabulary action' using errcode='22023';
  end if;
  insert into app_private.sync_operations(user_id,operation_id,payload_hash,result)
    values(owner_id,p_operation,md5(payload),result);
  return result;
end $$;
revoke all on function public.vocabulary_write(uuid,text,uuid,bigint,jsonb,uuid[],boolean) from public,anon;
grant execute on function public.vocabulary_write(uuid,text,uuid,bigint,jsonb,uuid[],boolean) to authenticated;

create function public.vocabulary_list(p_search text default '', p_type text default '',
  p_status text default '', p_tag uuid default null, p_favorite boolean default false,
  p_from date default null, p_to date default null, p_page integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
  with matched as (
    select w.id,w.arabic_word,w.bangla_meaning,w.english_meaning,w.word_type,w.favorite,
      w.needs_details,w.created_at,w.revision
    from public.words w where w.user_id=auth.uid() and w.deleted_at is null
      and (coalesce(p_type,'')='' or w.word_type=p_type)
      and (not coalesce(p_favorite,false) or w.favorite)
      and (coalesce(p_status,'')='' or (p_status='needs-details' and w.needs_details)
        or (p_status='new' and not exists(select 1 from public.word_review_state r where r.word_id=w.id and r.user_id=w.user_id and r.deleted_at is null)))
      and (p_tag is null or exists(select 1 from public.word_tags wt join public.tags t on t.id=wt.tag_id and t.user_id=wt.user_id
        where wt.word_id=w.id and wt.user_id=w.user_id and wt.tag_id=p_tag and wt.deleted_at is null and t.deleted_at is null))
      and (p_from is null or w.created_at >= p_from::timestamp at time zone 'UTC')
      and (p_to is null or w.created_at < (p_to+1)::timestamp at time zone 'UTC')
      and (coalesce(btrim(p_search),'')='' or strpos(lower(app_private.vocabulary_normalize(concat_ws(' ',w.arabic_word,w.arabic_meaning,w.bangla_meaning,w.english_meaning,
        w.transliteration,w.example_arabic,w.example_bangla,w.example_english,w.notes,array_to_string(w.root,''),array_to_string(w.masdars,' '),
        (select string_agg(t.name,' ') from public.word_tags wt join public.tags t on t.id=wt.tag_id and t.user_id=wt.user_id where wt.word_id=w.id and wt.user_id=w.user_id and wt.deleted_at is null and t.deleted_at is null)))),lower(app_private.vocabulary_normalize(btrim(p_search))))>0)
  ), selected as (select * from matched order by created_at desc,id desc limit 25 offset greatest(coalesce(p_page,0),0)*25)
  select jsonb_build_object('total',(select count(*) from matched),'words',coalesce((select jsonb_agg(to_jsonb(selected) order by created_at desc,id desc) from selected),'[]'))
$$;
revoke all on function public.vocabulary_list(text,text,text,uuid,boolean,date,date,integer) from public,anon;
grant execute on function public.vocabulary_list(text,text,text,uuid,boolean,date,date,integer) to authenticated;

-- Backfill search values using the same versioned rule. Originals remain untouched.
update public.words set normalized_arabic=app_private.vocabulary_normalize(arabic_word),normalization_version=1
  where normalized_arabic is distinct from app_private.vocabulary_normalize(arabic_word);
create index words_active_order_idx on public.words(user_id,created_at desc,id desc) where deleted_at is null;
