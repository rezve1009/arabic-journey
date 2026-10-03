import {t}from './i18n.js';
export function tagPicker(tags,{selected=[],disabled=false,onChange=()=>{}}={}){
 const node=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
 const root=node('fieldset','','tag-selector searchable-tags');root.disabled=disabled;root.append(node('legend',t('Tags / Decks')));
 const chosen=new Set(selected),names=new Map(tags.map(tag=>[tag.id,tag]));let limit=50;
 const label=node('label',t('Search tags / decks'),'tag-search-label'),search=node('input');search.type='search';search.placeholder=t('Type a tag or deck name');search.maxLength=200;label.append(search);
 const chips=node('div','','selected-tags');chips.setAttribute('aria-label',t('Selected tags / decks'));
 const status=node('p','','settings-help tag-result-count');status.setAttribute('aria-live','polite');
 const results=node('div','','tag-search-results');
 const more=node('button',t('Show more'),'button button-secondary');more.type='button';
 const normalized=value=>value.normalize('NFKC').toLocaleLowerCase().trim();
 const matches=()=>{const terms=normalized(search.value).split(/\s+/u).filter(Boolean);return tags.filter(tag=>{const text=normalized(tag.name+' '+tag.kind+' '+t(tag.kind==='deck'?'Deck':'Tag'));return terms.every(term=>text.includes(term));});};
 const sync=()=>{
  chips.replaceChildren();
  for(const id of chosen){const tag=names.get(id),name=tag?tag.name:t('Unavailable tag');const chip=node('button','','tag-chip');chip.type='button';chip.setAttribute('aria-label',t('Remove {name}',{name}));const text=node('span',name);text.dataset.noTranslate='';chip.append(text,node('span',' ×'));chip.addEventListener('click',()=>{chosen.delete(id);onChange([...chosen]);sync();});chips.append(chip);}
  if(!chosen.size)chips.append(node('span',t('No tags selected'),'settings-help'));
  for(const input of results.querySelectorAll('input'))input.checked=chosen.has(input.value);
  status.textContent=t('{selected} selected · {matches} matches',{selected:chosen.size,matches:matches().length});
 };
 const draw=()=>{
  const filtered=matches();results.replaceChildren();
  for(const tag of filtered.slice(0,limit)){const row=node('label','','checkbox-label');const input=node('input');input.type='checkbox';input.value=tag.id;input.checked=chosen.has(tag.id);input.addEventListener('change',()=>{if(input.checked)chosen.add(tag.id);else chosen.delete(tag.id);onChange([...chosen]);sync();});const text=node('span',t(tag.kind==='deck'?'Deck':'Tag')+': '+tag.name);text.dataset.noTranslate='';row.append(input,text);results.append(row);}
  if(!filtered.length)results.append(node('p',t(tags.length?'No matching tags or decks.':'Create tags or decks on the Tags page.'),'settings-help'));
  more.hidden=filtered.length<=limit;sync();
 };
 search.addEventListener('input',()=>{limit=50;draw();});more.addEventListener('click',()=>{limit+=50;draw();});root.append(label,chips,status,results,more);draw();return root;
}
