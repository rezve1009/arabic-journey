import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM}from'jsdom';
const dom=new JSDOM('<body></body>',{url:'https://app.example.test'});for(const key of ['document','window','localStorage'])globalThis[key]=dom.window[key];const {examplesEditor,examplesDetails}=await import('../js/examples.js');
test('Plus adds translated examples, removing preserves the first example and authored text is never HTML',()=>{
 const draft={example_arabic:'هَذَا كِتَابٌ'};const editor=examplesEditor(draft);editor.querySelector('button').click();assert.equal(editor.querySelectorAll('fieldset').length,2);const input=editor.querySelector('[name=examples_1_bangla]');input.value='এটি বই';input.dispatchEvent(new dom.window.Event('input'));assert.equal(draft.examples[0].bangla,'এটি বই');assert(draft.dirty);
 const details=examplesDetails({...draft,examples:[{arabic:'<script>bad()</script>',bangla:'বই',english:'book'}]});assert.equal(details.querySelectorAll('.example-card').length,2);assert.equal(details.querySelector('script'),null);
 [...editor.querySelectorAll('button')].find(b=>b.textContent==='Remove example').click();assert.equal(draft.examples.length,0);assert.equal(draft.example_arabic,'هَذَا كِتَابٌ');
});
