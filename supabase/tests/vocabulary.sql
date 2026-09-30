-- Run after migrations 001 and 002. All fixtures and operations roll back.
begin;
insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true);
do $$
declare saved jsonb; replay jsonb; warning jsonb; op uuid:=gen_random_uuid();
begin
  perform public.vocabulary_write(gen_random_uuid(),'tag-save','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',null,'{"name":"Phase 3 audit","kind":"deck"}');
  saved:=public.vocabulary_write(op,'save','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',null,
    '{"arabic_word":"كَتَبَ","bangla_meaning":"লিখেছে","english_meaning":"wrote","word_type":"verb","needs_details":true}',array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid]);
  replay:=public.vocabulary_write(op,'save','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',null,
    '{"arabic_word":"كَتَبَ","bangla_meaning":"লিখেছে","english_meaning":"wrote","word_type":"verb","needs_details":true}',array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid]);
  if saved<>replay then raise exception 'Retry changed data';end if;
  if (public.vocabulary_list('كتب')->>'total')::int<>1 then raise exception 'Arabic search failed';end if;
  warning:=public.vocabulary_write(gen_random_uuid(),'save',gen_random_uuid(),null,'{"arabic_word":"كتب","bangla_meaning":"লিখেছে","english_meaning":"wrote"}');
  if jsonb_array_length(warning->'duplicates')<>1 then raise exception 'Duplicate warning failed';end if;
  perform public.vocabulary_write(gen_random_uuid(),'favorite','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',(saved->'word'->>'revision')::bigint,'{"favorite":true}');
  if (public.vocabulary_list('','','',null,true)->>'total')::int<>1 then raise exception 'Favorite failed';end if;
  begin
    perform public.vocabulary_write(gen_random_uuid(),'delete','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',(saved->'word'->>'revision')::bigint);
    raise exception 'Stale revision accepted';
  exception when serialization_failure then null;end;
  begin update public.words set english_meaning='unsafe';raise exception 'Direct writes allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',true);
do $$begin
  if (public.vocabulary_list()->>'total')::int<>0 then raise exception 'Cross-user read';end if;
  begin
    perform public.vocabulary_write(gen_random_uuid(),'favorite','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',1,'{"favorite":true}');
    raise exception 'Cross-user write';
  exception when serialization_failure then null;end;
  begin
    perform public.vocabulary_write(gen_random_uuid(),'save',gen_random_uuid(),null,'{"arabic_word":"كِتَابٌ","bangla_meaning":"বই","english_meaning":"book"}',array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid]);
    raise exception 'Cross-user tag';
  exception when invalid_parameter_value then null;end;
end $$;
reset role;
set local role anon;
do $$begin
  begin perform public.vocabulary_list();raise exception 'Anonymous access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: Phase 3 ownership, CRUD, search, duplicates, retries and revisions; fixtures rolled back' as result;
