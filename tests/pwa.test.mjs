import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
test("PWA scope, static-only caching, safe updates and grouped notification click", async () => {
  const code = await readFile("service-worker.js", "utf8"),
    handlers = {};
  const fake = {
    registration: { scope: "https://example.test/arabic-journey/" },
    clients: {},
    addEventListener: (event, fn) => (handlers[event] = fn),
  };
  const context = {
    self: fake,
    URL,
    caches: {
      match: async () => ({ cached: true }),
      open: async () => ({
        addAll: async (assets) => {
          assert(assets.includes("./js/sync.js"));
          assert(assets.includes("./icons/icon-512.png"));
          assert(!assets.some((a) => a.includes("supabase/migrations")));
        },
      }),
    },
    fetch: async () => ({ network: true }),
  };
  vm.runInNewContext(code, context);
  let pending;
  handlers.install({ waitUntil: (p) => (pending = p) });
  await pending;
  let handled = false;
  const event = (url, mode = "cors") => ({
    request: { method: "GET", url, mode },
    respondWith: (p) => {
      handled = true;
      pending = p;
    },
  });
  handlers.fetch(event("https://project.supabase.co/rest/v1/words"));
  assert(!handled);
  handlers.fetch(event("https://example.test/other-site/index.html"));
  assert(!handled);
  handlers.fetch(event("https://example.test/arabic-journey/js/app.js"));
  assert(handled);
  assert((await pending).cached);
  let skipped = false;
  fake.skipWaiting = () => (skipped = true);
  handlers.message({ data: { type: "unrelated" } });
  assert(!skipped);
  handlers.message({ data: { type: "APPLY_UPDATE" } });
  assert(skipped);
  const manifest = JSON.parse(await readFile("manifest.webmanifest", "utf8"));
  assert.equal(manifest.scope, "./");
  assert(manifest.icons.some((i) => i.sizes === "192x192"));
  assert(manifest.icons.some((i) => i.sizes === "512x512"));
});
