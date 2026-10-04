import test from 'node:test';import assert from 'node:assert/strict';import {PGlite}from'@electric-sql/pglite';import {readFile,readdir}from'node:fs/promises';import {randomUUID}from'node:crypto';
test('Multiple examples roundtrip, retry, bounds, owner isolation, per-word history and old backup restore',async()=>{
 const db=new PGlite(),alice=randomUUID(),bob=randomUUID(),word=randomUUID(),op=randomUUID();
 try{await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await db.query('insert into auth.users(id)values($1),($2)',[alice,bob]);await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false)`);
 const values={arabic_word:'كِتَابٌ',bangla_meaning:'বই',english_meaning:'book',word_type:'noun',example_arabic:'هَذَا كِتَابٌ',examples:[{arabic:'أَقْرَأُ كِتَابًا',bangla:'আমি বই পড়ি',english:'I read a book'}]};
 const write=async(vals=values,revision=null,operation=op)=>(await db.query("select public.vocabulary_write($1,'save',$2,$3,$4)result",[operation,word,revision,JSON.stringify(vals)])).rows[0].result;
 const saved=await write();assert.deepEqual(saved.word.examples,values.examples);assert.deepEqual(await write(),saved);
 await assert.rejects(write({...values,examples:[{arabic:'',bangla:'',english:''}]},saved.word.revision,randomUUID()),/constraint/);
 await assert.rejects(write({...values,examples:Array(20).fill(values.examples[0])},saved.word.revision,randomUUID()),/constraint/);
 const preserved=await write(Object.fromEntries(Object.entries(values).filter(([k])=>k!=='examples')),saved.word.revision,randomUUID());assert.deepEqual(preserved.word.examples,values.examples);
 const history=(await db.query('select public.activity_history(p_word=>$1)result',[word])).rows[0].result;assert.equal(history.total,1);assert.equal(history.events[0].word_id,word);
 const backup=(await db.query('select public.backup_export()result')).rows[0].result;await db.query("select public.backup_restore($1,$2,'RESTORE')",[randomUUID(),JSON.stringify(backup)]);assert.deepEqual((await db.query('select examples from public.words where id=$1',[word])).rows[0].examples,values.examples);
 for(const row of backup.words)delete row.examples;await db.query("select public.backup_restore($1,$2,'RESTORE')",[randomUUID(),JSON.stringify(backup)]);assert.deepEqual((await db.query('select examples from public.words where id=$1',[word])).rows[0].examples,[]);
 await db.exec(`select set_config('request.jwt.claim.sub','${bob}',false)`);assert.equal((await db.query('select public.activity_history(p_word=>$1)result',[word])).rows[0].result.total,0);assert.equal((await db.query('select *from public.words where id=$1',[word])).rows.length,0);
 }finally{await db.close();}
});
