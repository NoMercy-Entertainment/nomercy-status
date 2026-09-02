import test from "node:test";
import assert from "node:assert/strict";
import { readIndentedBlock, readI18n } from "../lib/config-block.mjs";

const CONFIG = `owner: NoMercy-Entertainment
repo: nomercy-status

i18n:
  activeIncidents: Ongoing Incidents
  allSystemsOperational: All systems operational
  incidentReport: Incident Report

workflowSchedule:
  uptime: "*/5 * * * *"
`;

test("reads a flat indented block", () => {
  assert.deepEqual(readIndentedBlock(CONFIG, "i18n"), {
    activeIncidents: "Ongoing Incidents",
    allSystemsOperational: "All systems operational",
    incidentReport: "Incident Report",
  });
});

test("stops at the next top-level key", () => {
  const block = readIndentedBlock(CONFIG, "i18n");
  assert.equal(block.uptime, undefined, "must not bleed into workflowSchedule");
});

test("returns an empty object for a missing block", () => {
  assert.deepEqual(readIndentedBlock(CONFIG, "notThere"), {});
});

test("strips surrounding quotes and inline comments", () => {
  const text = 'i18n:\n  a: "quoted value"\n  b: plain # trailing note\n  c: \'single\'\n';
  assert.deepEqual(readIndentedBlock(text, "i18n"), {
    a: "quoted value",
    b: "plain",
    c: "single",
  });
});

test("ignores comment and blank lines inside the block", () => {
  const text = "i18n:\n  # a note\n\n  a: one\n";
  assert.deepEqual(readIndentedBlock(text, "i18n"), { a: "one" });
});

test("keeps a colon that appears inside a value", () => {
  assert.deepEqual(readIndentedBlock("i18n:\n  a: see: here\n", "i18n"), { a: "see: here" });
});

test("readI18n falls back to defaults when the block is absent", () => {
  const i18n = readI18n("owner: x\n");
  assert.equal(i18n.allSystemsOperational, "All systems operational");
  assert.equal(i18n.activeIncidents, "Ongoing Incidents");
});

test("readI18n prefers the configured strings", () => {
  const i18n = readI18n("i18n:\n  allSystemsOperational: Alles werkt\n");
  assert.equal(i18n.allSystemsOperational, "Alles werkt");
  // Unset keys still fall back rather than becoming undefined in the page.
  assert.equal(i18n.activeIncidents, "Ongoing Incidents");
});
