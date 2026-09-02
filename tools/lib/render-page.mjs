import { escapeHtml } from "./html.mjs";
import { summarise } from "./classify-days.mjs";

const RANK = { up: 0, degraded: 1, down: 2 };

const DAY_LABEL = {
  up: "operational",
  degraded: "degraded performance",
  down: "outage",
  nodata: "no monitoring data",
};

export function overallStatus(services) {
  let worst = "up";
  for (const service of services) {
    if ((RANK[service.status] ?? 0) > RANK[worst]) worst = service.status;
  }
  return worst;
}

export function renderBar(days) {
  return `<div class="bar" role="img" aria-label="Daily status for the last ${days.length} days">${days
    .map((day) => {
      const detail = day.checks
        ? `${day.checks} check${day.checks === 1 ? "" : "s"}`
        : DAY_LABEL[day.status];
      return `<i class="bar-day ${escapeHtml(day.status)}" title="${escapeHtml(day.date)} — ${escapeHtml(
        DAY_LABEL[day.status]
      )}${day.checks ? ` (${escapeHtml(detail)})` : ""}"></i>`;
    })
    .join("")}</div>`;
}

function layout({ title, body, extraHead = "" }) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
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
    <button class="theme-toggle" type="button" data-theme-toggle>Theme</button>
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

function card(service) {
  const stats = summarise(service.days);
  const uptime = stats.uptimePct === null ? "—" : `${stats.uptimePct.toFixed(2)}%`;
  return `<div class="card">
  <div class="card-head">
    <h2><a href="/history/${escapeHtml(service.slug)}/">${escapeHtml(service.name)}</a></h2>
    <span class="tag ${escapeHtml(service.status)}" data-status-for="${escapeHtml(service.slug)}">${escapeHtml(
    service.status
  )}</span>
  </div>
  ${renderBar(service.days)}
  <div class="bar-legend">
    <span>${service.days.length} days ago</span>
    <span>${uptime} uptime</span>
    <span>Today</span>
  </div>
</div>`;
}

export function renderIndex({ services, generatedAt, hero, repoUrl, i18n }) {
  const worst = overallStatus(services);
  const failing = services.filter((s) => s.status !== "up");
  const bannerClass = worst === "up" ? "" : worst === "down" ? " is-down" : " is-degraded";
  const bannerText =
    worst === "up"
      ? i18n.allSystemsOperational
      : `${i18n.activeIncidents}: ${failing.map((s) => s.name).join(", ")}`;

  const missing = services.some((s) => s.days.some((d) => d.status === "nodata"));
  const note = missing
    ? `<p class="note">Grey segments are days with no monitoring data — the checks were not running, so uptime is unknown for that period rather than assumed good.</p>`
    : "";

  return layout({
    title: "NoMercy Status",
    body: `${topbar("index")}
${hero ? `<div class="hero">${hero}</div>` : ""}
<div class="banner${bannerClass}" data-overall-banner>${escapeHtml(bannerText)}</div>
<h1>Current status</h1>
<div class="card-grid">
${services.map(card).join("\n")}
</div>
${legend()}
${note}
<footer>
  Updated <time datetime="${generatedAt.toISOString()}">${generatedAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 16)} UTC</time> ·
  <a href="${escapeHtml(repoUrl)}/issues?q=label%3Astatus">Incident history</a> ·
  <a href="${escapeHtml(repoUrl)}">Source</a>
</footer>`,
  });
}

export { layout, topbar, legend };
