import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthRetry,retryAfterSeconds} from '../js/auth-retry.js';
const store=()=>{const values=new Map();return{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),values};};
test('resend waits survive reloads, apply to signup, and do not block password requests',async()=>{
 let now=1000;const storage=store(),retry=createAuthRetry({storage,now:()=>now});let requests=0;
 await retry.run('email',async()=>requests++,{emailOnSuccess:true});
 assert.equal(retry.wait('email').seconds,60);assert.equal(retry.wait('request'),null);
 const reloaded=createAuthRetry({storage,now:()=>now});await assert.rejects(reloaded.run('email',async()=>requests++),e=>e.code==='auth_cooldown');assert.equal(requests,1);
 now+=60000;assert.equal(reloaded.wait('email'),null);await reloaded.run('email',async()=>requests++);assert.equal(requests,2);
 assert.doesNotMatch([...storage.values.values()].join(''),/password|email@|token/);
});
test('provider quota backoff honors retry duration and does not extend on blocked retries',async()=>{
 let now=1000;const storage=store(),retry=createAuthRetry({storage,now:()=>now});const error={status:429,code:'over_email_send_rate_limit'};
 await assert.rejects(retry.run('email',async()=>{throw error;}));assert.equal(retry.wait('email').seconds,3600);
 now+=5000;await assert.rejects(retry.run('email',async()=>{throw Error('should never reach provider');}));assert.equal(retry.wait('email').seconds,3595);
 const custom=createAuthRetry({now:()=>now});await assert.rejects(custom.run('request',async()=>{throw{status:429,retryAfterSeconds:90};}));assert.equal(custom.wait('request').seconds,90);assert.equal(custom.wait('email').seconds,90);
});
test('duplicate in-flight calls never reach the provider and non-rate errors do not lock login',async()=>{
 const retry=createAuthRetry();let resolve;const first=retry.run('email',()=>new Promise(done=>resolve=done));await assert.rejects(retry.run('email',async()=>{}),e=>e.code==='auth_in_progress');resolve();await first;
 await assert.rejects(retry.run('request',async()=>{throw{code:'invalid_credentials'};}));assert.equal(retry.wait('request'),null);
});
test('Retry-After supports seconds and dates and ignores invalid headers',()=>{
 assert.equal(retryAfterSeconds('90',0),90);assert.equal(retryAfterSeconds('Thu, 01 Jan 1970 00:02:00 GMT',0),120);assert.equal(retryAfterSeconds('invalid',0),null);assert.equal(retryAfterSeconds('0',0),null);
});
