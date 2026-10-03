import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";
const dom = new JSDOM("<html><body></body></html>", {
  url: "https://app.example.test/index.html#/review",
});
for (const key of [
  "window",
  "document",
  "location",
  "history",
  "localStorage",
  "NodeFilter",
  "Element",
  "Event",
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  configurable: true,
});
const uid = randomUUID();
let db,
  dropReviewResponse = false;
const request = async (name, args) => {
  try {
    const entries = Object.entries(args || {});
    if (!/^[_a-z]+$/.test(name) || entries.some(([k]) => !/^[_a-z]+$/.test(k)))
      throw new Error("Invalid test RPC");
    const data = (
      await db.query(
        "select public." +
          name +
          "(" +
          entries.map(([k], i) => k + "=> $" + (i + 1)).join(",") +
          ") result",
        entries.map(([, v]) =>
          v && typeof v === "object" && !Array.isArray(v)
            ? JSON.stringify(v)
            : v,
        ),
      )
    ).rows[0].result;
    if (name === "fixed_review" && dropReviewResponse) {
      dropReviewResponse = false;
      return { error: new TypeError("Injected lost response") };
    }
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
};
function from(table) {
  const filters = [],
    values = [];
  let range = [0, 999],
    single = false;
  const builder = {
    select: () => builder,
    eq: (key, value) => {
      values.push(value);
      filters.push(key + "=$" + values.length);
      return builder;
    },
    is: (key, value) => {
      filters.push(key + " is null");
      return builder;
    },
    order: () => builder,
    range: (a, b) => {
      range = [a, b];
      return builder;
    },
    single: () => {
      single = true;
      return builder;
    },
    then: async (resolve) => {
      try {
        const rows = (
          await db.query(
            "select *from public." +
              table +
              (filters.length ? " where " + filters.join(" and ") : "") +
              " limit " +
              (range[1] - range[0] + 1) +
              " offset " +
              range[0],
            values,
          )
        ).rows;
        return resolve({ data: single ? rows[0] : rows, error: null });
      } catch (e) {
        return resolve({ error: e });
      }
    },
  };
  return builder;
}
window.supabase = {
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      initialize: async () => ({}),
      getSession: async () => ({
        data: {
          session: { user: { id: uid, email: "disposable@example.test" } },
        },
      }),
      stopAutoRefresh() {},
    },
    from,
    rpc: request,
  }),
};
const { initializeSupabase, getAccount } = await import("../js/supabase.js");
const { reviewPage, setReviewRenderer, unmountReview } = await import(
  "../js/review.js"
);
const { quizPage, setQuizRenderer } = await import("../js/quiz.js");
const { statisticsPage } = await import("../js/statistics.js");
const { refreshCache, queueWrite, synchronize, pendingOperations } =
  await import("../js/sync.js");
const { getCache, atomic, readStore } = await import("../js/storage.js");
const wait = async (condition) => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(
    "UI did not finish: " + document.body.textContent.slice(-1000),
  );
};
const button = (label) =>
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent.startsWith(label),
  );
