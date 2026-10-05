begin;
create table public.app_memberships(
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'member' check(role in('member','admin')),
 status text not null default 'pending' check(status in('pending','approved','declined')),
 requested_at timestamptz not null default now(),decided_at timestamptz,decided_by uuid references auth.users(id),
 revision bigint not null default 1,check(role<>'admin' or status='approved')
);
create table public.access_decisions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),admin_id uuid not null references auth.users(id),decision text not null check(decision in('approved','declined')),occurred_at timestamptz not null default now());
-- Preserve existing accounts. Owner promotion is an explicit deployment step.
insert into public.app_memberships(user_id,status,decided_at) select id,'approved',now() from auth.users;
create function app_private.new_access_request()returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.app_memberships(user_id)values(new.id);return new;end$$;
revoke all on function app_private.new_access_request()from public,anon,authenticated;
create trigger arabic_journey_access_request after insert on auth.users for each row execute function app_private.new_access_request();
create function public.app_access_allowed()returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.app_memberships where user_id=auth.uid() and status='approved')$$;
create function app_private.is_admin()returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.app_memberships where user_id=auth.uid() and role='admin' and status='approved')$$;
create function app_private.require_access()returns void language plpgsql security definer set search_path='' as $$begin if not public.app_access_allowed()then raise exception 'Owner approval required' using errcode='42501';end if;end$$;
revoke all on function public.app_access_allowed(),app_private.is_admin(),app_private.require_access()from public,anon;
grant execute on function public.app_access_allowed(),app_private.is_admin(),app_private.require_access()to authenticated;
-- Guard every existing authenticated JSON RPC, preserving its owner, signature,
-- grants and SECURITY INVOKER/DEFINER mode. No custom serialization errors.
do $$declare f record;definition text;body text;begin
 for f in select p.*,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' and p.prorettype='jsonb'::regtype and has_function_privilege('authenticated',p.oid,'EXECUTE')loop
  definition:=pg_get_functiondef(f.oid);
  if f.lanname='plpgsql' then
   body:=regexp_replace(f.prosrc,'\mbegin\M','BEGIN PERFORM app_private.require_access();','i');
   if body=f.prosrc then raise exception 'Missing access guard insertion point: %',f.proname;end if;
  elsif f.lanname='sql' then
   body:='BEGIN PERFORM app_private.require_access(); RETURN ('||regexp_replace(trim(f.prosrc),';\s*$','')||'); END';
   definition:=replace(definition,'LANGUAGE sql','LANGUAGE plpgsql');
  else raise exception 'Unexpected RPC language: %',f.proname;end if;
  execute replace(definition,f.prosrc,body);
 end loop;
end$$;
-- Do not schedule reminders for declined or unapproved accounts.
do $$declare definition text;source text;begin
 definition:=pg_get_functiondef('public.claim_reminders()'::regprocedure);
 source:=replace(definition,'where (notification_preferences',$filter$where exists(select 1 from public.app_memberships m where m.user_id=public.user_settings.user_id and m.status='approved')and (notification_preferences$filter$);
 if source=definition then raise exception 'Reminder approval filter was not inserted';end if;
 execute source;
end$$;

-- Restrictive policies protect direct table requests as well as RPC calls.
do $$declare tab record;begin
 for tab in select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity loop
  if tab.relname in('profiles','user_settings')then
   execute format('create policy approved_update on public.%I as restrictive for update to authenticated using((select public.app_access_allowed()))with check((select public.app_access_allowed()))',tab.relname);
  else
   execute format('create policy approved_access on public.%I as restrictive for all to authenticated using((select public.app_access_allowed()))with check((select public.app_access_allowed()))',tab.relname);
  end if;
 end loop;
end$$;
alter table public.app_memberships enable row level security;
alter table public.access_decisions enable row level security;
revoke all on public.app_memberships,public.access_decisions from public,anon,authenticated;
grant select on public.app_memberships,public.access_decisions to authenticated;
create policy membership_read on public.app_memberships for select to authenticated using(user_id=(select auth.uid())or(select app_private.is_admin()));
create policy decision_read on public.access_decisions for select to authenticated using((select app_private.is_admin()));
create function public.access_status()returns jsonb language plpgsql security definer set search_path='' as $$declare member public.app_memberships;begin
 if auth.uid()is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into member from public.app_memberships where user_id=auth.uid();
 if not found then raise exception 'Membership unavailable' using errcode='42501';end if;
 return to_jsonb(member);
end$$;
create function public.access_requests(p_status text default 'pending',p_page integer default 0)returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not app_private.is_admin()then raise exception 'Administrator required' using errcode='42501';end if;
 if p_status is null or p_status not in('pending','approved','declined','all')or p_page is null or p_page<0 then raise exception 'Invalid request filter' using errcode='22023';end if;
 with candidates as materialized(select m.*,u.email,p.display_name,(to_jsonb(u)->>'email_confirmed_at')is not null email_verified from public.app_memberships m join auth.users u on u.id=m.user_id join public.profiles p on p.user_id=m.user_id where m.role='member' and(p_status='all'or m.status=p_status)),selected as(select *from candidates order by requested_at,user_id limit 25 offset p_page*25)
 select jsonb_build_object('total',(select count(*)from candidates),'pending',(select count(*)from public.app_memberships where status='pending'),'requests',coalesce((select jsonb_agg(to_jsonb(selected))from selected),'[]'))into result;
 return result;
end$$;
create function public.access_decide(p_user uuid,p_revision bigint,p_decision text)returns jsonb language plpgsql security definer set search_path='' as $$declare member public.app_memberships;begin
 if not app_private.is_admin()then raise exception 'Administrator required' using errcode='42501';end if;
 if p_decision is null or p_decision not in('approved','declined')or p_user is null or p_revision is null then raise exception 'Invalid decision' using errcode='22023';end if;
 select *into member from public.app_memberships where user_id=p_user for update;
 if not found or member.role='admin'then raise exception 'Request unavailable' using errcode='PT409';end if;
 -- A lost-response retry of the same decision is harmless.
 if member.status=p_decision then return to_jsonb(member);end if;
 if member.revision<>p_revision then raise exception 'Request changed' using errcode='PT409';end if;
 update public.app_memberships set status=p_decision,decided_at=now(),decided_by=auth.uid(),revision=revision+1 where user_id=p_user returning *into member;
 insert into public.access_decisions(user_id,admin_id,decision)values(p_user,auth.uid(),p_decision);
 return to_jsonb(member);
end$$;
revoke all on function public.access_status(),public.access_requests(text,integer),public.access_decide(uuid,bigint,text)from public,anon;
grant execute on function public.access_status(),public.access_requests(text,integer),public.access_decide(uuid,bigint,text)to authenticated;
notify pgrst,'reload schema';
commit;
