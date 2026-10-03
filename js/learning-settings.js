import { getAccount, loadAccount } from "./supabase.js";
import { vocabularyRequest } from "./vocabulary-data.js";
import { pendingOperations, resolveConflict, synchronize } from "./sync.js";
import { quizTypes } from "./quiz.js";
import {
  node,
  content,
  action,
  field,
  finish,
  message,
} from "./learning-ui.js";
export function learningSettings() {
  const section = node("section", "", "card settings-card learning-page");
  section.append(node("h2", "Learning preferences"));
  if (!getAccount().user) return section;
  const s = getAccount().settings,
    form = node("form", "", "settings-form");
  const quiz = { ...s.quiz_options },
    mastery = { ...s.mastery_thresholds },
    weights = { low_accuracy: 2, ...s.weak_weights },
    goals = { minimum_activity: 1, ...s.daily_goals };
  const collect = [];
  for (const [group, values, labels] of [
    [
      "Quiz",
      quiz,
      {
        question_count: "Daily question count",
        weak_percentage: "Weak word percentage",
        include_mastered: "Include mastered words",
        include_new: "Include new words",
      },
    ],
    [
      "Mastered",
      mastery,
      {
        successful_reviews: "Successful reviews required",
        accuracy: "Minimum accuracy",
        require_long_term: "Require long-term stage",
      },
    ],
    [
      "Weak scoring",
      weights,
      {
        again: "Again weight",
        hard: "Hard weight",
        quiz_mistake: "Quiz mistake weight",
        slow_ms: "Slow response milliseconds",
        slow: "Slow response weight",
        success: "Successful recall reduction",
        threshold: "Weak word threshold",
      },
    ],
    [
      "Daily Goal",
      goals,
      {
        new_words: "New Words Per Day",
        reviews: "Reviews Per Day",
        quiz_questions: "Quiz Questions Per Day",
        minimum_activity: "Minimum activity for a study day",
      },
    ],
  ]) {
    form.append(node("h3", group));
    for (const [key, label] of Object.entries(labels)) {
      const bool = typeof values[key] === "boolean";
      const f = field(label, bool ? "checkbox" : "number", values[key]);
      if (bool) f.input.checked = values[key];
      else {
        f.input.min = 0;
        f.input.max = key === "slow_ms" ? 1000000 : 1000;
        f.input.step = ["hard", "slow", "success", "threshold"].includes(key)
          ? ".1"
          : "1";
      }
      form.append(f.wrap);
      collect.push(
        () =>
          (values[key] = bool
            ? f.input.checked
            : f.input.value === ""
              ? null
              : Number(f.input.value)),
      );
    }
  }
  form.append(node('p','Only MCQ questions are used. Choose an option to answer.'));
  collect.push(()=>{quiz.types=['multiple_choice'];});
  const submit = node(
    "button",
    "Save learning preferences",
    "button button-primary",
  );
  submit.type = "submit";
  form.append(submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    collect.forEach((fn) => fn());
    try {
      await vocabularyRequest((c) =>
        c.rpc("save_learning_settings", {
          p_revision: s.revision,
          p_quiz: quiz,
          p_mastery: mastery,
          p_weights: weights,
          p_goals: goals,
        }),
      );
      await loadAccount();
    } catch (e) {
      message(form, e);
      submit.disabled = false;
    }
  });
  section.append(form);
  return finish(section);
}
export function syncSettings() {
  const section = node("section", "", "card settings-card learning-page");
  section.append(
    node("h2", "Offline and sync"),
    action("Sync now", async () => {
      await synchronize();
      window.dispatchEvent(new Event("learningrefresh"));
    }),
  );
  queueMicrotask(async () => {
    for (const op of await pendingOperations()) {
      if (!section.isConnected) return;
      const item = node("div", "", "sync-operation");
      item.append(
        node("p", op.conflict ? "Sync conflict" : "Pending change"),
        content("p", op.local?.arabic_word || op.local?.name || op.id),
      );
      if (op.conflict) {
        const row = await vocabularyRequest((c) => {
          let query = c
            .from(op.table)
            .select("*")
            .eq(op.rpc === "fixed_review" ? "word_id" : "id", op.id);
          if (op.rpc === "fixed_review") query = query.eq("algorithm", "fixed");
          return query.single();
        }).catch(() => null);
        const versions = node("div", "", "conflict-versions");
        for (const [label, value] of [
          ["This device", op.local],
          ["Server version", row],
        ]) {
          const group = node("section");
          group.append(node("h3", label));
          for (const key of [
            "arabic_word",
            "bangla_meaning",
            "english_meaning",
            "notes",
            "stage",
            "next_review_at",
          ])
            if (value?.[key]) group.append(content("p", value[key]));
          versions.append(group);
        }
        item.append(versions);
        item.append(
          node("p", "Your local version is kept. Choose which version to use."),
          action("Use server version", async () => {
            try {
              await resolveConflict(op, false);
              item.remove();
            } catch (e) {
              message(item, e);
            }
          }),
          action("Keep local version", async () => {
            try {
              await resolveConflict(op, true);
              item.remove();
            } catch (e) {
              message(item, e);
            }
          }),
        );
      }
      section.append(item);
    }
    finish(section);
  });
  return section;
}
