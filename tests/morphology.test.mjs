import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {normalizeArabic,removeHarakah,displayArabic,futureArabic,parseRoot,parseArabicList,arabicEquals,pronouns} from '../js/arabic-utils.js';

test('Arabic originals, comparison options, roots, future and stable pronouns',()=>{
  const original='كَـتَبَ';assert.equal(normalizeArabic(original),'كتب');assert.equal(removeHarakah(original),'كـتب');
  assert.equal(normalizeArabic(original,{ignoreHarakah:false,ignoreTatweel:false}),original);
  assert.equal(displayArabic(original,{mode:'hide_quiz'}),original);
  assert.equal(displayArabic(original,{mode:'hide_quiz',quiz:true}),'كـتب');
  assert.equal(displayArabic(original,{mode:'hide_quiz',quiz:true,revealed:true}),original);
  assert.equal(displayArabic(original,{mode:'always_hide'}),'كـتب');assert.equal(original,'كَـتَبَ');
  assert.equal(futureArabic('يَكْتُبُ'),'سَيَكْتُبُ');assert.equal(futureArabic('يَكْتُبُ','sawfa'),'سَوْفَ يَكْتُبُ');assert.equal(futureArabic(''),'');
  assert(arabicEquals('كـتب','كَتَبَ'));assert(!arabicEquals('',''));assert(!arabicEquals('كتب','كَتَبَ',{ignoreHarakah:false}));
  assert.deepEqual(parseRoot('كَ — ت — ب'),['ك','ت','ب']);assert.deepEqual(parseRoot('دحرج'),['د','ح','ر','ج']);assert.throws(()=>parseRoot('ك ت'));
  assert.deepEqual(parseArabicList('كِتَابَة، كَتْب\nكُتُب'),['كِتَابَة','كَتْب','كُتُب']);
  assert.equal(new Set(pronouns.map(p=>p.id)).size,14);assert.equal(pronouns.filter(p=>p.imperative).length,6);
});

