#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readObservations } from "./lib/parse-history.mjs";
import { classifyDays } from "./lib/classify-days.mjs";
import { renderIndex, renderDetail } from "./lib/render-page.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_URL = "https://github.com/NoMercy-Entertainment/nomercy-status";

export function buildSite({
  cwd = join(HERE, ".."),
  outDir = join(HERE, "..", "assets"),
  endDate = new Date(),
  dayCount = 90,
  // Source, not output: `assets/` is regenerated build output, so an illustration
  // parked there would be lost the first time someone wiped it and rebuilt.
  heroPath = join(HERE, "assets", "hero.svg"),
} = {}) {
  const summary = JSON.parse(readFileSync(join(cwd, "history", "summary.json"), "utf8"));

  // `generatedAt` is derived from the data (the newest observation across every service),
  // not from the wall clock. `endDate` still controls where the 90-day window ends and
  // defaults to now, but rendering the current instant into every page's "Updated" footer
  // would make two builds of the same data differ byte-for-byte, which in turn defeats the
  // `git diff --cached --quiet` idempotence gate the scheduled workflow relies on. "Updated"
  // should mean "data as of", not "HTML rebuilt at" — if data stops flowing, this timestamp
  // going stale is the correct, truthful behaviour.
  let newestObservedAt = null;

  const services = summary.map((entry) => {
    const observations = readObservations(entry.slug, cwd);
    const latest = observations.at(-1)?.at;
    if (latest && (!newestObservedAt || latest > newestObservedAt)) newestObservedAt = latest;
    return {
      ...entry,
      days: classifyDays(observations, endDate, dayCount),
    };
  });

  const generatedAt = newestObservedAt ?? endDate;

  // The illustration is chosen after the build exists, so treat it as optional.
  const hero = existsSync(heroPath) ? readFileSync(heroPath, "utf8") : "";

  const i18n = { allSystemsOperational: "All systems operational", activeIncidents: "Ongoing Incidents" };
  const written = [];

  const write = (relativePath, content) => {
    const target = join(outDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
    written.push(relativePath);
  };

  write("index.html", renderIndex({ services, generatedAt, hero, repoUrl: REPO_URL, i18n }));

  for (const service of services) {
    write(
      join("history", service.slug, "index.html"),
      renderDetail({ service, generatedAt, repoUrl: REPO_URL })
    );
  }

  for (const asset of ["status.css", "status.js"]) {
    mkdirSync(outDir, { recursive: true });
    copyFileSync(join(HERE, "assets", asset), join(outDir, asset));
    written.push(asset);
  }

  return { services, written };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  const { services, written } = buildSite({
    outDir: join(HERE, "..", value("--out", "assets")),
    dayCount: Number(value("--days", "90")),
  });
  console.log(`built ${written.length} files for ${services.length} services`);
}
