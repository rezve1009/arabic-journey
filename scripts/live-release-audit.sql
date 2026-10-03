begin;
insert into auth.users(id,email) values('ad148df5-88e0-4817-a792-de87adce3301','release-a@example.invalid'),('ad148df5-88e0-4817-a792-de87adce3302','release-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','ad148df5-88e0-4817-a792-de87adce3301',true);
do $audit$
declare w uuid:='ad148df5-88e0-4817-a792-de87adce3303';q jsonb;begin
perform public.vocabulary_write(gen_random_uuid(),'save',w,null,'{"arabic_word":"كَتَبَ","english_meaning":"wrote","bangla_meaning":"লিখেছে","word_type":"verb","root":["ك","ت","ب"],"masdars":["كِتَابَةٌ"],"verb_form":1}'::jsonb);
q:=public.quiz_start(gen_random_uuid(),5,array['root','masdar']);
if jsonb_array_length(q->'questions')<>2 then raise exception 'Authored quiz failed';end if;
if (public.learning_statistics()->>'total')::int<>1 then raise exception 'Statistics ownership failed';end if;
if (public.activity_history(p_kind=>'word')->>'total')::int<>1 then raise exception 'Activity word history failed';end if;
if (public.vocabulary_list(p_status=>'today')->>'total')::int<>1 or (public.vocabulary_list(p_status=>'learning')->>'total')::int<>1 then raise exception 'Dashboard category filters failed';end if;
perform public.backup_export();
q:=public.quiz_start(gen_random_uuid(),5,array['multiple_choice']);
if not (q->>'empty')::boolean then raise exception 'One-word MCQ must be empty';end if;
perform public.vocabulary_write(gen_random_uuid(),'save',gen_random_uuid(),null,'{"arabic_word":"قَلَمٌ","english_meaning":"pen","bangla_meaning":"কলম","word_type":"noun"}'::jsonb);
q:=public.quiz_start(gen_random_uuid(),5,array['multiple_choice']);
if jsonb_array_length(q->'questions')<>5 or exists(select 1 from jsonb_array_elements(q->'questions') question where jsonb_array_length(question->'choices')<>2)then raise exception 'MCQ options failed';end if;
perform set_config('request.jwt.claim.sub','ad148df5-88e0-4817-a792-de87adce3302',true);
if (public.activity_history()->>'total')::int<>0 then raise exception 'Cross-owner activity access';end if;
if exists(select 1 from public.words)then raise exception 'Cross-owner word access';end if;
if exists(select 1 from public.quiz_sessions)then raise exception 'Cross-owner quiz access';end if;
begin perform public.claim_reminders();raise exception 'Unauthorized job permitted';exception when insufficient_privilege then null;end;
end$audit$;
rollback;
select 'passed: authored quiz, owned statistics, cross-owner RLS, server job privileges; all test data rolled back' as audit;
