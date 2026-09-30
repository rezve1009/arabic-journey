import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';
import {fixedTransition,defaultSchedule,defaultRatings,validateSchedule} from '../js/srs.js';
test('Fixed v1 transitions and elapsed days',()=>{
 let state={stage:0};const at='2026-03-08T06:30:00Z';for(const days of [3,7,15,30,30,30]){state=fixedTransition(state,'good',defaultSchedule,defaultRatings,at);assert.equal(state.interval_days,days);assert.equal(new Date(state.next_review_at)-new Date(at),days*86400000);}
 assert.equal(fixedTransition({stage:2},'again').stage,0);assert.equal(fixedTransition({stage:2},'hard').interval_days,4);assert.equal(fixedTransition({stage:0},'easy').interval_days,7);
 assert.equal(fixedTransition({stage:9},'good',{intervals:[2],repeat_days:45}).interval_days,45);
 for(const intervals of [[],[0],[1.5],Array(31).fill(1)])assert.throws(()=>validateSchedule({intervals,repeat_days:30}));
});
test('Phase 5 PostgreSQL scheduling, history, retries, settings and isolation',async()=>{
 const db=new PGlite(),alice=randomUUID(),bob=randomUUID(),word=randomUUID();
 const write=async(id=word)=>(await db.query("select public.vocabulary_write($1,'save',$2,null,$3) result",[randomUUID(),id,JSON.stringify({arabic_word:id===word?'كَتَبَ':id,bangla_meaning:'শব্দ',english_meaning:'word',word_type:'verb'})])).rows[0].result.word;
 const state=async()=>(await db.query("select * from public.word_review_state where word_id=$1 and algorithm='fixed'",[word])).rows[0];
 const review=async(s,rating,op=randomUUID(),mode='recorded_practice')=>(await db.query('select public.fixed_review($1,$2,$3,$4,1234,$5) result',[op,word,s.revision,rating,mode])).rows[0].result;
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const f of ['202609300001_foundation.sql','202609300002_vocabulary.sql','202609300003_morphology.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  await db.query('insert into auth.users(id) values($1),($2)',[alice,bob]);await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false);`);const original=await write();
  await db.exec('reset role');await db.query("insert into public.word_review_state(user_id,word_id,algorithm,stage,interval_days,next_review_at) values($1,$2,'adaptive',8,45,now()+interval '45 days')",[alice,word]);
  const adaptive=(await db.query("select * from public.word_review_state where word_id=$1 and algorithm='adaptive'",[word])).rows[0];
  await db.exec(await readFile(new URL('../supabase/migrations/202609300004_fixed_srs.sql',import.meta.url),'utf8'));await db.exec('set role authenticated');
  let s=await state();assert.equal(s.stage,0);assert.equal(s.interval_days,1);assert.equal(new Date(s.next_review_at)-new Date(original.created_at),86400000);
  assert.equal((await db.query("select public.vocabulary_list('','','new') result")).rows[0].result.total,1);
  assert.equal((await db.query('select public.fixed_due() result')).rows[0].result.total,0);await assert.rejects(review(s,'good',randomUUID(),'scheduled'),/not due/);
  const op=randomUUID(),before=s;let result=await review(s,'good',op);s=result.state;assert.equal(s.interval_days,3);assert.equal(result.event.response_ms,1234);assert.deepEqual(await review(before,'good',op),result);await assert.rejects(review(before,'easy',op),/reused/);await assert.rejects(review(before,'good'),/changed/);
  assert.equal((await db.query("select public.vocabulary_list('','','new') result")).rows[0].result.total,0);
  for(const rating of ['hard','easy','again','good']){const expected=fixedTransition(s,rating);result=await review(s,rating);s=result.state;assert.equal(s.stage,expected.stage);assert.equal(s.interval_days,expected.interval_days);}
  assert.equal(s.review_count,5);assert.equal(s.incorrect_count,1);assert.equal(s.correct_count,4);assert.equal(s.success_count,3);assert(s.weak_score>=0);
  const failedOp=randomUUID();const eventCount=(await db.query('select count(*)::int count from public.review_history')).rows[0].count;
  await db.exec("reset role;create function app_private.fail_srs_test() returns trigger language plpgsql as $$begin raise exception 'Injected state failure';end$$;create trigger fail_srs_test before update on public.word_review_state for each row execute function app_private.fail_srs_test();set role authenticated;");
  await assert.rejects(review(s,'good',failedOp),/Injected/);assert.equal((await db.query('select count(*)::int count from public.review_history')).rows[0].count,eventCount);assert.equal((await state()).revision,s.revision);
  await db.exec('reset role;drop trigger fail_srs_test on public.word_review_state;drop function app_private.fail_srs_test();');assert.equal((await db.query('select count(*)::int count from app_private.sync_operations where operation_id=$1',[failedOp])).rows[0].count,0);await db.exec('set role authenticated');
  const history=(await db.query('select * from public.review_history order by occurred_at,id')).rows;
  let settings=(await db.query('select * from public.user_settings')).rows[0];const oldDue=s.next_review_at;
  settings=(await db.query('select public.save_fixed_schedule($1,$2,45,$3) result',[settings.revision,[2,5],JSON.stringify({again_days:2,hard_factor:0.4,easy_skip:0})])).rows[0].result;
  assert.equal(settings.revision_schedule.version,2);assert.equal(new Date((await state()).next_review_at).getTime(),new Date(oldDue).getTime());assert.deepEqual((await db.query('select * from public.review_history order by occurred_at,id')).rows,history);
  await assert.rejects(db.query("select public.save_fixed_schedule($1,array[1],30,'{}')",[settings.revision-1]),/changed/);
  for(const ratings of [{},null,{again_days:0,hard_factor:0.5,easy_skip:1},{again_days:1,hard_factor:2,easy_skip:1}])await assert.rejects(db.query('select public.save_fixed_schedule($1,array[1],30,$2)',[settings.revision,JSON.stringify(ratings)]),/Invalid/);
  await assert.rejects(db.query('select public.save_fixed_schedule($1,$2,30,$3)',[settings.revision,[],JSON.stringify(defaultRatings)]),/Invalid/);
  result=await review(s,'good');s=result.state;assert.equal(s.interval_days,45);assert.equal(s.schedule_version,2);assert.deepEqual(result.event.rating_snapshot,{again_days:2,hard_factor:0.4,easy_skip:0});
  const nextWord=await write(randomUUID());assert.equal((await db.query('select interval_days from public.word_review_state where word_id=$1',[nextWord.id])).rows[0].interval_days,2);
  await assert.rejects(db.exec('update public.review_history set rating=\'easy\''),/permission denied/);await assert.rejects(db.exec('delete from public.review_history'),/permission denied/);await assert.rejects(db.exec('update public.word_review_state set stage=99'),/permission denied/);
  await db.exec('reset role');await db.query("update public.word_review_state set next_review_at=now()-interval '1 minute' where word_id=$1 and algorithm='fixed'",[word]);await db.exec('set role authenticated');s=await state();assert.equal((await db.query('select public.fixed_due() result')).rows[0].result.total,1);result=await review(s,'again',randomUUID(),'scheduled');assert.equal(result.event.activity_mode,'scheduled');
  await db.exec(`select set_config('request.jwt.claim.sub','${bob}',false)`);assert.equal((await db.query('select public.fixed_due() result')).rows[0].result.total,0);assert.equal((await db.query('select * from public.review_history')).rows.length,0);await assert.rejects(review(result.state,'good'),/unavailable/);
  await db.exec(`select set_config('request.jwt.claim.sub','${alice}',false)`);await db.query("select public.vocabulary_write($1,'delete',$2,$3)",[randomUUID(),word,original.revision]);assert.equal((await db.query('select public.fixed_due() result')).rows[0].result.upcoming.length,1);assert.equal((await db.query('select * from public.review_history')).rows.length,7);await assert.rejects(review(result.state,'good'),/unavailable/);
  await db.exec('reset role;set role anon');await assert.rejects(db.exec('select public.fixed_due()'),/permission denied/);await assert.rejects(db.exec("select public.fixed_review(gen_random_uuid(),gen_random_uuid(),1,'good')"),/permission denied/);
  await db.exec('reset role');assert.deepEqual((await db.query("select * from public.word_review_state where word_id=$1 and algorithm='adaptive'",[word])).rows[0],adaptive,'fixed scheduling preserves adaptive state');
  for(const file of ['fixed-srs.sql','vocabulary.sql','morphology.sql'])await db.exec(await readFile(new URL('../supabase/tests/'+file,import.meta.url),'utf8'));assert.equal((await db.query('select count(*)::int count from auth.users')).rows[0].count,2);
  await db.query("insert into public.words(user_id,arabic_word,normalized_arabic,bangla_meaning,english_meaning,created_at) select $1,'كلمة '||n,'كلمة '||n,'শব্দ','word',now()-interval '3 days' from generate_series(1,1000) n",[alice]);
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false)`);const first=(await db.query('select public.fixed_due(0) result')).rows[0].result,second=(await db.query('select public.fixed_due(1) result')).rows[0].result;
  assert.equal(first.total,1000);assert.equal(first.words.length,25);assert.equal(second.words.length,25);assert(!first.words.some(w=>second.words.some(other=>w.id===other.id)));
 }finally{await db.close();}
});

