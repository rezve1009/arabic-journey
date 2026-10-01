import { vocabularyRequest } from "./vocabulary-data.js";
import { getAccount } from "./supabase.js";
import {
  node,
  content,
  action,
  shell,
  ready,
  finish,
  message,
  field,
} from "./learning-ui.js";
export function streaks(calendar, today, minimum = 1) {
  const dates = calendar
    .filter((d) => d.n >= minimum)
    .map((d) => d.study_day)
    .sort();
  let longest = 0,
    run = 0,
    prior = null;
  for (const day of dates) {
    run = prior && new Date(day) - new Date(prior) === 86400000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prior = day;
  }
  let current = 0,
    day = today;
  const set = new Set(dates);
  if (!set.has(day))
    day = new Date(new Date(day).getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
  while (set.has(day)) {
    current++;
    day = new Date(new Date(day).getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
  }
  return { current, longest, days: dates.length };
}
export const statisticsData = () =>
  vocabularyRequest((c) => c.rpc("learning_statistics"));
export function statisticsPage(route) {
  const page = shell(route.title);
  if (!ready(page)) return finish(page);
  const card = node("section", "", "card");
  page.append(card);
  if (route.id === "history") {
    const from = field("From date", "date"),
      to = field("To date", "date");
    let index = 0;
    const load = async () => {
      card.replaceChildren(node("p", "Loading…"));
      try {
        const data = await vocabularyRequest((c) =>
          c.rpc("learning_history", {
            p_from: from.input.value || null,
            p_to: to.input.value || null,
            p_page: index,
          }),
        );
        if (!page.isConnected) return;
        card.replaceChildren();
        for (const e of data.events) {
          const row = node("article", "", "history-row");
          row.append(
            content("h3", e.arabic_word, "arabic"),
            content(
              "p",
              new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: getAccount().settings.timezone,
              }).format(new Date(e.event_at)),
            ),
            node("p", e.kind),
            node("p", e.result),
          );
          if (e.new_interval)
            row.append(
              content(
                "p",
                e.prior_interval +
                  "d → " +
                  e.new_interval +
                  "d · " +
                  new Date(e.next_review_at).toLocaleString(),
              ),
            );
          card.append(row);
        }
        if (!data.events.length) card.append(node("p", "No activity yet."));
        const prev = action("Previous", () => {
            index--;
            load();
          }),
          next = action("Next", () => {
            index++;
            load();
          });
        prev.disabled = index === 0;
        next.disabled = (index + 1) * 25 >= data.total;
        card.append(prev, next);
        finish(page);
      } catch (e) {
        message(card, e);
      }
    };
    page.querySelector(".page-heading").append(
      from.wrap,
      to.wrap,
      action("Apply filters", () => {
        index = 0;
        load();
      }),
    );
    queueMicrotask(load);
  } else
    queueMicrotask(async () => {
      try {
        const data = await statisticsData();
        if (!page.isConnected) return;
        const streak = streaks(
            data.calendar,
            data.today,
            data.goals.minimum_activity || 1,
          ),
          grid = node("div", "", "stats-grid");
        for (const [key, label] of Object.entries({
          total: "Total Vocabulary",
          week: "Added This Week",
          month: "Added This Month",
          reviewed_today: "Reviewed today",
          due: "Words due",
          mastered: "Mastered",
          weak: "Weak words",
          favorites: "Favorites",
          accuracy: "Overall Accuracy",
          accuracy7: "7-day Accuracy",
          accuracy30: "30-day Accuracy",
          quiz_accuracy: "Quiz Accuracy",
          total_reviews: "Total Reviews",
        })) {
          const cell = node("article", "", "metric");
          cell.append(node("p", label), content("strong", data[key] ?? "—"));
          grid.append(cell);
        }
        for (const [key, label] of Object.entries({
          current: "Current Streak",
          longest: "Longest streak",
          days: "Days studied",
        })) {
          const cell = node("article", "", "metric");
          cell.append(node("p", label), content("strong", streak[key]));
          grid.append(cell);
        }
        card.append(grid, node("h2", "Activity calendar"));
        const calendar = node("div", "", "activity-calendar");
        const map = new Map(data.calendar.map((d) => [d.study_day, d.n]));
        for (let i = 364; i >= 0; i--) {
          const day = new Date(new Date(data.today).getTime() - i * 86400000)
              .toISOString()
              .slice(0, 10),
            n = map.get(day) || 0,
            cell = node("span", "", "activity-day");
          cell.style.opacity = n ? String(Math.min(1, 0.35 + n / 20)) : ".1";
          cell.title = day + ": " + n;
          cell.setAttribute("aria-label", cell.title);
          calendar.append(cell);
        }
        card.append(calendar);
        finish(page);
      } catch (e) {
        message(card, e);
      }
    });
  return finish(page);
}