test('Phase 4 PostgreSQL: atomic grammar, retention, retries, ownership and preferences',async()=>{
 const db=new PGlite(),alice=randomUUID(),bob=randomUUID(),id=randomUUID(),oldOp=randomUUID();
 const base={arabic_word:'كَتَبَ',bangla_meaning:'লিখেছে',english_meaning:'wrote',word_type:'verb'};
 const write=async(word,revision,values,op=randomUUID(),allow=false)=>(await db.query('select public.vocabulary_write($1,\'save\',$2,$3,$4,\'{}\',$5) result',[op,word,revision,JSON.stringify(values),allow])).rows[0].result;
 const current=async()=>(await db.query('select * from public.words where id=$1',[id])).rows[0];
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const f of ['202609300001_foundation.sql','202609300002_vocabulary.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  await db.query('insert into auth.users(id) values($1),($2)',[alice,bob]);
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false);`);
  const old=await write(id,null,base,oldOp);
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/202609300003_morphology.sql',import.meta.url),'utf8'));await db.exec('set role authenticated');
  assert.deepEqual(await write(id,null,base,oldOp),old,'pre-migration retries remain compatible');
  const conjugations=Object.fromEntries(pronouns.map(p=>[p.id,{past:'كَتَبَ',present:'يَكْتُبُ',...(p.imperative?{imperative:'اُكْتُبْ'}:{})}]));
  const grammar={...base,root:['ك','ت','ب'],root_meaning:'লেখা',wazn:'فَعَلَ',verb_form:1,masdars:['كِتَابَة','كَتْب'],past_base:'كَتَبَ',present_base:'يَكْتُبُ',conjugations,linguistic_provenance:'teacher'};
  const op=randomUUID();let saved=(await write(id,old.word.revision,grammar,op)).word;
  assert.equal(saved.verb_form,1);assert.deepEqual(saved.conjugations,conjugations);assert.deepEqual(saved.masdars,grammar.masdars);
  assert.deepEqual(await write(id,old.word.revision,grammar,op),{word:saved});await assert.rejects(write(id,old.word.revision,{...grammar,wazn:'changed'},op),/reused/);
  saved=(await write(id,saved.revision,{...base,notes:'Basic edit'})).word;assert.deepEqual(saved.conjugations,conjugations);assert.equal(saved.present_base,'يَكْتُبُ');
  await assert.rejects(write(id,saved.revision,{...grammar,conjugations:{huwa:{imperative:'invalid'}}}),/Invalid morphology/);
  await assert.rejects(write(id,saved.revision,{...grammar,root:['k','t','b']}),/Invalid root/);
  await assert.rejects(write(id,saved.revision,{...grammar,morphology:{plurals:[42]}}),/Invalid morphology/);
  await assert.rejects(write(id,saved.revision,{...grammar,verb_form:11}),/Invalid morphology/);
  await assert.rejects(write(id,saved.revision,{...grammar,verb_form:1.5}),/Invalid morphology/);
  await assert.rejects(write(id,saved.revision,{...grammar,masdars:Array(21).fill('كَتْب')}),/Invalid morphology/);
  const failedOp=randomUUID();await assert.rejects(write(id,saved.revision,{...grammar,notes:'must roll back',linguistic_provenance:'invalid'},failedOp),/check constraint/);
  assert.equal((await current()).revision,saved.revision,'invalid writes leave no side effects');
  assert.equal((await current()).notes,'Basic edit');
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int count from app_private.sync_operations where operation_id=$1',[failedOp])).rows[0].count,0);await db.exec('set role authenticated');
  await write(randomUUID(),null,{...base,arabic_word:'كِتَاب',word_type:'noun'});
  const before=await current();const warning=await write(id,saved.revision,{...base,arabic_word:'كِتَاب',word_type:'noun'});
  assert(warning.duplicates);assert.deepEqual(await current(),before,'duplicate type-change preparation rolls back');
  saved=(await write(id,saved.revision,{...base,word_type:'noun',morphology:{singular:'كَاتِب',dual:'كَاتِبَان',plurals:['كُتَّاب'],broken_plurals:['كُتَّاب'],synonyms:['مُؤَلِّف'],antonyms:[]}})).word;
  assert.deepEqual(saved.conjugations,{});assert.equal(saved.verb_form,null);assert.equal(saved.morphology._verb.present_base,'يَكْتُبُ');assert.equal(saved.morphology.singular,'كَاتِب');
  saved=(await write(id,saved.revision,base)).word;assert.deepEqual(saved.conjugations,conjugations);assert.equal(saved.verb_form,1);assert.equal(saved.morphology.singular,'كَاتِب');assert(!('_verb' in saved.morphology));
  assert.equal((await db.query('select count(*)::int count from public.word_review_state')).rows[0].count,0,'no Phase 5 scheduling introduced');
  assert.equal((await db.query('select count(*)::int count from public.review_history')).rows[0].count,0);
  const list=async(...args)=>(await db.query('select public.vocabulary_list($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result',['','','',null,false,null,null,0,'',true,true,true].map((v,i)=>args[i]??v))).rows[0].result;
  assert.equal((await list('','','',null,false,null,null,0,'ك ت ب')).total,1);
  assert.equal((await list('كـتب')).total,1);assert.equal((await list('كـتب','','',null,false,null,null,0,'',true,false)).total,0);
  assert.equal((await db.query("select public.vocabulary_list('كتب') result")).rows[0].result.total,1,'old optional calls remain supported');
  for(const sample of ['كَـتَبَ','ﻛﺘﺐ','  ك\tت\nب  ','أَلِف','سَوْفَ','\u00a0ك\u2003ت\u00a0','ك\ufeffتب',...['\u0085','\u1680','\u2007','\u202f','\u205f'].map(space=>'ك'+space+'ب')])for(const h of [true,false])for(const t of [true,false])for(const u of [true,false]){
   assert.equal((await db.query('select app_private.normalize_arabic($1,$2,$3,$4) v',[sample,h,t,u])).rows[0].v,normalizeArabic(sample,{ignoreHarakah:h,ignoreTatweel:t,unicode:u}));
  }
  let settings=(await db.query('select * from public.user_settings')).rows[0];
  settings=(await db.query("select public.save_arabic_display($1,'always_hide',80,'sawfa') result",[settings.revision])).rows[0].result;
  assert.equal(settings.arabic_font_size,80);assert.equal(settings.future_prefix,'sawfa');
  await assert.rejects(db.query("select public.save_arabic_display($1,'always_show',38,'sa')",[settings.revision-1]),/changed/);
  await assert.rejects(db.query("select public.save_arabic_display($1,'always_show',81,'sa')",[settings.revision]),/check constraint/);
  await assert.rejects(db.exec("select app_private.vocabulary_write_base(gen_random_uuid(),'save',gen_random_uuid())"),/permission denied/);
  await db.exec(`select set_config('request.jwt.claim.sub','${bob}',false);`);assert.equal((await list()).total,0);await assert.rejects(write(id,saved.revision,grammar),/unavailable/);
  await db.exec('reset role;set role anon');await assert.rejects(db.exec("select public.save_arabic_display(1,'always_show',38,'sa')"),/permission denied/);
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/tests/morphology.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/vocabulary.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select count(*)::int count from auth.users')).rows[0].count,2,'live audit fixtures roll back');
 }finally{await db.close();}
});
