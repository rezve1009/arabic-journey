import {vocabularyRequest,getWord} from './vocabulary-data.js';
import {getAccount} from './supabase.js';
import {t,getLanguage} from './i18n.js';
import {reviewDate} from './srs-details.js';
import {node,content,action,link,field,shell,ready,finish,message} from './learning-ui.js';
export function localStudyDay(value=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:getAccount().settings.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
export function historyPage(){
 const page=shell('History');page.classList.add('history-page');if(!ready(page))return finish(page);
 page.querySelector('.page-heading').append(node('p','Explore your saved reviews, quiz answers and added words.','page-description'));
 const owner=getAccount().user.id,params=new URLSearchParams(location.hash.split('?')[1]||''),word=params.get('word');const from=field('From date','date',params.get('from')||''),to=field('To date','date',params.get('to')||'');
 const controls=node('section','','card history-controls'),quick=node('div','','history-quick'),types=node('div','','history-types'),status=node('p','','settings-help'),results=node('section','','history-timeline');status.setAttribute('aria-live','polite');let kind=params.get('kind')||'',index=0,generation=0;
 const refresh=()=>{index=0;load();};const kindButtons=[];
 for(const [value,label]of [['','All activity'],['word','Added words'],['review','Reviews'],['quiz','Quiz answers']]){const btn=action(label,()=>{kind=value;refresh();});btn.dataset.kind=value;kindButtons.push(btn);types.append(btn);}
 const dateRange=days=>{to.input.value=localStudyDay();from.input.value=days===1?to.input.value:new Date(new Date(to.input.value+'T12:00:00Z').getTime()-(days-1)*86400000).toISOString().slice(0,10);refresh();};
 quick.append(action('Today',()=>dateRange(1)),action('Last 7 days',()=>dateRange(7)),action('All dates',()=>{from.input.value=to.input.value='';refresh();}));
 const dates=node('div','','history-dates');dates.append(from.wrap,to.wrap,action('Apply filters',refresh,true));controls.append(types,quick,dates);page.append(controls,status,results);
 if(word){const context=node('div','','history-word-context');context.append(node('p','History for this word'),link('All words','#/history'));controls.prepend(context);queueMicrotask(async()=>{try{const w=await getWord(word);if(context.isConnected&&getAccount().user?.id===owner)context.prepend(content('strong',w.arabic_word,'arabic'));}catch{}});}
 async function load(){const token=++generation;for(const b of kindButtons)b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
  if(from.input.value&&to.input.value&&from.input.value>to.input.value){status.textContent=t('The start date must be before the end date.');return;}
  results.replaceChildren(node('p','Loading…'));status.textContent='';try{
   const data=await vocabularyRequest(c=>c.rpc('activity_history',{p_from:from.input.value||null,p_to:to.input.value||null,p_page:index,p_kind:kind||null,p_word:word||null}));
   if(!page.isConnected||token!==generation||getAccount().user?.id!==owner)return;results.replaceChildren();status.textContent=t('{total} activities · Page {page} of {pages}',{total:data.total,page:index+1,pages:Math.max(1,Math.ceil(data.total/25))});
   let group=null,day='';for(const e of data.events){const d=localStudyDay(e.event_at);if(d!==day){day=d;group=node('section','','history-day-group');const label=new Intl.DateTimeFormat(getLanguage()==='bn'?'bn-BD':'en',{dateStyle:'long',timeZone:getAccount().settings.timezone||'UTC'}).format(new Date(e.event_at));group.append(content('h2',label));results.append(group);}
    const row=node('article','','card activity-event');row.dataset.kind=e.kind;const top=node('div','','activity-event-top'),title=link('', '#/vocabulary?word='+e.word_id);title.className='activity-word-link';title.append(content('strong',e.arabic_word,'arabic'));
    const resultLabels={again:'Again',hard:'Hard',good:'Good',easy:'Easy',correct:'Correct',incorrect:'Incorrect',added:'Added to vocabulary'};top.append(title,node('span',e.kind==='word'?'Added word':e.kind==='review'?'Review':'Quiz answer','pill'));row.append(top,content('time',reviewDate(e.event_at)),node('p',resultLabels[e.result]||e.result,'activity-result'));
    if(e.next_review_at){const details=node('details','','activity-schedule');details.append(node('summary','Review schedule'),content('p',t('{before} → {after} days',{before:e.prior_interval,after:e.new_interval})),content('p',t('Next review')+': '+reviewDate(e.next_review_at)));row.append(details);}row.append(link('View details','#/vocabulary?word='+e.word_id));group.append(row);
   }
   if(!data.events.length){const empty=node('div','','card history-empty');empty.append(node('h2','No activity in this period.'),node('p','Try another date range or record a review.'));results.append(empty);}
   const nav=node('nav','','history-pagination');nav.setAttribute('aria-label',t('History pages'));const prev=action('Previous',()=>{index--;load();}),next=action('Next',()=>{index++;load();});prev.disabled=index===0;next.disabled=(index+1)*25>=data.total;nav.append(prev,content('span',(index+1)+' / '+Math.max(1,Math.ceil(data.total/25))),next);results.append(nav);finish(page);
  }catch(e){if(page.isConnected&&token===generation&&getAccount().user?.id===owner){results.replaceChildren();message(results,e);results.append(action('Retry',load));}}
 }
 queueMicrotask(load);return finish(page);
}
