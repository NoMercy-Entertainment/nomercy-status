const SUMMARY_URL =
  "https://raw.githubusercontent.com/NoMercy-Entertainment/nomercy-status/HEAD/history/summary.json";

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
      for (const registration of await nav.serviceWorker.getRegistrations()) {
        await registration.unregister();
        unregistered++;
      }
    }
  } catch { /* nothing useful to do */ }

  try {
    if (cacheStore?.keys) {
      for (const key of await cacheStore.keys()) {
        await cacheStore.delete(key);
        cachesDeleted++;
      }
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

export function applySummary(summary, doc) {
  const bySlug = new Map(summary.map((entry) => [entry.slug, entry.status]));
  let updated = 0;
  for (const tag of doc.querySelectorAll("[data-status-for]")) {
    const status = bySlug.get(tag.dataset.statusFor);
    if (!status) continue;
    tag.textContent = status;
    tag.className = `tag ${status}`;
    updated++;
  }
  return updated;
}

if (typeof document !== "undefined") {
  const root = document.documentElement;

  const prefersLight =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
  root.dataset.theme = resolveTheme(readStoredTheme(globalThis.localStorage), prefersLight);

  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    button.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      writeStoredTheme(globalThis.localStorage, next);
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
