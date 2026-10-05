import { getAccount, vocabularyClient, subscribeAccount } from "./supabase.js";
import { getCache, putCache, allStore, atomic, readStore } from "./storage.js";
import { normalizeArabic } from "./arabic-utils.js";
import { fixedTransition } from "./srs.js";
import {isRevisionConflict} from './conflicts.js';
const tables = [
  "words",
  "tags",
  "word_tags",
  "word_review_state",
  "review_history",
  "quiz_sessions",
  "quiz_answers",
  "study_sessions",
];
let syncing = null,
  status = "Synced",
  lastOwner = null,
  retryTimer = null,
  retryAttempt = 0;
export const syncStatus = () => status;
function notify(value) {
  status = value;
  window.dispatchEvent(new Event("syncstatus"));
}
export const pendingOperations = () =>
  getAccount().user
    ? allStore("outbox", getAccount().user.id)
    : Promise.resolve([]);
let refreshing=null,refreshAgain=false,cacheTimer;
function scheduleCacheRefresh(){clearTimeout(cacheTimer);cacheTimer=setTimeout(()=>refreshCache().catch(()=>notify("Sync Error")),750);}
export function refreshCache(){clearTimeout(cacheTimer);if(refreshing){refreshAgain=true;return refreshing;}refreshing=refreshCacheWork().finally(()=>{refreshing=null;if(refreshAgain){refreshAgain=false;scheduleCacheRefresh();}});return refreshing;}
async function refreshCacheWork() {
  const uid = getAccount().user?.id;
  if (!uid || !navigator.onLine) return;
  const c = vocabularyClient();
  for (const table of tables) {
    let data = [],
      page = 0;
    while (true) {
      const result = await c.rpc("sync_snapshot", {
        p_table: table,
        p_page: page++,
      });
      if (result.error) throw result.error;
      if (getAccount().user?.id !== uid) throw new Error("session_expired");
      data.push(...result.data);
      if (result.data.length < 500) break;
    }
    const queued = await pendingOperations();
    if (
      queued.some(
        (q) =>
          q.table === table ||
          (table === "word_review_state" && q.table === "words"),
      )
    )
      continue;
    await putCache(uid, table, data);
  }
  await atomic(["meta"], (tx) =>
    tx
      .objectStore("meta")
      .put({ key: uid + ":sync", owner: uid, at: Date.now() }),
  );
}
export function synchronize() {
  if (syncing) return syncing;
  syncing = syncWork().finally(() => {
    syncing = null;
  });
  return syncing;
}
async function syncWork() {
  clearTimeout(retryTimer);
  const uid = getAccount().user?.id;
  if (!uid) return;
  if (!navigator.onLine) {
    notify("Offline");
    return;
  }
  notify("Syncing");
  try {
    const c = vocabularyClient();
    for (const op of (await pendingOperations()).sort((a, b) => a.at - b.at)) {
      if (getAccount().user?.id !== uid) return;
      if (op.inflightUntil > Date.now()) continue;
      if (op.conflict) {
        notify("Sync Error");
        continue;
      }
      if (op.dependency) {
        const resolved = await readStore("meta", uid + ":ack:" + op.dependency);
        if (!resolved) break;
        op.args.p_revision = resolved.revision;
        await atomic(["outbox"], (tx) => tx.objectStore("outbox").put(op));
      }
      const result = await c.rpc(op.rpc, op.args);
      if (result.error) {
        op.error = result.error.message;
        op.conflict = isRevisionConflict(result.error) || ["22023", "23514", "23505"].includes(
          result.error.code,
        );
        op.attempts = (op.attempts || 0) + 1;
        await atomic(["outbox"], (tx) => tx.objectStore("outbox").put(op));
        notify("Sync Error");
        if (!op.conflict) break;
        continue;
      }
      if (result.data?.duplicates?.length) {
        op.conflict = true;
        op.error = "Possible duplicate";
        await atomic(["outbox"], (tx) => tx.objectStore("outbox").put(op));
        continue;
      }
      const revision =
        result.data?.word?.revision ||
        result.data?.tag?.revision ||
        result.data?.state?.revision;
      await atomic(["outbox", "meta"], (tx) => {
        tx.objectStore("outbox").delete(op.key);
        tx.objectStore("meta").put({
          key: uid + ":ack:" + op.args.p_operation,
          owner: uid,
          revision,
          result: result.data,
        });
        if (op.resolves)
          tx.objectStore("meta").put({
            key: uid + ":ack:" + op.resolves,
            owner: uid,
            revision,
            result: result.data,
          });
      });
    }
    await refreshCache();
    const pending = await pendingOperations();
    notify(pending.length ? "Sync Error" : "Synced");
    if (pending.some((op) => !op.conflict)) scheduleRetry();
    else retryAttempt = 0;
  } catch {
    notify("Sync Error");
    scheduleRetry();
  }
}
function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!navigator.onLine || !getAccount().user) return;
  retryTimer = setTimeout(
    () => synchronize(),
    Math.min(60000, 1000 * 2 ** Math.min(6, retryAttempt++)),
  );
}
export async function queueWrite(rpc, args) {
  const account = getAccount(),
    uid = account.user?.id;
  if (!uid) throw new Error("session_expired");
  const table =
    rpc === "fixed_review"
      ? "word_review_state"
      : args.p_action?.startsWith("tag")
        ? "tags"
        : "words";
  const id = args.p_id || args.p_word;
  const existing = await getCache(uid, table);
  let row = existing.find((r) => (r.id || r.word_id) === id);
  const dependency = row?._pending || null;
  const prior = { ...row };
  const now = new Date().toISOString();
  let result;
  if (rpc === "fixed_review") {
    if (!row) throw new Error("Word not cached");
    row = {
      ...row,
      ...fixedTransition(
        row,
        args.p_rating,
        account.settings.revision_schedule,
        account.settings.rating_behavior,
      ),
      last_reviewed_at: now,
      review_count: row.review_count + 1,
      correct_count: row.correct_count + (args.p_rating === "again" ? 0 : 1),
      incorrect_count:
        row.incorrect_count + (args.p_rating === "again" ? 1 : 0),
      success_count:
        row.success_count + (["good", "easy"].includes(args.p_rating) ? 1 : 0),
      revision: row.revision + 1,
    };
    const weights = account.settings.weak_weights || {
      again: 2,
      hard: 1,
      success: 1,
      slow: 0.5,
      slow_ms: 15000,
    };
    row.weak_score = Math.max(
      0,
      (prior.weak_score || 0) +
        (args.p_rating === "again"
          ? weights.again
          : args.p_rating === "hard"
            ? weights.hard
            : -weights.success) +
        (args.p_response_ms > weights.slow_ms ? weights.slow : 0),
    );
    result = { state: row, queued: true };
  } else if (args.p_action === "save") {
    const words = existing.filter(
      (w) =>
        !w.deleted_at &&
        w.id !== id &&
        normalizeArabic(w.arabic_word) ===
          normalizeArabic(args.p_values.arabic_word),
    );
    if (words.length && !args.p_allow_duplicate) return { duplicates: words };
    row = {
      ...row,
      ...args.p_values,
      id,
      user_id: uid,
      created_at: row?.created_at || now,
      updated_at: now,
      revision: (row?.revision || 0) + 1,
      tags: args.p_tags,
      word_type: args.p_values.word_type || row?.word_type || "other",
      normalized_arabic: normalizeArabic(args.p_values.arabic_word),
      deleted_at: null,
    };
    result = { word: row, queued: true };
  } else if (args.p_action === "favorite") {
    if (!row) throw new Error("Word not cached");
    row = {
      ...row,
      favorite: args.p_values.favorite,
      revision: row.revision + 1,
    };
    result = { word: row, queued: true };
  } else if (args.p_action === "delete") {
    if (!row) throw new Error("Word not cached");
    row = { ...row, deleted_at: now, revision: row.revision + 1 };
    result = { word: row, queued: true };
  } else if (args.p_action === "tag-save") {
    row = {
      ...row,
      ...args.p_values,
      id,
      user_id: uid,
      created_at: row?.created_at || now,
      updated_at: now,
      revision: (row?.revision || 0) + 1,
      deleted_at: null,
    };
    result = { tag: row, queued: true };
  } else if (args.p_action === "tag-delete") {
    if (!row) throw new Error("Tag not cached");
    row = { ...row, deleted_at: now, revision: row.revision + 1 };
    result = { tag: row, queued: true };
  } else throw new Error("This change needs an internet connection.");
  row._pending = args.p_operation;
  const updated = existing
    .filter((r) => (r.id || r.word_id) !== id)
    .concat(row);
  const queued = await pendingOperations();
  const op = {
    key: uid + ":" + args.p_operation,
    owner: uid,
    rpc,
    args,
    table,
    id,
    prior,
    local: row,
    dependency,
    at: Math.max(Date.now(), ...queued.map((q) => q.at + 1)),
    conflict: false,
  };
  let initialStates = null;
  if (table === "words" && args.p_action === "save" && !prior.id) {
    const states = await getCache(uid, "word_review_state");
    states.push({
      word_id: id,
      user_id: uid,
      algorithm: "fixed",
      stage: 0,
      interval_days: account.settings.revision_schedule.intervals[0],
      next_review_at: new Date(
        Date.now() + account.settings.revision_schedule.intervals[0] * 86400000,
      ).toISOString(),
      revision: 1,
      review_count: 0,
      correct_count: 0,
      incorrect_count: 0,
      success_count: 0,
      weak_score: 0,
      quiz_count: 0,
      quiz_correct: 0,
      mastery_status: "new",
    });
    initialStates = states;
  }
  await atomic(["outbox", "cache"], (tx) => {
    tx.objectStore("outbox").put(op);
    tx.objectStore("cache").put({
      key: uid + ":" + table,
      owner: uid,
      data: updated,
    });
    if (initialStates)
      tx.objectStore("cache").put({
        key: uid + ":word_review_state",
        owner: uid,
        data: initialStates,
      });
  });
  navigator.serviceWorker?.ready
    .then((registration) => registration.sync?.register("arabic-journey-sync"))
    .catch(() => {});
  notify("Offline");
  return result;
}
export async function cloudWrite(rpc, args) {
  if (!navigator.onLine) return queueWrite(rpc, args);
  const uid = getAccount().user?.id,
    c = vocabularyClient(),
    table =
      rpc === "fixed_review"
        ? "word_review_state"
        : args.p_action?.startsWith("tag")
          ? "tags"
          : "words",
    id = args.p_id || args.p_word;
  const prior =
    (await getCache(uid, table)).find(
      (row) => (row.id || row.word_id) === id,
    ) || {};
  const op = {
    key: uid + ":" + args.p_operation,
    owner: uid,
    rpc,
    args,
    table,
    id,
    prior,
    local: { ...prior, ...args.p_values },
    at: Date.now(),
    inflightUntil: Date.now() + 20000,
    conflict: false,
  };
  await atomic(["outbox"], (tx) => tx.objectStore("outbox").put(op));
  let result;
  try {
    result = await c.rpc(rpc, args);
  } catch {
    result = { error: new TypeError("Network failure") };
  }
  if (getAccount().user?.id !== uid) throw new Error("session_expired");
  if (result.error) {
    if (!result.error.code && !result.error.status)
      return queueWrite(rpc, args);
    await atomic(["outbox"], (tx) => tx.objectStore("outbox").delete(op.key));
    throw result.error;
  }
  await atomic(["outbox"], (tx) => tx.objectStore("outbox").delete(op.key));
  scheduleCacheRefresh();
  return result.data;
}
export async function offlineList(filters = {}) {
  const uid = getAccount().user.id,
    words = await getCache(uid, "words"),
    states = await getCache(uid, "word_review_state"),
    links = await getCache(uid, "word_tags");
  const query = normalizeArabic(filters.search || "").toLowerCase();
  const filtered = words
    .filter(
      (w) =>
        !w.deleted_at &&
        (!filters.type || w.word_type === filters.type) &&
        (!filters.favorite || w.favorite) &&
        (!filters.status ||
          (["needs_details","needs-details"].includes(filters.status) && w.needs_details) ||
          (filters.status === "new" &&
            !states.find((s) => s.word_id === w.id)?.review_count) ||
          (filters.status==='learning' && ['new','learning'].includes(states.find(s=>s.word_id===w.id&&!s.deleted_at)?.mastery_status)) ||
          (filters.status==='reviewing' && states.find(s=>s.word_id===w.id&&!s.deleted_at)?.mastery_status==='reviewing') ||
          (filters.status==='today' && localDate(w.created_at,getAccount().settings.timezone)===localDate(new Date(),getAccount().settings.timezone))) &&
        (!filters.tag ||
          (
            w.tags ||
            links
              .filter((l) => l.word_id === w.id && !l.deleted_at)
              .map((l) => l.tag_id)
          ).includes(filters.tag)) &&
        (!query ||
          [
            w.arabic_word,
            w.bangla_meaning,
            w.english_meaning,
            w.notes,
            w.transliteration,
          ].some((v) => normalizeArabic(v).toLowerCase().includes(query))) &&
        (!filters.root ||
          normalizeArabic((w.root || []).join("")) ===
            normalizeArabic(filters.root).replaceAll(" ", "")) &&
        (!filters.from || w.created_at.slice(0, 10) >= filters.from) &&
        (!filters.to || w.created_at.slice(0, 10) <= filters.to),
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
  return {
    total: filtered.length,
    words: filtered.slice(
      (filters.page || 0) * 25,
      (filters.page || 0) * 25 + 25,
    ),
  };
}
export async function cachedWord(id) {
  const uid = getAccount().user.id,
    w = (await getCache(uid, "words")).find(
      (w) => w.id === id && !w.deleted_at,
    );
  if (!w) throw new Error("Word not cached");
  return {
    ...w,
    tags:
      w.tags ||
      (await getCache(uid, "word_tags"))
        .filter((l) => l.word_id === id && !l.deleted_at)
        .map((l) => l.tag_id),
  };
}
export async function cachedReview(id) {
  const uid = getAccount().user.id;
  return {
    state: (await getCache(uid, "word_review_state")).find(
      (s) => s.word_id === id && s.algorithm === "fixed",
    ),
    history: (await getCache(uid, "review_history"))
      .filter((e) => e.word_id === id)
      .sort(
        (a, b) =>
          b.occurred_at.localeCompare(a.occurred_at) ||
          b.id.localeCompare(a.id),
      )
      .slice(0, 25),
  };
}
export async function cachedDue(page = 0) {
  const uid = getAccount().user.id,
    words = await getCache(uid, "words"),
    states = await getCache(uid, "word_review_state");
  const all = states
    .filter(
      (s) =>
        s.algorithm === "fixed" &&
        !s.deleted_at &&
        words.some((w) => w.id === s.word_id && !w.deleted_at),
    )
    .map((s) => ({
      ...words.find((w) => w.id === s.word_id),
      ...s,
      id: s.word_id,
    }))
    .sort((a, b) => a.next_review_at.localeCompare(b.next_review_at));
  const due = all.filter((s) => new Date(s.next_review_at) <= new Date());
  return {
    total: due.length,
    words: due.slice(page * 25, page * 25 + 25),
    upcoming: all
      .filter((s) => new Date(s.next_review_at) > new Date())
      .slice(0, 5),
    offline: true,
  };
}
export async function resolveConflict(op, keepLocal) {
  const uid = getAccount().user.id;
  if (op.owner !== uid) throw new Error("session_expired");
  if (keepLocal) {
    const c = vocabularyClient();
    let latest;
    if (op.rpc === "fixed_review") {
      const r = await c
        .from("word_review_state")
        .select("*")
        .eq("word_id", op.id)
        .eq("algorithm", "fixed")
        .single();
      if (r.error) throw r.error;
      latest = r.data;
      op.args.p_mode = "recorded_practice";
    } else {
      const r = await c.from(op.table).select("*").eq("id", op.id).single();
      if (r.error) throw r.error;
      latest = r.data;
      if (latest.deleted_at)
        throw new Error("Deleted word cannot be overwritten");
    }
    op.resolves = op.args.p_operation;
    op.args.p_revision = latest.revision;
    op.args.p_operation = crypto.randomUUID();
    if (op.rpc === "vocabulary_write") op.args.p_allow_duplicate = true;
    op.key = uid + ":" + op.args.p_operation;
    op.conflict = false;
    op.dependency = null;
    await atomic(["outbox", "meta"], (tx) => {
      tx.objectStore("outbox").delete(uid + ":" + op.local._pending);
      tx.objectStore("outbox").put(op);
      tx.objectStore("meta").put({
        key: uid + ":conflict:" + op.local._pending,
        owner: uid,
        original: op.prior,
        local: op.local,
        server: latest,
      });
    });
  } else {
    const all = await pendingOperations(),
      removed = new Set([op.args.p_operation]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of all)
        if (removed.has(row.dependency) && !removed.has(row.args.p_operation)) {
          removed.add(row.args.p_operation);
          changed = true;
        }
    }
    await atomic(["outbox", "meta"], (tx) => {
      for (const row of all.filter((row) =>
        removed.has(row.args.p_operation),
      )) {
        tx.objectStore("outbox").delete(row.key);
        tx.objectStore("meta").put({
          key: uid + ":conflict:" + row.args.p_operation,
          owner: uid,
          original: row.prior,
          local: row.local,
        });
      }
      tx.objectStore("meta").put({
        key: uid + ":conflict:" + op.args.p_operation,
        owner: uid,
        original: op.prior,
        local: op.local,
      });
    });
  }
  await synchronize();
}
export function initializeSync() {
  subscribeAccount((account) => {
    if (lastOwner !== account.user?.id) {
      clearTimeout(retryTimer);clearTimeout(cacheTimer);
      retryAttempt = 0;
      lastOwner = account.user?.id;
      notify(navigator.onLine ? "Synced" : "Offline");
    }
    if (account.status === "ready" && navigator.onLine) synchronize();
  });
  window.addEventListener("online", synchronize);
  window.addEventListener("offline", () => notify("Offline"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && navigator.onLine) synchronize();
  });
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "sync") synchronize();
  });
}

function localDate(value,timezone='UTC'){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
