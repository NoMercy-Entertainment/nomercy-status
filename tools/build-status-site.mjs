#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readObservations } from "./lib/parse-history.mjs";
import { classifyDays } from "./lib/classify-days.mjs";
import { renderIndex, renderDetail } from "./lib/render-page.mjs";
import { readI18n } from "./lib/config-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_URL = "https://github.com/NoMercy-Entertainment/nomercy-status";

export function buildSite({
  cwd = join(HERE, ".."),
  outDir = join(HERE, "..", "assets"),
  endDate = new Date(),
  dayCount = 90,
  // Source, not output: `assets/` is regenerated build output, so illustrations
  // parked there would be lost the first time someone wiped it and rebuilt.
  heroesDir = join(HERE, "assets", "heroes"),
} = {}) {
  // This runs unattended on a schedule, so a bad read must say what is wrong and
  // where. A raw ENOENT or SyntaxError in a CI log costs whoever reads it a
  // detour through the stack trace to work out which file was even involved.
  const summaryPath = join(cwd, "history", "summary.json");
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch (cause) {
    const reason =
      cause.code === "ENOENT"
        ? "the file does not exist — has Upptime run yet?"
        : `it is not valid JSON (${cause.message})`;
    throw new Error(`Cannot read ${summaryPath}: ${reason}`, { cause });
  }
  if (!Array.isArray(summary)) {
    throw new Error(`Expected ${summaryPath} to contain an array of services, got ${typeof summary}`);
  }

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

  // Every candidate ships; the page reveals one at random per load. Sorted so the
  // build stays byte-identical across runs regardless of directory order, and
  // optional so the site still builds before any illustration exists.
  const heroes = existsSync(heroesDir)
    ? readdirSync(heroesDir)
        .filter((name) => name.endsWith(".svg"))
        .sort()
        .map((name) => readFileSync(join(heroesDir, name), "utf8").trim())
    : [];

  // Wording comes from .upptimerc.yml so the banner can be changed without
  // touching code, falling back per-key if the block is absent or partial.
  const configPath = join(cwd, ".upptimerc.yml");
  const i18n = readI18n(existsSync(configPath) ? readFileSync(configPath, "utf8") : "");
  const written = [];

  const write = (relativePath, content) => {
    const target = join(outDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
    written.push(relativePath);
  };

  write("index.html", renderIndex({ services, generatedAt, heroes, repoUrl: REPO_URL, i18n }));

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
