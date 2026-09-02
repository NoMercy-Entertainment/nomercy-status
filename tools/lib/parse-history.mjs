import { execFileSync } from "node:child_process";

const LOG_LINE = /^(\S+)\t(.*)$/;
const STATUS = /\bis (up|down|degraded)\b/;
const METRICS = /\((\d+) in (\d+) ms\)/;

/**
 * One commit subject describes one observation, e.g.
 *   🟩 Website is up (200 in 385 ms) [skip ci] [upptime]
 * Status is read from the words. The emoji is unreliable: every commit before
 * 2026-09-02 used 🔔 for up, down and degraded alike.
 */
export function parseObservationLine(line) {
  const match = LOG_LINE.exec(line ?? "");
  if (!match) return null;

  const [, isoDate, subject] = match;
  const status = STATUS.exec(subject);
  if (!status) return null;

  const at = new Date(isoDate);
  if (Number.isNaN(at.getTime())) return null;

  const metrics = METRICS.exec(subject);
  return {
    at,
    status: status[1],
    code: metrics ? Number(metrics[1]) : null,
    responseTimeMs: metrics ? Number(metrics[2]) : null,
  };
}

export function readObservations(slug, cwd = process.cwd()) {
  const stdout = execFileSync(
    "git",
    ["log", "--format=%aI%x09%s", "--", `history/${slug}.yml`],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return stdout
    .split("\n")
    .map(parseObservationLine)
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
}
