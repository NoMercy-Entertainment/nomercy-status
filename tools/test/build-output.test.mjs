import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite } from "../build-status-site.mjs";

const out = () => mkdtempSync(join(tmpdir(), "nm-status-"));

test("builds a landing page and one detail page per service", () => {
  const outDir = out();
  const { services, written } = buildSite({ outDir, endDate: new Date("2026-09-02T12:00:00Z"), dayCount: 90 });

  assert.ok(services.length >= 7, `expected >= 7 services, got ${services.length}`);
  assert.ok(existsSync(join(outDir, "index.html")));
  assert.ok(existsSync(join(outDir, "status.css")));
  assert.ok(existsSync(join(outDir, "status.js")));
  for (const service of services) {
    assert.ok(existsSync(join(outDir, "history", service.slug, "index.html")), `missing detail: ${service.slug}`);
  }
  assert.ok(written.length >= 3 + services.length);
});

test("every service gets exactly dayCount bar segments", () => {
  const outDir = out();
  const { services } = buildSite({ outDir, endDate: new Date("2026-09-02T12:00:00Z"), dayCount: 90 });
  for (const service of services) assert.equal(service.days.length, 90);

  const html = readFileSync(join(outDir, "index.html"), "utf8");
  assert.equal((html.match(/class="bar-day/g) || []).length, 90 * services.length);
});

test("the 77-day CI outage renders as nodata, not as uptime", () => {
  const outDir = out();
  const { services } = buildSite({ outDir, endDate: new Date("2026-09-02T12:00:00Z"), dayCount: 90 });
  const website = services.find((s) => s.slug === "website");
  const midOutage = website.days.find((d) => d.date === "2026-07-15");
  assert.equal(midOutage.status, "nodata");
});

test("a missing hero is not fatal", () => {
  const outDir = out();
  buildSite({ outDir, endDate: new Date("2026-09-02T12:00:00Z"), dayCount: 90, heroPath: "does-not-exist.svg" });
  assert.ok(readFileSync(join(outDir, "index.html"), "utf8").includes("card-grid"));
});
