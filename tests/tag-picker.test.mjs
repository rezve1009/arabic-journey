import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM}from'jsdom';
const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;const{tagPicker}=await import('../js/tag-picker.js');
test('Searchable tags preserve hidden selections, remove explicitly and retain unavailable IDs',()=>{
 const tags=[{id:'a',name:'Module 7 — নতুন শব্দ',kind:'deck'},{id:'b',name:'Verbs',kind:'tag'}];let saved;
 const view=tagPicker(tags,{selected:['b','missing'],onChange:value=>saved=value});const search=view.querySelector('input[type=search]');search.value='module নতুন';search.dispatchEvent(new dom.window.Event('input'));assert.equal(view.querySelectorAll('input[type=checkbox]').length,1);assert.equal(view.querySelectorAll('.tag-chip').length,2);assert.equal(saved,undefined);
 const input=view.querySelector('input[type=checkbox]');input.checked=true;input.dispatchEvent(new dom.window.Event('change'));assert.deepEqual(saved,['b','missing','a']);search.value='no match';search.dispatchEvent(new dom.window.Event('input'));assert(view.textContent.includes('No matching tags'));assert.equal(view.querySelectorAll('.tag-chip').length,3);
 view.querySelector('[aria-label="Remove Verbs"]').click();assert.deepEqual(saved,['missing','a']);search.value='';search.dispatchEvent(new dom.window.Event('input'));assert.equal(view.querySelector('input[value=a]').checked,true);assert.equal(view.querySelector('input[value=b]').checked,false);
});
test('Large tag lists render in bounded batches, match Unicode and expose disabled state',()=>{
 const tags=Array.from({length:105},(_,i)=>({id:String(i),name:'Tag '+i,kind:'tag'}));tags.push({id:'unicode',name:'ＣＯＵＲＳＥ',kind:'deck'});
 const view=tagPicker(tags,{disabled:true});assert(view.disabled);assert.equal(view.querySelectorAll('input[type=checkbox]').length,50);const more=[...view.querySelectorAll('button')].find(b=>b.textContent==='Show more');more.click();assert.equal(view.querySelectorAll('input[type=checkbox]').length,50);
 const enabled=tagPicker(tags);[...enabled.querySelectorAll('button')].find(b=>b.textContent==='Show more').click();assert.equal(enabled.querySelectorAll('input[type=checkbox]').length,100);
 const search=enabled.querySelector('input[type=search]');search.value='course';search.dispatchEvent(new dom.window.Event('input'));assert.equal(enabled.querySelectorAll('input[type=checkbox]').length,1);assert.equal(enabled.querySelector('input[type=checkbox]').value,'unicode');
});