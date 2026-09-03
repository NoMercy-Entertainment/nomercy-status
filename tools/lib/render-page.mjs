import { escapeHtml } from "./html.mjs";
import { summarise } from "./classify-days.mjs";
import { normaliseStatus, rankOf } from "./status-rank.mjs";

// Re-exported so importers keep one obvious entry point, while the definition
// itself lives in one place shared with the day classifier.
export { normaliseStatus };


const DAY_LABEL = {
  up: "operational",
  degraded: "degraded performance",
  down: "outage",
  nodata: "no monitoring data",
};

const BANNER_I18N = {
  allSystemsOperational: "All systems operational",
  activeIncidents: "Ongoing Incidents",
};

const dayLabel = (status) => DAY_LABEL[status] ?? "unknown status";

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;


export function overallStatus(services) {
  let worst = "up";
  for (const service of services) {
    const status = normaliseStatus(service.status);
    if (rankOf(status) > rankOf(worst)) worst = status;
  }
  return worst;
}

/**
 * The percentage is computed over OBSERVED days only, so the label must never
 * present it as if it covered the whole window. When days are missing it states
 * its own denominator instead.
 */
export function uptimeLabel(stats) {
  if (stats.uptimePct === null) return "No monitoring data";
  const pct = `${stats.uptimePct.toFixed(2)}%`;
  if (stats.nodataDays === 0) return `${pct} uptime`;
  return `${pct} of ${plural(stats.observedDays, "day")} observed`;
}

/**
 * `role="img"` hides the per-day elements from assistive tech, so the label has to
 * carry the information the colours carry. Counts, not just "daily status".
 */
export function barLabel(days) {
  const counts = new Map();
  for (const day of days) {
    const label = dayLabel(day.status);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const ordered = ["operational", "degraded performance", "outage", "no monitoring data", "unknown status"];
  const parts = [];
  for (const label of ordered) if (counts.has(label)) parts.push(`${plural(counts.get(label), "day")} ${label}`);
  return `Daily status for the last ${days.length} days: ${parts.join(", ")}`;
}

export function renderBar(days) {
  return `<div class="bar" role="img" aria-label="${escapeHtml(barLabel(days))}">${days
    .map((day) => {
      const detail = day.checks
        ? `${day.checks} check${day.checks === 1 ? "" : "s"}`
        : dayLabel(day.status);
      return `<i class="bar-day ${escapeHtml(day.status)}" title="${escapeHtml(day.date)} — ${escapeHtml(
        dayLabel(day.status)
      )}${day.checks ? ` (${escapeHtml(detail)})` : ""}"></i>`;
    })
    .join("")}</div>`;
}

function layout({ title, description, body, extraHead = "" }) {
  // No `data-theme` here on purpose. Baking one in makes the stylesheet's
  // `prefers-color-scheme` branch unreachable, so light-preference readers get dark
  // with JS off and a dark->light flash with JS on. The CSS owns the default (dark);
  // status.js stamps an attribute only for an explicitly stored choice.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" href="https://cdn.nomercy.tv/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/status.css">
${extraHead}</head>
<body>
<div class="wrap">
${body}
</div>
<script type="module" src="/status.js"></script>
</body>
</html>
`;
}

function topbar(active) {
  return `<div class="topbar">
  <strong>NoMercy Status</strong>
  <span>
    ${active === "index" ? "" : '<a href="/">← All services</a> '}
    <a href="https://nomercy.tv">Homepage</a>
    <button class="theme-toggle" type="button" data-theme-toggle aria-pressed="false">Theme</button>
  </span>
</div>`;
}

function legend() {
  return `<div class="legend">
  <span><i style="background:var(--up-solid)"></i>Operational</span>
  <span><i style="background:var(--degraded-solid)"></i>Degraded</span>
  <span><i style="background:var(--down-solid)"></i>Outage</span>
  <span><i style="background:var(--nodata)"></i>No monitoring data</span>
</div>`;
}

/** Grey has to be explained wherever it is drawn, not only on the landing page. */
function nodataNote(days) {
  if (!days.some((day) => day.status === "nodata")) return "";
  return `<p class="note">Grey segments are days with no monitoring data — the checks were not running, so uptime is unknown for that period rather than assumed good.</p>`;
}

function card(service) {
  const stats = summarise(service.days);
  // summary.json's `time` is the ALL-TIME mean, not a current reading. Labelling
  // it "Response time" invites the reader to take it as how the service is
  // performing right now.
  const responseTime =
    service.time == null
      ? ""
      : `\n  <p class="card-meta">All-time avg <b>${escapeHtml(String(service.time))} ms</b></p>`;
  return `<div class="card">
  <div class="card-head">
    <h2><a href="/history/${escapeHtml(service.slug)}/">${escapeHtml(service.name)}</a></h2>
    <span class="tag ${escapeHtml(service.status)}" data-status-for="${escapeHtml(service.slug)}">${escapeHtml(
    service.status
  )}</span>
  </div>${responseTime}
  ${renderBar(service.days)}
  <div class="bar-legend">
    <span>${escapeHtml(service.days[0]?.date ?? "")}</span>
    <span>${escapeHtml(uptimeLabel(stats))}</span>
    <span>${escapeHtml(service.days.at(-1)?.date ?? "")}</span>
  </div>
</div>`;
}

