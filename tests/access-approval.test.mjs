import test from 'node:test';import assert from 'node:assert/strict';import{readFile,readdir}from'node:fs/promises';import{randomUUID}from'node:crypto';import{PGlite}from'@electric-sql/pglite';
test('Approval gates RPCs and direct tables; only the owner admin can accept/decline with safe retries',async()=>{
 const db=new PGlite(),admin=randomUUID(),learner=randomUUID(),other=randomUUID();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid()to anon,authenticated;`);
 await db.query('insert into auth.users(id,email)values($1,$2)',[admin,'owner@example.test']);
 for(const f of(await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 assert.equal((await db.query('select status from public.app_memberships where user_id=$1',[admin])).rows[0].status,'approved','existing owner keeps access');
 await db.query("update public.app_memberships set role='admin'where user_id=$1",[admin]);
 await db.query('insert into auth.users(id,email)values($1,$2),($3,$4)',[learner,'learner@example.test',other,'other@example.test']);
 const word=randomUUID();await db.query("insert into public.words(id,user_id,arabic_word,normalized_arabic,bangla_meaning,english_meaning)values($1,$2,'كتاب','كتاب','বই','book')",[word,learner]);
 await db.exec('set role authenticated');const as=async uid=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);const rpc=async(sql,args=[])=>(await db.query(sql,args)).rows[0].r;
 await as(learner);const status=()=>rpc('select public.access_status()r');assert.equal((await status()).status,'pending');assert.equal((await status()).role,'member');
 assert.equal((await db.query('select count(*)::int n from public.app_memberships')).rows[0].n,1,'learner sees only own request');
 assert.equal((await db.query('select count(*)::int n from public.words')).rows[0].n,0,'pending cannot read even own words');
 assert.equal((await db.query("update public.profiles set display_name='blocked'where user_id=$1 returning *",[learner])).rows.length,0,'pending profile writes blocked');
 for(const query of ['select public.vocabulary_list()','select public.fixed_due()','select public.quiz_coverage_status()','select public.learning_statistics()','select public.backup_export()',"select public.sync_snapshot('words')",'select public.access_requests()'])await assert.rejects(db.query(query),e=>e.code==='42501');
 await assert.rejects(db.query("update public.app_memberships set status='approved'"),e=>e.code==='42501');
 await assert.rejects(db.query("select public.access_decide($1,1,'approved')",[learner]),e=>e.code==='42501');
 await as(admin);let list=await rpc('select public.access_requests()r');assert.equal(list.total,2);assert.equal(list.pending,2);
 const decision=async(uid,rev,state)=>rpc('select public.access_decide($1,$2,$3)r',[uid,rev,state]);const accepted=await decision(learner,1,'approved');assert.equal(accepted.status,'approved');assert.deepEqual(await decision(learner,1,'approved'),accepted,'lost response retry is idempotent');
 assert.equal((await db.query('select count(*)::int n from public.access_decisions')).rows[0].n,1);
 await assert.rejects(decision(learner,1,'declined'),e=>e.code==='PT409','stale conflicting decision is not a serialization retry');
 await assert.rejects(decision(admin,1,'declined'),e=>e.code==='PT409','administrator cannot remove own access');
 assert.equal((await db.query('select count(*)::int n from public.words')).rows[0].n,0,'admin cannot read another learners vocabulary');
 await as(learner);assert.equal((await status()).status,'approved');assert.equal((await db.query('select count(*)::int n from public.words')).rows[0].n,1);assert.equal((await rpc('select public.vocabulary_list()r')).total,1);assert.equal((await db.query('select count(*)::int n from public.access_decisions')).rows[0].n,0);
 await as(admin);await decision(learner,2,'declined');await decision(other,1,'declined');assert.equal((await rpc("select public.access_requests('declined')r")).total,2);
 await as(learner);assert.equal((await status()).status,'declined');await assert.rejects(db.query('select public.fixed_due()'),e=>e.code==='42501');assert.equal((await db.query('select count(*)::int n from public.words')).rows[0].n,0);
 await db.exec('reset role');const guarded=await db.query("select p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.prorettype='jsonb'::regtype and has_function_privilege('authenticated',p.oid,'EXECUTE')and p.proname not in('access_status','access_requests','access_decide')");assert(guarded.rows.length>=20);for(const f of guarded.rows)assert.match(f.prosrc,/require_access/);
 await db.exec('set role anon');await assert.rejects(db.query('select public.access_status()'),e=>e.code==='42501');
 }finally{await db.close();}
});
