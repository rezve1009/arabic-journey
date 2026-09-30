// Disposable UI test backend. Never deploy or use this adapter with real credentials.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();const root=resolve(import.meta.dirname,'..');
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const file of ['202609300001_foundation.sql','202609300002_vocabulary.sql','202609300003_morphology.sql','202609300004_fixed_srs.sql'])await db.exec(await readFile(resolve(root,'supabase/migrations',file),'utf8'));
await db.exec(`insert into auth.users(id) values('11111111-1111-4111-8111-111111111111');set role authenticated;select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
  if(req.url==='/__test-api'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    try{
      const q=JSON.parse(body);let data;
      if(q.rpc==='vocabulary_write'){const a=q.args;data=(await db.query('select public.vocabulary_write($1,$2,$3,$4,$5,$6,$7) as result',[a.p_operation,a.p_action,a.p_id,a.p_revision,JSON.stringify(a.p_values),a.p_tags,a.p_allow_duplicate])).rows[0].result;}
      else if(q.rpc==='vocabulary_list'){const a=q.args;data=(await db.query('select public.vocabulary_list($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result',[a.p_search,a.p_type,a.p_status,a.p_tag,a.p_favorite,a.p_from,a.p_to,a.p_page,a.p_root,a.p_harakah,a.p_tatweel,a.p_unicode])).rows[0].result;}
      else if(q.rpc==='save_arabic_display'){const a=q.args;data=(await db.query('select public.save_arabic_display($1,$2,$3,$4) result',[a.p_revision,a.p_harakah_mode,a.p_font_size,a.p_future_prefix])).rows[0].result;}
      else if(q.rpc==='save_fixed_schedule'){const a=q.args;data=(await db.query('select public.save_fixed_schedule($1,$2,$3,$4) result',[a.p_revision,a.p_intervals,a.p_repeat_days,JSON.stringify(a.p_ratings)])).rows[0].result;}
      else if(q.rpc==='fixed_due')data=(await db.query('select public.fixed_due($1) result',[q.args.p_page])).rows[0].result;
      else if(q.rpc==='fixed_review'){const a=q.args;data=(await db.query('select public.fixed_review($1,$2,$3,$4,$5,$6) result',[a.p_operation,a.p_word,a.p_revision,a.p_rating,a.p_response_ms,a.p_mode])).rows[0].result;}
      else{
        if(!['words','tags','word_tags','user_settings','word_review_state','review_history'].includes(q.table))throw new Error('Unsupported fixture table');
        const values=[];const clauses=q.filters.map(([key,value])=>{
          if(!['id','word_id','deleted_at','user_id','algorithm'].includes(key))throw new Error('Unsupported filter');
          if(value===null)return `${key} is null`;values.push(value);return `${key}=$${values.length}`;
        });
        const sort={tags:'name,id',words:'created_at desc,id',user_settings:'user_id',word_tags:'tag_id',word_review_state:'word_id',review_history:'occurred_at desc,id desc'}[q.table];
        const result=await db.query(`select * from public.${q.table} ${clauses.length?'where '+clauses.join(' and '):''} order by ${sort} limit ${Math.min(1000,q.end-q.start+1)} offset ${Math.max(0,q.start)}`,values);
        data=q.single?result.rows[0]:result.rows;if(q.single&&!data){res.end(JSON.stringify({error:{code:'PGRST116'}}));return;}
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error:null}));
    }catch(error){res.end(JSON.stringify({data:null,error:{code:error.code,message:error.message}}));}return;
  }
  try{
    let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(path==='/')path='/index.html';
    const file=resolve(root,'.'+path);if(!file.startsWith(root+'\\')&&!file.startsWith(root+'/'))throw new Error('Forbidden');
    let content=await readFile(path==='/js/supabase.js'?resolve(root,'tests/browser-account.js'):file);
    if(path==='/index.html')content=Buffer.from(content.toString().replace('<body>','<body><div style="background:#fff2d5;padding:8px;text-align:center;font-size:12px">Disposable PostgreSQL test account · localhost:5174</div>'));
    res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(content);
  }catch{res.statusCode=404;res.end('Not found');}
}).listen(5174,'127.0.0.1',()=>console.log('Disposable vocabulary UI tests: http://localhost:5174 (Ctrl+C removes database)'));
