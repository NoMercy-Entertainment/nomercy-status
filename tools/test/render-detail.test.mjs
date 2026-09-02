import test from "node:test";
import assert from "node:assert/strict";
import { renderDetail, sparklinePath } from "../lib/render-page.mjs";

const day = (date, status, avgResponseTimeMs) => ({
  date, status, checks: status === "nodata" ? 0 : 1, avgResponseTimeMs,
});

const service = (over = {}) => ({
  name: "API", slug: "api", url: "https://api.nomercy.tv/v1/server", status: "up",
  uptime: "99.90%", uptimeDay: "100.00%", uptimeWeek: "100.00%",
  uptimeMonth: "100.00%", uptimeYear: "99.90%", time: 596,
  days: [day("2026-06-01", "up", 100), day("2026-06-02", "up", 200), day("2026-06-03", "nodata", null)],
  ...over,
});

const opts = (over = {}) => ({
  service: service(), generatedAt: new Date("2026-09-02T02:00:00Z"),
  repoUrl: "https://github.com/NoMercy-Entertainment/nomercy-status", ...over,
});

test("sparklinePath skips days with no response time", () => {
  const d = sparklinePath([day("a", "up", 100), day("b", "nodata", null), day("c", "up", 200)]);
  assert.match(d, /^M/);
  assert.equal((d.match(/L/g) || []).length, 1); // two plotted points => one line segment
});

test("sparklinePath returns empty when there is nothing to plot", () => {
  assert.equal(sparklinePath([day("a", "nodata", null)]), "");
  assert.equal(sparklinePath([]), "");
});

test("detail page names the service and links its real target URL", () => {
  const html = renderDetail(opts());
  assert.ok(html.includes("API"));
  assert.ok(html.includes("https://api.nomercy.tv/v1/server"));
});

test("detail page shows all four uptime windows", () => {
  const html = renderDetail(opts());
  for (const label of ["24 hours", "7 days", "30 days", "1 year"]) {
    assert.ok(html.includes(label), `missing window: ${label}`);
  }
  assert.ok(html.includes("99.90%"));
});

test("detail page includes the 90-day bar and a sparkline", () => {
  const html = renderDetail(opts());
  assert.match(html, /class="bar"/);
  assert.match(html, /class="sparkline"/);
});

test("detail page links back to the landing page", () => {
  assert.match(renderDetail(opts()), /href="\/"/);
});

test("detail page escapes the service name", () => {
  const html = renderDetail(opts({ service: service({ name: "<script>x</script>" }) }));
  assert.ok(!html.includes("<script>x</script>"));
});
