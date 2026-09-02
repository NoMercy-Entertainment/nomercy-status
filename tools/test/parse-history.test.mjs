import test from "node:test";
import assert from "node:assert/strict";
import { parseObservationLine } from "../lib/parse-history.mjs";

const line = (at, subject) => `${at}\t${subject}`;

test("parses the historical bell-prefixed shape", () => {
  const o = parseObservationLine(
    line("2026-06-17T00:10:39Z", "🔔 Website is up (200 in 507 ms)")
  );
  assert.equal(o.status, "up");
  assert.equal(o.code, 200);
  assert.equal(o.responseTimeMs, 507);
  assert.equal(o.at.toISOString(), "2026-06-17T00:10:39.000Z");
});

test("parses the current green-square shape with trailing tags", () => {
  const o = parseObservationLine(
    line("2026-09-02T01:13:53Z", "🟩 Website is up (200 in 385 ms) [skip ci] [upptime]")
  );
  assert.equal(o.status, "up");
  assert.equal(o.responseTimeMs, 385);
});

test("status comes from the words, not the emoji", () => {
  // The bell prefix was used for down events too. Emoji parsing would call this "up".
  const o = parseObservationLine(
    line("2026-04-10T15:10:49Z", "🔔 Website is down (0 in 0 ms)")
  );
  assert.equal(o.status, "down");
  assert.equal(o.code, 0);
  assert.equal(o.responseTimeMs, 0);
});

test("parses degraded", () => {
  const o = parseObservationLine(line("2026-05-01T00:00:00Z", "🟨 API is degraded (200 in 9000 ms)"));
  assert.equal(o.status, "degraded");
});

test("returns null for commits that are not observations", () => {
  assert.equal(parseObservationLine(line("2026-09-02T01:00:00Z", "📊 Update graphs")), null);
  assert.equal(parseObservationLine("not a log line"), null);
});

test("tolerates a missing metrics clause", () => {
  const o = parseObservationLine(line("2026-05-01T00:00:00Z", "🟩 API is up"));
  assert.equal(o.status, "up");
  assert.equal(o.code, null);
  assert.equal(o.responseTimeMs, null);
});
