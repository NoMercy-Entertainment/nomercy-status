// WCAG contrast gate for the status palette.
//
// Every value here is PARSED OUT OF status.css — nothing is restated — so editing a
// token to a prettier-but-unreadable step fails this suite instead of shipping. The
// bar is the page's honesty signal: if `--nodata` cannot be told apart from the panel
// behind it, a 77-day monitoring gap reads as "nothing to see here", which is exactly
// the failure this whole project exists to prevent.
import test from "node:test";
import assert from "node:assert/strict";
import { THEMES } from "./css-tokens.mjs";

const TEXT_MIN = 4.5;      // WCAG 2.1 SC 1.4.3, normal-size text (this page is 12-17px)
const GRAPHIC_MIN = 3.0;   // WCAG 2.1 SC 1.4.11, non-text contrast

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(match, `not a hex colour: ${hex}`);
  const digits = match[1].length === 3 ? match[1].replace(/./g, (d) => d + d) : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, what it is]
const TEXT_PAIRS = [
  ["--text-primary", "--bg-primary", "body copy"],
  ["--text-primary", "--bg-panel", "card copy"],
  ["--text-primary", "--bg-raised", "theme toggle label"],
  ["--text-secondary", "--bg-primary", "footer / legend"],
  ["--text-secondary", "--bg-panel", "bar legend, grey-band note"],
  ["--text-secondary", "--bg-raised", ".tag.nodata"],
  ["--accent-light", "--bg-primary", "topbar and footer links"],
  ["--accent-light", "--bg-panel", "card title hover"],
  ["--up-text", "--up-surface", ".tag.up / all-clear banner"],
  ["--degraded-text", "--degraded-surface", ".tag.degraded / degraded banner"],
  ["--down-text", "--down-surface", ".tag.down / outage banner"],
];

const GRAPHIC_PAIRS = [
  ["--up-solid", "--bg-panel", "operational bar segment"],
  ["--degraded-solid", "--bg-panel", "degraded bar segment"],
  ["--down-solid", "--bg-panel", "outage bar segment"],
  ["--nodata", "--bg-panel", "no-monitoring-data bar segment"],
  ["--accent", "--bg-primary", "response-time sparkline"],
];

const check = (theme, pairs, min, kind) => {
  const palette = THEMES[theme];
  const failures = [];
  for (const [fg, bg, what] of pairs) {
    assert.ok(palette[fg], `${theme} palette missing ${fg}`);
    assert.ok(palette[bg], `${theme} palette missing ${bg}`);
    const ratio = contrast(palette[fg], palette[bg]);
    if (ratio < min) {
      failures.push(
        `${what}: ${fg} ${palette[fg]} on ${bg} ${palette[bg]} = ${ratio.toFixed(2)}:1 (needs ${min})`
      );
    }
  }
  assert.deepEqual(failures, [], `${theme} ${kind} contrast failures:\n  ${failures.join("\n  ")}`);
};

test("the ratio maths matches the WCAG reference values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#ffffff", "#ffffff").toFixed(2), "1.00");
  assert.equal(contrast("#767676", "#ffffff").toFixed(1), "4.5"); // the canonical 4.5:1 grey
});

for (const theme of ["dark", "light"]) {
  test(`${theme} theme: every text pairing clears ${TEXT_MIN}:1`, () => {
    check(theme, TEXT_PAIRS, TEXT_MIN, "text");
  });

  test(`${theme} theme: every bar and graphic colour clears ${GRAPHIC_MIN}:1`, () => {
    check(theme, GRAPHIC_PAIRS, GRAPHIC_MIN, "graphic");
  });

  test(`${theme} theme: no status colour is a near-duplicate of the panel`, () => {
    // Deliberately NOT asserted here: separation between the four fills themselves.
    // Green and red are near-identical in luminance by construction (light theme:
    // 1.12:1), and no in-palette step fixes that — which is precisely why status is
    // also carried in words. The bar's aria-label states the per-status day counts,
    // the tag names the status, and the uptime label names its own denominator; see
    // render-index.test.mjs and render-detail.test.mjs.
    const palette = THEMES[theme];
    for (const fill of ["--up-solid", "--degraded-solid", "--down-solid", "--nodata"]) {
      assert.ok(
        contrast(palette[fill], palette["--bg-panel"]) >= GRAPHIC_MIN,
        `${theme}: ${fill} ${palette[fill]} disappears into the panel`
      );
    }
  });
}
