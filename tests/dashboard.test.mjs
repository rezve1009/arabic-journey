import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM}from'jsdom';
const dom=new JSDOM('<body></body>',{url:'https://test.example/'});globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;
const {activityDays,activityChart}=await import('../js/dashboard-activity.js');const {setLanguage}=await import('../js/i18n.js');
test('Activity chart fills missing days, crosses month boundaries and opens date history',()=>{
 const calendar=[{study_day:'2026-09-30',n:30},{study_day:'2026-10-03',n:2}];const days=activityDays(calendar,'2026-10-03');assert.equal(days.length,7);assert.equal(days[0].day,'2026-09-27');assert.equal(days[3].count,30);assert.equal(days[6].count,2);
 const chart=activityChart(calendar,'2026-10-03');assert.equal(chart.querySelector('strong').textContent,'32 activities');assert.equal(chart.querySelector('[aria-current=date]').getAttribute('href'),'#/history?from=2026-10-03&to=2026-10-03');assert.equal(chart.querySelectorAll('.activity-zero').length,5);
 const select=chart.querySelector('select');select.value='30';select.dispatchEvent(new dom.window.Event('change'));assert.equal(chart.querySelectorAll('.activity-bar').length,30);
 setLanguage('bn',{notify:false});const bn=activityChart([],'2026-10-03');assert.equal(bn.querySelector('strong').textContent,'০টি কার্যক্রম');assert.equal(bn.querySelectorAll('.activity-zero').length,7);
});