import {getAccount,subscribeAccount} from './supabase.js';
import {t} from './i18n.js';
import {defaultSchedule,defaultRatings,validateSchedule} from './srs.js';
import {showModal} from './ui.js';
let owner,draft;
subscribeAccount(account=>{if(owner&&owner!==account.user?.id){owner=undefined;draft=null;}});
export function acknowledgeScheduleRevision(){if(draft&&owner===getAccount().user?.id)draft.revision=getAccount().settings.revision;}
export function scheduleForm({save,run,reload}){
 const account=getAccount();if(owner!==account.user.id){owner=account.user.id;draft=null;}
 if(!draft)draft={...structuredClone(account.settings.revision_schedule),ratings:structuredClone(account.settings.rating_behavior),revision:account.settings.revision};
 const form=document.createElement('form');form.className='settings-form srs-settings';
 const node=(tag,text)=>{const element=document.createElement(tag);if(text)element.textContent=t(text);return element;};
 const button=(text,action)=>{const b=node('button',text);b.type='button';b.className='button button-secondary';b.addEventListener('click',action);return b;};
 const field=(labelText,value,properties,onInput)=>{const label=node('label');label.append(node('span',labelText));const input=node('input');input.type='number';input.value=value;Object.assign(input,{required:true,...properties});input.addEventListener('input',()=>onInput(Number(input.value)));label.append(input);return label;};
 const render=()=>{
  form.replaceChildren(node('p','Fixed Schedule'),node('p','Intervals are days between reviews. New words start at the first interval; Good advances one stage. After the final stage, the long-term interval repeats.'));
  form.append(node('p','Days are elapsed 24-hour intervals; dates use your saved timezone.'));
  const list=node('ol');list.className='schedule-stages';
  draft.intervals.forEach((days,index)=>{
   const row=node('li');row.append(field(t('Stage {stage} days',{stage:index+1}),days,{min:1,max:3650,step:1},value=>draft.intervals[index]=value));
   const actions=node('div');actions.className='vocabulary-actions';
   const up=button(t('Move stage {stage} up',{stage:index+1}),()=>{[draft.intervals[index-1],draft.intervals[index]]=[draft.intervals[index],draft.intervals[index-1]];render();});up.disabled=index===0;
   const down=button(t('Move stage {stage} down',{stage:index+1}),()=>{[draft.intervals[index+1],draft.intervals[index]]=[draft.intervals[index],draft.intervals[index+1]];render();});down.disabled=index===draft.intervals.length-1;
   const remove=button(t('Delete stage {stage}',{stage:index+1}),()=>{draft.intervals.splice(index,1);render();});remove.disabled=draft.intervals.length===1;
   actions.append(up,down,remove);row.append(actions);list.append(row);
  });form.append(list);
  const add=button('Add stage',()=>{draft.intervals.push(draft.repeat_days);render();});add.disabled=draft.intervals.length>=30;form.append(add);
  form.append(field('Long-term repeat days',draft.repeat_days,{min:1,max:3650,step:1},v=>draft.repeat_days=v),node('h3','Rating behavior'));
  form.append(field('Again interval days',draft.ratings.again_days,{min:1,max:3650,step:1},v=>draft.ratings.again_days=v),field('Hard interval factor',draft.ratings.hard_factor,{min:0.1,max:1,step:0.1},v=>draft.ratings.hard_factor=v),field('Easy extra stages to skip',draft.ratings.easy_skip,{min:0,max:10,step:1},v=>draft.ratings.easy_skip=v));
  form.append(node('p','Again resets to the first stage. Hard keeps the stage and shortens its interval, rounded up to at least one day. Easy advances one stage plus the extra skip.'));
  form.append(node('p','Saving creates a new schedule version. Existing due dates and history stay unchanged; the next recorded review uses the new settings. Adaptive SRS is reserved for a later version.'));
  form.append(button('Reset schedule draft to default',()=>{Object.assign(draft,structuredClone(defaultSchedule),{ratings:structuredClone(defaultRatings)});render();}));
  const submit=node('button','Save fixed schedule');submit.type='submit';submit.className='button button-primary';form.append(submit);
  form.append(button('Reload schedule preferences',()=>{
   const content=node('div');content.append(node('p','Replace the schedule draft with the latest saved preferences?'));
   const actions=node('div');actions.className='vocabulary-actions';actions.append(button('Confirm',()=>{document.getElementById('app-dialog').close();run(async()=>{await reload();draft=null;});}),button('Cancel',()=>document.getElementById('app-dialog').close()));content.append(actions);showModal(t('Reload schedule preferences'),content);
  }));
 };
 form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;
  const values=structuredClone(draft);run(async()=>{validateSchedule(values,values.ratings);await save(values,values.revision);acknowledgeScheduleRevision();draft=null;},'Fixed schedule saved. Existing due dates were kept.');
 });render();return form;
}
