import { vocabularyRequest } from "./vocabulary-data.js";
import {
  node,
  content,
  action,
  link,
  shell,
  ready,
  finish,
  message,
} from "./learning-ui.js";
export function progressPage(route) {
  const page = shell(route.title);
  if (!ready(page)) return finish(page);
  const card = node("section", "", "card study-card"),
    sort = node("select");
  sort.setAttribute("aria-label", "Sort words");
  for (const [value, label] of [
    ["difficult", "Most Difficult"],
    ["mistakes", "Most Mistakes"],
    ["accuracy", "Lowest Accuracy"],
    ["recent", "Recently Failed"],
  ])
    sort.append(Object.assign(node("option", label), { value }));
  page.append(sort, card);
  let index = 0;
  async function load() {
    card.replaceChildren(node("p", "Loading…"));
    try {
      const result = await vocabularyRequest((c) =>
        c.rpc("progress_words", {
          p_kind: route.id === "mastered" ? "mastered" : "weak",
          p_sort: sort.value,
          p_page: index,
        }),
      );
      if (!page.isConnected) return;
      card.replaceChildren();
      if (!result.words.length)
        card.append(
          node(
            "p",
            route.id === "mastered"
              ? "Keep learning. Mastered words will appear here."
              : "No difficult words detected yet.",
          ),
        );
      for (const w of result.words) {
        const row = node("div", "", "progress-word"),
          ar = content("h2", w.arabic_word, "arabic");
        ar.lang = "ar";
        ar.dir = "rtl";
        row.append(
          ar,
          content("p", w.bangla_meaning + " · " + w.english_meaning),
          content(
            "p",
            w.weak_score +
              " · " +
              Math.round(
                ((w.correct_count + w.quiz_correct) * 100) /
                  Math.max(1, w.review_count + w.quiz_count),
              ) +
              "%",
          ),
          link("View details", "#/vocabulary?word=" + w.id),
        );
        card.append(row);
      }
      const prev = action("Previous", () => {
        index--;
        load();
      });
      prev.disabled = index === 0;
      const next = action("Next", () => {
        index++;
        load();
      });
      next.disabled = (index + 1) * 25 >= result.total;
      card.append(
        prev,
        content(
          "span",
          index + 1 + " / " + Math.max(1, Math.ceil(result.total / 25)),
        ),
        next,
      );
      if (route.id === "weak-words")
        card.append(link("Review Weak Words", "#/review?practice=weak"));
      finish(page);
    } catch (e) {
      card.replaceChildren(action("Retry", load));
      message(card, e);
    }
  }
  sort.addEventListener("change", () => {
    index = 0;
    load();
  });
  queueMicrotask(load);
  return finish(page);
}
