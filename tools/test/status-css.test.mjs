import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../assets/status.css", import.meta.url), "utf8");

const TOKENS = [
  "--bg-primary", "--bg-panel", "--bg-raised", "--border-color",
  "--text-primary", "--text-secondary", "--accent", "--accent-light",
  "--up-solid", "--up-surface", "--up-text",
  "--degraded-solid", "--degraded-surface", "--degraded-text",
  "--down-solid", "--down-surface", "--down-text", "--nodata",
];

function block(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `missing block: ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("dark is the default theme on bare :root", () => {
  const root = block(":root {");
  for (const token of TOKENS) assert.match(root, new RegExp(`${token}\\s*:`), `:root missing ${token}`);
  assert.match(root, /--bg-primary:\s*#111113/);
});

test("light theme redefines every token", () => {
  const light = block('[data-theme="light"]');
  for (const token of TOKENS) assert.match(light, new RegExp(`${token}\\s*:`), `light missing ${token}`);
});

test("light is honoured via prefers-color-scheme too", () => {
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*light\)/);
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
