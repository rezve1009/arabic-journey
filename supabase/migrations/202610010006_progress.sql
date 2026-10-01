
begin;
alter table public.user_settings add column weak_weights jsonb not null default '{"again":2,"hard":1,"quiz_mistake":2,"slow_ms":15000,"slow":0.5,"success":1,"threshold":2,"low_accuracy":2}';
alter table public.word_review_state add column evidence_score numeric not null default 0 check(evidence_score between 0 and 1000000),add column quiz_count integer not null default 0 check(quiz_count>=0),add column quiz_correct integer not null default 0 check(quiz_correct between 0 and quiz_count);
update public.word_review_state set evidence_score=weak_score where weak_score<>0;
create function public.save_learning_settings(p_revision bigint,p_quiz jsonb,p_mastery jsonb,p_weights jsonb,p_goals jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.user_settings;key text;begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into s from public.user_settings where user_id=auth.uid() for update;if s.revision is distinct from p_revision then raise exception 'Settings changed' using errcode='40001';end if;
 if (p_quiz->>'question_count')::int not between 1 and 100 or (p_quiz->>'weak_percentage')::int not between 0 and 100 or jsonb_array_length(p_quiz->'types') not between 1 and 12 or (p_mastery->>'successful_reviews')::int not between 1 and 1000 or (p_mastery->>'accuracy')::numeric not between 1 and 100 or (p_goals->>'new_words')::int not between 0 and 1000 or (p_goals->>'quiz_questions')::int not between 0 and 1000 or (p_goals->>'minimum_activity')::int not between 1 and 1000 then raise exception 'Invalid learning settings' using errcode='22023';end if;
 if not p_quiz ?& array['question_count','types','weak_percentage','include_new','include_mastered'] or not p_mastery ?& array['successful_reviews','accuracy','require_long_term'] or not p_goals ?& array['new_words','reviews','quiz_questions','minimum_activity'] or not p_weights ?& array['again','hard','quiz_mistake','slow_ms','slow','success','threshold'] then raise exception 'Missing settings' using errcode='22023';end if;
 for key in select jsonb_object_keys(p_weights)loop if (p_weights->>key)::numeric not between 0 and 1000000 then raise exception 'Invalid weight' using errcode='22023';end if;end loop;
 if (p_weights->>'threshold')::numeric<=0 or (p_weights->>'slow_ms')::numeric<100 or (p_goals->>'reviews')::int<0 or not(p_quiz->'types'<@'["arabic_bangla","arabic_english","bangla_arabic","english_arabic","arabic_typing","root","masdar","verb_form","conjugation","fill_blank","multiple_choice","true_false"]'::jsonb) or jsonb_typeof(p_quiz->'include_new')<>'boolean' or jsonb_typeof(p_quiz->'include_mastered')<>'boolean' or jsonb_typeof(p_mastery->'require_long_term')<>'boolean' then raise exception 'Invalid options' using errcode='22023';end if;
 update public.user_settings set quiz_options=p_quiz,mastery_thresholds=p_mastery,weak_weights=p_weights,daily_goals=p_goals where user_id=auth.uid() returning * into s;update public.word_review_state set stage=stage where user_id=auth.uid()and algorithm='fixed';return to_jsonb(s);
end$$;
revoke all on function public.save_learning_settings(bigint,jsonb,jsonb,jsonb,jsonb) from public,anon;grant execute on function public.save_learning_settings(bigint,jsonb,jsonb,jsonb,jsonb) to authenticated;
create function app_private.progress_evidence() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.user_settings;rating text;ms integer;correct boolean;delta numeric;begin
 if current_setting('app.restore',true)='on'then return new;end if;
 select * into s from public.user_settings where user_id=new.user_id;select h.rating,h.response_ms into rating,ms from public.review_history h where h.user_id=new.user_id and h.word_id=new.word_id order by h.occurred_at desc,h.id desc limit 1;
 if new.review_count>old.review_count then delta:=case rating when 'again' then (s.weak_weights->>'again')::numeric when 'hard' then (s.weak_weights->>'hard')::numeric else -(s.weak_weights->>'success')::numeric end;
 elsif new.quiz_count>old.quiz_count then correct:=new.quiz_correct>old.quiz_correct;delta:=case when correct then -(s.weak_weights->>'success')::numeric else (s.weak_weights->>'quiz_mistake')::numeric end;select a.response_ms into ms from public.quiz_answers a where a.user_id=new.user_id and a.word_id=new.word_id order by a.created_at desc,a.id desc limit 1;
 else delta:=0;ms:=0;end if;
 if ms>(s.weak_weights->>'slow_ms')::int then delta:=delta+(s.weak_weights->>'slow')::numeric;end if;
 new.evidence_score:=least(1000000,greatest(0,old.evidence_score+delta));new.weak_score:=least(1000000,new.evidence_score+(new.incorrect_count+new.quiz_count-new.quiz_correct)*coalesce((s.weak_weights->>'low_accuracy')::numeric,2)/greatest(1,new.review_count+new.quiz_count));
 new.mastery_status:=case when new.success_count>=(s.mastery_thresholds->>'successful_reviews')::int and (new.correct_count+new.quiz_correct)*100.0/greatest(1,new.review_count+new.quiz_count)>=(s.mastery_thresholds->>'accuracy')::numeric and (not(s.mastery_thresholds->>'require_long_term')::boolean or new.stage>=jsonb_array_length(s.revision_schedule->'intervals')) then 'mastered' when new.review_count=0 then 'new' when new.stage>=jsonb_array_length(s.revision_schedule->'intervals') then 'reviewing' else 'learning' end;
 return new;
end$$;
create trigger progress_evidence before update on public.word_review_state for each row execute function app_private.progress_evidence();
create function app_private.quiz_evidence() returns trigger language plpgsql security definer set search_path='' as $$begin
 if current_setting('app.restore',true)='on'then return new;end if;
 update public.word_review_state set quiz_count=quiz_count+1,quiz_correct=quiz_correct+case when new.correct then 1 else 0 end where user_id=new.user_id and word_id=new.word_id and algorithm='fixed';return new;end$$;
create trigger quiz_evidence after insert on public.quiz_answers for each row execute function app_private.quiz_evidence();
create function app_private.review_activity() returns trigger language plpgsql security definer set search_path='' as $$declare tz text;begin if current_setting('app.restore',true)='on'then return new;end if;select timezone into tz from public.user_settings where user_id=new.user_id;
 insert into public.study_sessions(user_id,operation_id,kind,started_at,completed_at,timezone,local_study_date,activity_counts)values(new.user_id,new.operation_id,'review',new.occurred_at,new.occurred_at,tz,(new.occurred_at at time zone tz)::date,jsonb_build_object('reviews',1,'correct',case when new.rating='again' then 0 else 1 end));return new;end$$;
create trigger review_activity after insert on public.review_history for each row execute function app_private.review_activity();
revoke all on function app_private.progress_evidence(),app_private.quiz_evidence(),app_private.review_activity() from public,anon,authenticated;
create index quiz_answers_owner_time on public.quiz_answers(user_id,created_at desc);
create index study_activity_date on public.study_sessions(user_id,local_study_date);
create function public.progress_words(p_kind text,p_sort text default 'difficult',p_page integer default 0)returns jsonb language sql stable security invoker set search_path='' as $$
 with eligible as(select w.id,w.arabic_word,w.bangla_meaning,w.english_meaning,w.word_type,r.*,greatest((select max(h.occurred_at)from public.review_history h where h.user_id=w.user_id and h.word_id=w.id and h.rating='again'),(select max(a.created_at)from public.quiz_answers a where a.user_id=w.user_id and a.word_id=w.id and not a.correct)) last_failed from public.words w join public.word_review_state r on r.word_id=w.id and r.user_id=w.user_id join public.user_settings s on s.user_id=w.user_id where w.user_id=auth.uid() and w.deleted_at is null and r.deleted_at is null and r.algorithm='fixed' and case when p_kind='mastered' then r.mastery_status='mastered' else r.weak_score>=(s.weak_weights->>'threshold')::numeric end),selected as(select * from eligible order by case p_sort when 'mistakes' then incorrect_count+quiz_count-quiz_correct when 'accuracy' then (incorrect_count+quiz_count-quiz_correct)*100.0/greatest(1,review_count+quiz_count) when 'recent' then coalesce(extract(epoch from last_failed),0)else weak_score end desc,last_reviewed_at desc nulls last,id limit 25 offset greatest(0,p_page)*25)
 select jsonb_build_object('total',(select count(*)from eligible),'words',coalesce((select jsonb_agg(to_jsonb(selected))from selected),'[]'))$$;
revoke all on function public.progress_words(text,text,integer) from public,anon;grant execute on function public.progress_words(text,text,integer) to authenticated;
commit;
