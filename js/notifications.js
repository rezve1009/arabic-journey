import { getAccount, loadAccount } from "./supabase.js";
import { vocabularyRequest } from "./vocabulary-data.js";
import { node, action, field, finish, message } from "./learning-ui.js";
function keyBytes(key) {
  return Uint8Array.from(
    atob(
      key.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat((4 - (key.length % 4)) % 4),
    ),
    (c) => c.charCodeAt(0),
  );
}
export function notificationSettings() {
  const section = node("section", "", "card settings-card learning-page");
  section.id = "notifications-section";
  section.append(node("h2", "Notifications"));
  if (!getAccount().user) return section;
  const prefs = { ...getAccount().settings.notification_preferences },
    morning = field("Morning reminder", "time", prefs.morning),
    evening = field("Evening reminder", "time", prefs.evening),
    review = field("Review reminder", "checkbox"),
    quiz = field("Quiz reminder", "checkbox");
  review.input.checked = prefs.review;
  quiz.input.checked = prefs.quiz;
  section.append(
    morning.wrap,
    evening.wrap,
    review.wrap,
    quiz.wrap,
    node(
      "p",
      "Reminders use your account timezone. Delivery depends on browser and device support.",
    ),
  );
  const save = async (enabled) => {
    prefs.morning = morning.input.value;
    prefs.evening = evening.input.value;
    prefs.review = review.input.checked;
    prefs.quiz = quiz.input.checked;
    prefs.enabled = enabled;
    let subscription = null;
    if (enabled) {
      const configurations = await vocabularyRequest((c) =>
        c.from("push_configuration").select("*").eq("id", true),
      );
      const config = configurations[0] || {};
      if (!config.enabled) throw new Error("server_not_ready");
      if (!("PushManager" in window)) throw new Error("push_not_supported");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("permission_denied");
      const registration = await navigator.serviceWorker.ready;
      subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(config.public_key),
        }));
    }
    await vocabularyRequest((c) =>
      c.rpc("push_save", {
        p_subscription: subscription?.toJSON() || null,
        p_enabled: enabled,
        p_preferences: prefs,
      }),
    );
    await loadAccount();
  };
  section.append(
    action("Enable Notifications", async () => {
      try {
        await save(true);
      } catch (e) {
        section.append(
          node(
            "p",
            e.message === "server_not_ready"
              ? "Notification server is not configured yet."
              : e.message === "permission_denied"
                ? "Notifications are blocked. You can change permission in browser settings."
                : "Notifications could not be enabled. Check browser support and connection.",
            "feedback is-error",
          ),
        );
      }
    }),
    action("Disable Notifications", async () => {
      try {
        await save(false);
      } catch (e) {
        message(section, e);
      }
    }),
  );
  return finish(section);
}
