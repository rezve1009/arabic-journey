import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
test('MCQ eligibility, distinct authored options, stable retry and server scoring',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid()to anon,authenticated;");
 for(const f of(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const owner=randomUUID();await db.query('insert into auth.users(id)values($1)',[owner]);await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 const add=async(arabic,meaning)=>db.query("select public.vocabulary_write($1,'save',$2,null,$3)",[randomUUID(),randomUUID(),JSON.stringify({arabic_word:arabic,english_meaning:meaning,bangla_meaning:({book:'বই',pen:'কলম',door:'দরজা',house:'বাড়ি'})[meaning],word_type:'noun'})]);
 const start=async(op=randomUUID())=>(await db.query("select public.quiz_start($1,20,array['multiple_choice']) result",[op])).rows[0].result;
 await add('كِتَابٌ','book');assert.deepEqual(await start(),{empty:true});
 await add('قَلَمٌ','pen');let two=await start();assert.equal(two.questions.length,8);assert(two.questions.every(q=>q.choices.length===2));
 await add('بَابٌ','door');await add('بَيْتٌ','house');await add('كُتُبٌ','book');
 assert.deepEqual(new Set(two.questions.map(q=>q.direction)),new Set(['bangla_arabic','arabic_bangla','arabic_english','english_arabic']));
 const op=randomUUID(),quiz=await start(op);assert.deepEqual(await start(op),quiz);
 for(const q of quiz.questions){assert.equal(q.type,'multiple_choice');assert(q.choices.length>=2&&q.choices.length<=4);assert.equal(new Set(q.choices).size,4);assert(q.choices.includes(q.answers[0]));assert(q.direction);if(q.answer_lang==='en')assert(q.choices.every(c=>['book','pen','door','house'].includes(c)));if(q.answer_lang==='bn')assert(q.choices.every(c=>['বই','কলম','দরজা','বাড়ি'].includes(c)));if(q.answer_lang==='ar')assert(q.choices.every(c=>/[ء-ي]/.test(c)));}
 const answers=quiz.questions.map((q,i)=>({id:q.id,answer:i===0?q.choices.find(c=>c!==q.answers[0]):q.answers[0],response_ms:1000}));
 const score=(await db.query('select public.quiz_finish($1,$2,$3)result',[randomUUID(),quiz.id,JSON.stringify(answers)])).rows[0].result.score;assert.equal(score,quiz.questions.length-1);
 }finally{await db.close();}
});
