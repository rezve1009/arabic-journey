import {getReviewInfo} from './srs-data.js';
import {getAccount} from './supabase.js';
import {t,getLanguage} from './i18n.js';
export function reviewDetails(word){
 const owner=getAccount().user.id,section=document.createElement('section');section.className='morphology-details';
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const date=value=>new Intl.DateTimeFormat(getLanguage()==='bn'?'bn-BD':'en',{dateStyle:'medium',timeStyle:'short',timeZone:getAccount().settings.timezone}).format(new Date(value));
 section.append(node('h3',t('Fixed review schedule')),node('p',t('Loading review schedule…')));
 queueMicrotask(async()=>{try{
  const {state,history}=await getReviewInfo(word.id);if(!section.isConnected||getAccount().user?.id!==owner)return;
  section.replaceChildren(node('h3',t('Fixed review schedule')),node('p',t('Times use {timezone}.',{timezone:getAccount().settings.timezone})));
  if(state){const list=node('dl','');list.className='word-detail-list';
   for(const [label,value]of [['Review stage',String(state.stage+1)],['Interval days',String(state.interval_days)],['Next review',date(state.next_review_at)],['Schedule version',String(state.schedule_version)],['Recorded reviews',String(state.review_count)]])list.append(node('dt',t(label)),node('dd',value));
   section.append(list,node('p',t(new Date(state.next_review_at)<=new Date()?'Due now':'Scheduled')));
  }else section.append(node('p',t('No fixed schedule state is available.')));
  section.append(node('h4',t('Recent review history')));
  if(!history.length)section.append(node('p',t('No recorded reviews yet. Rating controls arrive in Phase 6.')));
  else{const list=node('ol','');list.className='review-event-list';for(const event of history){const item=node('li','');
   item.append(node('strong',date(event.occurred_at)+' · '+t(event.rating)),node('p',t('Stage {before} → {after}; {days} days',{before:event.prior_stage+1,after:event.new_stage+1,days:event.new_interval})),node('p',t('Next review')+': '+date(event.next_review_at)),node('small',t(event.activity_mode==='scheduled'?'Scheduled review':'Recorded practice')));
   if(event.response_ms!==null)item.append(node('small',t('Response time: {ms} ms',{ms:event.response_ms})));list.append(item);
  }section.append(list);if(history.length===25)section.append(node('p',t('Showing the latest 25 reviews. Full history arrives in Phase 9.')));}
 }catch{if(section.isConnected&&getAccount().user?.id===owner){const message=node('p',t('Review schedule could not be loaded.'));const retry=node('button',t('Retry'));retry.type='button';retry.className='button button-secondary';retry.addEventListener('click',()=>section.replaceWith(reviewDetails(word)));section.replaceChildren(message,retry);}}});return section;
}
