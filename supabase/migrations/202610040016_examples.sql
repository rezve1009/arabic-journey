-- Additional authored examples; the first example keeps its existing columns.
begin;
create function app_private.valid_examples(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb;field record;
begin
 if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>19 then return false;end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['arabic','bangla','english'] then return false;end if;
  for field in select * from jsonb_each(item) loop
   if field.key not in ('arabic','bangla','english') or jsonb_typeof(field.value)<>'string' or length(field.value#>>'{}')>2000 then return false;end if;
  end loop;
  if btrim(item->>'arabic')='' and btrim(item->>'bangla')='' and btrim(item->>'english')='' then return false;end if;
 end loop;return true;
exception when others then return false;end$$;
revoke all on function app_private.valid_examples(jsonb) from public,anon;
grant execute on function app_private.valid_examples(jsonb) to authenticated;
alter table public.words add column examples jsonb not null default '[]' check(app_private.valid_examples(examples));
-- Extend the existing owner-scoped, revision-checked and idempotent transaction.
do $$declare d text;begin
 select pg_get_functiondef('public.vocabulary_write(uuid,text,uuid,bigint,jsonb,uuid[],boolean)'::regprocedure) into d;
 if position('''linguistic_provenance''];' in d)=0 or position('root=case when' in d)=0 then raise exception 'Unexpected vocabulary function';end if;
 d:=replace(d,'''linguistic_provenance''];','''linguistic_provenance'',''examples''];');
 d:=replace(d,'root=case when',$patch$examples=case when p_values ? 'examples' then p_values->'examples' else saved.examples end,
      root=case when$patch$);
 execute d;
end$$;
-- Older JSON backups have no examples column: retain an empty default.
do $backup$declare d text;begin
 select pg_get_functiondef('public.backup_restore(uuid,jsonb,text)'::regprocedure) into d;
 if position('if restore_table=''words''then entry:=' in d)=0 then raise exception 'Unexpected backup function';end if;
 d:=replace(d,'if restore_table=''words''then entry:=','if restore_table=''words''then entry:=jsonb_build_object(''examples'',''[]''::jsonb)||entry;entry:=');execute d;
end$backup$;
notify pgrst,'reload schema';
commit;
