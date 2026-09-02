const SUMMARY_URL =
  "https://raw.githubusercontent.com/NoMercy-Entertainment/nomercy-status/HEAD/history/summary.json";

const RANK = { up: 0, degraded: 1, down: 2 };

/**
 * Upptime's Sapper build registers a service worker. Returning visitors have it
 * cached and it will keep serving the OLD index.html over this page, so evict
 * it before anything else.
 */
export async function evictLegacyServiceWorkers(nav, cacheStore) {
  let unregistered = 0;
  let cachesDeleted = 0;

  try {
    if (nav?.serviceWorker?.getRegistrations) {
      const registrations = await nav.serviceWorker.getRegistrations();
      const results = await Promise.allSettled(
        registrations.map((registration) => registration.unregister())
      );
      unregistered += results.filter((r) => r.status === "fulfilled").length;
    }
  } catch { /* nothing useful to do */ }

  try {
    if (cacheStore?.keys) {
      const keys = await cacheStore.keys();
      const results = await Promise.allSettled(keys.map((key) => cacheStore.delete(key)));
      cachesDeleted += results.filter((r) => r.status === "fulfilled").length;
    }
  } catch { /* nothing useful to do */ }

  return { unregistered, cachesDeleted };
}

export function resolveTheme(stored, prefersLight) {
  if (stored === "dark" || stored === "light") return stored;
  return prefersLight ? "light" : "dark";
}

export function readStoredTheme(storage) {
  try {
    return storage?.getItem("nm-status-theme") ?? null;
  } catch {
    return null; // localStorage throws outright in some privacy modes
  }
}

export function writeStoredTheme(storage, theme) {
  try {
    storage?.setItem("nm-status-theme", theme);
  } catch { /* preference simply will not persist */ }
}

/** An unrecognised status degrades to the worst case, never to "up". */
export function normaliseStatus(status) {
  return status === "up" || status === "degraded" || status === "down" ? status : "down";
}

/** Worst-status-wins, matching the generator's rule exactly. */
export function worstStatus(entries) {
  let worst = "up";
  for (const entry of entries) {
    const status = normaliseStatus(entry.status);
    if (RANK[status] > RANK[worst]) worst = status;
  }
  return worst;
}

/**
 * The headline banner is baked in at build time. Without this it would keep
 * claiming "All systems operational" directly above a card that live data has
 * just repainted as `down`, which is the worst thing a status page can do.
 */
export function applyBanner(summary, doc) {
  const banner = doc.querySelector?.("[data-overall-banner]");
  if (!banner) return false;

  const worst = worstStatus(summary);
  const okLabel = banner.dataset?.labelOk || "All systems operational";
  const incidentLabel = banner.dataset?.labelIncidents || "Ongoing Incidents";
  const failing = summary.filter((entry) => normaliseStatus(entry.status) !== "up");

  banner.textContent =
    worst === "up"
      ? okLabel
      : `${incidentLabel}: ${failing.map((entry) => entry.name ?? entry.slug).join(", ")}`;
  banner.className =
    worst === "up" ? "banner" : worst === "down" ? "banner is-down" : "banner is-degraded";
  return true;
}

export function applySummary(summary, doc) {
  // The payload is fetched from a remote file. If it is ever not an array, keep
  // the build-time values rather than throwing: a stale-but-correct page beats a
  // blank one, and this is exactly when someone is trying to read it.
  if (!Array.isArray(summary)) return 0;

  const bySlug = new Map(summary.map((entry) => [entry.slug, entry.status]));
  let updated = 0;
  for (const tag of doc.querySelectorAll("[data-status-for]")) {
    const status = bySlug.get(tag.dataset.statusFor);
    if (!status) continue;
    tag.textContent = status;
    tag.className = `tag ${status}`;
    updated++;
  }
  applyBanner(summary, doc);
  return updated;
}

if (typeof document !== "undefined") {
  const root = document.documentElement;

  const prefersLight = () =>
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;

  // Only an EXPLICIT stored choice is stamped onto <html>. With nothing stored the
  // stylesheet decides: dark on bare :root, light under prefers-color-scheme: light.
  // Stamping unconditionally would make that media query unreachable.
  const stored = readStoredTheme(globalThis.localStorage);
  if (stored === "dark" || stored === "light") root.dataset.theme = stored;

  const toggles = document.querySelectorAll("[data-theme-toggle]");

  // aria-pressed has to track the real state, or a screen reader announces the
  // opposite of what is on screen -- worse than having no state at all.
  const syncPressed = () => {
    const isDark = resolveTheme(root.dataset.theme ?? null, prefersLight()) === "dark";
    for (const button of toggles) button.setAttribute("aria-pressed", String(isDark));
  };
  syncPressed();

  for (const button of toggles) {
    button.addEventListener("click", () => {
      const current = resolveTheme(root.dataset.theme ?? null, prefersLight());
      const next = current === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      writeStoredTheme(globalThis.localStorage, next);
      syncPressed();
    });
  }

  evictLegacyServiceWorkers(navigator, globalThis.caches);

  // The bars are baked in at build time; current status is fetched live.
  // On failure the page keeps the build-time values rather than showing nothing.
  fetch(SUMMARY_URL, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((summary) => applySummary(summary, document))
    .catch(() => { /* build-time values stand */ });
}
