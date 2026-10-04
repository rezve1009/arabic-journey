begin;
-- Preferences extend daily_goals without changing existing intervals or due dates.
alter table public.user_settings add constraint early_review_preferences_check check (
 (not daily_goals ? 'allow_early_reviews' or jsonb_typeof(daily_goals->'allow_early_reviews')='boolean') and
 (not daily_goals ? 'review_batch_size' or (jsonb_typeof(daily_goals->'review_batch_size')='number' and (daily_goals->>'review_batch_size')::numeric between 1 and 1000 and (daily_goals->>'review_batch_size')::numeric=trunc((daily_goals->>'review_batch_size')::numeric)))
);
create function public.fixed_upcoming(p_limit integer default 10) returns jsonb language sql stable security invoker set search_path='' as $$
 with eligible as(select w.id,w.arabic_word,r.next_review_at,to_jsonb(r) state from public.words w join public.word_review_state r on r.word_id=w.id and r.user_id=w.user_id where w.user_id=auth.uid() and w.deleted_at is null and r.deleted_at is null and r.algorithm='fixed' and r.next_review_at>statement_timestamp()),selected as(select *from eligible order by next_review_at,id limit greatest(1,least(coalesce(p_limit,10),1000)))
 select jsonb_build_object('total',(select count(*)from eligible),'words',coalesce((select jsonb_agg(to_jsonb(selected)order by next_review_at,id)from selected),'[]'));
$$;
revoke all on function public.fixed_upcoming(integer)from public,anon;grant execute on function public.fixed_upcoming(integer)to authenticated;
notify pgrst,'reload schema';
commit;
