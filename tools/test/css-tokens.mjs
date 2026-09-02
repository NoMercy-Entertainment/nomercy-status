// Shared test helper (deliberately NOT named *.test.mjs so the runner skips it).
// Both status-css.test.mjs and contrast.test.mjs read their values out of
// status.css rather than restating them, so an edit to the stylesheet cannot
// silently invalidate the assertions.
import { readFileSync } from "node:fs";

export const css = readFileSync(new URL("../assets/status.css", import.meta.url), "utf8");

export const TOKENS = [
  "--bg-primary", "--bg-panel", "--bg-raised", "--border-color",
  "--text-primary", "--text-secondary", "--accent", "--accent-light",
  "--up-solid", "--up-surface", "--up-text",
  "--degraded-solid", "--degraded-surface", "--degraded-text",
  "--down-solid", "--down-surface", "--down-text", "--nodata",
];

/** The declarations between `selector` and its closing brace. */
export function block(selector, source = css) {
  const start = source.indexOf(selector);
  if (start === -1) throw new Error(`missing block: ${selector}`);
  const end = source.indexOf("}", start);
  if (end === -1) throw new Error(`unterminated block: ${selector}`);
  return source.slice(start, end);
}

/** `{ "--nodata": "#8b8d98", ... }` for one block, comments stripped. */
export function tokensIn(blockText) {
  const out = {};
  for (const [, name, value] of blockText.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

/** The two palettes exactly as the browser would resolve them. */
export const THEMES = {
  dark: tokensIn(block(":root {")),
  light: tokensIn(block('[data-theme="light"] {')),
};
