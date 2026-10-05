begin;
-- Expected stale revisions are HTTP conflicts, not serialization failures.
-- PostgREST 14 can retry a custom 40001 forever, even after client disconnect.
-- Replace only the eight known app functions, preserving their definitions,
-- owners, signatures, security-definer configuration and existing privileges.
do $repair$
declare target record;definition text;
begin
 for target in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and (n.nspname,p.proname) in (
   ('public','save_base_settings'),('app_private','vocabulary_write_base'),
   ('public','save_fixed_schedule'),('public','save_arabic_display'),
   ('public','vocabulary_write'),('public','fixed_review'),
   ('public','quiz_finish'),('public','save_learning_settings')
  ) and p.prosrc like '%'||quote_literal('40001')||'%'
 loop
  definition:=pg_get_functiondef(target.oid);
  execute replace(definition,quote_literal('40001'),quote_literal('PT409'));
 end loop;
end $repair$;
notify pgrst,'reload schema';
commit;
