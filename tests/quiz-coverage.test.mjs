import test from 'node:test';import assert from 'node:assert/strict';
import{readFile,readdir}from'node:fs/promises';import{randomUUID}from'node:crypto';import{PGlite}from'@electric-sql/pglite';
test('Quiz rounds mix unique old/new words, complete coverage, restart, retry and isolate owners',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid()to anon,authenticated;`);
 for(const f of(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const owner=randomUUID(),other=randomUUID();await db.query('insert into auth.users(id)values($1),($2)',[owner,other]);
 await db.query(`insert into public.words(user_id,arabic_word,normalized_arabic,english_meaning,bangla_meaning,word_type)select $1,'كتاب '||i,'كتاب '||i,'book '||i,'বই '||i,'noun' from generate_series(1,6)i`,[owner]);
 await db.exec('set role authenticated');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[owner]);
 const status=async()=>(await db.query('select public.quiz_coverage_status()s')).rows[0].s;
 const start=async(op=randomUUID())=>(await db.query(`select public.quiz_plan_start($1,2,50,array['arabic_bangla'])s`,[op])).rows[0].s;
 const complete=async(q,op=randomUUID())=>(await db.query('select public.quiz_finish($1,$2,$3)s',[op,q.id,JSON.stringify(q.questions.map(x=>({id:x.id,answer:x.answers[0],response_ms:1000})))])).rows[0].s;
 assert.deepEqual(await status(),{round:1,total:6,covered:0,remaining:6});
 const abandoned=await start();assert.equal((await status()).covered,0,'starting does not mark words covered');
 const op=randomUUID(),first=await start(op);assert.deepEqual(await start(op),first,'lost response retries recover the same quiz');
 assert.equal(new Set(first.questions.map(q=>q.word_id)).size,2);
 assert(first.questions.every(q=>q.fresh&&q.direction==='arabic_bangla'));
 const finishOp=randomUUID();await complete(first,finishOp);await complete(first,finishOp);assert.equal((await status()).covered,2);
 for(let expected=3;expected<=6;expected++){
  const q=await start();assert.equal(q.questions.filter(x=>x.fresh).length,1);assert.equal(q.questions.filter(x=>!x.fresh).length,1);
  assert.equal(new Set(q.questions.map(x=>x.word_id)).size,2);await complete(q);assert.equal((await status()).covered,expected);
 }
 const round2=await start();assert.equal(round2.settings_snapshot.coverage_round,2);assert(round2.questions.every(q=>q.fresh));assert.equal((await status()).covered,0);
 await complete(abandoned);assert.equal((await status()).covered,0,'late completion stays in its original round');
 await assert.rejects(db.query(`select public.quiz_plan_start($1,2,0)`,[randomUUID()]),e=>e.code==='22023');
 await assert.rejects(db.query(`select public.quiz_plan_start($1,2,50,array[]::text[])`,[randomUUID()]),e=>e.code==='22023');
 await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[other]);assert.equal((await status()).total,0);assert.equal((await db.query('select count(*)::int n from public.quiz_coverage')).rows[0].n,0);
 await assert.rejects(complete(round2),e=>e.code==='PT409');
 }finally{await db.close();}
});
