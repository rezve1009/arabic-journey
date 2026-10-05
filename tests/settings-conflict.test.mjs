import test from 'node:test';import assert from 'node:assert/strict';import{scheduleBaseline,saveScheduleWithConflict}from'../js/settings-conflict.js';
const settings={revision:5,revision_schedule:{version:1,intervals:[1,3,7],repeat_days:30},rating_behavior:{again_days:1,hard_factor:0.5,easy_skip:1}};
test('Schedule saves retry unrelated preference changes without overwriting remote schedules or owner changes',async()=>{
 const baseline=scheduleBaseline(settings),revisions=[];const stale={code:'PT409'};
 const save=async revision=>{revisions.push(revision);if(revision===5)throw stale;return{revision:7};};
 assert.deepEqual(await saveScheduleWithConflict({settings,baseline,revision:5,save,read:async()=>({...settings,revision:6,ui_language:'bn'}),isCurrent:()=>true}),{revision:7});assert.deepEqual(revisions,[5,6]);
 const changed=structuredClone(settings);changed.revision_schedule.repeat_days=90;let writes=0;
 await assert.rejects(saveScheduleWithConflict({settings:changed,baseline,revision:6,save:async()=>writes++,read:async()=>changed,isCurrent:()=>true}),e=>e.code==='PT409');assert.equal(writes,0);
 await assert.rejects(saveScheduleWithConflict({settings,baseline,revision:5,save,read:async()=>changed,isCurrent:()=>true}),e=>e.code==='PT409');
 await assert.rejects(saveScheduleWithConflict({settings,baseline,revision:5,save,read:async()=>settings,isCurrent:()=>false}),/session_expired/);
 let tries=0;await assert.rejects(saveScheduleWithConflict({settings,baseline,revision:5,save:async()=>{tries++;throw stale;},read:async()=>({...settings,revision:6}),isCurrent:()=>true}),e=>e.code==='PT409');assert.equal(tries,2);
 let reads=0;await assert.rejects(saveScheduleWithConflict({settings,baseline,revision:5,save:async()=>{throw {code:'42501'};},read:async()=>reads++,isCurrent:()=>true}),e=>e.code==='42501');assert.equal(reads,0);
});
