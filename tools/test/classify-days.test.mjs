import test from "node:test";
import assert from "node:assert/strict";
import { classifyDays, utcDayKey, summarise } from "../lib/classify-days.mjs";

const obs = (iso, status = "up", responseTimeMs = 100) => ({
  at: new Date(iso), status, code: 200, responseTimeMs,
});
const statusOn = (days, date) => days.find((d) => d.date === date)?.status;

test("utcDayKey buckets by UTC, not local time", () => {
  assert.equal(utcDayKey(new Date("2026-06-17T23:59:59Z")), "2026-06-17");
  assert.equal(utcDayKey(new Date("2026-06-18T00:00:01Z")), "2026-06-18");
});

test("a day takes the worst status observed that day", () => {
  const days = classifyDays(
    [obs("2026-05-10T01:00:00Z", "up"),
     obs("2026-05-10T02:00:00Z", "down"),
     obs("2026-05-10T03:00:00Z", "up")],
    new Date("2026-05-10T12:00:00Z"), 1
  );
  assert.equal(days[0].status, "down");
  assert.equal(days[0].checks, 3);
});

test("degraded outranks up but not down", () => {
  const days = classifyDays(
    [obs("2026-05-10T01:00:00Z", "up"), obs("2026-05-10T02:00:00Z", "degraded")],
    new Date("2026-05-10T12:00:00Z"), 1
  );
  assert.equal(days[0].status, "degraded");
});

test("a quiet day inside a short gap carries the previous status forward", () => {
  // Commits only happen on status change plus one forced daily commit, so
  // 1-2 day silences are normal and must NOT read as an outage.
  const days = classifyDays(
    [obs("2026-05-10T23:00:00Z", "up"), obs("2026-05-12T01:00:00Z", "up")],
    new Date("2026-05-12T12:00:00Z"), 3
  );
  assert.equal(statusOn(days, "2026-05-11"), "up");
  assert.equal(days.find((d) => d.date === "2026-05-11").checks, 0);
});

test("a gap longer than the threshold is nodata, not false uptime", () => {
  const days = classifyDays(
    [obs("2026-06-17T00:10:00Z", "up"), obs("2026-09-02T01:13:00Z", "up")],
    new Date("2026-09-02T12:00:00Z"), 90
  );
  assert.equal(statusOn(days, "2026-07-15"), "nodata");
  assert.equal(statusOn(days, "2026-09-02"), "up");
});

test("days before the first observation are nodata", () => {
  const days = classifyDays([obs("2026-05-10T00:00:00Z")], new Date("2026-05-10T12:00:00Z"), 3);
  assert.equal(statusOn(days, "2026-05-08"), "nodata");
  assert.equal(statusOn(days, "2026-05-09"), "nodata");
  assert.equal(statusOn(days, "2026-05-10"), "up");
});

test("today carries forward from a recent last observation", () => {
  // Without this the page shows today grey every morning until the 23:00 run.
  const days = classifyDays(
    [obs("2026-09-01T23:00:00Z", "up")], new Date("2026-09-02T09:00:00Z"), 2
  );
  assert.equal(statusOn(days, "2026-09-02"), "up");
});

test("a stale trailing observation is nodata", () => {
  const days = classifyDays(
    [obs("2026-08-20T00:00:00Z", "up")], new Date("2026-09-02T09:00:00Z"), 2
  );
  assert.equal(statusOn(days, "2026-09-02"), "nodata");
});

test("returns exactly dayCount entries, oldest first", () => {
  const days = classifyDays([], new Date("2026-09-02T00:00:00Z"), 90);
  assert.equal(days.length, 90);
  assert.equal(days[0].date, "2026-06-05");
  assert.equal(days[89].date, "2026-09-02");
});

test("summarise ignores nodata days when computing uptime", () => {
  const days = [
    { date: "d1", status: "up", checks: 1, avgResponseTimeMs: 1 },
    { date: "d2", status: "down", checks: 1, avgResponseTimeMs: 1 },
    { date: "d3", status: "nodata", checks: 0, avgResponseTimeMs: null },
  ];
  const s = summarise(days);
  assert.equal(s.observedDays, 2);
  assert.equal(s.nodataDays, 1);
  assert.equal(s.uptimePct, 50);
});

test("summarise reports null uptime when nothing was observed", () => {
  assert.equal(summarise([{ date: "d", status: "nodata", checks: 0, avgResponseTimeMs: null }]).uptimePct, null);
});

test("a quiet day inside a short gap carries forward 'down' status", () => {
  // Verify that the carry-forward actually propagates 'down', not silently
  // converting to 'up'. This catches mutations of status = before.status → status = "up".
  const days = classifyDays(
    [obs("2026-05-10T23:00:00Z", "down"), obs("2026-05-12T01:00:00Z", "down")],
    new Date("2026-05-12T12:00:00Z"), 3
  );
  assert.equal(statusOn(days, "2026-05-11"), "down");
  assert.equal(days.find((d) => d.date === "2026-05-11").checks, 0);
});

test("a quiet day inside a short gap carries forward 'degraded' status", () => {
  // Verify that the carry-forward propagates 'degraded', not 'up'.
  // This catches mutations of status = before.status → status = "up".
  const days = classifyDays(
    [obs("2026-05-10T23:00:00Z", "degraded"), obs("2026-05-12T01:00:00Z", "degraded")],
    new Date("2026-05-12T12:00:00Z"), 3
  );
  assert.equal(statusOn(days, "2026-05-11"), "degraded");
  assert.equal(days.find((d) => d.date === "2026-05-11").checks, 0);
});

test("last observation as 'down' within 48h of final day carries forward", () => {
  // Trailing-edge carry-forward: the last observation was 'down' less than
  // 48 hours before the final day. That day must be 'down', not 'up'.
  const days = classifyDays(
    [obs("2026-09-01T23:00:00Z", "down")], new Date("2026-09-02T09:00:00Z"), 2
  );
  assert.equal(statusOn(days, "2026-09-02"), "down");
});

test("exactly 48 hours is the boundary: silence >= 48h becomes nodata", () => {
  // The gap boundary uses strict <, so exactly 48h is nodata, not carry-forward.
  // Start at 2026-05-10T12:00:00Z, end at 2026-05-12T12:00:00Z (exactly 48h).
  const days = classifyDays(
    [obs("2026-05-10T12:00:00Z", "up"), obs("2026-05-12T12:00:00Z", "up")],
    new Date("2026-05-12T12:00:00Z"), 3
  );
  // 2026-05-11 is inside the silence and at the boundary, so it should be nodata.
  assert.equal(statusOn(days, "2026-05-11"), "nodata");
});

import { readObservations } from "../lib/parse-history.mjs";

test("real history: the known March/April outages classify as down", () => {
  const days = classifyDays(readObservations("website"), new Date("2026-04-30T00:00:00Z"), 60);
  for (const date of ["2026-03-16", "2026-03-22", "2026-04-09", "2026-04-10"]) {
    assert.equal(statusOn(days, date), "down", `expected ${date} to be down`);
  }
});

test("real history: the 77-day CI outage classifies as nodata", () => {
  const days = classifyDays(readObservations("website"), new Date("2026-09-02T00:00:00Z"), 90);
  for (const date of ["2026-07-01", "2026-07-15", "2026-08-01", "2026-08-20"]) {
    assert.equal(statusOn(days, date), "nodata", `expected ${date} to be nodata`);
  }
});
