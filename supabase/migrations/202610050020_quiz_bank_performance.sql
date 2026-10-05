begin;
-- Prepare each authored answer once, rather than normalizing every alternative
-- again for every word and direction. Only the signed-in owner's words enter.
create function app_private.quiz_bank(p_owner uuid,p_types text[])
returns table(word_id uuid,value jsonb) language plpgsql stable set search_path='' as $bank$
begin
 if p_owner is distinct from auth.uid() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_types<>array['multiple_choice']::text[] then
  return query select w.id,q.value from public.words w cross join lateral jsonb_array_elements(app_private.question_bank(w))q where w.user_id=p_owner and w.deleted_at is null and q.value->>'type'=any(p_types);
  return;
 end if;
 return query
 with entries as materialized (
  select w.id,d.direction,d.prompt,d.answer,d.pl,d.al,lower(app_private.normalize_arabic(d.answer,true,true,true)) answer_key
  from public.words w cross join lateral (values
   ('bangla_arabic',w.bangla_meaning,w.arabic_word,'bn','ar'),
   ('arabic_bangla',w.arabic_word,w.bangla_meaning,'ar','bn'),
   ('arabic_english',w.arabic_word,w.english_meaning,'ar','en'),
   ('english_arabic',w.english_meaning,w.arabic_word,'en','ar')
  )d(direction,prompt,answer,pl,al)
  where w.user_id=p_owner and w.deleted_at is null and btrim(d.prompt)<>'' and btrim(d.answer)<>''
 ), correct as materialized (
  select e.direction,e.prompt,jsonb_agg(distinct e.answer order by e.answer) answers,array_agg(distinct e.answer_key) keys
  from entries e group by e.direction,e.prompt
 ), pool as materialized (
  select e.direction,e.answer_key,min(e.answer) answer from entries e group by e.direction,e.answer_key
 )
 select e.id,jsonb_build_object('type','multiple_choice','direction',e.direction,'prompt',e.prompt,'prompt_lang',e.pl,'answer_lang',e.al,'answers',c.answers,'choices',options.choices)
 from entries e join correct c on c.direction=e.direction and c.prompt=e.prompt
 cross join lateral (
  select jsonb_agg(v order by random()) choices from (
   select c.answers->>0 v union all
   select wrong.answer from (
    select p.answer from pool p where p.direction=e.direction and not p.answer_key=any(c.keys) order by random() limit 3
   )wrong
  )answers
 )options
 where jsonb_array_length(options.choices)>=2;
end $bank$;
revoke all on function app_private.quiz_bank(uuid,text[]) from public,anon,authenticated;
create or replace function public.quiz_start(p_operation uuid,p_count integer,p_types text[],p_weak integer default 30,p_new boolean default true,p_mastered boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();payload text;prior app_private.sync_operations;s public.user_settings;questions jsonb;session public.quiz_sessions;begin
 if uid is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_operation is null or p_count not between 1 and 100 or p_weak not between 0 and 100 or cardinality(p_types) not between 1 and 12 or not p_types <@ array['arabic_bangla','arabic_english','bangla_arabic','english_arabic','arabic_typing','root','masdar','verb_form','conjugation','fill_blank','multiple_choice','true_false']::text[] then raise exception 'Invalid quiz' using errcode='22023';end if;
 payload:=jsonb_build_array('quiz_start',p_count,p_types,p_weak,p_new,p_mastered)::text;perform pg_advisory_xact_lock(hashtextextended(uid::text||p_operation::text,0));select * into prior from app_private.sync_operations where user_id=uid and operation_id=p_operation;if found then if prior.payload_hash<>md5(payload) then raise exception 'Operation reused' using errcode='22023';end if;return prior.result;end if;
 select * into s from public.user_settings where user_id=uid;
 with candidates as (select w.id,q.value,coalesce(r.weak_score,0)>=2 weak,random() r from public.words w left join public.word_review_state r on r.word_id=w.id and r.user_id=w.user_id and r.algorithm='fixed' join app_private.quiz_bank(uid,p_types) q on q.word_id=w.id where w.user_id=uid and w.deleted_at is null and q.value->>'type'=any(p_types) and (q.value->>'type'<>'multiple_choice' or q.value ? 'choices' or (trim(w.english_meaning)<>'' and exists(select 1 from public.words alt where alt.user_id=uid and alt.deleted_at is null and trim(alt.english_meaning)<>'' and alt.english_meaning<>w.english_meaning))) and (p_new or coalesce(r.review_count,0)>0) and (p_mastered or r.mastery_status is distinct from 'mastered')),
 ranked as (select *,row_number() over(partition by weak order by r) rn,row_number() over(partition by weak,value->>'direction' order by r) direction_rank from candidates),selected as(select * from ranked order by case when weak and rn<=ceil(p_count*p_weak/100.0) then 0 else 1 end,direction_rank,r limit p_count)
 select coalesce(jsonb_agg(value||jsonb_build_object('word_id',id,'id',gen_random_uuid())),'[]') into questions from selected;
 if jsonb_array_length(questions)=0 then return jsonb_build_object('empty',true);end if;
 -- Only eligible MCQs: never silently replace an MCQ with a typing question.
 select jsonb_agg(case when q->>'type'='multiple_choice' and not q ? 'choices' then q||jsonb_build_object('choices',coalesce((select jsonb_agg(v order by random()) from(select q->'answers'->>0 v union all select v from(select v from(select distinct english_meaning v from public.words where user_id=uid and deleted_at is null and trim(english_meaning)<>'' and english_meaning<>q->'answers'->>0) distinct_meanings order by random() limit 3) alternatives)c),'[]')) else q end) into questions from jsonb_array_elements(questions)q;
 select jsonb_agg(case when q->>'type'='true_false' and random()<0.5 then coalesce((select q||jsonb_build_object('prompt',(select arabic_word from public.words where user_id=uid and id=(q->>'word_id')::uuid)||' = '||english_meaning,'answers',jsonb_build_array('false'))from public.words where user_id=uid and deleted_at is null and english_meaning<>q->'answers'->>0 and english_meaning<>(select english_meaning from public.words where user_id=uid and id=(q->>'word_id')::uuid) order by random()limit 1),q)else q end)into questions from jsonb_array_elements(questions)q;
 insert into public.quiz_sessions(user_id,operation_id,started_at,timezone,settings_snapshot,question_count,questions) values(uid,p_operation,statement_timestamp(),s.timezone,jsonb_build_object('count',p_count,'types',p_types,'weak',p_weak,'new',p_new,'mastered',p_mastered),jsonb_array_length(questions),questions) returning * into session;
 insert into app_private.sync_operations values(uid,p_operation,md5(payload),to_jsonb(session),now());return to_jsonb(session);
end$$;
commit;

