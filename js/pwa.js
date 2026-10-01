import { pendingOperations } from "./sync.js";
import { node, action, finish } from "./learning-ui.js";
let installPrompt, registration;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  window.dispatchEvent(new Event("pwa-ready"));
});
export async function initializePwa() {
  if (!("serviceWorker" in navigator)) return;
  registration = await navigator.serviceWorker.register(
    new URL("../service-worker.js", import.meta.url),
    { scope: new URL("../", import.meta.url).pathname },
  );
  const updated = () => window.dispatchEvent(new Event("pwa-ready"));
  registration.addEventListener("updatefound", () =>
    registration.installing?.addEventListener("statechange", updated),
  );
  navigator.serviceWorker.addEventListener("controllerchange", () =>
    window.dispatchEvent(new Event("pwa-ready")),
  );
  return registration;
}
export function pwaSettings() {
  const section = node("section", "", "card settings-card");
  section.append(node("h2", "Install Arabic Journey"));
  if (installPrompt)
    section.append(
      action("Install app", async () => {
        await installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        window.dispatchEvent(new Event("pwa-ready"));
      }),
    );
  else
    section.append(
      node(
        "p",
        "Use your browser menu to install. On iPhone: Share → Add to Home Screen.",
      ),
    );
  if (registration?.waiting)
    section.append(
      action("Update app", async () => {
        if ((await pendingOperations()).length) {
          section.append(node("p", "Sync pending changes before updating."));
          return;
        }
        registration.waiting.postMessage({ type: "APPLY_UPDATE" });
        section.append(action("Reload app", () => location.reload()));
      }),
    );
  return finish(section);
}
