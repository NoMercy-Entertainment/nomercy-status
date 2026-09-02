import test from "node:test";
import assert from "node:assert/strict";
import { evictLegacyServiceWorkers, resolveTheme, readStoredTheme, applySummary } from "../assets/status.js";

test("evicts every registered service worker and cache", async () => {
  // Sapper installs a service worker; left alone it serves the OLD page forever.
  let unregistered = 0;
  const deleted = [];
  const nav = { serviceWorker: { getRegistrations: async () => [
    { unregister: async () => { unregistered++; return true; } },
    { unregister: async () => { unregistered++; return true; } },
  ] } };
  const caches = { keys: async () => ["a", "b", "c"], delete: async (k) => { deleted.push(k); return true; } };

  const result = await evictLegacyServiceWorkers(nav, caches);
  assert.equal(unregistered, 2);
  assert.deepEqual(deleted, ["a", "b", "c"]);
  assert.equal(result.unregistered, 2);
  assert.equal(result.cachesDeleted, 3);
});

test("eviction is a no-op where the APIs are absent", async () => {
  const result = await evictLegacyServiceWorkers({}, undefined);
  assert.deepEqual(result, { unregistered: 0, cachesDeleted: 0 });
});

test("dark is the default, stored choice wins over system preference", () => {
  assert.equal(resolveTheme(null, false), "dark");
  assert.equal(resolveTheme(null, true), "light");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("nonsense", false), "dark");
});

test("readStoredTheme survives storage that throws", () => {
  assert.equal(readStoredTheme({ getItem() { throw new Error("denied"); } }), null);
  assert.equal(readStoredTheme({ getItem: () => "light" }), "light");
});

test("applySummary overwrites tag text and class from live data", () => {
  const tag = { className: "tag up", textContent: "up", dataset: { statusFor: "api" } };
  const doc = { querySelectorAll: () => [tag] };
  const updated = applySummary([{ slug: "api", status: "down" }], doc);
  assert.equal(updated, 1);
  assert.equal(tag.textContent, "down");
  assert.equal(tag.className, "tag down");
});

test("applySummary ignores services it has no tag for", () => {
  const doc = { querySelectorAll: () => [] };
  assert.equal(applySummary([{ slug: "ghost", status: "down" }], doc), 0);
});
