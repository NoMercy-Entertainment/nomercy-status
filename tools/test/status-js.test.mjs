import test from "node:test";
import assert from "node:assert/strict";
import {
  evictLegacyServiceWorkers, resolveTheme, readStoredTheme,
  applySummary, applyBanner, worstStatus,
} from "../assets/status.js";

/** Minimal stand-in for the parts of the DOM applySummary/applyBanner touch. */
const fakeDoc = ({ tags = [], banner = null } = {}) => ({
  querySelectorAll: () => tags,
  querySelector: (selector) => (selector === "[data-overall-banner]" ? banner : null),
});

const fakeBanner = (className = "banner") => ({
  className,
  textContent: "All systems operational",
  dataset: { labelOk: "All systems operational", labelIncidents: "Ongoing Incidents" },
});

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
  // The four combinations the served page must honour:
  assert.equal(resolveTheme(null, false), "dark");   // no stored, no preference
  assert.equal(resolveTheme(null, true), "light");   // no stored, prefers light
  assert.equal(resolveTheme("dark", true), "dark");  // stored dark, prefers light
  assert.equal(resolveTheme("light", false), "light"); // stored light, no preference
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

test("worstStatus applies worst-status-wins, unknown counting as down", () => {
  assert.equal(worstStatus([{ status: "up" }, { status: "up" }]), "up");
  assert.equal(worstStatus([{ status: "up" }, { status: "degraded" }]), "degraded");
  assert.equal(worstStatus([{ status: "degraded" }, { status: "down" }]), "down");
  assert.equal(worstStatus([{ status: "up" }, { status: "whoknows" }]), "down");
  assert.equal(worstStatus([]), "up");
});

test("the banner is repainted from live data, not left claiming all-clear", () => {
  // The single worst failure a status page can have: "All systems operational"
  // sitting directly above a card that live data has just repainted as `down`.
  const banner = fakeBanner();
  applyBanner([{ slug: "api", name: "API", status: "down" }, { slug: "cdn", name: "CDN", status: "up" }],
    fakeDoc({ banner }));
  assert.equal(banner.className, "banner is-down");
  assert.equal(banner.textContent, "Ongoing Incidents: API");
});

test("a degraded-only summary paints the banner degraded, not down", () => {
  const banner = fakeBanner();
  applyBanner([{ slug: "api", name: "API", status: "degraded" }], fakeDoc({ banner }));
  assert.equal(banner.className, "banner is-degraded");
  assert.equal(banner.textContent, "Ongoing Incidents: API");
});

test("recovery clears the banner back to all-clear", () => {
  const banner = fakeBanner("banner is-down");
  banner.textContent = "Ongoing Incidents: API";
  applyBanner([{ slug: "api", name: "API", status: "up" }], fakeDoc({ banner }));
  assert.equal(banner.className, "banner");
  assert.equal(banner.textContent, "All systems operational");
});

test("applySummary updates the banner alongside the tags", () => {
  const tag = { className: "tag up", textContent: "up", dataset: { statusFor: "api" } };
  const banner = fakeBanner();
  const updated = applySummary([{ slug: "api", name: "API", status: "down" }], fakeDoc({ tags: [tag], banner }));
  assert.equal(updated, 1);
  assert.equal(tag.className, "tag down");
  assert.equal(banner.className, "banner is-down");
});

test("applyBanner is a no-op on pages without a banner (detail pages)", () => {
  assert.equal(applyBanner([{ slug: "api", status: "down" }], fakeDoc()), false);
  // ...and applySummary must not throw on a document with no querySelector at all.
  assert.equal(applySummary([{ slug: "api", status: "down" }], { querySelectorAll: () => [] }), 0);
});

test("banner text is set as text, never as markup", () => {
  const banner = fakeBanner();
  applyBanner([{ slug: "x", name: "<img src=x onerror=alert(1)>", status: "down" }], fakeDoc({ banner }));
  assert.equal(banner.textContent, "Ongoing Incidents: <img src=x onerror=alert(1)>");
  assert.equal(banner.innerHTML, undefined, "innerHTML must never be assigned");
});

test("a rejecting unregister() does not abort the remaining registrations", async () => {
  const unregisteredOrder = [];
  const nav = { serviceWorker: { getRegistrations: async () => [
    { unregister: async () => { unregisteredOrder.push(1); return true; } },
    { unregister: async () => { throw new Error("boom"); } },
    { unregister: async () => { unregisteredOrder.push(3); return true; } },
  ] } };

  const result = await evictLegacyServiceWorkers(nav, undefined);
  assert.deepEqual(unregisteredOrder, [1, 3]);
  assert.equal(result.unregistered, 2);
});

test("a rejecting cache delete() does not abort the remaining keys", async () => {
  const deletedOrder = [];
  const caches = { keys: async () => ["a", "b", "c"], delete: async (k) => {
    if (k === "b") throw new Error("boom");
    deletedOrder.push(k);
    return true;
  } };

  const result = await evictLegacyServiceWorkers({}, caches);
  assert.deepEqual(deletedOrder, ["a", "c"]);
  assert.equal(result.cachesDeleted, 2);
});
