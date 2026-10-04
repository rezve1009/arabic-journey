import {getReviewInfo} from './srs-data.js';
import {getAccount} from './supabase.js';
import {t,getLanguage} from './i18n.js';
import {node,content,action,link} from './learning-ui.js';
export function reviewDate(value){return new Intl.DateTimeFormat(getLanguage()==='bn'?'bn-BD':'en',{dateStyle:'medium',timeStyle:'short',timeZone:getAccount().settings.timezone||'UTC'}).format(new Date(value));}
export function reviewDetails(word){
 const owner=getAccount().user.id,section=node('section','','word-schedule');section.append(node('h3','Next review'),node('p','Loading review schedule…'));
 const load=async()=>{try{const {state}=await getReviewInfo(word.id);if(!section.isConnected||getAccount().user?.id!==owner)return;section.replaceChildren(node('h3','Next review'));if(!state){section.append(node('p','No fixed schedule state is available.'));return;}
 const due=new Date(state.next_review_at)<=new Date();const when=content('p',reviewDate(state.next_review_at),'next-review-date');section.append(when,node('span',due?'Due now':'Scheduled','pill'),content('p',t('Times use {timezone}.',{timezone:getAccount().settings.timezone}),'settings-help'));
 const grid=node('dl','','schedule-facts');for(const [label,value]of [['Recorded reviews',state.review_count],['Interval days',state.interval_days],['Learning status',t(state.mastery_status)],['Weak score',Number(state.weak_score).toFixed(1)]])grid.append(node('dt',label),content('dd',value));section.append(grid,link(due?'Start Review':'Random Practice',due?'#/review':'#/review?practice=all'),link('View history','#/history?word='+word.id));
 }catch(e){if(section.isConnected&&getAccount().user?.id===owner){section.replaceChildren(node('p','Review schedule could not be loaded.'),action('Retry',load));}}};queueMicrotask(load);return section;
}
