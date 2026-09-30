import { t } from './i18n.js';
import { getAccount } from './supabase.js';
import { parseRoot, parseArabicList, displayArabic, futureArabic, pronouns } from './arabic-utils.js';

const verbFields = ['verb_form','past_base','present_base','imperative','active_participle','passive_participle'];
const nounFields = ['singular','dual','plurals','broken_plurals','masculine','feminine','synonyms','antonyms'];
const listFields = new Set(['plurals','broken_plurals','synonyms','antonyms']);
const labels = {
  root_input:'Root letters',root_meaning:'Root meaning',wazn:'Wazn / pattern',verb_form:'Verb form',
  masdars_input:'Masdars',past_base:'Past base',present_base:'Present base',imperative:'Imperative base',
  active_participle:'Active participle',passive_participle:'Passive participle',linguistic_provenance:'Grammar source',
  singular:'Singular',dual:'Dual',plurals:'Plurals',broken_plurals:'Broken plurals',masculine:'Masculine',feminine:'Feminine',synonyms:'Synonyms',antonyms:'Antonyms',
};
export function arabicPreferences() {
  const settings=getAccount().settings||{};
  return {mode:settings.harakah_mode||'always_show',fontSize:settings.arabic_font_size||38,prefix:settings.future_prefix||'sa'};
}
export function arabicDisplay(value) { return displayArabic(value,arabicPreferences()); }
export function hydrateMorphology(word) {
  const archive=word.word_type!=='verb' ? word.morphology?._verb||{} : {};
  const draft={...word,...archive,morphology:structuredClone(word.morphology||{}),conjugations:structuredClone(archive.conjugations||word.conjugations||{}),
    root_input:(word.root||[]).join(' '),masdars_input:(archive.masdars||word.masdars||[]).join('\n'),linguistic_provenance:word.linguistic_provenance||'manual',morphology_changed:[]};
  for(const key of nounFields)draft['noun_'+key]=listFields.has(key)?(Array.isArray(word.morphology?.[key])?word.morphology[key].join('\n'):''):word.morphology?.[key]||'';
  return draft;
}
export function mergeMorphologyDraft(existing,incoming) {
  const merged=hydrateMorphology(existing);
  for(const key of incoming.morphology_changed||[])merged[key]=structuredClone(incoming[key]);
  merged.morphology_changed=[...(incoming.morphology_changed||[])];
  return merged;
}
export function morphologyValues(draft) {
  const values={root:parseRoot(draft.root_input),root_meaning:draft.root_meaning||'',wazn:draft.wazn||'',linguistic_provenance:draft.linguistic_provenance||'manual'};
  const edited=new Set(draft.morphology_changed||[]);
  if(draft.word_type==='verb'||[...verbFields,'masdars_input','conjugations'].some(key=>edited.has(key))) {
    for(const key of verbFields)values[key]=key==='verb_form'?(draft[key]?Number(draft[key]):null):draft[key]||'';
    values.masdars=parseArabicList(draft.masdars_input);
    values.conjugations={};
    for(const pronoun of pronouns){
      const row=draft.conjugations?.[pronoun.id]||{};const saved={};
      for(const tense of ['past','present',...(pronoun.imperative?['imperative']:[])])if(row[tense]?.trim())saved[tense]=row[tense];
      if(Object.keys(saved).length)values.conjugations[pronoun.id]=saved;
    }
  }
  if(['noun','adjective'].includes(draft.word_type)||nounFields.some(key=>edited.has('noun_'+key))) {
    values.morphology={};
    for(const key of nounFields)values.morphology[key]=listFields.has(key)?parseArabicList(draft['noun_'+key]):draft['noun_'+key]||'';
  }
  return values;
}
function node(tag,text,className='') {const result=document.createElement(tag);if(text!=null)result.textContent=text;if(className)result.className=className;return result;}
function arabicNode(tag,value,{editing=false}={}) {
  const result=node(tag,editing?value:arabicDisplay(value));result.lang='ar';result.dir='rtl';result.dataset.noTranslate='';return result;
}
function changed(draft,key) {draft.dirty=true;draft.morphology_changed||=[];if(!draft.morphology_changed.includes(key))draft.morphology_changed.push(key);}
export function morphologyEditor(draft,{disabled=false}={}) {
  const section=node('section',null,'morphology-editor');
  if(!['verb','noun','adjective'].includes(draft.word_type))return section;
  section.append(node('h2',t('Arabic morphology')),node('p',t('Enter grammar from your teacher or a trusted reference. Missing forms stay empty.'),'settings-help'));
  const grid=node('div',null,'word-fields');
  const add=(key,{list=false,arabic=true,maxLength=200}={})=>{
    const label=node('label',t(labels[key.replace(/^noun_/, '')]));
    const input=node(list?'textarea':'input');input.value=draft[key]||'';input.name=key;input.disabled=disabled;input.maxLength=list?4020:maxLength;
    if(arabic){input.lang='ar';input.dir='rtl';}else input.dir='auto';
    input.addEventListener('input',()=>{draft[key]=input.value;changed(draft,key);});
    label.append(input);if(list)label.append(node('span',t('One item per line; up to 20 items.'),'settings-help'));grid.append(label);return input;
  };
  const root=add('root_input');root.placeholder=t('ك ت ب or د ح ر ج');
  const preview=arabicNode('output','',{editing:true});preview.className='root-preview';
  const updateRoot=()=>{try{preview.textContent=parseRoot(root.value).join(' — ');root.setCustomValidity('');}catch{preview.textContent='';root.setCustomValidity(t('Enter exactly 3 or 4 Arabic root letters.'));}};
  root.addEventListener('input',updateRoot);root.after(preview);updateRoot();
  add('root_meaning',{arabic:false,maxLength:2000});add('wazn');
  if(draft.word_type==='verb') {
    const label=node('label',t('Verb form'));const select=node('select');select.name='verb_form';select.disabled=disabled;
    for(const [value,text]of[['',t('Not specified')],...['I','II','III','IV','V','VI','VII','VIII','IX','X'].map((roman,index)=>[String(index+1),t('Form {form}',{form:roman})])]){const option=node('option',text);option.value=value;select.append(option);}
    select.value=draft.verb_form?String(draft.verb_form):'';select.addEventListener('change',()=>{draft.verb_form=select.value?Number(select.value):null;changed(draft,'verb_form');});label.append(select);grid.append(label);
    add('masdars_input',{list:true});
    for(const key of verbFields.filter(key=>key!=='verb_form'))add(key);
  } else for(const key of nounFields)add('noun_'+key,{list:listFields.has(key)});
  const source=node('label',t('Grammar source'));const select=node('select');select.disabled=disabled;
  for(const [value,text]of[['manual','Manual'],['teacher','Teacher'],['import','Imported'],['ai_suggestion','AI suggestion (unverified)']]){const option=node('option',t(text));option.value=value;select.append(option);}
  select.value=draft.linguistic_provenance;select.addEventListener('change',()=>{draft.linguistic_provenance=select.value;changed(draft,'linguistic_provenance');});source.append(select);grid.append(source);
  section.append(grid,node('p',t('Grammar for other word types is kept and hidden. Editing always shows original Harakah.'),'settings-help'));
  if(draft.word_type==='verb')section.append(conjugationTable(draft,{editable:true,disabled,expanded:true}));
  return section;
}
export function conjugationTable(word,{editable=false,disabled=false,expanded=false}={}) {
  const section=node('section',null,'conjugation-section');section.append(node('h3',t('14 pronoun conjugations')));
  const controls=node('div',null,'vocabulary-actions');const content=node('div');
  const compact=node('button',t('Compact View'),'button button-secondary');compact.type='button';
  const expand=node('button',t('Expanded View'),'button button-secondary');expand.type='button';
  compact.disabled=disabled;expand.disabled=disabled;controls.append(compact,expand);section.append(controls,node('p',t('Future is derived from each saved present form. Imperative applies only to second-person pronouns.'),'settings-help'),content);
  const render=()=>{
    compact.setAttribute('aria-pressed',String(!expanded));expand.setAttribute('aria-pressed',String(expanded));content.replaceChildren();
    const table=node('table',null,'conjugation-table');const caption=node('caption',t('Past, present, future and imperative'));table.append(caption);
    const head=node('thead');const header=node('tr');for(const text of ['Pronoun','Past','Present','Future','Imperative']){const th=node('th',t(text));th.scope='col';header.append(th);}head.append(header);table.append(head);
    const body=node('tbody');const prefs=arabicPreferences();
    for(const pronoun of pronouns) {
      const saved=word.conjugations?.[pronoun.id]||{};
      if(!expanded&&!Object.values(saved).some(value=>value?.trim()))continue;
      const row=node('tr');const name=node('th');name.scope='row';name.append(arabicNode('span',pronoun.arabic,{editing:editable}),node('small',t(pronoun.label)));row.append(name);
      const future=node('td');future.dataset.label=t('Future');
      const futureText=arabicNode('span',futureArabic(saved.present,prefs.prefix),{editing:editable});future.append(futureText);
      for(const tense of ['past','present','future','imperative']) {
        if(tense==='future'){row.append(future);continue;}
        const cell=node('td');cell.dataset.label=t(tense[0].toUpperCase()+tense.slice(1));
        if(tense==='imperative'&&!pronoun.imperative){cell.append(node('span','—'));row.append(cell);continue;}
        if(editable){
          const input=node('input');input.lang='ar';input.dir='rtl';input.maxLength=200;input.value=saved[tense]||'';input.disabled=disabled;
          input.setAttribute('aria-label',`${t(pronoun.label)} — ${t(tense[0].toUpperCase()+tense.slice(1))}`);
          input.dataset.pronoun=pronoun.id;input.dataset.tense=tense;
          input.addEventListener('input',()=>{word.conjugations||={};word.conjugations[pronoun.id]||={};word.conjugations[pronoun.id][tense]=input.value;changed(word,'conjugations');if(tense==='present')futureText.textContent=futureArabic(input.value,prefs.prefix)||'—';});
          cell.append(input);
        }else cell.append(arabicNode('span',saved[tense]||'—'));
        if(!futureText.textContent)futureText.textContent='—';row.append(cell);
      }
      body.append(row);
    }
    if(!body.children.length){content.append(node('p',t('No conjugations entered. Choose Expanded View to see all 14 pronouns.'),'settings-help'));return;}
    table.append(body);content.append(table);
  };
  compact.addEventListener('click',()=>{expanded=false;render();});expand.addEventListener('click',()=>{expanded=true;render();});render();return section;
}
export function morphologyDetails(word) {
  const section=node('section',null,'morphology-details');
  if(!['verb','noun','adjective'].includes(word.word_type))return section;
  section.append(node('h3',t('Arabic morphology')));const list=node('dl',null,'word-detail-list');
  const add=(label,value,arabic=true)=>{if(!value)return;list.append(node('dt',t(label)));const dd=arabic?arabicNode('dd',value):node('dd',value);dd.dataset.noTranslate='';if(!arabic)dd.dir='auto';list.append(dd);};
  add('Root letters',(word.root||[]).join(' — '));add('Root meaning',word.root_meaning,false);add('Wazn / pattern',word.wazn);
  if(word.word_type==='verb'){
    if(word.verb_form)add('Verb form',t('Form {form}',{form:['I','II','III','IV','V','VI','VII','VIII','IX','X'][word.verb_form-1]}),false);
    add('Masdars',(word.masdars||[]).join('\n'));
    for(const key of verbFields.filter(key=>key!=='verb_form'))add(labels[key],word[key]);
    add('Future',futureArabic(word.present_base,arabicPreferences().prefix));
  } else for(const key of nounFields)add(labels[key],Array.isArray(word.morphology?.[key])?word.morphology[key].join('\n'):word.morphology?.[key]);
  add('Grammar source',t({manual:'Manual',teacher:'Teacher',import:'Imported',ai_suggestion:'AI suggestion (unverified)'}[word.linguistic_provenance]||'Manual'),false);
  section.append(list);
  if(word.word_type==='verb')section.append(conjugationTable(word));return section;
}
