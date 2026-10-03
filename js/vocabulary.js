import {wordNeighbors,bindWordSwipe} from './word-navigation.js';
import {audio}from './learning-ui.js';
import { getAccount, subscribeAccount } from './supabase.js';
import { t, getLanguage } from './i18n.js';
import { emptyState, showModal, icon } from './ui.js';
import { listWords, listTags, getWord, writeVocabulary, vocabularyError } from './vocabulary-data.js';
import { hydrateMorphology, morphologyEditor, morphologyValues, morphologyDetails, mergeMorphologyDraft, arabicDisplay } from './morphology.js';
import {reviewDetails} from './srs-details.js';

const types = ['verb','noun','adjective','particle','phrase','other'];
const basic = ['arabic_word','bangla_meaning','english_meaning','arabic_meaning','transliteration','word_type','example_arabic','example_bangla','example_english','notes','favorite','needs_details'];
const labels = {arabic_word:'Arabic word',bangla_meaning:'Bengali meaning',english_meaning:'English meaning',arabic_meaning:'Arabic meaning',transliteration:'Transliteration',word_type:'Word type',example_arabic:'Arabic example',example_bangla:'Bengali example',example_english:'English example',notes:'Notes',favorite:'Favorite',needs_details:'Needs details'};
let owner, draft, editKey, tags = [], busy = false, notice = '', failure = false, rerender = ()=>{}, mount = 0, timer;
let browseFavorites=false;
let tagDraft = {name:'',kind:'tag'};
let demoRequests = [];
const filterDefaults={search:'',type:'',status:'',tag:'',from:'',to:'',page:0,favorite:false,root:'',harakah:true,tatweel:true,unicode:true};
const filters = {...filterDefaults};
subscribeAccount(account=>{
  if(owner && owner!==account.user?.id){draft=null;editKey=null;tags=[];tagDraft={name:'',kind:'tag'};demoRequests=[];notice='';busy=false;owner=undefined;++mount;clearTimeout(timer);}
});
window.addEventListener('beforeunload',event=>{
  if(draft?.dirty || tagDraft.name){event.preventDefault();event.returnValue='';}
});
export function setVocabularyRenderer(callback) { rerender = callback; }
export function unmountVocabulary() { ++mount; clearTimeout(timer); }
export function vocabularyPage(route) {
  const account = getAccount();
  if (owner !== account.user?.id) {
    owner = account.user?.id; draft = null; editKey = null; tags = []; notice = ''; busy = false;tagDraft={name:'',kind:'tag'};demoRequests=[];
    Object.assign(filters,filterDefaults);
  }
  const page = el('div',null,'page vocabulary-page');
  const token = ++mount;
  const heading = el('div',null,'page-heading');
  const editing=route.id==='add-word'&&new URLSearchParams(location.hash.split('?')[1]||'').has('edit');
  const copy = el('div'); copy.append(el('p',t('YOUR COLLECTION'),'eyebrow'),el('h1',t(editing?'Edit word':route.title)),el('p',t('Save a word today. Keep its meaning close.'),'page-description'));
  heading.append(copy);
  if(route.id==='add-word')heading.append(link(t('Back to vocabulary'),'#/vocabulary','button button-secondary'));

  if (route.id !== 'add-word') {
    const add=link(t('Add a word'),'#/add-word','button button-primary');
    const symbol=el('span');symbol.innerHTML=icon('plus');add.prepend(symbol);
    add.setAttribute('aria-label',t('Add a word'));heading.append(add);
  }
  page.append(heading);
  if (!['ready','offline'].includes(account.status)) {
    page.append(emptyState({title:t(account.status === 'loading' ? 'Connecting…' : 'Sign in to use your vocabulary'),description:t('Your words are stored privately in your account.'),link:'#/settings',label:t('Open Settings')}));
    return page;
  }
  if (notice) { const message = el('div',t(notice),`feedback${failure?' is-error':''}`); message.setAttribute('role','status'); page.append(message); }
  const content = el('div'); page.append(content);
  if(route.id!=='add-word'&&draft?.dirty){const kept=el('div',null,'draft-return');kept.append(el('p',t('Your unsaved edits are kept. Return to editing to save them.')),link(t('Continue editing'),editKey==='new'?'#/add-word':'#/add-word?edit='+editKey,'button button-secondary'));page.insertBefore(kept,content);}
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (params.has('tag')) {filters.tag=params.get('tag');filters.page=0;}
  queueMicrotask(async()=>{
    try {
      const loaded = await listTags();
      if (token !== mount) return;
      tags = loaded;
      content.replaceChildren();
      if (route.id === 'add-word') {
        const key = params.get('edit') || 'new';
        if (editKey !== key || !draft) {
          if (draft?.dirty && editKey && key !== editKey) {
            // Keep an unsaved form when visiting another word until explicitly replaced.
            content.append(el('p',t('An unsaved draft is kept. Clear it to open another word.'),'feedback'));
            content.append(link(t('Continue editing'),editKey==='new'?'#/add-word':'#/add-word?edit='+editKey,'button button-primary'));
            content.append(button('Clear draft',()=>confirmAction('Clear this draft?',()=>{draft=null;editKey=null;rerender();})));
            return;
          }
          const word = key === 'new' ? {} : await getWord(key);
          if (token !== mount) return;
          draft = {...hydrateMorphology(word),id:word.id||crypto.randomUUID(),tags:word.tags||[],mode:key==='new'?'quick':'full',word_type:word.word_type||'other',needs_details:word.needs_details??true};
          editKey = key;
        }
        content.append(editor());
      } else if (route.id === 'tags') content.append(tagManager());
      else if (params.get('word')) {
        const word = await getWord(params.get('word'));
        if (token === mount) content.append(details(word));
      } else collection(content,route.id === 'favorites',token);
    } catch(error) { if (token === mount) { content.replaceChildren(el('p',t(vocabularyError(error)),'feedback is-error'),button('Retry',rerender)); } }
  });
  content.append(el('p',t('Loading…'),'loading-message'));
  return page;
}
function el(tag,text,className='') { const node=document.createElement(tag); if(text!=null) node.textContent=text; if(className) node.className=className; return node; }
function userText(tag,text,language) { const node=el(tag,language==='ar'?arabicDisplay(text):text); node.dataset.noTranslate=''; if(language){node.lang=language;node.dir=language==='ar'?'rtl':'ltr';} return node; }
function link(text,href,className='text-link') { const node=el('a',text,className);node.href=href;return node; }
function button(text,action,className='button button-secondary') { const node=el('button',t(text),className);node.type='button';node.disabled=busy;node.addEventListener('click',action);return node; }
function choices(values,selected,change,label) {
  const select=el('select');select.setAttribute('aria-label',t(label));
  for(const [value,text] of values){const option=el('option',t(text));option.value=value;option.selected=value===selected;select.append(option);}
  select.addEventListener('change',()=>change(select.value));return select;
}
function tagOptions() { return tags.map(tag=>[tag.id,`${tag.kind==='deck'?t('Deck'):t('Tag')}: ${tag.name}`]); }
function collection(content,favorites,token) {
  browseFavorites=favorites;
  const toolbar=el('form',null,'vocabulary-filters');
  const search=el('input');search.type='search';search.value=filters.search;search.placeholder=t('Search words, meanings, examples or tags');search.setAttribute('aria-label',t('Search vocabulary'));search.maxLength=200;
  const result=el('div');
  const refresh=async()=>{
    const request=++sequence;result.setAttribute('aria-busy','true');
    try {
      const data=await listWords({...filters,favorite:favorites||filters.favorite});
      if(token!==mount||request!==sequence)return;
      result.replaceChildren(el('p',t('{count} words',{count:data.total}),'result-count'));
      if(!data.words.length)result.append(emptyState({title:t('No words found'),description:t('Add your first word or change the filters.'),link:'#/add-word',label:t('Add a word')}));
      const grid=el('div',null,'word-grid');
      for(const word of data.words)grid.append(wordCard(word));result.append(grid);
      const pager=el('div',null,'vocabulary-actions');
      const previous=button('Previous',()=>{filters.page--;refresh();});previous.disabled=filters.page===0;
      const next=button('Next',()=>{filters.page++;refresh();});next.disabled=(filters.page+1)*25>=data.total;
      pager.append(previous,el('span',t('Page {page}',{page:filters.page+1})),next);result.append(pager);
    }catch(error){if(token===mount&&request===sequence)result.replaceChildren(el('p',t(vocabularyError(error)),'feedback is-error'),button('Retry',refresh));}
    finally{if(request===sequence)result.removeAttribute('aria-busy');}
  };
  let sequence=0;
  const changed=()=>{filters.page=0;refresh();};
  search.addEventListener('input',()=>{filters.search=search.value;clearTimeout(timer);timer=setTimeout(changed,250);});
  toolbar.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);changed();});
  toolbar.append(search,choices([['','All types'],...types.map(type=>[type,type])],filters.type,value=>{filters.type=value;changed();},'Word type'),choices([['','All words'],['needs-details','Needs details'],['new','New words']],filters.status,value=>{filters.status=value;changed();},'Word status'),choices([['','All tags / decks'],...tagOptions()],filters.tag,value=>{filters.tag=value;changed();},'Tags / Decks'));
  if(!favorites){const label=el('label',null,'checkbox-label');const input=el('input');input.type='checkbox';input.checked=!!filters.favorite;input.addEventListener('change',()=>{filters.favorite=input.checked;changed();});label.append(input,el('span',t('Favorites only')));toolbar.append(label);}
  const rootLabel=el('label',t('Root filter'));const root=el('input');root.lang='ar';root.dir='rtl';root.value=filters.root;root.placeholder=t('ك ت ب or د ح ر ج');root.maxLength=40;root.addEventListener('input',()=>{filters.root=root.value;clearTimeout(timer);timer=setTimeout(changed,250);});rootLabel.append(root);toolbar.append(rootLabel);
  const searchOptions=el('fieldset',null,'search-options');searchOptions.append(el('legend',t('Search comparison')));
  for(const [key,text]of[['harakah','Ignore Harakah'],['tatweel','Ignore Tatweel'],['unicode','Normalize Unicode']]){const label=el('label',null,'checkbox-label');const input=el('input');input.type='checkbox';input.checked=filters[key];input.addEventListener('change',()=>{filters[key]=input.checked;changed();});label.append(input,el('span',t(text)));searchOptions.append(label);}toolbar.append(searchOptions);
  for(const [name,label] of [['from','Added from (UTC)'],['to','Added through (UTC)']]) {
    const wrapper=el('label',t(label));const input=el('input');input.type='date';input.value=filters[name];input.addEventListener('change',()=>{filters[name]=input.value;changed();});wrapper.append(input);toolbar.append(wrapper);
  }
  toolbar.append(button('Clear filters',()=>{Object.assign(filters,filterDefaults);if(location.hash.includes('?tag='))location.hash='#/vocabulary';else rerender();}));
  content.append(toolbar,el('p',t('Review and weak/mastered filters arrive with their planned phases.'),'settings-help'),result);refresh();
  content.append(button('Add demo words',()=>confirmAction('Add three demo words to your account?',()=>run(async()=>{
    if(!demoRequests.length)demoRequests=[
      {arabic_word:'كَتَبَ',bangla_meaning:'সে লিখেছে',english_meaning:'he wrote',word_type:'verb'},
      {arabic_word:'كِتَابٌ',bangla_meaning:'বই',english_meaning:'book',word_type:'noun'},
      {arabic_word:'جَمِيلٌ',bangla_meaning:'সুন্দর',english_meaning:'beautiful',word_type:'adjective'},
    ].map(values=>({action:'save',id:crypto.randomUUID(),operation:crypto.randomUUID(),values:{...values,needs_details:true,notes:'Demo word — editable sample'}}));
    for(const request of demoRequests)await writeVocabulary(request);
  },'Demo words added. Existing matches were kept.'))));
}
function wordCard(word) {
  const card=el('article',null,'card word-card');
  const anchor=link('','#/vocabulary?word='+word.id,'word-title');anchor.append(userText('span',word.arabic_word,'ar'));card.append(anchor);
  card.append(userText('p',word.bangla_meaning,'bn'),userText('p',word.english_meaning,'en'));
  const meta=el('div',null,'word-meta');meta.append(el('span',t(word.word_type),'pill'));
  if(word.needs_details)meta.append(el('span',t('Needs details'),'pill'));
  if(word.root?.length)card.append(userText('p',word.root.join(' — '),'ar'));
  meta.append(button(word.favorite?'Remove favorite':'Add favorite',()=>run(async()=>{await writeVocabulary({action:'favorite',id:word.id,revision:word.revision,values:{favorite:!word.favorite}});},'Favorite updated.')));
  card.append(meta);const actions=el('div',null,'word-card-actions');actions.append(link(t('View details'),'#/vocabulary?word='+word.id,'button button-secondary'),link(t(word.needs_details?'Add details':'Edit word'),'#/add-word?edit='+word.id,'button button-primary'));card.append(actions);card.addEventListener('click',event=>{if(!event.target.closest('a,button'))location.hash='#/vocabulary?word='+word.id;});return card;
}
function editor() {
  const form=el('form',null,'card word-editor');form.id='word-editor-form';
  const top=el('div',null,'editor-top-actions');
  top.append(link(t(draft.revision?'Back to word':'Back to vocabulary'),draft.revision?'#/vocabulary?word='+draft.id:'#/vocabulary','button button-secondary'));
  const topSave=el('button',t(busy?'Saving…':draft.revision?'Save changes':'Save word'),'button button-primary');topSave.type='submit';topSave.disabled=busy;top.append(topSave);form.append(top);
  const modes=el('div',null,'vocabulary-actions');
  for(const [value,label]of(draft.revision?[]:[['quick','Quick Add'],['full','Full Add']])){const node=button(label,()=>{draft.mode=value;rerender();});node.setAttribute('aria-pressed',String(draft.mode===value));modes.append(node);}
  form.append(modes,el('p',t('Arabic, Bengali and English are required. Quick Add marks a word as needing details.'),'settings-help'));
  const fields=draft.mode==='quick'?['arabic_word','bangla_meaning','english_meaning']:basic.filter(name=>!['favorite','needs_details'].includes(name));
  const grid=el('div',null,'word-fields');
  const grammar=el('div');
  const renderGrammar=()=>grammar.replaceChildren(morphologyEditor(draft,{disabled:busy}));
  for(const name of fields) {
    const label=el('label',t(labels[name]));
    let input;
    if(name==='word_type')input=choices(types.map(value=>[value,value]),draft[name],value=>{draft[name]=value;draft.dirty=true;renderGrammar();},labels[name]);
    else {
      input=el(['notes','example_arabic','example_bangla','example_english'].includes(name)?'textarea':'input');
      input.name=name;input.value=draft[name]||'';input.required=['arabic_word','bangla_meaning','english_meaning'].includes(name);
      input.maxLength=name==='arabic_word'?200:name==='notes'?20000:2000;
      if(name.includes('arabic')){input.lang='ar';input.dir='rtl';}
      if(name.includes('bangla')){input.lang='bn';input.dir='ltr';}
      input.addEventListener('input',()=>{draft[name]=input.value;draft.dirty=true;});
    }
    input.disabled=busy;label.append(input);grid.append(label);
  }
  form.append(grid);
  if(draft.mode==='full'){renderGrammar();form.append(grammar);}
  if(draft.mode==='full')for(const name of ['favorite','needs_details']){
    const label=el('label',null,'checkbox-label');const input=el('input');input.type='checkbox';input.checked=!!draft[name];input.disabled=busy;input.addEventListener('change',()=>{draft[name]=input.checked;draft.dirty=true;});label.append(input,el('span',t(labels[name])));form.append(label);
  }
  const selected=el('fieldset',null,'tag-selector');selected.append(el('legend',t('Tags / Decks')));
  if(!tags.length)selected.append(el('p',t('Create tags or decks on the Tags page.'),'settings-help'));
  for(const tag of tags){const label=el('label',null,'checkbox-label');const input=el('input');input.type='checkbox';input.checked=draft.tags.includes(tag.id);input.disabled=busy;input.addEventListener('change',()=>{draft.tags=input.checked?[...draft.tags,tag.id]:draft.tags.filter(id=>id!==tag.id);draft.dirty=true;});label.append(input,userText('span',`${t(tag.kind==='deck'?'Deck':'Tag')}: ${tag.name}`));selected.append(label);}
  for(const missing of draft.tags.filter(id=>!tags.some(tag=>tag.id===id))){const label=el('label',null,'checkbox-label');const input=el('input');input.type='checkbox';input.checked=true;input.disabled=busy;input.addEventListener('change',()=>{if(!input.checked){draft.tags=draft.tags.filter(id=>id!==missing);draft.dirty=true;}});label.append(input,el('span',t('Unavailable tag — uncheck to remove')));selected.append(label);}
  form.append(selected,link(t('Manage tags / decks'),'#/tags'));
  const actions=el('div',null,'vocabulary-actions');
  const submit=el('button',t(busy?'Saving…':draft.revision?'Save changes':'Save word'),'button button-primary');submit.type='submit';submit.disabled=busy;
  actions.append(submit,link(t(draft.revision?'Back to word':'Back to vocabulary'),draft.revision?'#/vocabulary?word='+draft.id:'#/vocabulary','button button-secondary'),button(draft.revision?'Discard changes':'Clear draft',()=>confirmAction(draft.revision?'Discard your unsaved changes?':'Clear this draft?',()=>{const destination=draft.revision?'#/vocabulary?word='+draft.id:'#/add-word';draft=null;editKey=null;location.hash=destination;rerender();})));
  if(draft.revision||failure)actions.append(link(t('Open latest word'),'#/vocabulary?word='+draft.id),button('Use latest version',()=>confirmAction('Replace this draft with the latest saved version?',()=>run(async()=>{const latest=await getWord(draft.id);draft={...hydrateMorphology(latest),mode:'full'};}))));
  form.append(actions);
  form.addEventListener('submit',event=>{event.preventDefault();if(!busy&&form.reportValidity())saveDraft(false);});return form;
}
async function saveDraft(allowDuplicate) {
  const values=Object.fromEntries(basic.map(name=>[name,draft[name]??(['favorite','needs_details'].includes(name)?false:'')]));
  if(draft.mode==='quick')values.needs_details=true;
  else {try{Object.assign(values,morphologyValues(draft));}catch(error){notice=vocabularyError(error);failure=true;rerender();return;}}
  const request={action:'save',id:draft.id,revision:draft.revision??null,values,tags:draft.tags,allowDuplicate};
  const signature=JSON.stringify(request);
  if(draft.signature!==signature){draft.operation=crypto.randomUUID();draft.signature=signature;}
  request.operation=draft.operation;
  await run(async()=>{
    const data=await writeVocabulary(request);
    if(data.duplicates){busy=false;rerender();duplicateDialog(data.duplicates);return false;}
    draft=null;editKey=null;location.hash='#/vocabulary?word='+data.word.id;
  },'Word saved.',true);
}
function duplicateDialog(matches) {
  const content=el('div');content.append(el('p',t('This word may already exist.')));
  for(const word of matches){const row=el('div',null,'duplicate-row');row.append(userText('p',word.arabic_word,'ar'),userText('p',word.english_meaning),userText('p',word.bangla_meaning,'bn'));
    row.append(link(t('Open Existing'),'#/vocabulary?word='+word.id),button('Update Existing',()=>{
      document.getElementById('app-dialog').close();run(async()=>{
        const existing=await getWord(word.id);
        // Start from existing values; Quick Add replaces only its three entry fields.
        const incoming=draft;const replacement={...mergeMorphologyDraft(existing,incoming),id:existing.id,revision:existing.revision,mode:'full'};
        for(const name of incoming.mode==='quick'?['arabic_word','bangla_meaning','english_meaning']:basic)replacement[name]=incoming[name]??replacement[name];
        replacement.tags=[...new Set([...existing.tags,...incoming.tags])];replacement.dirty=true;draft=replacement;editKey=existing.id;location.hash='#/add-word?edit='+existing.id;
      });
    }));content.append(row);
  }
  const actions=el('div',null,'vocabulary-actions');actions.append(button('Add Anyway',()=>{document.getElementById('app-dialog').close();saveDraft(true);}),button('Cancel',()=>document.getElementById('app-dialog').close()));content.append(actions);showModal(t('Possible duplicate'),content);
}
function details(word) {
  const card=el('article',null,'card word-details');const top=el('div',null,'word-detail-actions');top.append(link(t('Back to vocabulary'),'#/vocabulary','button button-secondary'),link(t(word.needs_details?'Add details':'Edit word'),'#/add-word?edit='+word.id,'button button-primary'));card.append(top,userText('h2',word.arabic_word,'ar'));if('speechSynthesis'in window){card.append(audio(word.arabic_word));if(word.example_arabic)card.append(audio(word.example_arabic));}
  const nav=el('nav',null,'word-navigation');nav.setAttribute('aria-label',t('Word navigation'));
  let neighbors={previous:null,next:null};
  const navigate=direction=>{if(card.isConnected&&neighbors[direction])location.hash='#/vocabulary?word='+neighbors[direction];};
  const previous=button('← Previous word',()=>navigate('previous')),next=button('Next word →',()=>navigate('next'));
  previous.disabled=true;next.disabled=true;nav.append(previous,next);card.insertBefore(nav,card.firstChild);
  card.append(el('p',t('On your phone, swipe left for the next word and right for the previous word.'),'settings-help'));
  bindWordSwipe(card,navigate);
  const navOwner=owner;
  wordNeighbors(word.id,page=>listWords({...filters,favorite:browseFavorites||filters.favorite,page}),filters.page).then(result=>{if(!card.isConnected||owner!==navOwner)return;neighbors=result;if(result.page!==undefined)filters.page=result.page;previous.disabled=!result.previous;next.disabled=!result.next;}).catch(()=>{if(card.isConnected)nav.append(button('Retry navigation',()=>rerender()));});
  const list=el('dl',null,'word-detail-list');
  for(const name of basic.filter(name=>!['arabic_word','favorite','needs_details'].includes(name))){if(!word[name])continue;list.append(el('dt',t(labels[name])),name==='word_type'?el('dd',t(word[name])):userText('dd',word[name],name.includes('arabic')?'ar':name.includes('bangla')?'bn':undefined));}
  list.append(el('dt',t('Tags / Decks')),userText('dd',tags.filter(tag=>word.tags.includes(tag.id)).map(tag=>tag.name).join(' · ')||t('None')));
  list.append(el('dt',t('Added')),el('dd',new Date(word.created_at).toLocaleString(getLanguage()==='bn'?'bn-BD':'en')),el('dt',t('Last edited')),el('dd',new Date(word.updated_at).toLocaleString(getLanguage()==='bn'?'bn-BD':'en')));card.append(list);
  card.append(morphologyDetails(word));
  if(word.needs_details)card.append(el('p',t('Needs details'),'pill'));
  const actions=el('div',null,'vocabulary-actions');actions.append(link(t('Edit word'),'#/add-word?edit='+word.id,'button button-primary'),button(word.favorite?'Remove favorite':'Add favorite',()=>run(()=>writeVocabulary({action:'favorite',id:word.id,revision:word.revision,values:{favorite:!word.favorite}}),'Favorite updated.')),button('Delete word',()=>confirmAction('Delete this word? It will leave your collection. Learning history is preserved.',()=>run(async()=>{await writeVocabulary({action:'delete',id:word.id,revision:word.revision});location.hash='#/vocabulary';},'Word deleted.')),'button button-danger'));
  card.append(actions,reviewDetails(word));return card;
}
function tagManager() {
  const section=el('section',null,'card tag-manager');
  const form=el('form',null,'tag-form');const label=el('label',t('Name'));const name=el('input');name.value=tagDraft.name;name.required=true;name.maxLength=100;name.disabled=busy;name.addEventListener('input',()=>{tagDraft.name=name.value;});label.append(name);
  const kind=choices([['tag','Tag'],['deck','Deck']],tagDraft.kind,value=>{tagDraft.kind=value;},'Kind');kind.disabled=busy;const submit=el('button',t(tagDraft.editing?'Save changes':'Create'),'button button-primary');submit.disabled=busy;
  form.append(label,kind,submit);form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())run(async()=>{
    const values={name:tagDraft.name.trim(),kind:tagDraft.kind};const signature=JSON.stringify(values);
    if(tagDraft.signature!==signature){tagDraft.signature=signature;tagDraft.id=tagDraft.id||crypto.randomUUID();tagDraft.operation=crypto.randomUUID();}
    await writeVocabulary({action:'tag-save',id:tagDraft.id,operation:tagDraft.operation,revision:tagDraft.revision??null,values});tagDraft={name:'',kind:'tag'};
  },'Tag saved.');});section.append(form);
  if(tagDraft.editing)section.append(button('Cancel',()=>{tagDraft={name:'',kind:'tag'};rerender();}));
  if(!tags.length)section.append(el('p',t('No tags or decks yet.'),'settings-help'));
  for(const tag of tags){const row=el('div',null,'tag-row');row.append(userText('strong',tag.name),el('span',t(tag.kind==='deck'?'Deck':'Tag'),'pill'),link(t('View words'),'#/vocabulary?tag='+tag.id));
    row.append(button('Rename',()=>{tagDraft={...tag,editing:true};rerender();}),button('Delete',()=>confirmAction('Delete this tag or deck? Words will be kept.',()=>run(()=>writeVocabulary({action:'tag-delete',id:tag.id,revision:tag.revision}),'Tag deleted.')),'button button-danger'));section.append(row);}
  return section;
}
function confirmAction(message,action) {
  const body=el('div');body.append(el('p',t(message)));const actions=el('div',null,'vocabulary-actions');actions.append(button('Confirm',()=>{document.getElementById('app-dialog').close();action();},'button button-danger'),button('Cancel',()=>document.getElementById('app-dialog').close()));body.append(actions);showModal(t('Confirm'),body);
}
async function run(action,message='',keepModal=false) {
  if(busy)return;
  const activeOwner=owner;busy=true;notice='';failure=false;rerender();
  try{const result=await action();if(owner===activeOwner&&result!==false)notice=message;}
  catch(error){if(owner===activeOwner){notice=vocabularyError(error);failure=true;}}
  finally{if(owner===activeOwner){busy=false;if(!keepModal||!document.getElementById('app-dialog').open)rerender();}}
}
