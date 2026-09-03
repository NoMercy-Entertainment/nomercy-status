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

// --- check-definition changes -------------------------------------------------
// A service's target can be redefined. When it is, older observations measured
// something else and must not be presented as history for the current check.

import { parseObservationLog, forCurrentTarget } from "../lib/parse-history.mjs";

const block = (iso, subject, patch) => `\u0000${iso}\t${subject}\n\n${patch}\n`;

const PATCH_CHANGED = `diff --git a/history/api.yml b/history/api.yml
@@ -1,7 +1,7 @@
-url: https://api.nomercy.tv
+url: https://api.nomercy.tv/v1/server
 status: up
`;

const PATCH_CONTEXT = `diff --git a/history/api.yml b/history/api.yml
@@ -1,7 +1,7 @@
 url: https://api.nomercy.tv
 status: up
-responseTime: 465
+responseTime: 430
`;

test("takes the new url when a commit changes it", () => {
  const [o] = parseObservationLog(block("2026-09-02T01:13:54Z", "🟩 API is up (302 in 95 ms)", PATCH_CHANGED));
  assert.equal(o.url, "https://api.nomercy.tv/v1/server");
  assert.equal(o.status, "up");
});

test("takes the url from context when the commit did not change it", () => {
  const [o] = parseObservationLog(block("2026-06-17T00:10:40Z", "🔔 API is up (200 in 430 ms)", PATCH_CONTEXT));
  assert.equal(o.url, "https://api.nomercy.tv");
});

test("returns observations oldest first", () => {
  const log =
    block("2026-09-02T01:13:54Z", "🟩 API is up (302 in 95 ms)", PATCH_CHANGED) +
    block("2026-06-17T00:10:40Z", "🔔 API is up (200 in 430 ms)", PATCH_CONTEXT);
  const observations = parseObservationLog(log);
  assert.equal(observations.length, 2);
  assert.ok(observations[0].at < observations[1].at);
});

test("carries the url forward when a commit shows no url line", () => {
  // Merge commits produce no patch under `git log -p`.
  const log =
    block("2026-06-18T00:00:00Z", "🔔 API is up (200 in 400 ms)", "diff --git a/history/api.yml b/history/api.yml\n") +
    block("2026-06-17T00:10:40Z", "🔔 API is up (200 in 430 ms)", PATCH_CONTEXT);
  const observations = parseObservationLog(log);
  assert.equal(observations[1].url, "https://api.nomercy.tv", "should inherit the earlier url");
});

test("forCurrentTarget drops observations of a previous target", () => {
  const log =
    block("2026-09-02T01:13:54Z", "🟩 API is up (302 in 95 ms)", PATCH_CHANGED) +
    block("2026-06-17T00:10:40Z", "🔔 API is up (200 in 430 ms)", PATCH_CONTEXT);
  const kept = forCurrentTarget(parseObservationLog(log));
  assert.equal(kept.length, 1, "the June observation measured a different URL");
  assert.equal(kept[0].url, "https://api.nomercy.tv/v1/server");
});

test("forCurrentTarget keeps everything when the target never changed", () => {
  const log =
    block("2026-06-18T00:00:00Z", "🔔 API is up (200 in 400 ms)", PATCH_CONTEXT) +
    block("2026-06-17T00:10:40Z", "🔔 API is up (200 in 430 ms)", PATCH_CONTEXT);
  assert.equal(forCurrentTarget(parseObservationLog(log)).length, 2);
});

test("forCurrentTarget on an empty list is empty", () => {
  assert.deepEqual(forCurrentTarget([]), []);
});
