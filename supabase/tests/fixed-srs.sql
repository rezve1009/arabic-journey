-- Live Phase 5 audit. All fixtures roll back; no learner records are retained.
begin;
insert into auth.users(id) values('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),('cccccccc-cccc-4ccc-8ccc-ccccccccccc2');
set local role authenticated;
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',true);
do $$
declare saved jsonb;state public.word_review_state;outcome jsonb;replay jsonb;op uuid:=gen_random_uuid();settings public.user_settings;old_due timestamptz;
begin
 saved:=public.vocabulary_write(gen_random_uuid(),'save','cccccccc-cccc-4ccc-8ccc-ccccccccccc3',null,'{"arabic_word":"كَتَبَ","bangla_meaning":"লিখেছে","english_meaning":"wrote","word_type":"verb"}');
 select * into state from public.word_review_state where word_id='cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
 if state.stage<>0 or state.interval_days<>1 or state.review_count<>0 then raise exception 'Initialization failed';end if;
 if (public.vocabulary_list('','','new')->>'total')::int<>1 then raise exception 'New filter failed';end if;
 begin perform public.fixed_review(gen_random_uuid(),state.word_id,state.revision,'good');raise exception 'Early scheduled rating allowed';exception when invalid_parameter_value then null;end;
 outcome:=public.fixed_review(op,state.word_id,state.revision,'good',1200,'recorded_practice');
 replay:=public.fixed_review(op,state.word_id,state.revision,'good',1200,'recorded_practice');
 if outcome<>replay or (outcome->'state'->>'interval_days')::int<>3 then raise exception 'Review/retry failed';end if;
 begin perform public.fixed_review(gen_random_uuid(),state.word_id,state.revision,'easy',null,'recorded_practice');raise exception 'Stale rating allowed';exception when serialization_failure then null;end;
 select * into state from public.word_review_state where word_id=state.word_id and user_id=auth.uid();
 old_due:=state.next_review_at;select * into settings from public.user_settings;
 perform public.save_fixed_schedule(settings.revision,array[2,5,10],45,'{"again_days":2,"hard_factor":0.5,"easy_skip":1}');
 if (select next_review_at from public.word_review_state where word_id=state.word_id)<>old_due then raise exception 'Schedule changed existing due';end if;
 if (select schedule_snapshot->>'version' from public.review_history where operation_id=op)<>'1' then raise exception 'History rewritten';end if;
 outcome:=public.fixed_review(gen_random_uuid(),state.word_id,state.revision,'again',null,'recorded_practice');
 if (outcome->'state'->>'stage')::int<>0 or (outcome->'state'->>'interval_days')::int<>2 then raise exception 'Again/configuration failed';end if;
 begin update public.review_history set rating='easy';raise exception 'History mutation allowed';exception when insufficient_privilege then null;end;
 begin delete from public.review_history;raise exception 'History deletion allowed';exception when insufficient_privilege then null;end;
 begin update public.word_review_state set stage=50;raise exception 'Counter mutation allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-ccccccccccc2',true);
do $$begin
 if (public.fixed_due()->>'total')::int<>0 or (select count(*) from public.review_history)<>0 then raise exception 'Cross-owner read';end if;
 begin perform public.fixed_review(gen_random_uuid(),'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',1,'good');raise exception 'Cross-owner review';exception when serialization_failure then null;end;
end $$;
reset role;set local role anon;
do $$begin begin perform public.fixed_due();raise exception 'Anonymous due access';exception when insufficient_privilege then null;end;end $$;
reset role;rollback;
select 'PASS: Phase 5 fixed SRS, immutable history, retries, schedule versions, due protection and owner isolation; fixtures rolled back' as result;
