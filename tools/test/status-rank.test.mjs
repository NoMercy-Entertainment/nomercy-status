import test from "node:test";
import assert from "node:assert/strict";
import { normaliseStatus, rankOf, worstStatus } from "../lib/status-rank.mjs";

test("known states pass through unchanged", () => {
  for (const status of ["up", "degraded", "down"]) {
    assert.equal(normaliseStatus(status), status);
  }
});

test("anything unrecognised degrades to down, never up", () => {
  // On a status page, "we do not know" must not resolve in our own favour.
  for (const value of ["nodata", "UP", "", null, undefined, 0, {}, "healthy"]) {
    assert.equal(normaliseStatus(value), "down", `expected down for ${JSON.stringify(value)}`);
  }
});

test("ranking orders up < degraded < down", () => {
  assert.ok(rankOf("up") < rankOf("degraded"));
  assert.ok(rankOf("degraded") < rankOf("down"));
});

test("an unknown status ranks as the worst", () => {
  assert.equal(rankOf("who knows"), rankOf("down"));
});

test("worstStatus picks the worst present", () => {
  assert.equal(worstStatus(["up", "up"]), "up");
  assert.equal(worstStatus(["up", "degraded"]), "degraded");
  assert.equal(worstStatus(["degraded", "down", "up"]), "down");
});

test("worstStatus treats an unknown entry as down", () => {
  assert.equal(worstStatus(["up", "sideways"]), "down");
});

test("worstStatus on an empty list is up", () => {
  assert.equal(worstStatus([]), "up");
});