/**
 * Every candidate hero ships inline and one is revealed at random per load.
 *
 * Two constraints shape this. The build must stay byte-identical across runs
 * (the daily job commits only when the output changed), so the randomness has
 * to live in the browser, not here. And the swap must happen before first
 * paint, or the reader sees the default hero flash and change under them --
 * hence a synchronous inline script rather than the deferred module.
 *
 * With scripting unavailable the first hero simply stands.
 */
function heroBlock(heroes) {
  if (!heroes?.length) return "";

  const slots = heroes
    .map((svg, index) => `  <div class="hero-art"${index === 0 ? "" : " hidden"}>${svg}</div>`)
    .join("\n");

  if (heroes.length < 2) return `<div class="hero">\n${slots}\n</div>`;

  return `<div class="hero" data-hero-rotator>
${slots}
</div>
<script>
(function () {
  var slots = document.currentScript.previousElementSibling.children;
  var pick = Math.floor(Math.random() * slots.length);
  for (var i = 0; i < slots.length; i++) slots[i].hidden = i !== pick;
})();
</script>`;
}

export function renderIndex({ services, generatedAt, heroes, repoUrl, i18n }) {
  const worst = overallStatus(services);
  const failing = services.filter((s) => normaliseStatus(s.status) !== "up");
  const bannerClass = worst === "up" ? "" : worst === "down" ? " is-down" : " is-degraded";
  const okLabel = i18n?.allSystemsOperational ?? BANNER_I18N.allSystemsOperational;
  const incidentLabel = i18n?.activeIncidents ?? BANNER_I18N.activeIncidents;
  const bannerText =
    worst === "up" ? okLabel : `${incidentLabel}: ${failing.map((s) => s.name).join(", ")}`;

  const note = nodataNote(services.flatMap((s) => s.days));

  return layout({
    title: "NoMercy Status",
    description: `Live availability for ${services.length} NoMercy services, with 90 days of history.`,
    body: `${topbar("index")}
${heroBlock(heroes)}
<div class="banner${bannerClass}" data-overall-banner data-label-ok="${escapeHtml(
      okLabel
    )}" data-label-incidents="${escapeHtml(incidentLabel)}">${escapeHtml(bannerText)}</div>
<h1>Current status</h1>
<div class="card-grid">
${services.map(card).join("\n")}
</div>
${legend()}
${note}
<footer>
  Data as of <time datetime="${generatedAt.toISOString()}">${generatedAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 16)} UTC</time> ·
  <a href="${escapeHtml(repoUrl)}/issues?q=label%3Astatus">Incident history</a> ·
  <a href="${escapeHtml(repoUrl)}">Source</a>
</footer>`,
  });
}

export function sparklinePath(days, width = 600, height = 90) {
  const points = days
    .map((day, index) => ({ index, value: day.avgResponseTimeMs }))
    .filter((point) => typeof point.value === "number");
  if (points.length < 2) return "";

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lastIndex = days.length - 1 || 1;
  const pad = 6;
  const usable = height - pad * 2;

  return points
    .map((point, i) => {
      const x = (point.index / lastIndex) * width;
      const y = pad + (1 - (point.value - min) / span) * usable;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function renderDetail({ service, generatedAt, repoUrl }) {
  const stats = summarise(service.days);
  const path = sparklinePath(service.days);

  const windows = [
    ["24 hours", service.uptimeDay, service.timeDay],
    ["7 days", service.uptimeWeek, service.timeWeek],
    ["30 days", service.uptimeMonth, service.timeMonth],
    ["1 year", service.uptimeYear, service.timeYear],
  ];

  return layout({
    title: `${service.name} — NoMercy Status`,
    description: `Availability and response time for ${service.name} over the last ${service.days.length} days.`,
    body: `${topbar("detail")}
<h1>${escapeHtml(service.name)}</h1>
<p><a href="${escapeHtml(service.url)}">${escapeHtml(service.url)}</a> ·
   <span class="tag ${escapeHtml(service.status)}" data-status-for="${escapeHtml(
      service.slug
    )}">${escapeHtml(service.status)}</span></p>

<div class="stats">
${windows
  .map(
    ([label, uptime, time]) => `  <div class="stat">
    <b>${escapeHtml(uptime ?? "—")}</b>
    <span>${escapeHtml(label)}${time == null ? "" : ` · ${escapeHtml(String(time))} ms`}</span>
  </div>`
  )
  .join("\n")}
</div>

<h2>Last ${service.days.length} days</h2>
${renderBar(service.days)}
<div class="bar-legend">
  <span>${escapeHtml(service.days[0]?.date ?? "")}</span>
  <span>${escapeHtml(uptimeLabel(stats))}</span>
  <span>${escapeHtml(service.days.at(-1)?.date ?? "")}</span>
</div>
${legend()}
${nodataNote(service.days)}

<h2>Response time</h2>
${
  path
    ? `<svg class="sparkline" viewBox="0 0 600 90" preserveAspectRatio="none" role="img" aria-label="Daily mean response time"><path d="${path}"/></svg>`
    : `<p class="note">Not enough response-time data to plot yet.</p>`
}

<footer>
  Data as of <time datetime="${generatedAt.toISOString()}">${generatedAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 16)} UTC</time> ·
  <a href="${escapeHtml(repoUrl)}/issues?q=label%3Astatus">Incident history</a>
</footer>`,
  });
}

export { layout, topbar, legend, nodataNote };
