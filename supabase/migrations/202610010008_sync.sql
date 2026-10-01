
begin;
create function public.sync_snapshot(p_table text,p_page integer default 0)returns jsonb language plpgsql security invoker set search_path='' as $$declare result jsonb;begin
 if p_table<>all(array['words','tags','word_tags','word_review_state','review_history','quiz_sessions','quiz_answers','study_sessions'])or p_page<0 then raise exception 'Invalid sync table' using errcode='22023';end if;
 execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from(select * from public.%I where user_id=auth.uid() order by %s limit 500 offset $1)t',p_table,case when p_table='word_tags' then 'word_id,tag_id' when p_table='word_review_state' then 'word_id,algorithm' else 'id' end)into result using p_page*500;return result;
end$$;
revoke all on function public.sync_snapshot(text,integer)from public,anon;grant execute on function public.sync_snapshot(text,integer)to authenticated;
commit;