test("Mounted review, answer reveal, transactional rating, quiz save and statistics", async () => {
  db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid()to anon,authenticated;",
    );
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await db.query("insert into auth.users(id)values($1)", [uid]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid,
    ]);
    const id = randomUUID();
    const word = await request("vocabulary_write", {
      p_operation: randomUUID(),
      p_action: "save",
      p_id: id,
      p_values: {
        arabic_word: "كَتَبَ",
        bangla_meaning: "লিখেছে",
        english_meaning: "wrote",
        word_type: "verb",
      },
    });
    assert(!word.error);
    await db.exec(
      "reset role;update public.word_review_state set next_review_at=now()-interval'1 hour';set role authenticated;",
    );
    await initializeSupabase();
    assert.equal(getAccount().status, "ready");
    const mountReview = () => {
      unmountReview();
      document.body.replaceChildren(reviewPage());
    };
    setReviewRenderer(mountReview);
    mountReview();
    await wait(() => button("Start Review"));
    button("Start Review").click();
    await wait(() => button("Show Answer"));
    button("Show Answer").click();
    assert(document.body.textContent.includes("লিখেছে"));
    const {reviewReturnContext}=await import('../js/review.js');
    assert.deepEqual(reviewReturnContext(id),{position:1,total:1});
    assert.equal(document.querySelector('a[href*="from=review"]').getAttribute('href'),'#/vocabulary?word='+id+'&from=review');
    const {vocabularyPage,unmountVocabulary}=await import('../js/vocabulary.js');
    unmountReview();location.hash='#/vocabulary?word='+id+'&from=review';document.body.replaceChildren(vocabularyPage({id:'vocabulary',title:'Vocabulary'}));
    await wait(()=>document.querySelector('.review-resume-banner'));
    assert.equal(document.querySelector('.review-resume-banner a').getAttribute('href'),'#/review');
    unmountVocabulary();location.hash='#/review';mountReview();
    assert(document.body.textContent.includes('লিখেছে'));assert(button('Good'));assert.equal(button('Show Answer'),undefined);
    button("Good").click();
    await wait(() => document.body.textContent.includes("Session complete"));
    assert.equal(
      (await db.query("select count(*)::int n from public.review_history"))
        .rows[0].n,
      1,
    );
    unmountReview();
    const mountQuiz = () => document.body.replaceChildren(quizPage());
    setQuizRenderer(mountQuiz);
    await db.query("select public.vocabulary_write($1,'save',$2,null,$3)", [randomUUID(),randomUUID(),JSON.stringify({arabic_word:'قَلَمٌ',english_meaning:'pen',bangla_meaning:'কলম',word_type:'noun'})]);
    const oldQuiz={id:randomUUID(),index:0,answers:[],questions:[{type:'arabic_typing',prompt:'book',answers:['كتاب']}],saved:false};
    await atomic(['meta'],tx=>tx.objectStore('meta').put({key:uid+':active-quiz',owner:uid,quiz:oldQuiz}));
    mountQuiz();
    await wait(()=>document.body.textContent.includes('Your older typing quiz'));
    assert((await readStore('meta',uid+':archived-quiz:'+oldQuiz.id)).quiz);
    assert(!document.querySelector('fieldset'));
    document.querySelector('input[type=number]').value='2';
    button('Start Quiz').click();
    await wait(()=>document.querySelector('.mcq-options'));
    const firstOptions=document.querySelector('.mcq-options');
    const original=(await readStore('meta',uid+':active-quiz')).quiz;
    const firstAnswer=original.questions[0].answers[0];
    [...firstOptions.querySelectorAll('button')].find(b=>b.textContent.endsWith('. '+firstAnswer)).click();
    await wait(()=>!firstOptions.isConnected);
    button('Restart quiz').click();
    button('Cancel').click();
    assert(document.querySelector('.mcq-options'));
    button('Restart quiz').click();
    button('Restart now').click();
    await wait(()=>button('Start Quiz'));
    const archived=(await readStore('meta',uid+':archived-quiz:'+original.id)).quiz;
    assert.equal(archived.answers.length,1);
    assert.equal((await db.query('select count(*)::int n from public.quiz_answers')).rows[0].n,0);
    document.querySelector('input[type=number]').value='2';
    button('Start Quiz').click();
    await wait(()=>document.querySelector('.mcq-options'));
    assert.notEqual((await readStore('meta',uid+':active-quiz')).quiz.id,original.id);
    while(document.querySelector('.mcq-options')){
      const options=document.querySelector('.mcq-options');
      assert.equal(button('Submit answer'),undefined);
      const questions=(await db.query('select questions from public.quiz_sessions order by started_at desc limit 1')).rows[0].questions;
      const answer=questions.find(q=>q.id===document.querySelector('.study-card').dataset.questionId).answers[0];
      [...options.querySelectorAll('button')].find(b=>b.textContent.endsWith('. '+answer)).click();
      await wait(()=>!options.isConnected);
    }
    await wait(() => document.body.textContent.includes("Results saved."));
    assert.equal(
      (await db.query("select count(*)::int n from public.quiz_answers"))
        .rows[0].n,
      2,
    );
    document.body.replaceChildren(
      statisticsPage({ id: "statistics", title: "Statistics" }),
    );
    await wait(() => document.querySelector(".activity-calendar"));
    assert.equal(document.querySelectorAll(".activity-day").length, 365);
    await refreshCache();
    navigator.onLine = false;
    const state = (await getCache(uid, "word_review_state")).find(r=>r.word_id===id);
    await queueWrite("fixed_review", {
      p_operation: randomUUID(),
      p_word: id,
      p_revision: state.revision,
      p_rating: "hard",
      p_response_ms: 1000,
      p_mode: "recorded_practice",
    });
    navigator.onLine = true;
    dropReviewResponse = true;
    await synchronize();
    assert.equal((await pendingOperations()).length, 1);
    assert.equal(
      (await db.query("select count(*)::int n from public.review_history"))
        .rows[0].n,
      2,
    );
    await synchronize();
    assert.equal((await pendingOperations()).length, 0);
    assert.equal(
      (await db.query("select count(*)::int n from public.review_history"))
        .rows[0].n,
      2,
    );
    await db.query("select public.vocabulary_write($1,'save',$2,null,$3)", [randomUUID(),randomUUID(),JSON.stringify({arabic_word:'قَلَمٌ',english_meaning:'pen',bangla_meaning:'কলম',word_type:'noun'})]);
    mountQuiz();
    button('New quiz').click();
    document.querySelector('input[type=number]').value='2';
    button('Start Quiz').click();
    await wait(()=>document.querySelector('.mcq-options'));
    while(document.querySelector('.mcq-options')){
      const options=document.querySelector('.mcq-options');
      assert.equal(options.querySelectorAll('button').length,2);
      assert.equal(button('Submit answer'),undefined);
      const questions=(await db.query('select questions from public.quiz_sessions order by started_at desc limit 1')).rows[0].questions;
      const answer=questions.find(q=>q.id===document.querySelector('.study-card').dataset.questionId).answers[0];
      [...options.querySelectorAll('button')].find(b=>b.textContent.endsWith('. '+answer)).click();
      await wait(()=>!options.isConnected);
    }
    await wait(()=>document.body.textContent.includes('Results saved.'));
    assert(document.body.textContent.includes('2 / 2'));
    const {dashboard}=await import('../js/pages/dashboard.js');
    const stats=(await db.query('select public.learning_statistics() result')).rows[0].result;
    document.body.replaceChildren(dashboard());
    await wait(()=>document.querySelectorAll('.activity-bar').length===7);
    assert.equal(document.querySelectorAll('.metric-value')[3].textContent,stats.quiz_today+' / '+stats.goals.quiz_questions);
    assert.equal(document.querySelector('.metric-link:last-child').getAttribute('href'),'#/quiz');
    assert.equal(document.querySelector('.summary-row').getAttribute('href'),'#/vocabulary?status=learning');
    assert(!document.body.textContent.includes('No quiz yet'));
    const todayBar=document.querySelector('[aria-current=date]');
    location.hash=todayBar.getAttribute('href');
    document.body.replaceChildren(statisticsPage({id:'history',title:'History'}));
    await wait(()=>document.querySelector('.history-row'));
    assert.equal(document.querySelector('input[type=date]').value,stats.today);
    assert(document.body.textContent.includes('Added word'));
    const {initializePwa,pwaSettings}=await import('../js/pwa.js');
    const posted=[],registration={waiting:{postMessage:m=>posted.push(m)},addEventListener:()=>{},update:async()=>{}};
    let registrationOptions;
    navigator.serviceWorker={register:async(url,options)=>{registrationOptions=options;return registration;},addEventListener:()=>{}};
    document.body.replaceChildren(Object.assign(document.createElement('main'),{id:'main'}));
    await initializePwa();
    assert.equal(registrationOptions.updateViaCache,'none');
    assert(document.getElementById('pwa-update-banner'));
    const pendingKey=uid+':update-test';
    await atomic(['outbox'],tx=>tx.objectStore('outbox').put({key:pendingKey,owner:uid}));
    document.getElementById('pwa-update-banner').querySelector('button').click();
    await wait(()=>document.body.textContent.includes('Sync pending changes before updating.'));
    assert.equal(posted.length,0);
    await atomic(['outbox'],tx=>tx.objectStore('outbox').delete(pendingKey));
    document.body.append(pwaSettings());
    document.getElementById('pwa-update-banner').querySelector('button').click();
    await wait(()=>posted.length===1);
    assert.equal(posted[0].type,'APPLY_UPDATE');
    assert(!button('Reload app'));
  } finally {
    await db.close();
  }
});
