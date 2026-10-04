import {getAccount}from './supabase.js';import {statisticsData}from './statistics.js';import {getCache}from './storage.js';import {pendingOperations}from './sync.js';
export function practiceCount(value){if(!/^[0-9]+$/.test(String(value)))throw Error('invalid_count');const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>1000)throw Error('invalid_count');return n;}
export async function reviewSummary(){
 const account=getAccount(),uid=account.user.id;const pending=(await pendingOperations()).filter(op=>op.rpc==='fixed_review').length;
 if(navigator.onLine){const data=await statisticsData();return {reviewed:data.reviewed_today,due:data.due,weak:data.weak,pending};}
 const [words,states,events]=await Promise.all(['words','word_review_state','review_history'].map(table=>getCache(uid,table)));const active=new Set(words.filter(w=>!w.deleted_at).map(w=>w.id));const live=states.filter(s=>!s.deleted_at&&s.algorithm==='fixed'&&active.has(s.word_id));const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:account.settings.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));const today=day(Date.now());
 return {reviewed:events.filter(e=>day(e.occurred_at)===today).length,due:live.filter(s=>new Date(s.next_review_at)<=new Date()).length,weak:live.filter(s=>s.weak_score>=(account.settings.weak_weights?.threshold||2)).length,pending};
}

export function selectUpcoming(words,states,limit=10,now=Date.now()){practiceCount(limit);const live=new Map(words.filter(w=>!w.deleted_at).map(w=>[w.id,w]));const ordered=states.filter(s=>s.algorithm==='fixed'&&!s.deleted_at&&live.has(s.word_id)&&new Date(s.next_review_at).getTime()>now).sort((a,b)=>a.next_review_at.localeCompare(b.next_review_at)||a.word_id.localeCompare(b.word_id));return {total:ordered.length,words:ordered.slice(0,limit).map(state=>({id:state.word_id,arabic_word:live.get(state.word_id).arabic_word,next_review_at:state.next_review_at,state})),offline:true};}
