import { getAccount, subscribeAccount } from "./supabase.js";
import { getDueWords, getReviewInfo, recordFixedReview } from "./srs-data.js";
import { getWord, listWords, listTags } from "./vocabulary-data.js";
import { fixedTransition } from "./srs.js";
import { displayArabic } from "./arabic-utils.js";
import {
  node,
  content,
  action,
  link,
  shell,
  ready,
  finish,
  message,
  audio,
} from "./learning-ui.js";
let session = null,
  owner = null,
  render = () => {},
  keys = null,
  generation = 0;
subscribeAccount((account) => {
  if (owner && owner !== account.user?.id) {
    owner = null;
    session = null;
    unmountReview();
  }
});
window.addEventListener("learningreset", () => {
  session = null;
  unmountReview();
});
export function setReviewRenderer(work) {
  render = work;
}
export function unmountReview() {
  generation++;
  if (keys) window.removeEventListener("keydown", keys);
  keys = null;
}
export function reviewPage() {
  const page = shell("Review");
  if (!ready(page)) return finish(page);
  const account = getAccount();
  if (owner !== account.user.id) {
    owner = account.user.id;
    session = null;
  }
  const body = node("section", "", "card study-card");
  page.append(body);
  if (!session) {
    body.append(node("p", "Loading…"));
    const token = generation;
    queueMicrotask(async () => {
      try {
        const due = await getDueWords();
        if (
          !page.isConnected ||
          generation !== token ||
          owner !== getAccount().user?.id
        )
          return;
        body.replaceChildren(
          node("h2", "Today's review"),
          content(
            "p",
            due.total +
              " " +
              (account.settings.ui_language === "bn"
                ? "শব্দ বাকি"
                : "words due"),
          ),
        );
        const counts = { New: 0, Learning: 0, "Long-term": 0, Weak: 0 };
        const all = [];
        for (let p = 0; p < Math.ceil(due.total / 25); p++) {
          const batch = p ? await getDueWords(p) : due;
          all.push(...batch.words);
        }
        for (const w of all) {
          w.state =
            w.review_count !== undefined
              ? { ...w }
              : (await getReviewInfo(w.id)).state;
          counts[
            w.state.review_count === 0
              ? "New"
              : w.state.stage >=
                  account.settings.revision_schedule.intervals.length
                ? "Long-term"
                : "Learning"
          ]++;
          if (w.state.weak_score >= (account.settings.weak_weights?.threshold||2)) counts.Weak++;
        }
        const stats = node("div", "", "study-preview");
        for (const [k, v] of Object.entries(counts))
          stats.append(node("p", k), content("strong", v));
        body.append(stats);
        if (all.length)
          body.append(
            action("Start Review", () => start(all, "scheduled"), true),
          );
        else
          body.append(
            node("p", "You're done for today. No words are currently due."),
          );
        const practice = node("div", "", "practice-controls");
        practice.append(node("h3", "Random Practice"));
        const kind = node("select");
        kind.setAttribute("aria-label", "Practice selection");
        for (const value of ["all", "weak", "recent", "verb", "noun"]) {
          const o = node("option", value);
          o.value = value;
          kind.append(o);
        }
        if (
          new URLSearchParams(location.hash.split("?")[1] || "").get(
            "practice",
          ) === "weak"
        )
          kind.value = "weak";
        const limit = node("select");
        limit.setAttribute("aria-label", "Practice word count");
        for (const count of [5, 10, 20]) {
          const o = content("option", count);
          o.value = count;
          limit.append(o);
        }
        const tag = node("select");
        tag.setAttribute("aria-label", "Tag / Deck");
        tag.append(
          Object.assign(node("option", "All tags / decks"), { value: "" }),
        );
        for (const item of await listTags())
          tag.append(
            Object.assign(content("option", item.name), { value: item.id }),
          );
        const record = node("input");
        record.type = "checkbox";
        const label = node("label");
        label.append(
          record,
          node("span", "Record practice and update review schedule"),
        );
        practice.append(
          kind,
          limit,
          tag,
          label,
          action("Start Practice", async () => {
            try {
              const pool = [];
              let p = 0,
                total = 1;
              while (pool.length < total) {
                const batch = await listWords({
                  page: p++,
                  type: ["verb", "noun"].includes(kind.value) ? kind.value : "",
                  tag: tag.value,
                });
                total = batch.total;
                pool.push(...batch.words);
              }
              let chosen = pool;
              if (kind.value === "weak") {
                chosen = [];
                for (const w of pool) {
                  const info = await getReviewInfo(w.id);
                  if (info.state?.weak_score >= (account.settings.weak_weights?.threshold||2))
                    chosen.push({ ...w, state: info.state });
                }
              }
              if (kind.value !== "recent")
                chosen.sort(() => Math.random() - 0.5);
              chosen = chosen.slice(0, Number(limit.value));
              if (!chosen.length) {
                body.append(node("p", "No eligible words."));
                return;
              }
              for (const w of chosen)
                if (!w.state) w.state = (await getReviewInfo(w.id)).state;
              start(
                chosen,
                record.checked ? "recorded_practice" : "unrecorded",
              );
            } catch (e) {
              message(body, e);
            }
          }),
        );
        body.append(practice);
        finish(page);
      } catch (e) {
        body.replaceChildren(action("Retry", () => render()));
        message(body, e);
      }
    });
    return page;
  }
  if (session.index >= session.words.length) {
    body.append(
      node("h2", "Session complete"),
      content("p", session.index + " / " + session.words.length),
      node(
        "p",
        session.mode === "unrecorded"
          ? "Practice complete. The review schedule was unchanged."
          : "Your reviews have been saved.",
      ),
      action("Review again", () => {
        session = null;
        render();
      }),
      link("Back to vocabulary", "#/vocabulary"),
    );
    return finish(page);
  }
  const item = session.words[session.index];
  body.append(
    content(
      "p",
      session.index + 1 + " / " + session.words.length,
      "study-position",
    ),
  );
  const progress = node("progress");
  progress.max = session.words.length;
  progress.value = session.index;
  progress.setAttribute("aria-label", "Review progress");
  body.append(progress);
  if (!item.word) {
    const token = generation;
    body.append(node("p", "Loading…"));
    queueMicrotask(async () => {
      try {
        item.word = await getWord(item.id);
        if (generation === token && owner === getAccount().user?.id) {
          item.at = performance.now();
          render();
        }
      } catch (e) {
        if (page.isConnected) message(body, e);
      }
    });
    return page;
  }
  const word = item.word,
    ar = content(
      "h2",
      displayArabic(word.arabic_word, {
        mode: account.settings.harakah_mode,
        quiz: true,
        revealed: session.revealed,
      }),
      "flashcard-arabic",
    );
  ar.lang = "ar";
  ar.dir = "rtl";
  body.append(ar);
  if ("speechSynthesis" in window) body.append(audio(word.arabic_word));
  if (!session.revealed)
    body.append(
      action(
        "Show Answer",
        () => {
          session.revealed = true;
          render();
        },
        true,
      ),
    );
  else {
    for (const key of [
      "bangla_meaning",
      "english_meaning",
      "arabic_meaning",
      "root_meaning",
      "example_arabic",
      "example_bangla",
      "example_english",
      "notes",
    ])
      if (word[key]) {
        const text = content("p", word[key]);
        if (key.includes("arabic")) {
          text.lang = "ar";
          text.dir = "rtl";
          text.className = "flashcard-example";
        }
        body.append(text);
      }
    if (word.root?.length) body.append(content("p", word.root.join(" — ")));
    body.append(link("View details", "#/vocabulary?word=" + word.id));
    const ratings = node("div", "", "rating-actions");
    for (const rating of ["again", "hard", "good", "easy"]) {
      const predicted = fixedTransition(
        item.state || { stage: 0 },
        rating,
        account.settings.revision_schedule,
        account.settings.rating_behavior,
      );
      const btn = action(
        rating[0].toUpperCase() + rating.slice(1),
        () => submit(rating, body),
        rating === "good",
      );
      btn.disabled = !!session.pending;
      btn.append(
        content(
          "small",
          session.mode === "unrecorded" ? "" : predicted.interval_days + "d",
        ),
      );
      ratings.append(btn);
    }
    body.append(ratings);
  }
  if (session.error) {
    message(body, session.error);
    if (session.error.code === "40001")
      body.append(
        action("Reload review state", async () => {
          item.state = (await getReviewInfo(item.id)).state;
          session.pending = null;
          session.error = null;
          render();
        }),
      );
    else
      body.append(
        action("Retry", () => submit(session.pending.rating, body), true),
      );
  }
  if (!session.pending)
    body.append(
      action("End session", () => {
        session = null;
        render();
      }),
    );
  keys = (event) => {
    if (
      /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      session.pending
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      session.revealed = true;
      render();
    } else if (session.revealed && ["1", "2", "3", "4"].includes(event.key))
      submit(["again", "hard", "good", "easy"][Number(event.key) - 1], body);
  };
  window.addEventListener("keydown", keys);
  body.append(
    node(
      "p",
      "Space: show answer · 1 Again · 2 Hard · 3 Good · 4 Easy",
      "settings-help",
    ),
  );
  return finish(page);
}
function start(words, mode) {
  session = {
    words,
    mode,
    index: 0,
    revealed: false,
    pending: null,
    error: null,
  };
  render();
}
async function submit(rating, body) {
  if (session.saving) return;
  const active = session,
    item = active.words[active.index],
    uid = owner;
  active.pending ??= {
    operation: crypto.randomUUID(),
    rating,
    responseMs: Math.min(
      2147483647,
      Math.max(0, Math.round(performance.now() - item.at)),
    ),
  };
  active.saving = true;
  render();
  try {
    if (active.mode !== "unrecorded")
      await recordFixedReview({
        operation: active.pending.operation,
        word: item.id,
        revision: item.state.revision,
        rating: active.pending.rating,
        responseMs: active.pending.responseMs,
        mode: active.mode,
      });
    if (session !== active || getAccount().user?.id !== uid) return;
    active.index++;
    active.revealed = false;
    active.pending = null;
    active.error = null;
  } catch (e) {
    active.error = e;
  } finally {
    active.saving = false;
    if (session === active) render();
  }
}
