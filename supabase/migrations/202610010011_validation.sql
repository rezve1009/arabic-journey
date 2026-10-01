
begin;
update public.user_settings set daily_goals=jsonb_build_object('minimum_activity',1)||daily_goals where not daily_goals?'minimum_activity';
alter table public.user_settings alter column daily_goals set default '{"new_words":5,"reviews":null,"quiz_questions":10,"minimum_activity":1}';
create function app_private.valid_learning(q jsonb,m jsonb,w jsonb,g jsonb)returns boolean language plpgsql immutable set search_path=''as $$declare key text;begin
 if not(q?&array['question_count','types','weak_percentage','include_new','include_mastered']and m?&array['successful_reviews','accuracy','require_long_term']and w?&array['again','hard','quiz_mistake','slow_ms','slow','success','threshold']and g?&array['new_words','reviews','quiz_questions','minimum_activity'])then return false;end if;
 for key in select jsonb_object_keys(w)loop if jsonb_typeof(w->key)<>'number'or(w->>key)::numeric not between 0 and 1000000 then return false;end if;end loop;
 return((q->>'question_count')::int between 1 and 100 and(q->>'weak_percentage')::int between 0 and 100 and jsonb_typeof(q->'include_new')='boolean'and jsonb_typeof(q->'include_mastered')='boolean'and jsonb_array_length(q->'types')between 1 and 12 and(q->'types')<@'["arabic_bangla","arabic_english","bangla_arabic","english_arabic","arabic_typing","root","masdar","verb_form","conjugation","fill_blank","multiple_choice","true_false"]'::jsonb and(m->>'successful_reviews')::int between 1 and 1000 and(m->>'accuracy')::numeric between 1 and 100 and jsonb_typeof(m->'require_long_term')='boolean'and(w->>'threshold')::numeric>0 and(w->>'slow_ms')::numeric>=100 and(g->>'new_words')::int between 0 and 1000 and(g->>'quiz_questions')::int between 0 and 1000 and(g->>'minimum_activity')::int between 1 and 1000 and(g->'reviews'='null'::jsonb or(g->>'reviews')::int between 0 and 1000))is true;
 exception when others then return false;end$$;
revoke all on function app_private.valid_learning(jsonb,jsonb,jsonb,jsonb)from public,anon;grant execute on function app_private.valid_learning(jsonb,jsonb,jsonb,jsonb)to authenticated;
alter table public.user_settings add constraint learning_settings_bounds check(app_private.valid_learning(quiz_options,mastery_thresholds,weak_weights,daily_goals))not valid;
-- Cache snapshots include the current revision plus enough evidence for review preview.
do $$declare d text;begin select pg_get_functiondef('public.fixed_due(integer)'::regprocedure)into d;d:=replace(d,'r.next_review_at,r.revision','r.next_review_at,r.revision,r.review_count,r.weak_score,r.mastery_status');execute d;end$$;
commit;
