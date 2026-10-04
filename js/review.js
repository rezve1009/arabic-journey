import {examplesDetails} from './examples.js';
import {reviewDate} from './srs-details.js';
import {t}from './i18n.js';
import {practiceCount,reviewSummary}from './review-tools.js';
import { getAccount, subscribeAccount } from "./supabase.js";
import { getUpcomingWords, getDueWords, getReviewInfo, recordFixedReview } from "./srs-data.js";
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
  page.classList.add('review-page');
  page.querySelector('.page-heading').append(node('p','Recall a word, check its meaning, then rate your memory.','page-description'));
  const summary=node('section','','review-summary');summary.setAttribute('aria-label','Review summary');
  for(const [key,label]of [['reviewed','Reviewed today'],['due','Words due'],['weak','Weak words']]){const card=node('article','','card review-metric');card.append(node('p',label),content('strong','—'));card.dataset.metric=key;summary.append(card);}
  const summaryStatus=node('p','Loading…','settings-help');summaryStatus.setAttribute('aria-live','polite');page.append(summary,summaryStatus);
  queueMicrotask(async()=>{try{const data=await reviewSummary();if(!page.isConnected||getAccount().user?.id!==account.user.id)return;for(const card of summary.children)card.querySelector('strong').textContent=data[card.dataset.metric];summaryStatus.textContent=data.pending?t('Pending sync: {count} reviews',{count:data.pending}):t('Today counts saved ratings, not sessions or word views.');}catch{if(page.isConnected)summaryStatus.textContent=t('Summary could not be loaded.');}});
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
              t("words due"),
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
        const stats = node("div", "", "study-preview");stats.setAttribute('aria-label','Due word categories');
        for (const [k, v] of Object.entries(counts))
          {const cell=node('div','','due-category');cell.append(node('span',k),content('strong',v));stats.append(cell);}
        body.append(stats);
        if (all.length)
          body.append(
            action("Start Review", () => start(all, "scheduled"), true),
          );
        else
          body.append(
            node("p", "You're done for today. No words are currently due."),
          );
        const upcoming=node('section','','upcoming-review');upcoming.append(node('h3','Upcoming words'),node('p','The next five scheduled words. Due words appear above.','settings-help'));if(due.upcoming?.length){for(const w of due.upcoming){const row=link('', '#/vocabulary?word='+w.id);row.className='upcoming-word';row.append(content('strong',w.arabic_word,'arabic'),content('span',reviewDate(w.next_review_at)));upcoming.append(row);}}else upcoming.append(node('p','No upcoming words.'));body.append(upcoming);
        const advance=node("section","","advance-review");advance.append(node("h3","Do the next review now"),node("p","Review upcoming words in scheduled order. Ratings are saved and only those words move to their next review. Today's due queue is unchanged.","settings-help"));const advanceLimit=fieldCount();const advanceLabel=node("label","Words in the next review batch");advanceLabel.append(advanceLimit);advance.append(advanceLabel);const advanceStart=action("Start next review",async()=>{if(advanceStart.disabled)return;let wanted;try{wanted=practiceCount(advanceLimit.value);}catch{advanceLimit.setCustomValidity(t("Enter a whole number from 1 to 1000."));advanceLimit.reportValidity();return;}advanceStart.disabled=true;try{const batch=await getUpcomingWords(wanted);if(!page.isConnected||account.user.id!==getAccount().user?.id)return;if(!batch.words.length){advance.append(node("p","No upcoming words."));return;}start(batch.words,"recorded_practice",wanted,"upcoming");}catch(e){message(advance,e);}finally{if(advance.isConnected)advanceStart.disabled=false;}},true);advanceStart.disabled=account.settings.daily_goals?.allow_early_reviews===false;if(advanceStart.disabled)advance.append(node("p","Enable extra revision sessions in Settings."));advance.append(advanceStart,link("Revision settings","#/settings?section=learning"));body.append(advance);
        const practice = node("div", "", "practice-controls");
        practice.append(node("h3", "Random Practice"),node('p','Choose your words and practise at your own pace.','settings-help'));
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
        const limit=node('input');limit.type='number';limit.min='1';limit.max='1000';limit.step='1';limit.value='5';limit.required=true;limit.setAttribute('aria-label','Practice word count');
        const countsLabel=node('label','Practice word count');countsLabel.append(limit);
        const presets=node('div','','practice-presets');
        for(const count of [5,10,20]){const preset=action(String(count),()=>{limit.value=String(count);limit.dispatchEvent(new Event('input'));});presets.append(preset);}
        const requested=node('p','','settings-help');limit.addEventListener('input',()=>{requested.textContent='';limit.setCustomValidity('');});
        const kindLabel=node('label','Practice selection');kindLabel.append(kind);
        const tag = node("select");
        tag.setAttribute("aria-label", "Tag / Deck");
        tag.append(
          Object.assign(node("option", "All tags / decks"), { value: "" }),
        );
        for (const item of await listTags())
          tag.append(
            Object.assign(content("option", item.name), { value: item.id }),
          );
        const tagLabel=node("label","Tag / Deck");tagLabel.append(tag);let starting=false;
        const record = node("input");
        record.type = "checkbox";
        const label = node("label");
        label.append(
          record,
          node("span", "Record practice and update review schedule"),
        );
        practice.append(
          kindLabel,
          countsLabel,
          presets,
          requested,
          tagLabel,
          label,
          action("Start Practice", async () => {
            if(starting)return;
            try {
              let wanted;try{wanted=practiceCount(limit.value);}catch{limit.setCustomValidity(t("Enter a whole number from 1 to 1000."));limit.reportValidity();return;}
              starting=true;practice.querySelector(".button-primary").disabled=true;
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
              chosen = chosen.slice(0, wanted);
              if (!chosen.length) {
                body.append(node("p", "No eligible words."));
                return;
              }
              for (const w of chosen)
                if (!w.state) w.state = (await getReviewInfo(w.id)).state;
              if(!page.isConnected||owner!==getAccount().user?.id)return;
              start(
                chosen,
                record.checked ? "recorded_practice" : "unrecorded",
                wanted,
              );
            } catch (e) {
              message(body, e);
            }finally{starting=false;const startButton=practice.querySelector(".button-primary");if(startButton)startButton.disabled=false;}
          }, true),
        );
        const modeHint=node("p","Practice is not recorded. Your review schedule will stay unchanged.","practice-mode-note");label.className="practice-record-label";record.addEventListener("change",()=>{modeHint.textContent=t(record.checked?"Ratings will be saved and your review schedule will change.":"Practice is not recorded. Your review schedule will stay unchanged.");});practice.append(modeHint);
        body.append(practice);
        finish(page);
      } catch (e) {
        body.replaceChildren(action("Retry", () => render()));
        message(body, e);
      }
    });
    return page;
  }
  if(session.kind==='upcoming')body.append(node('h2','Upcoming review session'));
  const modeNote=node('p',session.mode==='unrecorded'?'Practice is not recorded. Your review schedule will stay unchanged.':'Ratings will be saved and your review schedule will change.','practice-mode-note');body.append(modeNote);
  if(session.requested>session.words.length)body.append(node('p',t('Requested {requested}; {available} matching words are available.',{requested:session.requested,available:session.words.length}),'settings-help'));
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
      ...(session.kind==='upcoming'?[action("Next upcoming batch",()=>{session=null;render();},true)]:[]),
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
    body.append(examplesDetails(word));
    if (word.root?.length) body.append(content("p", word.root.join(" — ")));
    body.append(link("View details", "#/vocabulary?word=" + word.id+"&from=review"));
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
function start(words, mode, requested=words.length,kind="regular") {
  session = {
    words,
    kind,
    requested,
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

export function reviewReturnContext(wordId){return session&&owner===getAccount().user?.id&&session.index<session.words.length&&session.words[session.index].id===wordId?{position:session.index+1,total:session.words.length}:null;}

function fieldCount(){const input=node('input');input.type='number';input.min=1;input.max=1000;input.step=1;input.value=getAccount().settings.daily_goals?.review_batch_size||10;input.setAttribute('aria-label','Words in the next review batch');input.addEventListener('input',()=>input.setCustomValidity(''));return input;}
