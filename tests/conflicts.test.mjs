import {approveFixtureUsers}from './approved-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {isRevisionConflict} from '../js/conflicts.js';
test('Revision conflicts accept rolling-update codes without treating timeouts as conflicts',()=>{
 for(const code of ['PT409','40001'])assert(isRevisionConflict({code}));
 for(const code of ['57014','42501','22023',undefined])assert(!isRevisionConflict({code}));
});
test('App revision checks use nonretryable HTTP conflicts and preserve stale values',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid()to anon,authenticated;`);
 for(const file of(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 assert.equal((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prosrc like '%'||quote_literal('40001')||'%'`)).rows[0].n,0);
 await approveFixtureUsers(db);await db.exec(`insert into auth.users(id)values('d21e36d0-6f39-49e9-a86b-a534c688fa54');set role authenticated;select set_config('request.jwt.claim.sub','d21e36d0-6f39-49e9-a86b-a534c688fa54',false);`);
 const before=(await db.query('select * from public.user_settings')).rows[0];
 await assert.rejects(db.query(`select public.save_arabic_display($1,'always_hide',40,'sa')`,[before.revision-1]),e=>e.code==='PT409');
 assert.deepEqual((await db.query('select * from public.user_settings')).rows[0],before);
 }finally{await db.close();}
});
