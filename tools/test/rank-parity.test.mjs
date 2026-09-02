import test from "node:test";
import assert from "node:assert/strict";
import * as shared from "../lib/status-rank.mjs";
import * as browser from "../assets/status.js";

/**
 * The ranking rule exists twice on purpose.
 *
 * `tools/lib/status-rank.mjs` is used by the generator; `tools/assets/status.js`
 * carries its own copy because it is a browser module served standalone, and
 * importing the shared one would mean shipping a second file and a second
 * request to every visitor of a status page.
 *
 * The duplication is only safe while the two agree exactly. If they drift, the
 * live overlay and the baked-in page reach different conclusions about the same
 * data -- the banner would contradict the cards beneath it. These tests are the
 * thing that makes the duplication safe, so do not delete them without merging
 * the implementations.
 */

const STATUSES = ["up", "degraded", "down", "nodata", "UP", "", null, undefined, 0, "healthy"];

test("normaliseStatus agrees across generator and browser copies", () => {
  for (const status of STATUSES) {
    assert.equal(
      browser.normaliseStatus(status),
      shared.normaliseStatus(status),
      `disagreement on ${JSON.stringify(status)}`
    );
  }
});

test("worstStatus agrees across generator and browser copies", () => {
  // The browser copy takes entry objects; the shared one takes bare statuses.
  for (const a of STATUSES) {
    for (const b of STATUSES) {
      assert.equal(
        browser.worstStatus([{ status: a }, { status: b }]),
        shared.worstStatus([a, b]),
        `disagreement on ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
      );
    }
  }
});

test("both treat an empty list as up", () => {
  assert.equal(browser.worstStatus([]), shared.worstStatus([]));
  assert.equal(browser.worstStatus([]), "up");
});
