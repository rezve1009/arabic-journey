import { readStore, atomic } from "./storage.js";
import {t}from './i18n.js';
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
  startOp = null,
  startSignature = null;
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
  page.classList.add('quiz-page');
  page.querySelector('.page-heading').append(node('p','Build your vocabulary, one quiz round at a time.','page-description'));
  if (!ready(page)) return finish(page);
  const account = getAccount();
  if (owner !== account.user.id) {
    owner = account.user.id;
    quiz = null;
    startOp = null;
  }
  const card = node("section", "", "card study-card");
  const coverage=node('section','','card quiz-coverage');page.append(coverage);
  if(!quiz||quiz.saved||!quiz.settings_snapshot?.coverage_round)queueMicrotask(async()=>{try{const status=await vocabularyRequest(c=>c.rpc('quiz_coverage_status'));if(page.isConnected&&account.user.id===getAccount().user?.id)showCoverage(coverage,status);}catch{if(page.isConnected)coverage.append(node('p','Coverage could not be loaded.'));}});
  else showCoverage(coverage,{round:quiz.settings_snapshot?.coverage_round||1,total:quiz.settings_snapshot?.coverage_total||0,covered:quiz.settings_snapshot?.coverage_done||0});
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
    const weak = field("New words (%)", "number", 60);
    weak.input.min = 1;
    weak.input.max = 100;
    const newWords = field("Include new words", "checkbox");
    newWords.input.checked = true;
    const mastered = field("Include mastered words", "checkbox");
    mastered.input.checked = true;
    const optional=node('details','','quiz-options');optional.append(node('summary','Optional quiz settings'));
    const directionSet=node('fieldset','','quiz-directions');directionSet.append(node('legend','Question directions'));
    const directions=[];
    for(const [value,label]of [['bangla_arabic','Bengali → Arabic'],['arabic_bangla','Arabic → Bengali'],['arabic_english','Arabic → English'],['english_arabic','English → Arabic']]){const input=field(label,'checkbox');input.input.checked=true;directions.push({value,input:input.input});directionSet.append(input.wrap);}
    optional.append(weak.wrap,node('p','The remaining questions repeat words covered in this round. Available words fill any shortage.','settings-help'),directionSet,newWords.wrap,mastered.wrap,node('p','Keep all directions and both word groups enabled to cover your full eligible collection.','settings-help'));
    card.append(node('h2','Prepare your quiz'),count.wrap,
      node("p", "Only MCQ questions are used. Choose an option to answer."),
      node('p','Each quiz uses different words. Completed, saved quizzes count toward coverage.','settings-help'),optional,
      action(
        "Start Quiz",
        async () => {
          if (busy) return;
          const chosen=directions.filter(d=>d.input.checked).map(d=>d.value);
          if(!chosen.length){card.append(node('p','Choose at least one question direction.','feedback is-error'));return;}
          const selected = ["multiple_choice"];
          if (
            !selected.length ||
            !count.input.reportValidity() ||
            !weak.input.reportValidity()
          )
            return;
          busy = true;
          card.querySelectorAll('.feedback').forEach(n=>n.remove());
          const startButton=card.querySelector('button');
          startButton.disabled=true;
          const pending=node('p','Preparing your quiz…','feedback');pending.setAttribute('role','status');card.append(pending);
          const options={p_count:Number(count.input.value),p_new_percent:Number(weak.input.value),p_directions:chosen,p_new:newWords.input.checked,p_mastered:mastered.input.checked};
          const signature=JSON.stringify(options);
          if(startSignature!==signature){startOp=null;startSignature=signature;}
          startOp ??= crypto.randomUUID();
          try {
            const result = await vocabularyRequest((c) =>
              c.rpc("quiz_plan_start", {
                p_operation: startOp,
                ...options,
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
            const code=String(e?.code||'').replace(/[^A-Za-z0-9_]/g,'').slice(0,20);
            const failure=node('p',e?.code==='57014'?'Quiz preparation took too long. Please try fewer questions and retry.':'Unable to start the quiz. Please retry.','feedback is-error');
            failure.setAttribute('role','alert');if(code)failure.append(content('span',' ('+code+')'));card.append(failure);
          } finally {
            busy = false;
            pending.remove();startButton.disabled=false;
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
  if(typeof q.fresh==='boolean')card.append(node('span',q.fresh?'New in this round':'Previously covered','quiz-word-badge'));
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
      const marker=content('span',String.fromCharCode(65+index)+'. ','mcq-marker');marker.lang='en';marker.dir='ltr';
      const answer=content('span',choice,'mcq-answer');if(q.answer_lang){answer.lang=q.answer_lang;answer.dir=q.answer_lang==='ar'?'rtl':'ltr';}
      btn.replaceChildren(marker,answer);
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
function showCoverage(panel,status){panel.replaceChildren(node('p','Collection coverage','eyebrow'),content('h2',String(status.covered)+' / '+String(status.total)),node('p','Words covered in this round'));const bar=node('progress');bar.max=Math.max(1,status.total);bar.value=status.covered;bar.setAttribute('aria-label',t('Collection coverage'));panel.append(bar,content('p',''+tRound(status.round)),node('p',status.total&&status.covered>=status.total?'Round complete! The next quiz starts a new round.':'Uncovered words come first. Earlier words return for recall.','settings-help'));}
function tRound(round){return t('Round {count}',{count:round});}
async function archiveQuiz(uid,session){await atomic(['meta'],tx=>{const store=tx.objectStore('meta');store.put({key:uid+':archived-quiz:'+session.id,owner:uid,quiz:structuredClone(session)});store.delete(uid+':active-quiz');});}
