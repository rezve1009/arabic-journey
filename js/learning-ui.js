import { t, translate } from "./i18n.js";
import { getAccount } from "./supabase.js";
export function node(tag, text = "", className = "") {
  const n = document.createElement(tag);
  n.className = className;
  if (text) n.textContent = t(text);
  return n;
}
export function content(tag, text = "", className = "") {
  const n = node(tag, "", className);
  n.textContent = String(text ?? "");
  n.dataset.noTranslate = "";
  return n;
}
export function action(label, work, primary = false) {
  const n = node(
    "button",
    label,
    "button " + (primary ? "button-primary" : "button-secondary"),
  );
  n.type = "button";
  n.addEventListener("click", work);
  return n;
}
export function link(label, href) {
  const n = node("a", label, "button button-secondary");
  n.href = href;
  return n;
}
export function field(label, type = "text", value = "") {
  const wrap = node("label"),
    input = node("input");
  wrap.append(node("span", label));
  input.type = type;
  input.value = value ?? "";
  wrap.append(input);
  return { wrap, input };
}
export function shell(title) {
  const page = node("div", "", "page learning-page"),
    head = node("div", "", "page-heading");
  head.append(node("h1", title));
  page.append(head);
  return page;
}
export function ready(page) {
  if (getAccount().user && ["ready", "offline"].includes(getAccount().status))
    return true;
  page.append(node("p", "Sign in to continue."), link("Sign in", "#/login"));
  return false;
}
export function message(parent, error) {
  const n = node(
    "p",
    error?.code === "40001"
      ? "This item changed on another device. Reload to continue."
      : "Unable to finish. Your work is kept; please retry.",
    "feedback is-error",
  );
  n.setAttribute("role", "alert");
  parent.append(n);
}
export function finish(page) {
  translate(page);
  return page;
}
export function audio(text) {
  const button = action("🔊", () => {
    const voice = speechSynthesis
      .getVoices()
      .find((v) => v.lang.startsWith("ar"));
    if (!voice) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
  const refresh = () => {
    button.disabled = !speechSynthesis
      .getVoices()
      .some((v) => v.lang.startsWith("ar"));
    button.title = t(
      button.disabled
        ? "Arabic voice is unavailable on this device."
        : "Listen to Arabic",
    );
  };
  button.setAttribute("aria-label", t("Listen to Arabic"));
  refresh();
  speechSynthesis.addEventListener("voiceschanged", refresh, { once: true });
  return button;
}
