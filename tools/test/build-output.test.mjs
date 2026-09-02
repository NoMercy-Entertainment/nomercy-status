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

  assert.equal(services.length, 7, `expected exactly 7 services, got ${services.length}`);
  assert.ok(existsSync(join(outDir, "index.html")));
  assert.ok(existsSync(join(outDir, "status.css")));
  assert.ok(existsSync(join(outDir, "status.js")));
  for (const service of services) {
    assert.ok(existsSync(join(outDir, "history", service.slug, "index.html")), `missing detail: ${service.slug}`);
  }
  assert.equal(written.length, 3 + services.length);
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

test("a missing heroes directory is not fatal", () => {
  const outDir = out();
  buildSite({ outDir, endDate: new Date("2026-09-02T12:00:00Z"), dayCount: 90, heroesDir: "does-not-exist" });
  const html = readFileSync(join(outDir, "index.html"), "utf8");
  assert.ok(html.includes("card-grid"));
  assert.doesNotMatch(html, /class="hero"/);
});

test("all five heroes ship and one is revealed at random", () => {
  const outDir = out();
  buildSite({ outDir, endDate: new Date("2026-09-02T12:00:00Z"), dayCount: 90 });
  const html = readFileSync(join(outDir, "index.html"), "utf8");

  const slots = html.match(/<div class="hero-art"[^>]*>/g) || [];
  assert.equal(slots.length, 5, "expected all five candidates inlined");
  assert.equal(
    slots.filter((slot) => !slot.includes("hidden")).length,
    1,
    "exactly one must be visible before the script runs"
  );
  assert.match(html, /data-hero-rotator/);
  assert.match(html, /Math\.random/);
  // Every candidate must be theme-adaptive; a literal colour would render one
  // theme's artwork on the other theme's ground.
  const heroMarkup = html.slice(html.indexOf('class="hero"'), html.indexOf("data-overall-banner"));
  assert.doesNotMatch(heroMarkup, /#[0-9a-fA-F]{3,8}\b/);
});

test("two builds produce byte-identical output", () => {
  // No endDate is pinned here, deliberately: this mirrors exactly how the CLI invokes
  // buildSite() (endDate defaults to `new Date()` at full millisecond precision on every
  // call). generatedAt must be derived from the data (the newest observation timestamp),
  // not from that wall-clock default, or every build churns even when nothing changed.
  const outDirA = out();
  const outDirB = out();
  buildSite({ outDir: outDirA, dayCount: 90 });
  buildSite({ outDir: outDirB, dayCount: 90 });

  const htmlA = readFileSync(join(outDirA, "index.html"), "utf8");
  const htmlB = readFileSync(join(outDirB, "index.html"), "utf8");
  assert.equal(htmlA, htmlB, "index.html must be byte-identical across two builds run moments apart");
});
