import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderIndex, overallStatus, renderBar, uptimeLabel, barLabel } from "../lib/render-page.mjs";
import { escapeHtml } from "../lib/html.mjs";

const days = (statuses) => statuses.map((status, i) => ({
  date: `2026-06-${String(i + 1).padStart(2, "0")}`,
  status, checks: status === "nodata" ? 0 : 1,
  avgResponseTimeMs: status === "nodata" ? null : 120,
}));

const service = (over = {}) => ({
  name: "Website", slug: "website", url: "https://nomercy.tv", status: "up",
  uptime: "99.87%", uptimeDay: "100.00%", uptimeWeek: "100.00%",
  uptimeMonth: "100.00%", uptimeYear: "99.87%", time: 620,
  days: days(["up", "up", "nodata"]), ...over,
});

// The banner also carries its label strings as data-* so status.js can rebuild the
// text from live data (see C1). Grepping the whole document for "All systems
// operational" would therefore match that attribute, so assert on the rendered
// banner CONTENT instead — which is what the reader actually sees.
const bannerOf = (html) => html.match(/<div class="banner[^"]*"[^>]*>([\s\S]*?)<\/div>/)[1];

const opts = (services) => ({
  services, generatedAt: new Date("2026-09-02T02:00:00Z"), heroes: [],
  repoUrl: "https://github.com/NoMercy-Entertainment/nomercy-status",
  i18n: { allSystemsOperational: "All systems operational", activeIncidents: "Ongoing Incidents" },
});

test("overallStatus is up only when every service is up", () => {
  assert.equal(overallStatus([service(), service()]), "up");
  assert.equal(overallStatus([service(), service({ status: "degraded" })]), "degraded");
  assert.equal(overallStatus([service({ status: "degraded" }), service({ status: "down" })]), "down");
});

test("renderBar emits one element per day carrying its status class", () => {
  const html = renderBar(days(["up", "down", "nodata"]));
  assert.equal((html.match(/class="bar-day/g) || []).length, 3);
  assert.match(html, /bar-day up/);
  assert.match(html, /bar-day down/);
  assert.match(html, /bar-day nodata/);
});

test("nodata days are labelled as missing monitoring, not as uptime", () => {
  const html = renderBar(days(["nodata"]));
  assert.match(html, /no monitoring data/i);
  assert.doesNotMatch(html, /100%/);
});

test("renders one card per service", () => {
  const html = renderIndex(opts([service(), service({ name: "API", slug: "api" })]));
  assert.equal((html.match(/class="card"/g) || []).length, 2);
  assert.ok(html.includes("Website"));
  assert.ok(html.includes("API"));
});

test("banner reads all-clear when everything is up", () => {
  const html = renderIndex(opts([service()]));
  assert.equal(bannerOf(html), "All systems operational");
  assert.doesNotMatch(html, /class="banner[^"]*is-down/);
});

test("banner names the failing services when something is down", () => {
  const html = renderIndex(opts([service(), service({ name: "API", slug: "api", status: "down" })]));
  assert.match(html, /class="banner[^"]*is-down/);
  assert.equal(bannerOf(html), "Ongoing Incidents: API");
});

test("the banner exposes the labels status.js needs to repaint it live", () => {
  // Without these the live overlay could only hardcode English copy of its own.
  const html = renderIndex(opts([service()]));
  assert.match(html, /data-overall-banner data-label-ok="All systems operational" data-label-incidents="Ongoing Incidents"/);
});

test("cards link to their detail page", () => {
  const html = renderIndex(opts([service()]));
  assert.ok(html.includes('href="/history/website/"'));
});

test("the markup does not bake a theme attribute onto <html>", () => {
  // Baking data-theme="dark" in makes status.css's `:root:not([data-theme="dark"])`
  // branch unreachable, so prefers-color-scheme: light can never win. The default
  // must come from the stylesheet; status.js stamps an attribute only for a stored
  // choice. See the four-combination matrix in status-js.test.mjs.
  const html = renderIndex(opts([service()]));
  const openTag = html.match(/<html[^>]*>/)[0];
  assert.doesNotMatch(openTag, /data-theme/, `<html> must not carry a theme: ${openTag}`);
});

test("an unrecognised status degrades to the worst case, never to up", () => {
  // A status page that renders an unknown value as green is lying about an outage.
  assert.equal(overallStatus([service({ status: "whoknows" })]), "down");
  assert.equal(overallStatus([service(), service({ status: "" })]), "down");
  assert.equal(overallStatus([service(), service({ status: undefined })]), "down");

  const html = renderIndex(opts([service(), service({ name: "API", slug: "api", status: "whoknows" })]));
  assert.match(html, /class="banner[^"]*is-down/);
  assert.equal(bannerOf(html), "Ongoing Incidents: API");
});

test("the uptime label never implies a window it does not cover", () => {
  assert.equal(uptimeLabel({ uptimePct: 100, observedDays: 90, nodataDays: 0 }), "100.00% uptime");
  assert.equal(uptimeLabel({ uptimePct: 100, observedDays: 14, nodataDays: 76 }), "100.00% of 14 days observed");
  assert.equal(uptimeLabel({ uptimePct: 100, observedDays: 1, nodataDays: 89 }), "100.00% of 1 day observed");
  assert.equal(uptimeLabel({ uptimePct: null, observedDays: 0, nodataDays: 90 }), "No monitoring data");
});

