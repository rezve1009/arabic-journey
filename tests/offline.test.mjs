import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: false },
  configurable: true,
});
const { getAccount } = await import("../js/supabase.js");
const { getCache, putCache, atomic, allStore, clearOwner } = await import(
  "../js/storage.js"
);
const { queueWrite, offlineList, cachedWord, cachedDue, pendingOperations } =
  await import("../js/sync.js");
const { csvCell, parseCsv, validateBackup } = await import("../js/backup.js");
const { streaks } = await import("../js/statistics.js");
test("Offline durable writes, dependent edits, reviews, isolation and atomic rollback", async () => {
  const uid = crypto.randomUUID(),
    id = crypto.randomUUID(),
    account = getAccount();
  Object.assign(account, {
    status: "offline",
    user: { id: uid },
    settings: {
      revision_schedule: {
        intervals: [1, 3, 7, 15, 30],
        repeat_days: 30,
        version: 1,
      },
      rating_behavior: { again_days: 1, hard_factor: 0.5, easy_skip: 1 },
    },
  });
  const op = crypto.randomUUID();
  const result = await queueWrite("vocabulary_write", {
    p_operation: op,
    p_action: "save",
    p_id: id,
    p_revision: null,
    p_values: {
      arabic_word: "كَتَبَ",
      bangla_meaning: "লিখেছে",
      english_meaning: "wrote",
      word_type: "verb",
    },
    p_tags: [],
    p_allow_duplicate: false,
  });
  assert(result.queued);
  assert.equal((await offlineList()).total, 1);
  assert.equal((await pendingOperations()).length, 1);
  let word = await cachedWord(id);
  await queueWrite("vocabulary_write", {
    p_operation: crypto.randomUUID(),
    p_action: "save",
    p_id: id,
    p_revision: word.revision,
    p_values: { ...word, notes: "offline detail" },
    p_tags: [],
    p_allow_duplicate: false,
  });
  assert.equal((await cachedWord(id)).notes, "offline detail");
  assert((await pendingOperations()).some((q) => q.dependency === op));
  const states = await getCache(uid, "word_review_state");
  states[0].next_review_at = new Date(Date.now() - 10000).toISOString();
  await putCache(uid, "word_review_state", states);
  assert.equal((await cachedDue()).total, 1);
  await queueWrite("fixed_review", {
    p_operation: crypto.randomUUID(),
    p_word: id,
    p_revision: 1,
    p_rating: "good",
    p_mode: "scheduled",
    p_response_ms: 1000,
  });
  assert.equal((await getCache(uid, "word_review_state"))[0].interval_days, 3);
  await assert.rejects(
    atomic(["cache", "outbox"], (tx) => {
      tx.objectStore("cache").put({ key: uid + ":bad", owner: uid, data: [1] });
      throw new Error("Injected failure");
    }),
  );
  assert(!(await allStore("cache", uid)).some((r) => r.key === uid + ":bad"));
  account.user = { id: crypto.randomUUID() };
  assert.equal((await offlineList()).total, 0);
  assert.equal((await pendingOperations()).length, 0);
  await clearOwner(uid);
  assert.equal((await allStore("outbox", uid)).length, 0);
});
test("CSV Unicode, quotes, formula protection, malformed input and streak boundaries", () => {
  const rows = [
    ["Arabic", "বাংলা", "English"],
    ["كَتَبَ", "লিখেছে", 'write, quote "here"'],
  ];
  const encoded = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  assert.deepEqual(parseCsv(encoded), rows);
  assert.equal(csvCell('=HYPERLINK("evil")')[1], "'");
  assert.throws(() => parseCsv('"unclosed'));
  assert.throws(() => validateBackup({ format: "arabic-journey", version: 2 }));
  assert.deepEqual(
    streaks(
      [
        { study_day: "2026-09-28", n: 2 },
        { study_day: "2026-09-29", n: 2 },
        { study_day: "2026-09-30", n: 2 },
      ],
      "2026-10-01",
      2,
    ),
    { current: 3, longest: 3, days: 3 },
  );
});
