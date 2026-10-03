import { t } from './i18n.js';
import { getAccount } from './supabase.js';
import { parseRoot, parseArabicList, displayArabic, pronouns } from './arabic-utils.js';

const verbFields = ['verb_form','past_base','present_base','imperative','active_participle','passive_participle'];
const nounFields = ['singular','dual','plurals','broken_plurals','masculine','feminine','synonyms','antonyms'];
const listFields = new Set(['plurals','broken_plurals','synonyms','antonyms']);
const labels = {
  root_input:'Root letters',root_meaning:'Root meaning',wazn:'Wazn / pattern',verb_form:'Verb form',
  masdars_input:'Masdars',past_base:'Past base',present_base:'Present / future base',imperative:'Imperative base',
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
 const controls=node('div',null,'vocabulary-actions'),content=node('div',null,'conjugation-tables');
 const compact=node('button',t('Compact View'),'button button-secondary'),expand=node('button',t('Expanded View'),'button button-secondary');
 for(const button of [compact,expand]){button.type='button';button.disabled=disabled;}controls.append(compact,expand);
 const status=node('p',null,'settings-help');status.setAttribute('aria-live','polite');
 section.append(controls,node('p',t('Compact: saved past and present / future forms. Expanded: all pronouns, meanings and imperative forms.'),'settings-help'),status,content);
 const render=()=>{
  compact.setAttribute('aria-pressed',String(!expanded));expand.setAttribute('aria-pressed',String(expanded));content.replaceChildren();
  const visible=pronouns.filter(p=>expanded||Object.values(word.conjugations?.[p.id]||{}).some(value=>value?.trim()));
  status.textContent=t(expanded?'Expanded view: all 14 pronouns and imperative forms.':'Compact view: {count} saved pronouns.',{count:visible.length});
  if(!visible.length){content.append(node('p',t('No conjugations entered. Choose Expanded View to see all 14 pronouns.'),'settings-help'));return;}
  for(const [tense,label]of [['past','Past'],['present','Present / future'],...(expanded?[['imperative','Imperative']]:[])]){
   const table=node('table',null,'conjugation-table tense-table');table.dataset.tense=tense;table.append(node('caption',t(label)));
   const head=node('thead'),header=node('tr');for(const text of ['Pronoun',label]){const th=node('th',t(text));th.scope='col';header.append(th);}head.append(header);table.append(head);
   const body=node('tbody');
   for(const pronoun of visible){if(tense==='imperative'&&!pronoun.imperative)continue;
    const row=node('tr'),name=node('th');name.scope='row';name.append(arabicNode('span',pronoun.arabic,{editing:editable}));if(expanded)name.append(node('small',t(pronoun.label)));row.append(name);
    const saved=word.conjugations?.[pronoun.id]||{},cell=node('td');
    if(editable){const input=node('input');input.lang='ar';input.dir='rtl';input.maxLength=200;input.value=saved[tense]||'';input.disabled=disabled;input.setAttribute('aria-label',t(pronoun.label)+' — '+t(label));input.dataset.pronoun=pronoun.id;input.dataset.tense=tense;
     input.addEventListener('input',()=>{word.conjugations||={};word.conjugations[pronoun.id]||={};word.conjugations[pronoun.id][tense]=input.value;changed(word,'conjugations');});cell.append(input);
    }else cell.append(arabicNode('span',saved[tense]||'—'));
    row.append(cell);body.append(row);
   }
   if(body.children.length){table.append(body);content.append(table);}
  }
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
  } else for(const key of nounFields)add(labels[key],Array.isArray(word.morphology?.[key])?word.morphology[key].join('\n'):word.morphology?.[key]);
  add('Grammar source',t({manual:'Manual',teacher:'Teacher',import:'Imported',ai_suggestion:'AI suggestion (unverified)'}[word.linguistic_provenance]||'Manual'),false);
  section.append(list);
  if(word.word_type==='verb')section.append(conjugationTable(word));return section;
}
