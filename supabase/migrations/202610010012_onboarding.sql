
begin;
create function public.complete_onboarding()returns void language plpgsql security definer set search_path=''as $$begin if auth.uid()is null then raise exception 'Sign in required'using errcode='42501';end if;if not exists(select 1 from public.words where user_id=auth.uid()and deleted_at is null)then raise exception 'Add a word first'using errcode='22023';end if;update public.user_settings set onboarding_progress=jsonb_build_object('complete',true,'completed_at',statement_timestamp())where user_id=auth.uid();end$$;
revoke all on function public.complete_onboarding()from public,anon;grant execute on function public.complete_onboarding()to authenticated;
commit;
