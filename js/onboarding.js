import { getAccount, loadAccount } from "./supabase.js";
import { vocabularyRequest } from "./vocabulary-data.js";
import { node, link, action, finish, message } from "./learning-ui.js";
export function onboarding() {
  const a = getAccount();
  if (a.status !== "ready" || a.settings.onboarding_progress?.complete)
    return null;
  const card = node("section", "", "card onboarding");
  card.append(
    node("h2", "Welcome to Arabic Journey"),
    node("p", "Set up your learning routine. Notifications are optional."),
  );
  const steps = node("ol");
  for (const [label, href] of [
    ["Choose Revision Schedule", "#/settings?section=schedule"],
    ["Choose Reminder Time", "#/settings?section=notifications"],
    ["Enable Notifications", "#/settings?section=notifications"],
    ["Add First Word", "#/add-word"],
  ]) {
    const row = node("li");
    row.append(link(label, href));
    steps.append(row);
  }
  card.append(
    steps,
    action("Finish setup", async () => {
      try {
        await vocabularyRequest((c) => c.rpc("complete_onboarding"));
        await loadAccount();
      } catch (e) {
        message(card, e);
      }
    }),
  );
  return finish(card);
}
