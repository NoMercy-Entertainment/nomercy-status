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

/**
 * Parse `git log -p` output into observations that each know which URL they
 * measured.
 *
 * The URL matters because a check can be redefined. `history/api.yml` recorded
 * `url: https://api.nomercy.tv` until 2026-09-02 and `.../v1/server` after: the
 * first is a shared Cloudflare front door that answers for several hostnames,
 * the second is a real API route. Both are "API is up" in the commit subject,
 * but they are measurements of different things, and splicing them into one bar
 * would present front-door uptime as API uptime.
 *
 * Input is `git log --format='%x00%aI%x09%s' -p -U7 -- <file>`, so each commit
 * begins with a NUL. Returns oldest first.
 */
export function parseObservationLog(text) {
  const blocks = String(text ?? "").split("\u0000").filter((block) => block.trim());

  // git lists newest first; walk oldest first so an unknown URL can inherit the
  // one before it (merge commits carry no patch at all).
  const observations = [];
  for (const block of blocks.reverse()) {
    const newline = block.indexOf("\n");
    const observation = parseObservationLine(newline === -1 ? block : block.slice(0, newline));
    if (!observation) continue;

    const body = newline === -1 ? "" : block.slice(newline + 1);
    // A commit that changed the URL shows both `-url:` and `+url:`; take the new
    // one. Otherwise it appears as unchanged context.
    const changed = body.match(/^\+url:\s*(\S+)/m);
    const context = body.match(/^[ ]url:\s*(\S+)/m);
    observation.url = changed?.[1] ?? context?.[1] ?? observations.at(-1)?.url ?? null;

    observations.push(observation);
  }
  return observations;
}

/**
 * Keep only the observations that measured what the check measures TODAY.
 *
 * Anything recorded against an earlier target is dropped rather than reinterpreted:
 * those days then read as "no monitoring data", which is true — we have no
 * observation of the current target for them.
 */
export function forCurrentTarget(observations) {
  const current = observations.at(-1)?.url ?? null;
  if (current === null) return [...observations];
  return observations.filter((observation) => observation.url === current);
}

/**
 * Every recorded observation for a service, oldest first, each tagged with the
 * URL it measured.
 *
 * `-U7` is the whole file, which guarantees the `url:` line is in every patch
 * even when the commit did not change it.
 */
export function readObservations(slug, cwd = process.cwd()) {
  const stdout = execFileSync(
    "git",
    ["log", "--format=%x00%aI%x09%s", "-p", "-U7", "--", `history/${slug}.yml`],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  return parseObservationLog(stdout);
}

/**
 * What the page should actually draw: only observations of the target the check
 * points at today. See forCurrentTarget for why the rest are discarded.
 */
export function readCurrentObservations(slug, cwd = process.cwd()) {
  return forCurrentTarget(readObservations(slug, cwd));
}
