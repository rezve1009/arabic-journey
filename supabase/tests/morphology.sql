-- Phase 4 live audit: transactional fixtures, no persistent learner data.
begin;
insert into auth.users(id) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
set local role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true);
do $$
declare saved jsonb;replay jsonb;op uuid:=gen_random_uuid();settings_revision bigint;
  values jsonb:='{"arabic_word":"كَتَبَ","bangla_meaning":"লিখেছে","english_meaning":"wrote","word_type":"verb","root":["ك","ت","ب"],"verb_form":1,"masdars":["كِتَابَة","كَتْب"],"present_base":"يَكْتُبُ","conjugations":{"huwa":{"past":"كَتَبَ","present":"يَكْتُبُ"},"anta":{"imperative":"اُكْتُبْ"}}}';
begin
  saved:=public.vocabulary_write(op,'save','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',null,values);
  replay:=public.vocabulary_write(op,'save','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',null,values);
  if saved<>replay then raise exception 'Grammar retry failed';end if;
  if (public.vocabulary_list(p_root=>'ك ت ب')->>'total')::int<>1 then raise exception 'Root filter failed';end if;
  begin
    perform public.vocabulary_write(gen_random_uuid(),'save','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',(saved->'word'->>'revision')::bigint,values||'{"conjugations":{"huwa":{"imperative":"wrong person"}}}');
    raise exception 'Invalid imperative accepted';
  exception when invalid_parameter_value then null;end;
  saved:=public.vocabulary_write(gen_random_uuid(),'save','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',(saved->'word'->>'revision')::bigint,
    '{"arabic_word":"كَتَبَ","bangla_meaning":"লিখেছে","english_meaning":"wrote","word_type":"noun","morphology":{"singular":"كَاتِب","plurals":["كُتَّاب"]}}');
  if saved->'word'->'conjugations'<>'{}'::jsonb or saved->'word'->'morphology'->'_verb'->>'present_base'<>'يَكْتُبُ' then raise exception 'Type retention failed';end if;
  saved:=public.vocabulary_write(gen_random_uuid(),'save','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',(saved->'word'->>'revision')::bigint,
    '{"arabic_word":"كَتَبَ","bangla_meaning":"লিখেছে","english_meaning":"wrote","word_type":"verb"}');
  if saved->'word'->'conjugations'->'huwa'->>'present'<>'يَكْتُبُ' or saved->'word'->'morphology'->>'singular'<>'كَاتِب' then raise exception 'Restore failed';end if;
  select revision into settings_revision from public.user_settings;
  perform public.save_arabic_display(settings_revision,'always_hide',80,'sawfa');
  begin perform public.save_arabic_display(settings_revision,'always_show',38,'sa');raise exception 'Stale preference accepted';exception when serialization_failure then null;end;
  begin perform app_private.vocabulary_write_base(gen_random_uuid(),'save',gen_random_uuid());raise exception 'Private core exposed';exception when insufficient_privilege then null;end;
  begin update public.words set conjugations='{}';raise exception 'Direct grammar writes allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',true);
do $$begin
  if (public.vocabulary_list()->>'total')::int<>0 then raise exception 'Cross-owner read';end if;
  begin perform public.vocabulary_write(gen_random_uuid(),'save','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',1,'{"arabic_word":"x","bangla_meaning":"x","english_meaning":"x"}');raise exception 'Cross-owner write';exception when serialization_failure then null;end;
end $$;
reset role;set local role anon;
do $$begin
  begin perform public.save_arabic_display(1,'always_show',38,'sa');raise exception 'Anonymous preferences allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: Phase 4 morphology, retention, retries, roots, display revisions and owner isolation; fixtures rolled back' as result;
