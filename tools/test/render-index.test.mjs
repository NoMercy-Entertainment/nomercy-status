import test from "node:test";
import assert from "node:assert/strict";
import { renderIndex, overallStatus, renderBar } from "../lib/render-page.mjs";
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

const opts = (services) => ({
  services, generatedAt: new Date("2026-09-02T02:00:00Z"), hero: "",
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
  assert.ok(html.includes("All systems operational"));
  assert.doesNotMatch(html, /class="banner[^"]*is-down/);
});

test("banner names the failing services when something is down", () => {
  const html = renderIndex(opts([service(), service({ name: "API", slug: "api", status: "down" })]));
  assert.match(html, /class="banner[^"]*is-down/);
  assert.ok(html.includes("API"));
  assert.ok(!html.includes("All systems operational"));
});

test("cards link to their detail page", () => {
  const html = renderIndex(opts([service()]));
  assert.ok(html.includes('href="/history/website/"'));
});

test("dark theme is the default in the served markup", () => {
  const html = renderIndex(opts([service()]));
  assert.match(html, /<html[^>]+data-theme="dark"/);
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
