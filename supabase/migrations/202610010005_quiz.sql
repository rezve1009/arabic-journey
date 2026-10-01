
begin;
alter table public.quiz_sessions add column questions jsonb not null default '[]';
create function app_private.question_bank(w public.words) returns jsonb language plpgsql stable set search_path='' as $$
declare q jsonb:='[]';item record;tense record;prompt text;begin
 q:=jsonb_build_array(jsonb_build_object('type','arabic_bangla','prompt',w.arabic_word,'answers',jsonb_build_array(w.bangla_meaning)),jsonb_build_object('type','arabic_english','prompt',w.arabic_word,'answers',jsonb_build_array(w.english_meaning)),jsonb_build_object('type','bangla_arabic','prompt',w.bangla_meaning,'answers',jsonb_build_array(w.arabic_word)),jsonb_build_object('type','english_arabic','prompt',w.english_meaning,'answers',jsonb_build_array(w.arabic_word)),jsonb_build_object('type','arabic_typing','prompt',w.english_meaning,'answers',jsonb_build_array(w.arabic_word)),jsonb_build_object('type','multiple_choice','prompt',w.arabic_word,'answers',jsonb_build_array(w.english_meaning)),jsonb_build_object('type','true_false','prompt',w.arabic_word||' = '||w.english_meaning,'answers',jsonb_build_array('true')));
 if cardinality(w.root)>0 then q:=q||jsonb_build_array(jsonb_build_object('type','root','prompt',w.arabic_word,'answers',jsonb_build_array(array_to_string(w.root,' '))));end if;
 if cardinality(w.masdars)>0 then q:=q||jsonb_build_array(jsonb_build_object('type','masdar','prompt',w.arabic_word,'answers',to_jsonb(w.masdars)));end if;
 if w.word_type='verb' and w.verb_form is not null then q:=q||jsonb_build_array(jsonb_build_object('type','verb_form','prompt',w.arabic_word,'answers',jsonb_build_array(w.verb_form::text)));end if;
 if w.example_arabic<>'' and position(w.arabic_word in w.example_arabic)>0 then q:=q||jsonb_build_array(jsonb_build_object('type','fill_blank','prompt',replace(w.example_arabic,w.arabic_word,'____'),'answers',jsonb_build_array(w.arabic_word)));end if;
 if w.word_type='verb' then for item in select * from jsonb_each(w.conjugations) loop for tense in select * from jsonb_each_text(item.value) loop if trim(tense.value)<>'' then q:=q||jsonb_build_array(jsonb_build_object('type','conjugation','prompt',w.arabic_word,'pronoun',item.key,'tense',tense.key,'answers',jsonb_build_array(tense.value)));end if;end loop;end loop;end if;
 return q;
