
begin;
create table public.push_configuration(id boolean primary key default true check(id),public_key text not null,enabled boolean not null default false);
alter table public.push_configuration enable row level security;create policy read_config on public.push_configuration for select to authenticated using(true);grant select on public.push_configuration to authenticated;
create function public.push_save(p_subscription jsonb,p_enabled boolean,p_preferences jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare saved public.push_subscriptions;ep text;begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if jsonb_typeof(p_preferences->'enabled')<>'boolean' or jsonb_typeof(p_preferences->'review')<>'boolean' or jsonb_typeof(p_preferences->'quiz')<>'boolean' or not p_preferences ?&array['morning','evening','review','quiz','enabled'] or p_preferences->>'morning'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_preferences->>'evening'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid reminders' using errcode='22023';end if;
 if p_subscription is not null then ep:=p_subscription->>'endpoint';if ep!~'^https://(fcm.googleapis.com|[a-zA-Z0-9.-]+\.push.services.mozilla.com|[a-zA-Z0-9.-]+\.push.apple.com|[a-zA-Z0-9.-]+\.notify.windows.com)/' or length(ep)>2000 or length(p_subscription->'keys'->>'p256dh')not between 80 and 100 or length(p_subscription->'keys'->>'auth')not between 20 and 30 then raise exception 'Invalid push subscription' using errcode='22023';end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key,enabled)values(auth.uid(),ep,p_subscription->'keys'->>'p256dh',p_subscription->'keys'->>'auth',p_enabled)on conflict(endpoint)do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,enabled=excluded.enabled,last_seen_at=now(),deleted_at=null where public.push_subscriptions.user_id=auth.uid() returning *into saved;if not found then raise exception 'Subscription unavailable' using errcode='42501';end if;
 elsif not p_enabled then update public.push_subscriptions set enabled=false where user_id=auth.uid();end if;
 update public.user_settings set notification_preferences=p_preferences where user_id=auth.uid();return jsonb_build_object('saved',true);
end$$;
revoke all on function public.push_save(jsonb,boolean,jsonb)from public,anon;grant execute on function public.push_save(jsonb,boolean,jsonb)to authenticated;
-- Called only by the authenticated server function. A lease makes cron retries bounded.
create function public.claim_reminders()returns jsonb language plpgsql security definer set search_path='' as $$declare s record;slot text;local_now timestamp;slot_at timestamp;due integer;quiz_due boolean;jobs jsonb:='[]';claimed integer;begin
 for s in select *from public.user_settings where (notification_preferences->>'enabled')::boolean loop local_now:=statement_timestamp()at time zone s.timezone;
 for slot in select unnest(array['morning','evening'])loop
 slot_at:=local_now::date+(s.notification_preferences->>slot)::time;if local_now<slot_at then slot_at:=slot_at-interval'1 day';end if;
 if local_now>=slot_at and local_now<slot_at+interval'30 minutes' then
 select count(*)into due from public.word_review_state r join public.words w on w.id=r.word_id and w.user_id=r.user_id where r.user_id=s.user_id and r.algorithm='fixed' and r.next_review_at<=statement_timestamp()and r.deleted_at is null and w.deleted_at is null;
 quiz_due:=not exists(select 1 from public.quiz_sessions q where q.user_id=s.user_id and q.completed_at is not null and(q.completed_at at time zone s.timezone)::date=local_now::date);
 if (due>0 and(s.notification_preferences->>'review')::boolean)or(quiz_due and(s.notification_preferences->>'quiz')::boolean)then
 insert into app_private.notification_deliveries(user_id,local_date,reminder_slot,status,attempt_count,lease_until)values(s.user_id,slot_at::date,slot,'sending',1,now()+interval'5 minutes')on conflict(user_id,local_date,reminder_slot)do update set status='sending',attempt_count=notification_deliveries.attempt_count+1,lease_until=now()+interval'5 minutes' where notification_deliveries.status<>'sent'and notification_deliveries.attempt_count<3 and(notification_deliveries.lease_until is null or notification_deliveries.lease_until<now());get diagnostics claimed=row_count;
 if claimed>0 then jobs:=jobs||jsonb_build_array(jsonb_build_object('user_id',s.user_id,'date',slot_at::date,'slot',slot,'due',case when(s.notification_preferences->>'review')::boolean then due else 0 end,'quiz',quiz_due and(s.notification_preferences->>'quiz')::boolean,'subscriptions',coalesce((select jsonb_agg(to_jsonb(p))from public.push_subscriptions p where p.user_id=s.user_id and p.enabled and p.deleted_at is null),'[]')));end if;
 end if;end if;end loop;end loop;return jobs;
end$$;
create function public.finish_reminder(p_user uuid,p_date date,p_slot text,p_sent boolean,p_expired uuid[]default'{}')returns void language plpgsql security definer set search_path=''as $$begin update app_private.notification_deliveries set status=case when p_sent then'sent'else'failed'end,sent_at=case when p_sent then now()else null end,lease_until=now()+interval'5 minutes'where user_id=p_user and local_date=p_date and reminder_slot=p_slot and status='sending';update public.push_subscriptions set enabled=false,deleted_at=now()where user_id=p_user and id=any(p_expired);end$$;
revoke all on function public.claim_reminders(),public.finish_reminder(uuid,date,text,boolean,uuid[])from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role')then grant execute on function public.claim_reminders(),public.finish_reminder(uuid,date,text,boolean,uuid[])to service_role;end if;end$$;
commit;
