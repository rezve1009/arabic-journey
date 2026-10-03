import test from 'node:test';import assert from 'node:assert/strict';import {wordNeighbors,swipeDirection,bindWordSwipe}from '../js/word-navigation.js';import {JSDOM}from 'jsdom';
test('Word neighbors preserve filtered order and cross pagination without wrapping',async()=>{
 const words=Array.from({length:53},(_,i)=>({id:String(i)}));const load=async page=>({words:words.slice(page*25,page*25+25),total:words.length});
 assert.deepEqual(await wordNeighbors('0',load),{previous:null,next:'1',page:0});
 assert.deepEqual(await wordNeighbors('24',load),{previous:'23',next:'25',page:0});
 assert.deepEqual(await wordNeighbors('25',load,1),{previous:'24',next:'26',page:1});
 assert.deepEqual(await wordNeighbors('52',load),{previous:'51',next:null,page:2});
 assert.deepEqual(await wordNeighbors('deleted',load),{previous:null,next:null});
 assert.deepEqual(await wordNeighbors('one',async()=>({words:[{id:'one'}],total:1})),{previous:null,next:null,page:0});
});
test('Phone swipes navigate horizontally and ignore scrolling, controls and multitouch',()=>{
 assert.equal(swipeDirection({x:100,y:0,time:0},{x:0,y:10,time:300}),'next');assert.equal(swipeDirection({x:0,y:0,time:0},{x:100,y:5,time:300}),'previous');assert.equal(swipeDirection({x:100,y:0,time:0},{x:10,y:150,time:300}),null);
 const dom=new JSDOM('<article><p>word</p><button>edit</button></article>');globalThis.window=dom.window;const card=dom.window.document.querySelector('article'),calls=[];bindWordSwipe(card,d=>calls.push(d));
 const fire=(target,type,x,y,touches=type==='touchend'?[]:[{clientX:x,clientY:y}])=>{const event=new dom.window.Event(type,{bubbles:true});Object.assign(event,{touches,changedTouches:[{clientX:x,clientY:y}]});target.dispatchEvent(event);};
 fire(card,'touchstart',150,0);fire(card,'touchend',10,5);assert.deepEqual(calls,['next']);
 fire(card,'touchstart',150,0);fire(card,'touchend',10,200);assert.equal(calls.length,1);
 fire(card.querySelector('button'),'touchstart',150,0);fire(card,'touchend',10,5);assert.equal(calls.length,1);
 fire(card,'touchstart',150,0,[{},{}]);fire(card,'touchend',10,5);assert.equal(calls.length,1);
 dom.window.close();
});
