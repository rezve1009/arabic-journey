import { readStore, atomic } from "./storage.js";
import { getAccount, subscribeAccount } from "./supabase.js";
import { vocabularyRequest } from "./vocabulary-data.js";
import { normalizeArabic, displayArabic, pronouns } from "./arabic-utils.js";
import {
  node,
  content,
  action,
  link,
  shell,
  ready,
  finish,
  message,
  field,
} from "./learning-ui.js";
export const quizTypes = [
  "arabic_bangla",
  "arabic_english",
  "bangla_arabic",
  "english_arabic",
  "arabic_typing",
  "root",
  "masdar",
  "verb_form",
  "conjugation",
  "fill_blank",
  "multiple_choice",
  "true_false",
];
export const compareAnswer = (answer, answers) =>
  answers.some(
    (expected) =>
      normalizeArabic(answer).trim().toLocaleLowerCase() ===
      normalizeArabic(expected).trim().toLocaleLowerCase(),
  );
let quiz = null,
  owner = null,
  render = () => {},
  busy = false,
  startOp = null;
subscribeAccount((account) => {
  if (owner && owner !== account.user?.id) {
    quiz = null;
    owner = null;
    startOp = null;
  }
});
async function keepQuiz() {
  if (!quiz || !owner) return;
  const saved = structuredClone(quiz);
  delete saved.saving;
  await atomic(["meta"], (tx) =>
    tx
      .objectStore("meta")
      .put({ key: owner + ":active-quiz", owner, quiz: saved }),
  );
}
window.addEventListener("learningreset", () => {
  quiz = null;
  startOp = null;
});
export function setQuizRenderer(fn) {
  render = fn;
}
export function quizPage() {
  const page = shell("Daily Quiz");
  if (!ready(page)) return finish(page);
  const account = getAccount();
  if (owner !== account.user.id) {
    owner = account.user.id;
    quiz = null;
    startOp = null;
  }
  const card = node("section", "", "card study-card");
  page.append(card);
  if (!quiz) {
    queueMicrotask(async () => {
      const uid = owner;
      const draft = await readStore("meta", uid + ":active-quiz");
      if (
        draft?.quiz &&
        !draft.quiz.saved &&
        uid === getAccount().user?.id &&
        page.isConnected &&
        !quiz
      ) {
        if (!mcqSession(draft.quiz)) {
          await archiveQuiz(uid,draft.quiz);
          card.append(node("p", "Your older typing quiz was kept in local storage. Start a new MCQ quiz."));
          return;
        }
        quiz = { ...draft.quiz, at: performance.now(), saving: false };
        render();
      }
    });
    const prefs = account.settings.quiz_options;
    const count = field("Question count", "number", prefs.question_count);
    count.input.min = 1;
    count.input.max = 100;
    const weak = field("Weak word percentage", "number", prefs.weak_percentage);
    weak.input.min = 0;
    weak.input.max = 100;
    const newWords = field("Include new words", "checkbox");
    newWords.input.checked = prefs.include_new;
    const mastered = field("Include mastered words", "checkbox");
    mastered.input.checked = prefs.include_mastered;
    card.append(
      count.wrap,
      node("p", "Only MCQ questions are used. Choose an option to answer."),
      node("p", "MCQs mix Bengali, Arabic and English. Options come from your own words."),
      weak.wrap,
      newWords.wrap,
      mastered.wrap,
      action(
        "Start Quiz",
        async () => {
          if (busy) return;
          const selected = ["multiple_choice"];
          if (
            !selected.length ||
            !count.input.reportValidity() ||
            !weak.input.reportValidity()
          )
            return;
          busy = true;
          startOp ??= crypto.randomUUID();
          try {
            const result = await vocabularyRequest((c) =>
              c.rpc("quiz_start", {
                p_operation: startOp,
                p_count: Number(count.input.value),
                p_types: selected,
                p_weak: Number(weak.input.value),
                p_new: newWords.input.checked,
                p_mastered: mastered.input.checked,
              }),
            );
            if (owner !== getAccount().user?.id) return;
            if (result.empty) {
              card.append(
                node(
                  "p",
                  selected.length === 1 && selected[0] === "multiple_choice" ? "Add at least two words with different meanings to start an MCQ quiz." : "No eligible questions. Add words or enable more question types.",
                ),
              );
              startOp = null;
            } else {
              quiz = {
                ...result,
                index: 0,
                answers: [],
                at: performance.now(),
                submitted: false,
                finishOp: crypto.randomUUID(),
              };
              await keepQuiz();
              render();
            }
          } catch (e) {
            message(card, e);
          } finally {
            busy = false;
          }
        },
        true,
      ),
    );
    return finish(page);
  }
  if (!mcqSession(quiz)) {
    card.append(node("p", "Your older typing quiz was kept in local storage. Start a new MCQ quiz."),action("Start new MCQ quiz", async()=>{await archiveQuiz(owner,quiz);quiz=null;startOp=null;render();},true));
    return finish(page);
  }
  if (!quiz.saved) {
    const restart=action('Restart quiz',()=>{
      if(busy||quiz.saving||card.querySelector('.quiz-restart-confirm'))return;
      const confirmation=node('div','','feedback quiz-restart-confirm');
      confirmation.append(node('p','Restart this quiz? Your current answers will be kept separately.'),action('Cancel',()=>confirmation.remove()),action('Restart now',async()=>{
        if(busy||quiz.saving)return;
        const active=quiz,uid=owner;busy=true;
        try{await archiveQuiz(uid,active);if(quiz===active&&getAccount().user?.id===uid){quiz=null;startOp=null;render();}}catch(error){message(confirmation,error);}finally{busy=false;}
      },true));
      card.prepend(confirmation);
    });
    restart.disabled=!!quiz.saving;
    card.append(restart);
  }
  if (quiz.index >= quiz.questions.length) {
    card.append(
      node("h2", "Quiz complete"),
      content(
        "p",
        (quiz.saved
          ? quiz.score
          : quiz.answers.filter((a) => a.correct).length) +
          " / " +
          quiz.questions.length,
      ),
    );
    for (const a of quiz.answers.filter((a) => !a.correct)) {
      const q = quiz.questions.find((q) => q.id === a.id);
      const block = node("div", "", "quiz-mistake");
      block.append(
        content("h3", q.prompt),
        content("p", a.answer),
        content("p", q.answers.join(" / ")),
      );
      card.append(block);
    }
    if (!quiz.saved) {
      card.append(action("Save results", () => save(card), true));
      if (!quiz.submitted) queueMicrotask(() => save(card));
    } else
      card.append(
        node("p", "Results saved."),
        action("New quiz", () => {
          quiz = null;
          startOp = null;
          render();
        }),
        link("Review weak words", "#/weak-words"),
      );
    return finish(page);
  }
  const q = quiz.questions[quiz.index];
  card.dataset.questionId=q.id;
  card.append(
    content("p", quiz.index + 1 + " / " + quiz.questions.length),
    node("p", q.direction ? ({bangla_arabic:"Bengali → Arabic",arabic_bangla:"Arabic → Bengali",arabic_english:"Arabic → English",english_arabic:"English → Arabic"}[q.direction]) : q.type.replaceAll("_", " ")),
  );
  if (q.pronoun)
    card.append(
      content(
        "p",
        (pronouns.find((p) => p.id === q.pronoun)?.arabic || q.pronoun) +
          " · " +
          q.tense,
      ),
    );
  const prompt = content(
    "h2",
    displayArabic(q.prompt, {
      mode: account.settings.harakah_mode,
      quiz: true,
      revealed: false,
    }),
    "quiz-prompt",
  );
  if (q.prompt_lang) prompt.lang=q.prompt_lang;
  if (q.prompt_lang === "ar" || (!q.prompt_lang && /[ء-ي]/.test(q.prompt))) {
    prompt.lang = "ar";
    prompt.dir = "rtl";
  }
  card.append(prompt);
  const submit = async (answer) => {
    if (busy) return;
    busy = true;
    const active = quiz;
    try {
      const next = {
        ...active,
        answers: [
          ...active.answers,
          {
            id: q.id,
            answer,
            response_ms: Math.min(
              2147483647,
              Math.round(performance.now() - active.at),
            ),
            correct: compareAnswer(answer, q.answers),
          },
        ],
        index: active.index + 1,
        at: performance.now(),
      };
      await atomic(["meta"], (tx) =>
        tx
          .objectStore("meta")
          .put({
            key: owner + ":active-quiz",
            owner,
            quiz: structuredClone(next),
          }),
      );
      if (quiz === active && owner === getAccount().user?.id) {
        quiz = next;
        render();
      }
    } catch (e) {
      message(card, e);
    } finally {
      busy = false;
    }
  };
  if (q.type === "multiple_choice" && q.choices?.length >= 2) {
    const options = node("div", "", "mcq-options");
    for (const [index, choice] of q.choices.entries()) {
      const btn = action(choice, () => submit(choice));
      btn.textContent = String.fromCharCode(65 + index) + ". " + choice;
      btn.dataset.noTranslate = "";
      if(q.answer_lang){btn.lang=q.answer_lang;btn.dir=q.answer_lang=== "ar"?"rtl":"ltr";}
      options.append(btn);
    }
    card.append(options);
  }
  return finish(page);
}
async function save(card) {
  if (quiz.saving) return;
  const active = quiz;
  active.saving = true;
  active.submitted = true;
  try {
    const result = await vocabularyRequest((c) =>
      c.rpc("quiz_finish", {
        p_operation: active.finishOp,
        p_session: active.id,
        p_answers: active.answers.map(({ id, answer, response_ms }) => ({
          id,
          answer,
          response_ms,
        })),
      }),
    );
    if (active !== quiz || getAccount().user?.id !== owner) return;
    active.saved = true;
    await keepQuiz();
    active.score = result.score;
    await keepQuiz();
    render();
  } catch (e) {
    if (card.isConnected) message(card, e);
  } finally {
    active.saving = false;
  }
}

function mcqSession(session){return session.questions?.length>0&&session.questions.every(q=>q.type==='multiple_choice'&&q.choices?.length>=2);}
async function archiveQuiz(uid,session){await atomic(['meta'],tx=>{const store=tx.objectStore('meta');store.put({key:uid+':archived-quiz:'+session.id,owner:uid,quiz:structuredClone(session)});store.delete(uid+':active-quiz');});}