test("a card whose bar is mostly grey does not print a bare percentage", () => {
  const html = renderIndex(opts([service({ days: days(["up", "nodata", "nodata"]) })]));
  assert.ok(html.includes("100.00% of 1 day observed"));
  assert.ok(!html.includes("100.00% uptime"));
});

test("the bar's accessible label carries the counts, not just the window", () => {
  assert.equal(
    barLabel(days(["up", "up", "down", "nodata"])),
    "Daily status for the last 4 days: 2 days operational, 1 day outage, 1 day no monitoring data"
  );
  const html = renderBar(days(["up", "nodata"]));
  assert.match(html, /aria-label="Daily status for the last 2 days: 1 day operational, 1 day no monitoring data"/);
});

test("status is carried in text, not by hue alone", () => {
  // Colour vision deficiency makes the green/red bar fills indistinguishable, so the
  // card must state the status in words as well.
  const html = renderIndex(opts([service({ status: "down", days: days(["down", "down"]) })]));
  assert.match(html, /<span class="tag down"[^>]*>down<\/span>/);
  assert.match(html, /aria-label="[^"]*2 days outage/);
});

test("cards show the current response time", () => {
  const html = renderIndex(opts([service({ time: 620 })]));
  assert.match(html, /Response time <b>620 ms<\/b>/);
});

test("a card without a response time omits the line rather than printing junk", () => {
  const html = renderIndex(opts([service({ time: null })]));
  assert.ok(!html.includes("card-meta"));
});

test("service names are HTML-escaped", () => {
  const html = renderIndex(opts([service({ name: '<img src=x onerror=alert(1)>' })]));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
});

test("a nodata stretch produces an explanatory note", () => {
  const html = renderIndex(opts([service({ days: days(["nodata", "nodata", "up"]) })]));
  assert.match(html, /monitoring/i);
});

test("renderBar HTML-escapes day.status in the class attribute", () => {
  const malicious = [{ date: "2026-06-01", status: '"><b>x</b>', checks: 1, avgResponseTimeMs: 120 }];
  const html = renderBar(malicious);
  assert.ok(!html.includes('"><b>x</b>'));
  assert.ok(html.includes(escapeHtml('"><b>x</b>')));
});

// --- hero rotation -----------------------------------------------------------
// All candidate heroes ship in the page and one is revealed at random per load.
// Rendering must stay deterministic (the build is asserted byte-identical
// elsewhere), so the randomness lives entirely in the browser.

const HEROES = ['<svg id="a"></svg>', '<svg id="b"></svg>', '<svg id="c"></svg>'];

test("every hero is inlined so the choice needs no extra request", () => {
  const html = renderIndex({ ...opts([service()]), heroes: HEROES });
  for (const svg of HEROES) assert.ok(html.includes(svg), `missing hero: ${svg}`);
});

test("exactly one hero is visible before any script runs", () => {
  const html = renderIndex({ ...opts([service()]), heroes: HEROES });
  const slots = html.match(/<div class="hero-art"[^>]*>/g) || [];
  assert.equal(slots.length, 3);
  assert.equal(slots.filter((s) => !s.includes("hidden")).length, 1);
});

test("rendering is deterministic - no randomness at build time", () => {
  // Two renders must match, or the daily rebuild would commit on every run.
  const a = renderIndex({ ...opts([service()]), heroes: HEROES });
  const b = renderIndex({ ...opts([service()]), heroes: HEROES });
  assert.equal(a, b);
});

test("the rotator script ships with the page", () => {
  const html = renderIndex({ ...opts([service()]), heroes: HEROES });
  assert.match(html, /data-hero-rotator/);
  assert.match(html, /Math\.random/);
});

test("a single hero renders without a rotator", () => {
  const html = renderIndex({ ...opts([service()]), heroes: [HEROES[0]] });
  assert.ok(html.includes(HEROES[0]));
  assert.doesNotMatch(html, /Math\.random/);
});

test("no heroes renders no hero block at all", () => {
  const html = renderIndex({ ...opts([service()]), heroes: [] });
  assert.doesNotMatch(html, /class="hero"/);
  assert.doesNotMatch(html, /Math\.random/);
});

// --- head metadata and control state -----------------------------------------
// These exist because an earlier accidental revert of render-page.mjs went
// undetected: nothing asserted the description or the toggle's state, so the
// suite stayed green while both silently disappeared.

test("the landing page declares a meta description", () => {
  const html = renderIndex(opts([service(), service({ name: "API", slug: "api" })]));
  const meta = html.match(/<meta name="description" content="([^"]+)">/);
  assert.ok(meta, "no meta description");
  assert.match(meta[1], /2 NoMercy services/);
});

test("the theme toggle exposes a pressed state", () => {
  const html = renderIndex(opts([service()]));
  assert.match(html, /data-theme-toggle[^>]*aria-pressed="(true|false)"/);
});

test("the ranking rule is the shared one, not a local copy", () => {
  // A second copy of the rule inside the renderer could disagree with the day
  // classifier, and the banner would contradict the bars beneath it.
  const src = readFileSync(new URL("../lib/render-page.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /const RANK\s*=/, "render-page must not define its own RANK");
  assert.match(src, /from "\.\/status-rank\.mjs"/);
});
