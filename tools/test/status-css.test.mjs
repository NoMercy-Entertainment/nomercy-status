import test from "node:test";
import assert from "node:assert/strict";
import { renderIndex, renderDetail } from "../lib/render-page.mjs";
import { css, TOKENS, block, tokensIn } from "./css-tokens.mjs";

const day = (date, status) => ({
  date, status, checks: status === "nodata" ? 0 : 1,
  avgResponseTimeMs: status === "nodata" ? null : 120,
});

const service = {
  name: "Website", slug: "website", url: "https://nomercy.tv", status: "up",
  uptime: "99.87%", uptimeDay: "100.00%", uptimeWeek: "100.00%",
  uptimeMonth: "100.00%", uptimeYear: "99.87%", time: 620,
  days: [day("2026-06-01", "up"), day("2026-06-02", "nodata")],
};

const indexOpts = {
  services: [service], generatedAt: new Date("2026-09-02T02:00:00Z"), hero: "",
  repoUrl: "https://github.com/NoMercy-Entertainment/nomercy-status",
  i18n: { allSystemsOperational: "All systems operational", activeIncidents: "Ongoing Incidents" },
};
const detailOpts = {
  service, generatedAt: new Date("2026-09-02T02:00:00Z"),
  repoUrl: "https://github.com/NoMercy-Entertainment/nomercy-status",
};

test("dark is the default theme on bare :root", () => {
  const root = block(":root {");
  for (const token of TOKENS) assert.match(root, new RegExp(`${token}\\s*:`), `:root missing ${token}`);
  assert.match(root, /--bg-primary:\s*#111113/);
});

test("light theme redefines every token", () => {
  const light = block('[data-theme="light"] {');
  for (const token of TOKENS) assert.match(light, new RegExp(`${token}\\s*:`), `light missing ${token}`);
});

test("light is honoured via prefers-color-scheme too", () => {
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*light\)/);
});

test("the prefers-color-scheme branch can actually match the emitted markup", () => {
  // Greping for the at-rule alone is not enough: the branch is guarded by
  // `:root:not([data-theme="dark"])`, so a build that bakes data-theme="dark" onto
  // <html> makes it permanently dead while this file still looks correct. Assert
  // the guard AND that no page ships a theme attribute for it to trip over.
  assert.match(css, /:root:not\(\[data-theme="dark"\]\)/);
  for (const html of [renderIndex(indexOpts), renderDetail(detailOpts)]) {
    const openTag = html.match(/<html[^>]*>/)[0];
    assert.doesNotMatch(openTag, /data-theme/, `<html> must not carry a theme: ${openTag}`);
  }
});

test("both light definitions carry identical token values", () => {
  // A token defined in `[data-theme="light"]` but missing from the media block keeps
  // its DARK value for every reader who never touched the toggle, and vice versa.
  const explicit = tokensIn(block('[data-theme="light"] {'));
  const preferred = tokensIn(block(':root:not([data-theme="dark"]) {'));
  for (const token of TOKENS) {
    assert.ok(preferred[token], `prefers-color-scheme block missing ${token}`);
    assert.equal(preferred[token], explicit[token], `${token} drifted between the two light blocks`);
  }
});

test("status tags never put white text on the green solid", () => {
  // grass-9 with white is 3.0:1. The surface+text pairing is ~7.8:1.
  const tag = block(".tag.up");
  assert.match(tag, /var\(--up-surface\)/);
  assert.match(tag, /var\(--up-text\)/);
  assert.doesNotMatch(tag, /#fff|white/i);
});

test("required components are present", () => {
  for (const cls of [".banner", ".card-grid", ".card", ".bar", ".bar-day", ".theme-toggle", ".sparkline"]) {
    assert.ok(css.includes(cls), `missing component: ${cls}`);
  }
});
