-- Run in Supabase SQL Editor as postgres. Test fixtures are ALWAYS rolled back.
-- No real login credentials, emails or persisted user accounts are created.
begin;
insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.words(id,user_id,arabic_word,normalized_arabic,bangla_meaning,english_meaning) values
  ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','كَتَبَ','كتب','লেখা','write'),
  ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','كِتَابٌ','كتاب','বই','book');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare visible_count integer; saved jsonb;
begin
  select count(*) into visible_count from public.words;
  if visible_count <> 1 then raise exception 'RLS failed: expected one visible word'; end if;
  if exists(select 1 from public.profiles where user_id='22222222-2222-4222-8222-222222222222') then
    raise exception 'RLS failed: another profile is visible'; end if;
  update public.profiles set display_name='Intruder' where user_id='22222222-2222-4222-8222-222222222222';
  if found then raise exception 'RLS failed: another profile was updated'; end if;
  begin
    update public.user_settings set revision=900;
    raise exception 'Privilege failed: revision was writable';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.review_history;
    raise exception 'Privilege failed: history deletion was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform * from app_private.sync_operations;
    raise exception 'Privilege failed: private operations were visible';
  exception when insufficient_privilege then null; end;
  saved := public.save_base_settings('Test learner','Asia/Dhaka','bn',1,1);
  if (saved->'profile'->>'revision')::integer <> 2 then raise exception 'Revision trigger failed'; end if;
  begin
    perform public.save_base_settings('Stale','UTC','en',1,1);
    raise exception 'Conflict failed: stale settings were saved';
  exception when serialization_failure then null; end;
  begin
    perform public.save_base_settings('Partial','UTC','en',2,1);
    raise exception 'Atomicity failed: stale settings were saved';
  exception when serialization_failure then null; end;
  if (select display_name from public.profiles) <> 'Test learner' then raise exception 'Atomicity failed: profile changed'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
begin
  if (select count(*) from public.words) <> 1 or
    (select id from public.words) <> '44444444-4444-4444-8444-444444444444'::uuid then
    raise exception 'RLS failed for second user'; end if;
end;
$$;
set local role anon;
do $$
begin
  begin
    perform * from public.profiles;
    raise exception 'Anonymous access failed: profiles were visible';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_base_settings('Anon','UTC','en',1,1);
    raise exception 'Anonymous access failed: settings RPC was allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
select 'PASS: two-user RLS, anonymous denial, protected counters, atomic saves and stale-write protection; fixtures rolled back' as result;
