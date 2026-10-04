begin;
drop function public.activity_history(date,date,integer,text);
create function public.activity_history(p_from date default null,p_to date default null,p_page integer default 0,p_kind text default null,p_word uuid default null)returns jsonb language sql stable security invoker set search_path='' as $$
 with cfg as(select timezone from public.user_settings where user_id=auth.uid()), events as(select h.id,h.word_id,w.arabic_word,h.occurred_at as event_at,h.rating result,h.prior_interval,h.new_interval,h.next_review_at,'review' kind from public.review_history h join public.words w on w.id=h.word_id and w.user_id=h.user_id where h.user_id=auth.uid() union all select a.id,a.word_id,w.arabic_word,a.created_at,case when a.correct then 'correct'else 'incorrect'end,null,null,null,'quiz'from public.quiz_answers a join public.words w on w.id=a.word_id and w.user_id=a.user_id where a.user_id=auth.uid() union all select w.id,w.id,w.arabic_word,w.created_at,'added',null::integer,null::integer,null::timestamptz,'word'from public.words w where w.user_id=auth.uid()),filtered as(select *from events cross join cfg where(p_word is null or word_id=p_word)and(p_kind is null or kind=p_kind)and(p_from is null or(event_at at time zone timezone)::date>=p_from)and(p_to is null or(event_at at time zone timezone)::date<=p_to)),selected as(select *from filtered order by event_at desc,id limit 25 offset greatest(0,p_page)*25)
 select jsonb_build_object('total',(select count(*)from filtered),'events',coalesce((select jsonb_agg(to_jsonb(selected)order by event_at desc,id)from selected),'[]'));
$$;
revoke all on function public.activity_history(date,date,integer,text,uuid)from public,anon;grant execute on function public.activity_history(date,date,integer,text,uuid)to authenticated;
notify pgrst,'reload schema';
commit;

