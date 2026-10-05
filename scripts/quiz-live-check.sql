begin;
set local statement_timeout='2s';
-- Disposable identity and vocabulary, fully rolled back; no learner accounts read.
insert into auth.users(id) values('c16f33f1-30af-45c1-bb73-7155a0b5fd64');
insert into public.words(user_id,arabic_word,normalized_arabic,english_meaning,bangla_meaning,word_type)
select 'c16f33f1-30af-45c1-bb73-7155a0b5fd64','كتاب '||i,'كتاب '||i,'book '||i,'বই '||i,'noun' from generate_series(1,63)i;
select set_config('request.jwt.claim.sub','c16f33f1-30af-45c1-bb73-7155a0b5fd64',true) is not null as fixture_selected;
set local role authenticated;
select jsonb_array_length(public.quiz_start(gen_random_uuid(),10,array['multiple_choice'])->'questions') as question_count;
rollback;
