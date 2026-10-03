import {getLanguage,t} from './i18n.js';
export function activityDays(calendar,today,count=7){
 const values=new Map(calendar.map(day=>[day.study_day,Number(day.n)]));
 return Array.from({length:count},(_,i)=>{const day=new Date(Date.parse(today+'T12:00:00Z')-(count-1-i)*86400000).toISOString().slice(0,10);return {day,count:values.get(day)||0};});
}
export function activityChart(calendar,today){
 const root=document.createElement('div');root.className='dashboard-activity';
 const controls=document.createElement('div');controls.className='activity-controls';
 const total=document.createElement('strong'),select=document.createElement('select');select.setAttribute('aria-label',t('Activity period'));
 for(const [value,label]of [[7,'Last 7 days'],[30,'Last 30 days']]){const option=document.createElement('option');option.value=value;option.textContent=t(label);select.append(option);}
 controls.append(total,select);
 const chart=document.createElement('div');chart.className='activity-bars';
 const note=document.createElement('p');note.className='muted activity-note';note.textContent=t('Activity = words added + reviews + saved quiz answers. Select a day for details.');
 const history=document.createElement('a');history.href='#/history';history.className='text-link';history.textContent=t('View all activity →');
 const draw=()=>{const days=activityDays(calendar,today,Number(select.value));const locale=getLanguage()==='bn'?'bn-BD':'en';const numbers=new Intl.NumberFormat(locale);const max=Math.max(1,...days.map(d=>d.count));chart.replaceChildren();chart.classList.toggle('activity-bars-month',days.length===30);
 total.textContent=t('{count} activities',{count:numbers.format(days.reduce((n,d)=>n+d.count,0))});
 for(const day of days){const label=new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(day.day+'T12:00:00Z'));const link=document.createElement('a');link.href='#/history?from='+day.day+'&to='+day.day;link.className='activity-bar';link.title=t('{date}: {count} activities',{date:label,count:numbers.format(day.count)});link.setAttribute('aria-label',link.title);if(day.day===today)link.setAttribute('aria-current','date');
 const number=document.createElement('span');number.className='activity-count';number.textContent=numbers.format(day.count);const track=document.createElement('span');track.className='activity-track';const fill=document.createElement('span');fill.className='activity-fill';fill.style.height=day.count?Math.max(4,day.count/max*100)+'%':'3px';fill.classList.toggle('activity-zero',!day.count);track.append(fill);const date=document.createElement('small');date.textContent=days.length===7?label:new Intl.DateTimeFormat(locale,{day:'numeric',timeZone:'UTC'}).format(new Date(day.day+'T12:00:00Z'));link.append(number,track,date);chart.append(link);}
 };
 select.addEventListener('change',draw);draw();root.append(controls,chart,note,history);return root;
}
