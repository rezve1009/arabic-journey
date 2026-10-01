
begin;
create function public.backup_export()returns jsonb language plpgsql stable security invoker set search_path=''as $$declare result jsonb;restore_table text;rows jsonb;begin
 result:=jsonb_build_object('format','arabic-journey','version',1,'exported_at',statement_timestamp(),'settings',(select to_jsonb(s)from public.user_settings s where user_id=auth.uid()),'profile',(select to_jsonb(p)from public.profiles p where user_id=auth.uid()));
 foreach restore_table in array array['words','tags','word_tags','word_review_state','review_history','quiz_sessions','quiz_answers','study_sessions']loop execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]'')from public.%I t where user_id=auth.uid()',restore_table)into rows;result:=result||jsonb_build_object(restore_table,rows);end loop;return result;
end$$;
create function public.backup_restore(p_operation uuid,p_backup jsonb,p_confirmation text)returns jsonb language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();restore_table text;entry jsonb;cfg public.user_settings;rec record;payload text;prior app_private.sync_operations;result jsonb;columns text;begin
 if uid is null then raise exception 'Sign in required'using errcode='42501';end if;
 if p_operation is null or p_confirmation is distinct from 'RESTORE' or p_backup->>'format'is distinct from'arabic-journey'or p_backup->>'version'is distinct from'1'or length(p_backup::text)>20971520 then raise exception 'Invalid backup'using errcode='22023';end if;
 payload:=p_backup::text;perform pg_advisory_xact_lock(hashtextextended(uid::text||p_operation::text,0));select *into prior from app_private.sync_operations where user_id=uid and operation_id=p_operation;if found then if prior.payload_hash<>md5(payload)then raise exception 'Operation reused'using errcode='22023';end if;return prior.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||'vocabulary',0));
 foreach restore_table in array array['words','tags','word_tags','word_review_state','review_history','quiz_sessions','quiz_answers','study_sessions']loop if jsonb_typeof(p_backup->restore_table)is distinct from'array'or jsonb_array_length(p_backup->restore_table)>100000 then raise exception 'Missing backup table'using errcode='22023';end if;end loop;
 -- This explicit, confirmed restore is the only operation allowed to replace learning history.
 perform set_config('app.restore','on',true);
 delete from public.quiz_answers where user_id=uid;delete from public.review_history where user_id=uid;delete from public.quiz_sessions where user_id=uid;delete from public.study_sessions where user_id=uid;delete from public.word_tags where user_id=uid;delete from public.word_review_state where user_id=uid;delete from public.words where user_id=uid;delete from public.tags where user_id=uid;
 foreach restore_table in array array['tags','words','word_tags','word_review_state','study_sessions','quiz_sessions','review_history','quiz_answers']loop
 for entry in select *from jsonb_array_elements(p_backup->restore_table)loop
 entry:=jsonb_build_object('quiz_count',0,'quiz_correct',0,'evidence_score',coalesce((entry->>'weak_score')::numeric,0))||entry||jsonb_build_object('user_id',uid);entry:=entry-'_pending';
 if restore_table='words'then entry:=entry||jsonb_build_object('normalized_arabic',app_private.normalize_arabic(entry->>'arabic_word'));end if;
 if restore_table='word_review_state'then delete from public.word_review_state where user_id=uid and word_id=(entry->>'word_id')::uuid and algorithm=entry->>'algorithm';end if;
 select string_agg(quote_ident(column_name),','order by ordinal_position)into columns from information_schema.columns where table_schema='public'and information_schema.columns.table_name=restore_table and is_generated='NEVER';
 execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1)',restore_table,columns,columns,restore_table)using entry;
 end loop;end loop;
 -- Prevent evidence triggers from altering restored counters: the exact state is reapplied.
 for entry in select *from jsonb_array_elements(p_backup->'word_review_state')loop update public.word_review_state set evidence_score=coalesce((entry->>'evidence_score')::numeric,(entry->>'weak_score')::numeric,0),stage=(entry->>'stage')::int,interval_days=(entry->>'interval_days')::int,next_review_at=(entry->>'next_review_at')::timestamptz,last_reviewed_at=(entry->>'last_reviewed_at')::timestamptz,review_count=(entry->>'review_count')::int,correct_count=(entry->>'correct_count')::int,incorrect_count=(entry->>'incorrect_count')::int,success_count=(entry->>'success_count')::int,quiz_count=coalesce((entry->>'quiz_count')::int,0),quiz_correct=coalesce((entry->>'quiz_correct')::int,0),weak_score=(entry->>'weak_score')::numeric,mastery_status=entry->>'mastery_status'where user_id=uid and word_id=(entry->>'word_id')::uuid and algorithm=entry->>'algorithm';end loop;
 select *into cfg from public.user_settings where user_id=uid;entry:=p_backup->'settings';
 if not app_private.valid_schedule(entry->'revision_schedule')or not app_private.valid_rating_behavior(entry->'rating_behavior')then raise exception 'Invalid settings'using errcode='22023';end if;
 update public.user_settings set ui_language=entry->>'ui_language',timezone=entry->>'timezone',revision_schedule=entry->'revision_schedule',rating_behavior=entry->'rating_behavior',mastery_thresholds=entry->'mastery_thresholds',daily_goals=entry->'daily_goals',quiz_options=entry->'quiz_options',harakah_mode=entry->>'harakah_mode',arabic_font_size=(entry->>'arabic_font_size')::int,future_prefix=entry->>'future_prefix',weak_weights=coalesce(entry->'weak_weights',cfg.weak_weights),notification_preferences=coalesce(entry->'notification_preferences',cfg.notification_preferences)||jsonb_build_object('enabled',false),onboarding_progress=coalesce(entry->'onboarding_progress','{}')where user_id=uid;
 update public.profiles set display_name=coalesce(p_backup->'profile'->>'display_name','')where user_id=uid;
 perform set_config('app.restore','off',true);
 result:=jsonb_build_object('restored',jsonb_array_length(p_backup->'words'));insert into app_private.sync_operations values(uid,p_operation,md5(payload),result,now());return result;
end$$;
revoke all on function public.backup_export(),public.backup_restore(uuid,jsonb,text)from public,anon;grant execute on function public.backup_export(),public.backup_restore(uuid,jsonb,text)to authenticated;
commit;
