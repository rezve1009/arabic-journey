import {t} from './i18n.js';
import {node,content,action,audio} from './learning-ui.js';
export function wordExamples(word){return [{arabic:word.example_arabic||'',bangla:word.example_bangla||'',english:word.example_english||''},...(word.examples||[])].filter(e=>Object.values(e).some(v=>v?.trim()));}
export function examplesEditor(draft,{disabled=false}={}){
 const section=node('section','','examples-editor');section.append(node('h2','Examples'),node('p','Add an Arabic sentence and its Bengali or English meaning.','settings-help'));
 draft.examples||=[];const rows=node('div');let add;
 const render=()=>{rows.replaceChildren();for(const [index,example]of [{arabic:draft.example_arabic||'',bangla:draft.example_bangla||'',english:draft.example_english||''},...draft.examples].entries()){
  const row=node('fieldset','','example-editor-row');row.append(content('legend',t('Example {number}',{number:index+1})));
  for(const [key,label,lang]of [['arabic','Arabic example','ar'],['bangla','Bengali example','bn'],['english','English example','en']]){const wrap=node('label',label),input=node('textarea');input.name=index?'examples_'+index+'_'+key:'example_'+key;input.value=example[key];input.maxLength=2000;input.disabled=disabled;input.lang=lang;input.dir=lang==='ar'?'rtl':'auto';input.addEventListener('input',()=>{if(index)draft.examples[index-1][key]=input.value;else draft['example_'+key]=input.value;draft.dirty=true;});wrap.append(input);row.append(wrap);}
  if(index){const remove=action('Remove example',()=>{draft.examples.splice(index-1,1);draft.dirty=true;render();});remove.className='button button-danger';remove.disabled=disabled;row.append(remove);}rows.append(row);
 }add.disabled=disabled||draft.examples.length>=19;};
 add=action('+ Add example',()=>{draft.examples.push({arabic:'',bangla:'',english:''});draft.dirty=true;render();rows.lastElementChild.querySelector('textarea').focus();});
 section.append(rows,add);render();return section;
}
export function examplesDetails(word){const section=node('section','','examples-details');const examples=wordExamples(word);if(!examples.length)return section;section.append(node('h3','Examples'));
 for(const [i,e]of examples.entries()){const card=node('article','','example-card');card.append(content('h4',t('Example {number}',{number:i+1})));for(const [key,lang]of [['arabic','ar'],['bangla','bn'],['english','en']])if(e[key]){const p=content('p',e[key],key==='arabic'?'arabic':'');p.lang=lang;p.dir=key==='arabic'?'rtl':'auto';card.append(p);}if(e.arabic&&'speechSynthesis'in window)card.append(audio(e.arabic));section.append(card);}return section;
}
