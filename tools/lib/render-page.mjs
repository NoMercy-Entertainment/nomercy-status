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
  const observed = stats.uptimePct === null ? "—" : `${stats.uptimePct.toFixed(2)}%`;
  const path = sparklinePath(service.days);

  const windows = [
    ["24 hours", service.uptimeDay, service.timeDay],
    ["7 days", service.uptimeWeek, service.timeWeek],
    ["30 days", service.uptimeMonth, service.timeMonth],
    ["1 year", service.uptimeYear, service.timeYear],
  ];

  return layout({
    title: `${service.name} — NoMercy Status`,
    body: `${topbar("detail")}
<h1>${escapeHtml(service.name)}</h1>
<p><a href="${escapeHtml(service.url)}">${escapeHtml(service.url)}</a> ·
   <span class="tag ${escapeHtml(service.status)}">${escapeHtml(service.status)}</span></p>

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
  <span>${service.days.length} days ago</span>
  <span>${observed} uptime observed</span>
  <span>Today</span>
</div>
${legend()}

<h2>Response time</h2>
${
  path
    ? `<svg class="sparkline" viewBox="0 0 600 90" preserveAspectRatio="none" role="img" aria-label="Daily mean response time"><path d="${path}"/></svg>`
    : `<p class="note">Not enough response-time data to plot yet.</p>`
}

<footer>
  Updated <time datetime="${generatedAt.toISOString()}">${generatedAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 16)} UTC</time> ·
  <a href="${escapeHtml(repoUrl)}/issues?q=label%3Astatus">Incident history</a>
</footer>`,
  });
}

export { layout, topbar, legend };
