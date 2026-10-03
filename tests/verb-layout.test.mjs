import test from 'node:test';import assert from 'node:assert/strict';import{JSDOM}from'jsdom';import{pronouns}from'../js/arabic-utils.js';
const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;
const{conjugationTable,morphologyDetails}=await import('../js/morphology.js');
test('Verb views differ even with all rows filled, use separate tense tables and omit derived future',()=>{
 const word={word_type:'verb',present_base:'يَكْتُبُ',conjugations:Object.fromEntries(pronouns.map(p=>[p.id,{past:'كَتَبَ',present:'يَكْتُبُ',...(p.imperative?{imperative:'اُكْتُبْ'}:{})}]))};
 const view=conjugationTable(word);assert.equal(view.querySelectorAll('table').length,2);assert.equal(view.querySelectorAll('tbody tr').length,28);assert.equal(view.querySelectorAll('tbody small').length,0);
 const buttons=view.querySelectorAll('button');buttons[1].click();assert.equal(buttons[1].getAttribute('aria-pressed'),'true');assert.equal(view.querySelectorAll('table').length,3);assert.equal(view.querySelector('[data-tense=imperative] tbody').children.length,6);assert.equal(view.querySelectorAll('tbody small').length,34);
 buttons[0].click();assert.equal(view.querySelectorAll('table').length,2);assert.equal(view.querySelector('[data-tense=future]'),null);assert(!morphologyDetails(word).textContent.includes('سَيَكْتُبُ'));
});
test('Changing verb view preserves unsaved forms and only offers six imperative pronouns',()=>{
 const word={word_type:'verb',conjugations:{}};const view=conjugationTable(word,{editable:true,expanded:true});assert.equal(view.querySelectorAll('input').length,34);
 const input=view.querySelector('input[data-pronoun=huwa][data-tense=present]');input.value='يَكْتُبُ';input.dispatchEvent(new dom.window.Event('input'));assert(word.dirty);assert(word.morphology_changed.includes('conjugations'));
 const buttons=view.querySelectorAll('button');buttons[0].click();assert.equal(view.querySelectorAll('input').length,2);buttons[1].click();assert.equal(view.querySelector('input[data-pronoun=huwa][data-tense=present]').value,'يَكْتُبُ');
});