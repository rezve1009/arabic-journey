import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Phase 2 migration: ownership, least privilege, constraints and atomic revisions', async () => {
  const db = new PGlite();
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const wordA = '33333333-3333-4333-8333-333333333333';
  const wordB = '44444444-4444-4444-8444-444444444444';
  const tagB = '55555555-5555-4555-8555-555555555555';
  try {
    // Minimal Supabase Auth contract, backed by a real PostgreSQL engine.
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,public to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${alice}','alice@example.test');`);
    await db.exec(await readFile(new URL('../supabase/migrations/202609300001_foundation.sql',import.meta.url),'utf8'));
    await db.exec(`insert into auth.users values('${bob}','bob@example.test');`);
    assert.equal((await db.query('select count(*)::int as total from public.profiles')).rows[0].total,2,'existing and new accounts get profiles');
    assert.equal((await db.query('select count(*)::int as total from public.user_settings')).rows[0].total,2);
    const settings = (await db.query('select * from public.user_settings where user_id = $1',[alice])).rows[0];
    assert.deepEqual(settings.revision_schedule.intervals,[1,3,7,15,30]);
    assert.equal(settings.notification_preferences.enabled,false);

    await db.exec(`insert into public.words(id,user_id,arabic_word,normalized_arabic,bangla_meaning,english_meaning)
      values('${wordA}','${alice}','كَتَبَ','كتب','লেখা','write'),('${wordB}','${bob}','كِتَابٌ','كتاب','বই','book');
      insert into public.tags(id,user_id,name) values('${tagB}','${bob}','Lesson');`);
    await assert.rejects(db.exec(`insert into public.word_tags(user_id,word_id,tag_id) values('${alice}','${wordA}','${tagB}')`),/foreign key/,'same-owner composite foreign key blocks cross-user links');
    await assert.rejects(db.exec(`update public.words set conjugations='{"unknown":{"past":"x"}}',word_type='verb' where id='${wordA}'`),/check constraint/);
    await assert.rejects(db.exec(`update public.words set root=array['ك','ت'] where id='${wordA}'`),/check constraint/);
    await assert.rejects(db.exec(`update public.user_settings set revision_schedule='{"intervals":[0],"repeat_days":30,"version":1}' where user_id='${alice}'`),/check constraint/);
    await assert.rejects(db.exec(`update public.user_settings set revision_schedule='{"intervals":[1],"repeat_days":30}' where user_id='${alice}'`),/check constraint/);
    await assert.rejects(db.exec(`update public.user_settings set timezone='Made/Up' where user_id='${alice}'`),/check constraint/);
    const publicTables = ['profiles','user_settings','words','tags','word_tags','word_review_state','study_sessions','review_history','quiz_sessions','quiz_answers','push_subscriptions'];
    const rls = await db.query("select tablename,rowsecurity from pg_tables where schemaname in ('public','app_private')");
    assert.equal(rls.rows.length,13);
    assert(rls.rows.every(row=>row.rowsecurity),'all application tables enable RLS');

    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false);`);
    assert.equal((await db.query('select user_id from public.profiles')).rows.length,1);
    assert.equal((await db.query('select user_id from public.user_settings')).rows[0].user_id,alice);
    assert.equal((await db.query('select id from public.words')).rows[0].id,wordA);
    for (const table of publicTables) {
      const data = await db.query(`select * from public.${table} where user_id=$1`,[bob]);
      assert.equal(data.rows.length,0,`${table}: another user's rows are not visible`);
    }
    const forbiddenUpdate = await db.query('update public.profiles set display_name=$1 where user_id=$2 returning *',['intruder',bob]);
    assert.equal(forbiddenUpdate.rows.length,0);
    await assert.rejects(db.exec(`update public.profiles set user_id='${bob}' where user_id='${alice}'`),/permission denied/);
    await assert.rejects(db.exec(`update public.user_settings set revision=100 where user_id='${alice}'`),/permission denied/);
    await assert.rejects(db.exec(`update public.user_settings set revision_algorithm='adaptive' where user_id='${alice}'`),/permission denied/);
    for (const table of ['words','tags','word_tags','word_review_state','review_history','quiz_sessions','quiz_answers','study_sessions','push_subscriptions']) {
      await assert.rejects(db.exec(`delete from public.${table} where user_id='${alice}'`),/permission denied/,`${table}: destructive writes unavailable`);
    }
    await assert.rejects(db.exec('select * from app_private.sync_operations'),/permission denied/);
    await assert.rejects(db.exec('select * from app_private.notification_deliveries'),/permission denied/);
    const result = (await db.query('select public.save_base_settings($1,$2,$3,$4,$5) as result',['Alice','Asia/Dhaka','bn',1,1])).rows[0].result;
    assert.equal(result.profile.revision,2);
    assert.equal(result.settings.revision,2);
    assert.equal(result.settings.ui_language,'bn');
    await assert.rejects(db.query('select public.save_base_settings($1,$2,$3,$4,$5)',['Overwrite','UTC','en',1,1]),/changed/,'stale writes must not overwrite');
    await assert.rejects(db.query('select public.save_base_settings($1,$2,$3,$4,$5)',['Partial save','UTC','en',2,1]),/changed/);
    assert.equal((await db.query('select display_name from public.profiles')).rows[0].display_name,'Alice','settings conflict rolls back profile update');
    await assert.rejects(db.query('select public.save_base_settings($1,$2,$3,$4,$5)',['Invalid','Made/Up','en',2,2]),/check constraint/);
    assert.equal((await db.query('select revision from public.profiles')).rows[0].revision,2,'invalid timezone rolls back profile revision');

    await db.exec(`select set_config('request.jwt.claim.sub','${bob}',false);`);
    assert.equal((await db.query('select id from public.words')).rows[0].id,wordB);
    assert.equal((await db.query('select display_name from public.profiles')).rows[0].display_name,'');
    await db.exec('reset role; set role anon;');
    for (const table of publicTables) await assert.rejects(db.exec(`select * from public.${table}`),/permission denied/,`${table}: anonymous access denied`);
    await assert.rejects(db.query('select public.save_base_settings($1,$2,$3,$4,$5)',['Anon','UTC','en',1,1]),/permission denied/);
    await db.exec('reset role;');
    await db.exec(await readFile(new URL('../supabase/tests/rls.sql',import.meta.url),'utf8').then(sql=>sql.replaceAll('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666').replaceAll('22222222-2222-4222-8222-222222222222','77777777-7777-4777-8777-777777777777').replaceAll('33333333-3333-4333-8333-333333333333','88888888-8888-4888-8888-888888888888').replaceAll('44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999')));
    assert.equal((await db.query('select count(*)::int as total from auth.users')).rows[0].total,2,'live audit fixture script leaves no users behind');
  } finally { await db.close(); }
});
