begin;
create function public.fixed_upcoming_page(p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$
 with eligible as(select w.id,w.arabic_word,w.bangla_meaning,w.english_meaning,r.next_review_at from public.words w join public.word_review_state r on r.word_id=w.id and r.user_id=w.user_id where w.user_id=auth.uid() and w.deleted_at is null and r.deleted_at is null and r.algorithm='fixed' and r.next_review_at>statement_timestamp()),selected as(select *from eligible order by next_review_at,id limit 25 offset greatest(coalesce(p_page,0),0)::bigint*25)
 select jsonb_build_object('total',(select count(*)from eligible),'words',coalesce((select jsonb_agg(to_jsonb(selected)order by next_review_at,id)from selected),'[]'));
$$;
revoke all on function public.fixed_upcoming_page(integer)from public,anon;grant execute on function public.fixed_upcoming_page(integer)to authenticated;
notify pgrst,'reload schema';
commit;