end$$;
revoke all on function app_private.question_bank(public.words) from public,anon,authenticated;
create function public.quiz_start(p_operation uuid,p_count integer,p_types text[],p_weak integer default 30,p_new boolean default true,p_mastered boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();payload text;prior app_private.sync_operations;s public.user_settings;questions jsonb;session public.quiz_sessions;begin
 if uid is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_operation is null or p_count not between 1 and 100 or p_weak not between 0 and 100 or cardinality(p_types) not between 1 and 12 or not p_types <@ array['arabic_bangla','arabic_english','bangla_arabic','english_arabic','arabic_typing','root','masdar','verb_form','conjugation','fill_blank','multiple_choice','true_false']::text[] then raise exception 'Invalid quiz' using errcode='22023';end if;
 payload:=jsonb_build_array('quiz_start',p_count,p_types,p_weak,p_new,p_mastered)::text;perform pg_advisory_xact_lock(hashtextextended(uid::text||p_operation::text,0));select * into prior from app_private.sync_operations where user_id=uid and operation_id=p_operation;if found then if prior.payload_hash<>md5(payload) then raise exception 'Operation reused' using errcode='22023';end if;return prior.result;end if;
 select * into s from public.user_settings where user_id=uid;
 with candidates as (select w.id,q.value,coalesce(r.weak_score,0)>=2 weak,random() r from public.words w left join public.word_review_state r on r.word_id=w.id and r.user_id=w.user_id and r.algorithm='fixed' cross join lateral jsonb_array_elements(app_private.question_bank(w)) q where w.user_id=uid and w.deleted_at is null and q.value->>'type'=any(p_types) and (p_new or coalesce(r.review_count,0)>0) and (p_mastered or r.mastery_status is distinct from 'mastered')),
 ranked as (select *,row_number() over(partition by weak order by r) rn from candidates),selected as(select * from ranked order by case when weak and rn<=ceil(p_count*p_weak/100.0) then 0 else 1 end,r limit p_count)
 select coalesce(jsonb_agg(value||jsonb_build_object('word_id',id,'id',gen_random_uuid())),'[]') into questions from selected;
 if jsonb_array_length(questions)=0 then return jsonb_build_object('empty',true);end if;
 -- MC alternatives are distinct authored meanings. With insufficient choices use typing.
 select jsonb_agg(case when q->>'type'='multiple_choice' then q||jsonb_build_object('choices',coalesce((select jsonb_agg(v) from(select q->'answers'->>0 v union all select v from(select distinct english_meaning v from public.words where user_id=uid and deleted_at is null and english_meaning<>q->'answers'->>0 limit 3) alternatives)c),'[]')) else q end) into questions from jsonb_array_elements(questions)q;
 select jsonb_agg(case when q->>'type'='true_false' and random()<0.5 then coalesce((select q||jsonb_build_object('prompt',(select arabic_word from public.words where user_id=uid and id=(q->>'word_id')::uuid)||' = '||english_meaning,'answers',jsonb_build_array('false'))from public.words where user_id=uid and deleted_at is null and english_meaning<>q->'answers'->>0 and english_meaning<>(select english_meaning from public.words where user_id=uid and id=(q->>'word_id')::uuid) order by random()limit 1),q)else q end)into questions from jsonb_array_elements(questions)q;
 insert into public.quiz_sessions(user_id,operation_id,started_at,timezone,settings_snapshot,question_count,questions) values(uid,p_operation,statement_timestamp(),s.timezone,jsonb_build_object('count',p_count,'types',p_types,'weak',p_weak,'new',p_new,'mastered',p_mastered),jsonb_array_length(questions),questions) returning * into session;
 insert into app_private.sync_operations values(uid,p_operation,md5(payload),to_jsonb(session),now());return to_jsonb(session);
end$$;
create function public.quiz_finish(p_operation uuid,p_session uuid,p_answers jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();payload text;prior app_private.sync_operations;s public.quiz_sessions;a jsonb;q jsonb;correct boolean;points integer:=0;seen uuid[]:='{}';begin
 if uid is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_operation is null or jsonb_typeof(p_answers)<>'array' then raise exception 'Invalid answers' using errcode='22023';end if;
 payload:=jsonb_build_array('quiz_finish',p_session,p_answers)::text;perform pg_advisory_xact_lock(hashtextextended(uid::text||p_operation::text,0));select * into prior from app_private.sync_operations where user_id=uid and operation_id=p_operation;if found then if prior.payload_hash<>md5(payload) then raise exception 'Operation reused' using errcode='22023';end if;return prior.result;end if;
 select * into s from public.quiz_sessions where user_id=uid and id=p_session for update;if not found or s.completed_at is not null then raise exception 'Quiz unavailable' using errcode='40001';end if;
 if jsonb_array_length(p_answers)<>s.question_count then raise exception 'Incomplete quiz' using errcode='22023';end if;
 for a in select * from jsonb_array_elements(p_answers) loop
 select value into q from jsonb_array_elements(s.questions) where value->>'id'=a->>'id';if q is null or (a->>'id')::uuid=any(seen) or length(a->>'answer')>2000 or (a->>'response_ms')::bigint not between 0 and 2147483647 then raise exception 'Invalid answer' using errcode='22023';end if;seen:=array_append(seen,(a->>'id')::uuid);
 correct:=exists(select 1 from jsonb_array_elements_text(q->'answers') e where lower(trim(app_private.normalize_arabic(a->>'answer',true,true,true)))=lower(trim(app_private.normalize_arabic(e,true,true,true))));
 insert into public.quiz_answers(user_id,session_id,word_id,operation_id,question_type,question_snapshot,expected_answer,submitted_answer,correct,response_ms)values(uid,p_session,(q->>'word_id')::uuid,(a->>'id')::uuid,q->>'type',q,q->'answers',to_jsonb(a->>'answer'),correct,(a->>'response_ms')::integer);points:=points+case when correct then 1 else 0 end;
 end loop;
 update public.quiz_sessions set completed_at=statement_timestamp(),score=points where id=p_session returning * into s;
 insert into public.study_sessions(user_id,operation_id,kind,started_at,completed_at,timezone,local_study_date,activity_counts)values(uid,p_operation,'quiz',s.started_at,s.completed_at,s.timezone,(s.completed_at at time zone s.timezone)::date,jsonb_build_object('questions',s.question_count,'correct',points));
 insert into app_private.sync_operations values(uid,p_operation,md5(payload),to_jsonb(s),now());return to_jsonb(s);
end$$;
revoke all on function public.quiz_start(uuid,integer,text[],integer,boolean,boolean),public.quiz_finish(uuid,uuid,jsonb) from public,anon;
grant execute on function public.quiz_start(uuid,integer,text[],integer,boolean,boolean),public.quiz_finish(uuid,uuid,jsonb) to authenticated;
commit;
