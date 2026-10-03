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
    button('Start Quiz').click();
    await wait(()=>document.querySelector('.mcq-options'));
    while(document.querySelector('.mcq-options')){
      const options=document.querySelector('.mcq-options');
      assert.equal(button('Submit answer'),undefined);
      const prompt=document.querySelector('.quiz-prompt').textContent;
      [...options.querySelectorAll('button')].find(b=>b.textContent.endsWith('. '+(prompt==='كَتَبَ'?'wrote':'pen'))).click();
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
    button('Start Quiz').click();
    await wait(()=>document.querySelector('.mcq-options'));
    while(document.querySelector('.mcq-options')){
      const options=document.querySelector('.mcq-options');
      assert.equal(options.querySelectorAll('button').length,2);
      assert.equal(button('Submit answer'),undefined);
      const prompt=document.querySelector('.quiz-prompt').textContent;
      const answer=prompt==='كَتَبَ'?'wrote':'pen';
      [...options.querySelectorAll('button')].find(b=>b.textContent.endsWith('. '+answer)).click();
      await wait(()=>!options.isConnected);
    }
    await wait(()=>document.body.textContent.includes('Results saved.'));
    assert(document.body.textContent.includes('2 / 2'));
  } finally {
    await db.close();
  }
});
