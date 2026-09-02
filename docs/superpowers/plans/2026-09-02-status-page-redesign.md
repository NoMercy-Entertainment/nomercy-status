# Status Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Upptime's stock Sapper status page with a `githubstatus.com`-style dashboard — hero illustration, status banner, service cards with 90-day uptime bars — in NoMercy's Moooom palette with dark and light themes.

**Architecture:** A dependency-free Node generator reads `history/summary.json` and each service's git history, then writes static HTML into `assets/`. Upptime's own `site` command copies `assets/*` over its export at deploy time, so the page ships through the existing, unmodified Static Site CI. A new workflow (whose filename is not one of Upptime's eight) regenerates and commits the assets daily.

**Tech Stack:** Node 20+ ESM, `node:test` + `node:assert/strict` (both built in — no npm dependencies at all), plain CSS custom properties, inline SVG.

**Spec:** `docs/superpowers/specs/2026-09-02-status-page-redesign-design.md`

## Global Constraints

- **Zero runtime dependencies.** No `package.json`, no `npm install`. Use only Node built-ins. The generator runs on a self-hosted runner we do not control the toolchain of.
- **Never edit `.github/workflows/{graphs,response-time,setup,site,summary,update-template,updates,uptime}.yml`.** `upptime update-template` deletes and regenerates exactly those eight names. New workflow files must use a different name.
- **Parse status from the message words** (`/\bis (up|down|degraded)\b/`), never from the emoji. Every commit before 2026-09-02 uses `🔔` for all states.
- **Bucket by UTC date.** Never local time.
- **Carry-forward gap threshold is 48 hours**, expressed as a named parameter with that default — not a literal buried in a branch.
- **The generator's commit message must NOT contain `[skip ci]`.** Static Site CI is guarded by `if: "!contains(github.event.head_commit.message, '[skip ci]')"` and we need it to run.
- **Status colour pairings are fixed** (decided in `.upptimerc.yml`): solid step-9 for bars and borders; step-3 surface with step-11 text for tags. Never white text on `grass-9` — that is 3.0:1.
- **Every `localStorage` access wrapped in try/catch.** It throws outright in some privacy modes.
- Commit messages follow Conventional Commits. **Never add any AI/assistant attribution, co-author trailer, or "generated with" footer.**

## File Structure

```
tools/
  lib/parse-history.mjs        git log -> observation records          (Task 1)
  lib/classify-days.mjs        observations -> N-day status series     (Task 2)
  lib/render-page.mjs          data -> landing + detail HTML           (Tasks 4, 5)
  lib/html.mjs                 escaping + small shared helpers         (Task 1)
  assets/status.css            hand-written stylesheet, both themes    (Task 3)
  assets/status.js             browser runtime, importable ESM         (Task 6)
  build-status-site.mjs        CLI entry; orchestrates and writes      (Task 7)
  test/*.test.mjs              node:test suites                        (per task)

assets/                        GENERATED — Upptime copies over its export
  index.html                   landing page
  history/<slug>/index.html    one per service
  status.css  status.js        copied verbatim from tools/assets/
  hero.svg                     chosen illustration                     (Task 10)

.github/workflows/status-site.yml    regenerate + commit daily         (Task 8)
docs/illustrations/                  5 candidates + picker             (Task 9)
```

`tools/assets/` holds hand-written source; `assets/` is build output. Keeping them separate means the generator can be re-run safely and it is always obvious which files a human edits.

---

### Task 1: History parser

Turns `git log` output into observation records. Pure string handling plus one `git` call.

**Files:**
- Create: `tools/lib/html.mjs`
- Create: `tools/lib/parse-history.mjs`
- Test: `tools/test/parse-history.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `escapeHtml(value: string): string`
  - `parseObservationLine(line: string): Observation | null`
  - `readObservations(slug: string, cwd?: string): Observation[]` — ascending by `at`
  - `Observation = { at: Date, status: "up"|"down"|"degraded", code: number|null, responseTimeMs: number|null }`

- [ ] **Step 1: Write the failing test**

Create `tools/test/parse-history.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/parse-history.test.mjs`
Expected: FAIL — `Cannot find module '../lib/parse-history.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `tools/lib/html.mjs`:

```js
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
```

Create `tools/lib/parse-history.mjs`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/parse-history.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify against the real repository**

Run:
```bash
node -e "import('./tools/lib/parse-history.mjs').then(m => {
  const o = m.readObservations('website');
  console.log('observations:', o.length);
  console.log('down events:', o.filter(x => x.status === 'down').length);
  console.log('earliest:', o[0].at.toISOString());
})"
```
Expected: at least 100 observations, exactly 4 down events, earliest in March 2026.

- [ ] **Step 6: Commit**

```bash
git add tools/lib/html.mjs tools/lib/parse-history.mjs tools/test/parse-history.test.mjs
git commit -m "feat(status-site): parse service history from git commit messages"
```

---

### Task 2: Day classifier

Collapses observations into one status per UTC day, deciding honestly when we simply have no data.

**Files:**
- Create: `tools/lib/classify-days.mjs`
- Test: `tools/test/classify-days.test.mjs`

**Interfaces:**
- Consumes: `Observation` from Task 1.
- Produces:
  - `utcDayKey(date: Date): string` — `"YYYY-MM-DD"`
  - `classifyDays(observations: Observation[], endDate: Date, dayCount: number, gapHours?: number): Day[]` — oldest first, length `dayCount`, `gapHours` defaults to 48
  - `Day = { date: string, status: "up"|"down"|"degraded"|"nodata", checks: number, avgResponseTimeMs: number|null }`
  - `summarise(days: Day[]): { observedDays: number, nodataDays: number, uptimePct: number|null }`

`endDate` and `dayCount` are explicit parameters, not hardcoded to "90 days ending today", so tests can inspect windows that contain the real March/April outages.

- [ ] **Step 1: Write the failing test**

Create `tools/test/classify-days.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/classify-days.test.mjs`
Expected: FAIL — `Cannot find module '../lib/classify-days.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `tools/lib/classify-days.mjs`:

```js
const DAY_MS = 86_400_000;
const RANK = { up: 0, degraded: 1, down: 2 };

export function utcDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * One status per UTC day for the `dayCount` days ending on `endDate`.
 *
 * A day with observations takes the worst one. A day without observations
 * carries the previous status forward only if the surrounding silence is
 * shorter than `gapHours`; otherwise it is "nodata". Response Time CI forces a
 * commit for every service daily, so a longer silence means the monitoring
 * pipeline was not running -- which must not be drawn as uptime.
 */
export function classifyDays(observations, endDate, dayCount, gapHours = 48) {
  const sorted = [...observations].sort((a, b) => a.at - b.at);
  const gapMs = gapHours * 3_600_000;

  const byDay = new Map();
  for (const observation of sorted) {
    const key = utcDayKey(observation.at);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(observation);
  }

  const lastDayStart = startOfUtcDay(endDate);
  const days = [];

  for (let offset = dayCount - 1; offset >= 0; offset--) {
    const dayStart = lastDayStart - offset * DAY_MS;
    const dayEnd = dayStart + DAY_MS - 1;
    const date = new Date(dayStart).toISOString().slice(0, 10);
    const observed = byDay.get(date);

    if (observed?.length) {
      let status = "up";
      let total = 0;
      let counted = 0;
      for (const observation of observed) {
        if (RANK[observation.status] > RANK[status]) status = observation.status;
        if (typeof observation.responseTimeMs === "number") {
          total += observation.responseTimeMs;
          counted++;
        }
      }
      days.push({
        date,
        status,
        checks: observed.length,
        avgResponseTimeMs: counted ? Math.round(total / counted) : null,
      });
      continue;
    }

    let before = null;
    let after = null;
    for (const observation of sorted) {
      const at = observation.at.getTime();
      if (at < dayStart) before = observation;
      else if (at > dayEnd) { after = observation; break; }
    }

    let status = "nodata";
    if (before) {
      const silence = after
        ? after.at.getTime() - before.at.getTime()
        : dayStart - before.at.getTime();
      if (silence < gapMs) status = before.status;
    }

    days.push({ date, status, checks: 0, avgResponseTimeMs: null });
  }

  return days;
}

export function summarise(days) {
  const observed = days.filter((day) => day.status !== "nodata");
  const good = observed.filter((day) => day.status === "up").length;
  return {
    observedDays: observed.length,
    nodataDays: days.length - observed.length,
    uptimePct: observed.length ? (good / observed.length) * 100 : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/classify-days.test.mjs`
Expected: PASS, 11 tests

- [ ] **Step 5: Pin the real outages against real data**

Append to `tools/test/classify-days.test.mjs`:

```js
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
```

Run: `node --test tools/test/classify-days.test.mjs`
Expected: PASS, 13 tests

- [ ] **Step 6: Commit**

```bash
git add tools/lib/classify-days.mjs tools/test/classify-days.test.mjs
git commit -m "feat(status-site): classify per-day status with honest no-data gaps"
```

---

### Task 3: Stylesheet

Both themes, dark by default, using the Moooom values already committed in `.upptimerc.yml`.

**Files:**
- Create: `tools/assets/status.css`
- Test: `tools/test/status-css.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a stylesheet defining, for both themes, the custom properties
  `--bg-primary --bg-panel --bg-raised --border-color --text-primary --text-secondary --accent --accent-light --up-solid --up-surface --up-text --degraded-solid --degraded-surface --degraded-text --down-solid --down-surface --down-text --nodata`
  and the classes `.banner .card-grid .card .bar .bar-day .tag .theme-toggle .sparkline`.

- [ ] **Step 1: Write the failing test**

Create `tools/test/status-css.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../assets/status.css", import.meta.url), "utf8");

const TOKENS = [
  "--bg-primary", "--bg-panel", "--bg-raised", "--border-color",
  "--text-primary", "--text-secondary", "--accent", "--accent-light",
  "--up-solid", "--up-surface", "--up-text",
  "--degraded-solid", "--degraded-surface", "--degraded-text",
  "--down-solid", "--down-surface", "--down-text", "--nodata",
];

function block(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `missing block: ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("dark is the default theme on bare :root", () => {
  const root = block(":root {");
  for (const token of TOKENS) assert.match(root, new RegExp(`${token}\\s*:`), `:root missing ${token}`);
  assert.match(root, /--bg-primary:\s*#111113/);
});

test("light theme redefines every token", () => {
  const light = block('[data-theme="light"]');
  for (const token of TOKENS) assert.match(light, new RegExp(`${token}\\s*:`), `light missing ${token}`);
});

test("light is honoured via prefers-color-scheme too", () => {
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*light\)/);
});

test("status tags never put white text on the green solid", () => {
  // grass-9 with white is 3.0:1. The surface+text pairing is ~7.8:1.
  const tag = block(".tag.up");
  assert.match(tag, /var\(--up-surface\)/);
  assert.match(tag, /var\(--up-text\)/);
  assert.doesNotMatch(tag, /#fff|white/i);
});

test("required components are present", () => {
  for (const cls of [".banner", ".card-grid", ".card", ".bar", ".bar-day", ".theme-toggle", ".sparkline"]) {
    assert.ok(css.includes(cls), `missing component: ${cls}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/status-css.test.mjs`
Expected: FAIL — ENOENT on `status.css`

- [ ] **Step 3: Write minimal implementation**

Create `tools/assets/status.css`. Values are the Moooom dark and light scales
(`nomercy-app-web/src/components/nm/tokens.css`); step numbers are the Radix
positions those tokens are built on.

```css
/* Generated-page stylesheet. Palette: NoMercy design system (Moooom).
   Dark is the default; light is opt-in via prefers-color-scheme or the toggle. */

:root {
  --bg-primary: #111113;      /* slate-1  */
  --bg-panel: #18191b;        /* slate-2  */
  --bg-raised: #212225;       /* slate-3  */
  --border-color: #363a3f;    /* slate-6  */
  --text-primary: #edeef0;    /* slate-12 */
  --text-secondary: #b0b4ba;  /* slate-11 */
  --accent: #12a594;          /* teal-9   */
  --accent-light: #0bd8b6;    /* teal-11  */
  --up-solid: #46a758;        /* grass-9  */
  --up-surface: #1b2a1e;      /* grass-3  */
  --up-text: #71d083;         /* grass-11 */
  --degraded-solid: #ffc53d;  /* amber-9  */
  --degraded-surface: #302008;/* amber-3  */
  --degraded-text: #ffca16;   /* amber-11 */
  --down-solid: #e5484d;      /* red-9    */
  --down-surface: #3b1219;    /* red-3    */
  --down-text: #ff9592;       /* red-11   */
  --nodata: #363a3f;          /* slate-6  */
  color-scheme: dark;
}

[data-theme="light"] {
  --bg-primary: #f9f9fb;
  --bg-panel: #fcfcfd;
  --bg-raised: #f0f0f3;
  --border-color: #d9d9e0;
  --text-primary: #1c2024;
  --text-secondary: #60646c;
  --accent: #12a594;
  --accent-light: #008573;
  --up-solid: #46a758;
  --up-surface: #e9f6e9;
  --up-text: #2a7e3b;
  --degraded-solid: #ffc53d;
  --degraded-surface: #fff7c2;
  --degraded-text: #ab6400;
  --down-solid: #e5484d;
  --down-surface: #feebec;
  --down-text: #ce2c31;
  --nodata: #d9d9e0;
  color-scheme: light;
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg-primary: #f9f9fb;
    --bg-panel: #fcfcfd;
    --bg-raised: #f0f0f3;
    --border-color: #d9d9e0;
    --text-primary: #1c2024;
    --text-secondary: #60646c;
    --accent-light: #008573;
    --up-surface: #e9f6e9;
    --up-text: #2a7e3b;
    --degraded-surface: #fff7c2;
    --degraded-text: #ab6400;
    --down-surface: #feebec;
    --down-text: #ce2c31;
    --nodata: #d9d9e0;
    color-scheme: light;
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.5;
}

.wrap { max-width: 920px; margin: 0 auto; padding: 0 20px 64px; }

.topbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border-color);
}
.topbar a { color: var(--accent-light); text-decoration: none; }
.topbar a:hover { text-decoration: underline; }

.theme-toggle {
  background: var(--bg-raised); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 6px;
  padding: 6px 12px; font: inherit; font-size: 14px; cursor: pointer;
}
.theme-toggle:hover { border-color: var(--accent); }

.hero { margin: 8px 0 -12px; }
.hero svg { display: block; width: 100%; height: auto; }

.banner {
  display: flex; align-items: center; gap: 10px;
  border-radius: 8px; padding: 14px 18px; margin: 24px 0 32px;
  font-size: 17px; font-weight: 600;
  background: var(--up-surface); color: var(--up-text);
  border: 1px solid var(--up-solid);
}
.banner.is-degraded { background: var(--degraded-surface); color: var(--degraded-text); border-color: var(--degraded-solid); }
.banner.is-down { background: var(--down-surface); color: var(--down-text); border-color: var(--down-solid); }

h1 { font-size: 22px; letter-spacing: -0.3px; margin: 0 0 4px; }
h2 { font-size: 15px; letter-spacing: -0.2px; margin: 0; }

.card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--border-color); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
@media (max-width: 720px) { .card-grid { grid-template-columns: 1fr; } }

.card { background: var(--bg-panel); padding: 18px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.card-head a { color: var(--text-primary); text-decoration: none; }
.card-head a:hover { color: var(--accent-light); }

.tag { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.tag.up { background: var(--up-surface); color: var(--up-text); }
.tag.degraded { background: var(--degraded-surface); color: var(--degraded-text); }
.tag.down { background: var(--down-surface); color: var(--down-text); }
.tag.nodata { background: var(--bg-raised); color: var(--text-secondary); }

.bar { display: flex; gap: 1px; height: 34px; align-items: stretch; }
.bar-day { flex: 1 1 0; min-width: 0; border-radius: 1px; background: var(--nodata); }
.bar-day.up { background: var(--up-solid); }
.bar-day.degraded { background: var(--degraded-solid); }
.bar-day.down { background: var(--down-solid); }
.bar-day.nodata { background: var(--nodata); }

.bar-legend { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--text-secondary); }

.legend { display: flex; flex-wrap: wrap; gap: 16px; margin: 20px 0 0; font-size: 12px; color: var(--text-secondary); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

.note { margin: 28px 0 0; padding: 12px 16px; border-left: 3px solid var(--nodata); background: var(--bg-panel); color: var(--text-secondary); font-size: 13px; border-radius: 0 6px 6px 0; }

.sparkline { width: 100%; height: 90px; display: block; }
.sparkline path { fill: none; stroke: var(--accent); stroke-width: 2; }

.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--border-color); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; margin: 24px 0; }
@media (max-width: 720px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.stat { background: var(--bg-panel); padding: 14px 16px; }
.stat b { display: block; font-size: 18px; font-weight: 600; }
.stat span { font-size: 12px; color: var(--text-secondary); }

footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border-color); font-size: 13px; color: var(--text-secondary); }
footer a { color: var(--accent-light); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/status-css.test.mjs`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add tools/assets/status.css tools/test/status-css.test.mjs
git commit -m "feat(status-site): add dark/light stylesheet on Moooom tokens"
```

---

### Task 4: Landing page renderer

**Files:**
- Create: `tools/lib/render-page.mjs`
- Test: `tools/test/render-index.test.mjs`

**Interfaces:**
- Consumes: `escapeHtml` (Task 1), `Day` and `summarise` (Task 2).
- Produces:
  - `Service = { name, slug, url, status, uptime, uptimeDay, uptimeWeek, uptimeMonth, uptimeYear, time, days: Day[] }`
  - `overallStatus(services: Service[]): "up"|"degraded"|"down"`
  - `renderBar(days: Day[]): string`
  - `renderIndex({ services, generatedAt, hero, repoUrl, i18n }): string`
  - `i18n = { allSystemsOperational: string, activeIncidents: string }`
  - `hero` is an SVG string or `""` when no illustration has been chosen yet.

- [ ] **Step 1: Write the failing test**

Create `tools/test/render-index.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { renderIndex, overallStatus, renderBar } from "../lib/render-page.mjs";

const days = (statuses) => statuses.map((status, i) => ({
  date: `2026-06-${String(i + 1).padStart(2, "0")}`,
  status, checks: status === "nodata" ? 0 : 1,
  avgResponseTimeMs: status === "nodata" ? null : 120,
}));

const service = (over = {}) => ({
  name: "Website", slug: "website", url: "https://nomercy.tv", status: "up",
  uptime: "99.87%", uptimeDay: "100.00%", uptimeWeek: "100.00%",
  uptimeMonth: "100.00%", uptimeYear: "99.87%", time: 620,
  days: days(["up", "up", "nodata"]), ...over,
});

const opts = (services) => ({
  services, generatedAt: new Date("2026-09-02T02:00:00Z"), hero: "",
  repoUrl: "https://github.com/NoMercy-Entertainment/nomercy-status",
  i18n: { allSystemsOperational: "All systems operational", activeIncidents: "Ongoing Incidents" },
});

test("overallStatus is up only when every service is up", () => {
  assert.equal(overallStatus([service(), service()]), "up");
  assert.equal(overallStatus([service(), service({ status: "degraded" })]), "degraded");
  assert.equal(overallStatus([service({ status: "degraded" }), service({ status: "down" })]), "down");
});

test("renderBar emits one element per day carrying its status class", () => {
  const html = renderBar(days(["up", "down", "nodata"]));
  assert.equal((html.match(/class="bar-day/g) || []).length, 3);
  assert.match(html, /bar-day up/);
  assert.match(html, /bar-day down/);
  assert.match(html, /bar-day nodata/);
});

test("nodata days are labelled as missing monitoring, not as uptime", () => {
  const html = renderBar(days(["nodata"]));
  assert.match(html, /no monitoring data/i);
  assert.doesNotMatch(html, /100%/);
});

test("renders one card per service", () => {
  const html = renderIndex(opts([service(), service({ name: "API", slug: "api" })]));
  assert.equal((html.match(/class="card"/g) || []).length, 2);
  assert.ok(html.includes("Website"));
  assert.ok(html.includes("API"));
});

test("banner reads all-clear when everything is up", () => {
  const html = renderIndex(opts([service()]));
  assert.ok(html.includes("All systems operational"));
  assert.doesNotMatch(html, /class="banner[^"]*is-down/);
});

test("banner names the failing services when something is down", () => {
  const html = renderIndex(opts([service(), service({ name: "API", slug: "api", status: "down" })]));
  assert.match(html, /class="banner[^"]*is-down/);
  assert.ok(html.includes("API"));
  assert.ok(!html.includes("All systems operational"));
});

test("cards link to their detail page", () => {
  const html = renderIndex(opts([service()]));
  assert.ok(html.includes('href="/history/website/"'));
});

test("dark theme is the default in the served markup", () => {
  const html = renderIndex(opts([service()]));
  assert.match(html, /<html[^>]+data-theme="dark"/);
});

test("service names are HTML-escaped", () => {
  const html = renderIndex(opts([service({ name: '<img src=x onerror=alert(1)>' })]));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
});

test("a nodata stretch produces an explanatory note", () => {
  const html = renderIndex(opts([service({ days: days(["nodata", "nodata", "up"]) })]));
  assert.match(html, /monitoring/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/render-index.test.mjs`
Expected: FAIL — `Cannot find module '../lib/render-page.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `tools/lib/render-page.mjs`:

```js
import { escapeHtml } from "./html.mjs";
import { summarise } from "./classify-days.mjs";

const RANK = { up: 0, degraded: 1, down: 2 };

const DAY_LABEL = {
  up: "operational",
  degraded: "degraded performance",
  down: "outage",
  nodata: "no monitoring data",
};

export function overallStatus(services) {
  let worst = "up";
  for (const service of services) {
    if ((RANK[service.status] ?? 0) > RANK[worst]) worst = service.status;
  }
  return worst;
}

export function renderBar(days) {
  return `<div class="bar" role="img" aria-label="Daily status for the last ${days.length} days">${days
    .map((day) => {
      const detail = day.checks
        ? `${day.checks} check${day.checks === 1 ? "" : "s"}`
        : DAY_LABEL[day.status];
      return `<i class="bar-day ${day.status}" title="${escapeHtml(day.date)} — ${escapeHtml(
        DAY_LABEL[day.status]
      )}${day.checks ? ` (${escapeHtml(detail)})` : ""}"></i>`;
    })
    .join("")}</div>`;
}

function layout({ title, body, extraHead = "" }) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="https://cdn.nomercy.tv/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/status.css">
${extraHead}</head>
<body>
<div class="wrap">
${body}
</div>
<script type="module" src="/status.js"></script>
</body>
</html>
`;
}

function topbar(active) {
  return `<div class="topbar">
  <strong>NoMercy Status</strong>
  <span>
    ${active === "index" ? "" : '<a href="/">← All services</a> '}
    <a href="https://nomercy.tv">Homepage</a>
    <button class="theme-toggle" type="button" data-theme-toggle>Theme</button>
  </span>
</div>`;
}

function legend() {
  return `<div class="legend">
  <span><i style="background:var(--up-solid)"></i>Operational</span>
  <span><i style="background:var(--degraded-solid)"></i>Degraded</span>
  <span><i style="background:var(--down-solid)"></i>Outage</span>
  <span><i style="background:var(--nodata)"></i>No monitoring data</span>
</div>`;
}

function card(service) {
  const stats = summarise(service.days);
  const uptime = stats.uptimePct === null ? "—" : `${stats.uptimePct.toFixed(2)}%`;
  return `<div class="card">
  <div class="card-head">
    <h2><a href="/history/${escapeHtml(service.slug)}/">${escapeHtml(service.name)}</a></h2>
    <span class="tag ${escapeHtml(service.status)}" data-status-for="${escapeHtml(service.slug)}">${escapeHtml(
    service.status
  )}</span>
  </div>
  ${renderBar(service.days)}
  <div class="bar-legend">
    <span>${service.days.length} days ago</span>
    <span>${uptime} uptime</span>
    <span>Today</span>
  </div>
</div>`;
}

export function renderIndex({ services, generatedAt, hero, repoUrl, i18n }) {
  const worst = overallStatus(services);
  const failing = services.filter((s) => s.status !== "up");
  const bannerClass = worst === "up" ? "" : worst === "down" ? " is-down" : " is-degraded";
  const bannerText =
    worst === "up"
      ? i18n.allSystemsOperational
      : `${i18n.activeIncidents}: ${failing.map((s) => s.name).join(", ")}`;

  const missing = services.some((s) => s.days.some((d) => d.status === "nodata"));
  const note = missing
    ? `<p class="note">Grey segments are days with no monitoring data — the checks were not running, so uptime is unknown for that period rather than assumed good.</p>`
    : "";

  return layout({
    title: "NoMercy Status",
    body: `${topbar("index")}
${hero ? `<div class="hero">${hero}</div>` : ""}
<div class="banner${bannerClass}" data-overall-banner>${escapeHtml(bannerText)}</div>
<h1>Current status</h1>
<div class="card-grid">
${services.map(card).join("\n")}
</div>
${legend()}
${note}
<footer>
  Updated <time datetime="${generatedAt.toISOString()}">${generatedAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 16)} UTC</time> ·
  <a href="${escapeHtml(repoUrl)}/issues?q=label%3Astatus">Incident history</a> ·
  <a href="${escapeHtml(repoUrl)}">Source</a>
</footer>`,
  });
}

export { layout, topbar, legend };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/render-index.test.mjs`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add tools/lib/render-page.mjs tools/test/render-index.test.mjs
git commit -m "feat(status-site): render the landing page with 90-day bars"
```

---

### Task 5: Detail page renderer

**Files:**
- Modify: `tools/lib/render-page.mjs`
- Test: `tools/test/render-detail.test.mjs`

**Interfaces:**
- Consumes: `layout`, `topbar`, `legend`, `renderBar` (Task 4); `Service` (Task 4).
- Produces:
  - `sparklinePath(days: Day[], width?: number, height?: number): string` — an SVG `d` attribute, `""` when fewer than two days carry a response time
  - `renderDetail({ service, generatedAt, repoUrl }): string`

- [ ] **Step 1: Write the failing test**

Create `tools/test/render-detail.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { renderDetail, sparklinePath } from "../lib/render-page.mjs";

const day = (date, status, avgResponseTimeMs) => ({
  date, status, checks: status === "nodata" ? 0 : 1, avgResponseTimeMs,
});

const service = (over = {}) => ({
  name: "API", slug: "api", url: "https://api.nomercy.tv/v1/server", status: "up",
  uptime: "99.90%", uptimeDay: "100.00%", uptimeWeek: "100.00%",
  uptimeMonth: "100.00%", uptimeYear: "99.90%", time: 596,
  days: [day("2026-06-01", "up", 100), day("2026-06-02", "up", 200), day("2026-06-03", "nodata", null)],
  ...over,
});

const opts = (over = {}) => ({
  service: service(), generatedAt: new Date("2026-09-02T02:00:00Z"),
  repoUrl: "https://github.com/NoMercy-Entertainment/nomercy-status", ...over,
});

test("sparklinePath skips days with no response time", () => {
  const d = sparklinePath([day("a", "up", 100), day("b", "nodata", null), day("c", "up", 200)]);
  assert.match(d, /^M/);
  assert.equal((d.match(/L/g) || []).length, 1); // two plotted points => one line segment
});

test("sparklinePath returns empty when there is nothing to plot", () => {
  assert.equal(sparklinePath([day("a", "nodata", null)]), "");
  assert.equal(sparklinePath([]), "");
});

test("detail page names the service and links its real target URL", () => {
  const html = renderDetail(opts());
  assert.ok(html.includes("API"));
  assert.ok(html.includes("https://api.nomercy.tv/v1/server"));
});

test("detail page shows all four uptime windows", () => {
  const html = renderDetail(opts());
  for (const label of ["24 hours", "7 days", "30 days", "1 year"]) {
    assert.ok(html.includes(label), `missing window: ${label}`);
  }
  assert.ok(html.includes("99.90%"));
});

test("detail page includes the 90-day bar and a sparkline", () => {
  const html = renderDetail(opts());
  assert.match(html, /class="bar"/);
  assert.match(html, /class="sparkline"/);
});

test("detail page links back to the landing page", () => {
  assert.match(renderDetail(opts()), /href="\/"/);
});

test("detail page escapes the service name", () => {
  const html = renderDetail(opts({ service: service({ name: "<script>x</script>" }) }));
  assert.ok(!html.includes("<script>x</script>"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/render-detail.test.mjs`
Expected: FAIL — `renderDetail is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `tools/lib/render-page.mjs`:

```js
export function sparklinePath(days, width = 600, height = 90) {
  const points = days
    .map((day, index) => ({ index, value: day.avgResponseTimeMs }))
    .filter((point) => typeof point.value === "number");
  if (points.length < 2) return "";

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lastIndex = days.length - 1 || 1;
  const pad = 6;
  const usable = height - pad * 2;

  return points
    .map((point, i) => {
      const x = (point.index / lastIndex) * width;
      const y = pad + (1 - (point.value - min) / span) * usable;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function renderDetail({ service, generatedAt, repoUrl }) {
  const stats = summarise(service.days);
  const observed = stats.uptimePct === null ? "—" : `${stats.uptimePct.toFixed(2)}%`;
  const path = sparklinePath(service.days);

  const windows = [
    ["24 hours", service.uptimeDay, service.timeDay],
    ["7 days", service.uptimeWeek, service.timeWeek],
    ["30 days", service.uptimeMonth, service.timeMonth],
    ["1 year", service.uptimeYear, service.timeYear],
  ];

  return layout({
    title: `${service.name} — NoMercy Status`,
    body: `${topbar("detail")}
<h1>${escapeHtml(service.name)}</h1>
<p><a href="${escapeHtml(service.url)}">${escapeHtml(service.url)}</a> ·
   <span class="tag ${escapeHtml(service.status)}">${escapeHtml(service.status)}</span></p>

<div class="stats">
${windows
  .map(
    ([label, uptime, time]) => `  <div class="stat">
    <b>${escapeHtml(uptime ?? "—")}</b>
    <span>${escapeHtml(label)}${time == null ? "" : ` · ${escapeHtml(String(time))} ms`}</span>
  </div>`
  )
  .join("\n")}
</div>

<h2>Last ${service.days.length} days</h2>
${renderBar(service.days)}
<div class="bar-legend">
  <span>${service.days.length} days ago</span>
  <span>${observed} uptime observed</span>
  <span>Today</span>
</div>
${legend()}

<h2>Response time</h2>
${
  path
    ? `<svg class="sparkline" viewBox="0 0 600 90" preserveAspectRatio="none" role="img" aria-label="Daily mean response time"><path d="${path}"/></svg>`
    : `<p class="note">Not enough response-time data to plot yet.</p>`
}

<footer>
  Updated <time datetime="${generatedAt.toISOString()}">${generatedAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 16)} UTC</time> ·
  <a href="${escapeHtml(repoUrl)}/issues?q=label%3Astatus">Incident history</a>
</footer>`,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/render-detail.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add tools/lib/render-page.mjs tools/test/render-detail.test.mjs
git commit -m "feat(status-site): render per-service detail pages"
```

---

### Task 6: Browser runtime

Theme toggle, live status overlay, and the service-worker eviction the spec calls out as a hazard.

**Files:**
- Create: `tools/assets/status.js`
- Test: `tools/test/status-js.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `evictLegacyServiceWorkers(nav, cacheStore): Promise<{ unregistered: number, cachesDeleted: number }>`
  - `resolveTheme(stored, prefersLight): "dark"|"light"`
  - `readStoredTheme(storage): string|null` — never throws
  - `applySummary(summary, doc): number` — returns how many tags it updated

Functions take their dependencies as parameters so they are testable under Node with no DOM. The file self-bootstraps only when `document` exists.

- [ ] **Step 1: Write the failing test**

Create `tools/test/status-js.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { evictLegacyServiceWorkers, resolveTheme, readStoredTheme, applySummary } from "../assets/status.js";

test("evicts every registered service worker and cache", async () => {
  // Sapper installs a service worker; left alone it serves the OLD page forever.
  let unregistered = 0;
  const deleted = [];
  const nav = { serviceWorker: { getRegistrations: async () => [
    { unregister: async () => { unregistered++; return true; } },
    { unregister: async () => { unregistered++; return true; } },
  ] } };
  const caches = { keys: async () => ["a", "b", "c"], delete: async (k) => { deleted.push(k); return true; } };

  const result = await evictLegacyServiceWorkers(nav, caches);
  assert.equal(unregistered, 2);
  assert.deepEqual(deleted, ["a", "b", "c"]);
  assert.equal(result.unregistered, 2);
  assert.equal(result.cachesDeleted, 3);
});

test("eviction is a no-op where the APIs are absent", async () => {
  const result = await evictLegacyServiceWorkers({}, undefined);
  assert.deepEqual(result, { unregistered: 0, cachesDeleted: 0 });
});

test("dark is the default, stored choice wins over system preference", () => {
  assert.equal(resolveTheme(null, false), "dark");
  assert.equal(resolveTheme(null, true), "light");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("nonsense", false), "dark");
});

test("readStoredTheme survives storage that throws", () => {
  assert.equal(readStoredTheme({ getItem() { throw new Error("denied"); } }), null);
  assert.equal(readStoredTheme({ getItem: () => "light" }), "light");
});

test("applySummary overwrites tag text and class from live data", () => {
  const tag = { className: "tag up", textContent: "up", dataset: { statusFor: "api" } };
  const doc = { querySelectorAll: () => [tag] };
  const updated = applySummary([{ slug: "api", status: "down" }], doc);
  assert.equal(updated, 1);
  assert.equal(tag.textContent, "down");
  assert.equal(tag.className, "tag down");
});

test("applySummary ignores services it has no tag for", () => {
  const doc = { querySelectorAll: () => [] };
  assert.equal(applySummary([{ slug: "ghost", status: "down" }], doc), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/status-js.test.mjs`
Expected: FAIL — cannot find `../assets/status.js`

- [ ] **Step 3: Write minimal implementation**

Create `tools/assets/status.js`:

```js
const SUMMARY_URL =
  "https://raw.githubusercontent.com/NoMercy-Entertainment/nomercy-status/HEAD/history/summary.json";

/**
 * Upptime's Sapper build registers a service worker. Returning visitors have it
 * cached and it will keep serving the OLD index.html over this page, so evict
 * it before anything else.
 */
export async function evictLegacyServiceWorkers(nav, cacheStore) {
  let unregistered = 0;
  let cachesDeleted = 0;

  try {
    if (nav?.serviceWorker?.getRegistrations) {
      for (const registration of await nav.serviceWorker.getRegistrations()) {
        await registration.unregister();
        unregistered++;
      }
    }
  } catch { /* nothing useful to do */ }

  try {
    if (cacheStore?.keys) {
      for (const key of await cacheStore.keys()) {
        await cacheStore.delete(key);
        cachesDeleted++;
      }
    }
  } catch { /* nothing useful to do */ }

  return { unregistered, cachesDeleted };
}

export function resolveTheme(stored, prefersLight) {
  if (stored === "dark" || stored === "light") return stored;
  return prefersLight ? "light" : "dark";
}

export function readStoredTheme(storage) {
  try {
    return storage?.getItem("nm-status-theme") ?? null;
  } catch {
    return null; // localStorage throws outright in some privacy modes
  }
}

export function writeStoredTheme(storage, theme) {
  try {
    storage?.setItem("nm-status-theme", theme);
  } catch { /* preference simply will not persist */ }
}

export function applySummary(summary, doc) {
  const bySlug = new Map(summary.map((entry) => [entry.slug, entry.status]));
  let updated = 0;
  for (const tag of doc.querySelectorAll("[data-status-for]")) {
    const status = bySlug.get(tag.dataset.statusFor);
    if (!status) continue;
    tag.textContent = status;
    tag.className = `tag ${status}`;
    updated++;
  }
  return updated;
}

if (typeof document !== "undefined") {
  const root = document.documentElement;

  const prefersLight =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
  root.dataset.theme = resolveTheme(readStoredTheme(globalThis.localStorage), prefersLight);

  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    button.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      writeStoredTheme(globalThis.localStorage, next);
    });
  }

  evictLegacyServiceWorkers(navigator, globalThis.caches);

  // The bars are baked in at build time; current status is fetched live.
  // On failure the page keeps the build-time values rather than showing nothing.
  fetch(SUMMARY_URL, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((summary) => applySummary(summary, document))
    .catch(() => { /* build-time values stand */ });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/status-js.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify the CORS assumption the spec flagged**

Run:
```bash
curl -sS -D - -o /dev/null -H "Origin: https://status.nomercy.tv" \
  https://raw.githubusercontent.com/NoMercy-Entertainment/nomercy-status/HEAD/history/summary.json \
  | grep -i "access-control-allow-origin\|^HTTP"
```
Expected: `HTTP/2 200` and `access-control-allow-origin: *`.
If the header is absent, stop and report it — the live overlay must then be dropped and the page rely on build-time values only.

- [ ] **Step 6: Commit**

```bash
git add tools/assets/status.js tools/test/status-js.test.mjs
git commit -m "feat(status-site): theme toggle, live status overlay, service-worker eviction"
```

---

### Task 7: Generator CLI

**Files:**
- Create: `tools/build-status-site.mjs`
- Test: `tools/test/build-output.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  - `buildSite({ cwd, outDir, endDate, dayCount }): { services: Service[], written: string[] }`
  - CLI: `node tools/build-status-site.mjs [--out assets] [--days 90]`

- [ ] **Step 1: Write the failing test**

Create `tools/test/build-output.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/build-output.test.mjs`
Expected: FAIL — cannot find `../build-status-site.mjs`

- [ ] **Step 3: Write minimal implementation**

Create `tools/build-status-site.mjs`:

```js
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
  heroPath = join(HERE, "..", "assets", "hero.svg"),
} = {}) {
  const summary = JSON.parse(readFileSync(join(cwd, "history", "summary.json"), "utf8"));

  const services = summary.map((entry) => ({
    ...entry,
    days: classifyDays(readObservations(entry.slug, cwd), endDate, dayCount),
  }));

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

  write("index.html", renderIndex({ services, generatedAt: endDate, hero, repoUrl: REPO_URL, i18n }));

  for (const service of services) {
    write(
      join("history", service.slug, "index.html"),
      renderDetail({ service, generatedAt: endDate, repoUrl: REPO_URL })
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/build-output.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Run the whole suite and generate for real**

Run:
```bash
node --test tools/test/
node tools/build-status-site.mjs
```
Expected: all suites pass; `built 10 files for 7 services` (1 index + 7 detail + 2 assets).

Preview over HTTP, **not** `file://` — the pages reference `/status.css` and
`/history/<slug>/` as absolute paths, which only resolve from a server root:

```bash
python -m http.server 8080 --directory assets
```

Open `http://localhost:8080/`. Confirm by eye: dark by default, seven cards, a
long grey band mid-bar, the toggle switches to light and the choice survives a
reload. Click a card through to its detail page.

- [ ] **Step 6: Commit**

```bash
git add tools/build-status-site.mjs tools/test/build-output.test.mjs assets/
git commit -m "feat(status-site): generate the static status site into assets/"
```

---

### Task 8: Regeneration workflow and first deploy

**Files:**
- Create: `.github/workflows/status-site.yml`
- Test: manual dispatch plus live verification

**Interfaces:**
- Consumes: `tools/build-status-site.mjs` (Task 7).
- Produces: a daily commit to `assets/`, which triggers Static Site CI.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/status-site.yml`. The name is deliberately **not** one
of Upptime's eight, so `update-template` will not delete it.

```yaml
# Hand-maintained. Upptime's update-template only rewrites its own eight
# workflows, so this filename must never collide with them.
name: Status Site CI
on:
  schedule:
    - cron: "30 0 * * *"
  workflow_dispatch:
concurrency:
  group: ${{ github.repository }}-status-site
  cancel-in-progress: false
jobs:
  build:
    name: Rebuild status site
    runs-on: [self-hosted, Linux, X64, beast-unit]
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ secrets.GH_PAT || github.token }}
      - name: Run tests
        run: node --test tools/test/
      - name: Build
        run: node tools/build-status-site.mjs
      - name: Commit when changed
        run: |
          git config user.name "Upptime Bot"
          git config user.email "73812536+upptime-bot@users.noreply.github.com"
          git add assets/
          if git diff --cached --quiet; then
            echo "no changes"
            exit 0
          fi
          # No [skip ci]: this commit must trigger Static Site CI to deploy.
          git commit -m "chore(status-site): rebuild status page"
          git push
```

`fetch-depth: 0` is required — the generator reads the full commit history of
each `history/*.yml`, and a shallow clone would silently yield empty bars.

- [ ] **Step 2: Validate the YAML**

Run:
```bash
python -c "
import yaml; d = yaml.safe_load(open('.github/workflows/status-site.yml', encoding='utf-8'))
j = d['jobs']['build']
print('runs-on:', j['runs-on'])
print('steps:', [s.get('name') for s in j['steps']])
assert j['steps'][0]['with']['fetch-depth'] == 0
print('OK')
"
```
Expected: the four self-hosted labels, five steps, `OK`.

- [ ] **Step 3: Confirm the filename cannot be clobbered**

Run:
```bash
git show upptime/uptime-monitor 2>/dev/null; \
curl -sS https://raw.githubusercontent.com/upptime/uptime-monitor/master/src/update-template.ts \
  | grep -oE '"[a-z-]+\.yml"' | sort -u
```
Expected: the eight Upptime-owned names. Assert `status-site.yml` is **not** among them.

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/status-site.yml
git commit -m "ci: rebuild the status site daily and on demand"
git push origin master
```

- [ ] **Step 5: Dispatch and verify end to end**

Run:
```bash
gh workflow run status-site.yml --ref master
sleep 15
gh run watch "$(gh run list --workflow=status-site.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
gh run watch "$(gh run list --workflow=site.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```
Expected: both succeed; the second is Static Site CI, triggered by the `assets/` commit.

Then confirm the deployed page is ours, not Sapper's:
```bash
curl -sS "https://status.nomercy.tv/?cb=$RANDOM" | grep -c "card-grid"
curl -sS -o /dev/null -w "%{http_code}\n" https://status.nomercy.tv/history/website/
```
Expected: `1` or more, and `200`.

- [ ] **Step 6: Commit any fixes**

If the deploy did not take, the most likely causes in order: `assets/` not
copied (check the Static Site CI log for the `cp -r ../assets/*` step),
a cached service worker (hard-reload), or Cloudflare caching (append a query
string). Fix, commit, re-dispatch.

---

### Task 9: Five hero illustrations

**Files:**
- Create: `docs/illustrations/hero-{1..5}.svg`
- Create: `docs/illustrations/index.html` (picker)

**Interfaces:**
- Consumes: the theme tokens from Task 3 — every illustration must draw using
  `currentColor` or `var(--accent)` / `var(--text-secondary)` so it recolours
  with the theme rather than carrying baked-in hex.
- Produces: five candidate SVGs plus a picker page.

- [ ] **Step 1: Draw five illustrations in five distinct styles**

All on the NoMercy media-server theme. Each must be a standalone `<svg>` with
`viewBox="0 0 960 220"`, `preserveAspectRatio="xMidYMid meet"`, no `width`/
`height` attributes, and no hardcoded colours outside the theme variables.

1. `hero-1.svg` — **Machine room, line art.** Hard-hatted characters tending a
   contraption that feeds film reels onto a conveyor and out to a TV. The
   closest analogue to GitHub's scene.
2. `hero-2.svg` — **Isometric server rack.** Rack units, patch cables, a small
   character swapping a drive; clean geometric solids.
3. `hero-3.svg` — **Signal flow, minimal.** Towers and waveforms carrying a
   stream left to right through relay nodes; no characters.
4. `hero-4.svg` — **Retro cinema.** Projector throwing a beam across the frame
   onto a screen showing the NoMercy mark, dust motes in the light.
5. `hero-5.svg` — **Playful mascots.** Small round characters passing media
   between them in a relay, thick friendly strokes.

- [ ] **Step 2: Verify each is valid, self-contained and themeable**

Run:
```bash
for f in docs/illustrations/hero-*.svg; do
  printf "%-34s " "$f"
  python -c "
import sys, xml.dom.minidom as m
d = m.parse('$f')
svg = d.documentElement
assert svg.tagName == 'svg', 'root is not <svg>'
assert svg.getAttribute('viewBox') == '0 0 960 220', 'wrong viewBox'
assert not svg.getAttribute('width'), 'must not set width'
print('valid,', len(d.getElementsByTagName('*')), 'nodes')
"
done
grep -l "#[0-9a-fA-F]\{3,6\}" docs/illustrations/hero-*.svg && echo "HARDCODED COLOUR FOUND" || echo "all themeable"
```
Expected: five `valid` lines, then `all themeable`.

- [ ] **Step 3: Build the picker page**

`docs/illustrations/index.html` shows all five stacked, each labelled with its
style name and filename, on the real page background, with a dark/light toggle
so both themes can be judged. Inline the five SVGs directly.

- [ ] **Step 4: Publish the picker for review**

Publish `docs/illustrations/index.html` as an Artifact so the choice can be made
by looking. Report the URL.

- [ ] **Step 5: Commit**

```bash
git add docs/illustrations/
git commit -m "feat(status-site): five candidate hero illustrations"
```

---

### Task 10: Wire in the chosen illustration

**Files:**
- Create: `assets/hero.svg`
- Test: `tools/test/build-output.test.mjs` (extend)

**Interfaces:**
- Consumes: the chosen file from Task 9; `buildSite` (Task 7).
- Produces: `assets/hero.svg`, inlined into the landing page.

- [ ] **Step 1: Write the failing test**

Append to `tools/test/build-output.test.mjs`:

```js
test("the chosen hero is inlined into the landing page", () => {
  const outDir = out();
  buildSite({ outDir, endDate: new Date("2026-09-02T12:00:00Z"), dayCount: 90 });
  const html = readFileSync(join(outDir, "index.html"), "utf8");
  assert.match(html, /<div class="hero"><svg/);
  assert.match(html, /viewBox="0 0 960 220"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/test/build-output.test.mjs`
Expected: FAIL — no `<div class="hero">` because `assets/hero.svg` is absent.

- [ ] **Step 3: Install the chosen illustration**

```bash
cp docs/illustrations/hero-<N>.svg assets/hero.svg   # N = the chosen candidate
node tools/build-status-site.mjs
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/test/`
Expected: all suites PASS.

- [ ] **Step 5: Commit, push, verify live**

```bash
git add assets/
git commit -m "feat(status-site): add the hero illustration"
git push origin master
gh run watch "$(gh run list --workflow=site.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
curl -sS "https://status.nomercy.tv/?cb=$RANDOM" | grep -c "class=\"hero\""
```
Expected: Static Site CI succeeds and the hero is present on the live page.

---

## Done when

- `node --test tools/test/` passes every suite.
- `https://status.nomercy.tv/` serves the new page, dark by default, with a working light toggle that survives reload.
- Seven cards, each with 90 segments; the 2026-06-17 → 2026-09-02 band is grey and explained.
- `https://status.nomercy.tv/history/website/` resolves and matches the design.
- Status Site CI and Static Site CI are both green.
- `.github/workflows/` still contains Upptime's eight generated files, unmodified.
