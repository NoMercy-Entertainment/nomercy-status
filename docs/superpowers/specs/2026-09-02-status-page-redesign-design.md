# Status page redesign — design

**Date:** 2026-09-02
**Repo:** `nomercy-status`
**Status:** approved, not yet implemented

## Goal

Replace Upptime's stock Sapper status page with a dashboard modelled on
`githubstatus.com`: a hero illustration, an overall status banner, and a grid of
service cards each carrying a 90-day uptime bar. Rendered in the NoMercy design
system (Moooom) with dark and light themes, dark by default.

## Constraints

1. **Do not break the generated-workflow model.** All eight files in
   `.github/workflows/` are regenerated wholesale by `upptime update-template`.
   Nothing in this design may require editing them.
2. **Do not regress the monitoring pipeline.** CI was dead for 77 days
   (2026-06-17 to 2026-09-02); the page redesign must not put it back at risk.
3. **The page must be honest.** It must not imply uptime for periods when no
   monitoring ran.

## Architecture

### Build and deploy path

`src/site.ts` in `uptime-monitor` ends its build with:

```js
if (assetsExists) cp("-r", "../assets/*", "status-page/__sapper__/export");
```

Anything in the repo's `assets/` directory is copied **over** Upptime's own
export, `index.html` included. That is the integration point: the generator
writes into `assets/`, and the existing, unmodified Static Site CI deploys it.

The generated `site.yml` already carries `on: push: paths: ["assets/**"]`, so a
commit that touches `assets/` triggers the deploy on its own.

```
tools/build-status-site.mjs          generator, Node, no dependencies
  reads   history/summary.json       site list + current metrics
          git log history/<slug>.yml per-day time series
          assets/hero.svg            chosen illustration (committed separately)
  writes  assets/index.html
          assets/history/<slug>/index.html   one per site
          assets/status.css
          assets/status.js

.github/workflows/status-site.yml    NEW filename, survives update-template
  on: schedule "30 0 * * *", workflow_dispatch
  runs the generator, commits assets/ when the output changed
  that commit lands on assets/** -> Static Site CI deploys
```

The workflow name must not collide with the eight Upptime-owned names
(`graphs`, `response-time`, `setup`, `site`, `summary`, `update-template`,
`updates`, `uptime`); `update-template` deletes exactly those and no others.

The generator's commit must **not** contain `[skip ci]`, because Static Site CI
is guarded by `if: "!contains(github.event.head_commit.message, '[skip ci]')"`
and we want it to run. `status-site.yml` triggers only on schedule and manual
dispatch, never on push, so there is no loop.

### Data sources

**Cards** come from `history/summary.json`, which already carries every field
needed: `name`, `url`, `icon`, `slug`, `status`, `uptime`, `uptimeDay`,
`uptimeWeek`, `uptimeMonth`, `uptimeYear`, `time`, `timeDay`, `timeWeek`,
`timeMonth`, `timeYear`, `dailyMinutesDown`.

**The 90-day series** is reconstructed from git history of
`history/<slug>.yml`. Every commit encodes one observation in its message:

```
🔔 Website is up (200 in 507 ms)
🔔 Website is down (0 in 0 ms)
🟩 Website is up (200 in 385 ms) [skip ci] [upptime]
```

Parse with two expressions:

- status: `/\bis (up|down|degraded)\b/`
- code and response time: `/\((\d+) in (\d+) ms\)/`

**Parse the words, never the emoji.** Every commit before 2026-09-02 uses the
`🔔` prefix, because the repo previously hard-coded it in place of `$PREFIX`.
Emoji-based parsing would misread the entire history as down. The words have
been stable across that change.

Timestamps come from `git log --format=%aI` and are bucketed by **UTC** date.

### Day classification

For each site, for each of the last 90 UTC days:

1. Collect all observations falling on that day.
2. If there is at least one: the day's status is the **worst** observed
   (`down` > `degraded` > `up`). Record the count and the mean response time.
3. If there are none: look at the nearest observation before the day and the
   nearest after.
   - If both exist and are **less than 48 hours apart**, carry the earlier
     status forward. This keeps normally sparse healthy stretches green —
     commits only occur on status change plus one forced daily commit, so 1–2
     day gaps are routine.
   - Otherwise the day is **`nodata`**.
4. Days before the site's first observation are `nodata`.

The 48-hour threshold is chosen because Response Time CI runs
`update(shouldCommit = true)` daily, forcing a commit for every site regardless
of status change. A silence longer than 48h therefore means the pipeline was not
running, not that nothing changed.

This renders the 2026-06-17 to 2026-09-02 outage as a labelled grey band rather
than as false green. `App`, `Docs` and `Packages` will be almost entirely grey
until they accumulate history; this is correct and self-healing.

### Freshness

The 90-day bars change at most once a day, so they are baked into the HTML at
build time. Current status changes every five minutes, so `status.js` fetches
`history/summary.json` from `raw.githubusercontent.com` at
`.../nomercy-status/HEAD/history/summary.json` on load and overlays the live
values.

If that fetch fails the page keeps the values baked in at build time and shows
an "as of &lt;timestamp&gt;" note. The page must never render empty or
error-only: a status page is read precisely when things are broken.

This costs exactly one request per page load, so it cannot hit the
unauthenticated GitHub API rate limit the way per-service API calls would.
`raw.githubusercontent.com` serves `Access-Control-Allow-Origin: *`, so the
cross-origin fetch from `status.nomercy.tv` succeeds without a proxy. Verify
this holds during implementation rather than assuming it.

### Service worker hazard

Upptime's Sapper build registers a service worker, and `gh-pages` currently
serves `service-worker.js` and `service-worker-index.html`. Any returning
visitor has it installed and cached, and it will serve the **old** `index.html`
over the new page, potentially indefinitely.

`assets/index.html` must therefore, on load:

1. Call `navigator.serviceWorker.getRegistrations()` and unregister each one.
2. Delete every entry in `caches.keys()`.

Both guarded for absence (`'serviceWorker' in navigator`, `'caches' in window`)
so the page still works where the APIs are unavailable. Without this the
redesign appears broken only for people who visited before, which is the hardest
class of bug to reproduce.

## Pages

### Landing page — `assets/index.html`

- Hero illustration (inline SVG, theme-aware).
- Overall banner: "All Systems Operational" when every site is up; otherwise
  naming the degraded or down services. Uses the `i18n` strings already in
  `.upptimerc.yml` (`allSystemsOperational`, `activeIncidents`).
- Service card grid, two columns on desktop, one on narrow screens. Each card:
  service name, live status dot, 90-day bar, `90 days ago … N% uptime … Today`,
  and current response time.
- Theme toggle.
- Link to the repo's Issues as incident history — Upptime already records every
  incident there and closes it on recovery.

### Detail pages — `assets/history/<slug>/index.html`

One per site. `gh-pages` currently has **no** `/history` directory — Upptime's
detail views are client-side SPA routes with no exported files — so these are
purely additive and take precedence over the SPA fallback.

Each carries: the service name and URL, current status, the same 90-day bar,
uptime figures across day/week/month/year, and a response-time sparkline drawn
as inline SVG from the same git series. Plus a link back to the landing page.

## Theming

CSS custom properties on `:root`, with `[data-theme="light"]` and
`[data-theme="dark"]` overrides and a `prefers-color-scheme` media query.
Default is dark when nothing is stored and no preference is expressed.

Tokens are the Moooom dark and light scales already used in `.upptimerc.yml`,
sourced from `nomercy-app-web/src/components/nm/tokens.css`. Status colours
reuse the existing decisions: solid step-9 for bars and borders, and the
surface+text pairing (step-3 background, step-11 text) for tags, because white
on `grass-9` is only 3.0:1 while `grass-11` on `grass-3` is about 7.8:1.

`nodata` gets a neutral `slate-6`-derived fill, visually recessive so an outage
reads as absence rather than as a fourth alarm state.

Theme choice persists in `localStorage`, wrapped in try/catch — it throws in
some privacy modes.

## Illustrations

Five hand-authored SVGs in five distinct styles, all on the NoMercy
media-server theme. Delivered as a picker page so the choice is made by looking
rather than by reading descriptions. The chosen file becomes `assets/hero.svg`
and is inlined into the generated pages so it can inherit theme tokens.

SVG rather than raster: crisp at any size, a few KB, and able to reference CSS
custom properties so it recolours with the theme.

Build order: the five candidates and the picker come first, the choice is made,
and only then is `assets/hero.svg` wired in. The generator must therefore treat
a missing `assets/hero.svg` as non-fatal and emit the page without a hero, so
the rest of the work is not blocked on the decision.

## Testing

The generator is pure — git history in, HTML out — so it is testable without
network or CI:

1. **Parser tests.** Feed known commit-message strings, including the historical
   `🔔` shape, the current `🟩 … [skip ci] [upptime]` shape, and the `(0 in 0 ms)`
   failure shape. Assert extracted status, code and response time.
2. **Day-classification tests.** Synthetic observation sets covering: a normal
   sparse healthy stretch (must stay `up`, not `nodata`), a >48h gap (must be
   `nodata`), a day with mixed observations (must take the worst), and days
   before first observation (must be `nodata`).
3. **Output assertions.** Run against the real repo and assert: 7 cards, 90 bars
   per site, the June–September band classified `nodata`, and the known
   2026-03-16 / 03-22 / 04-09 / 04-10 / 04-16 down days classified `down`.
4. **Deploy verification.** After the first deploy, confirm the served
   `index.html` is ours and not Sapper's, and that a detail page resolves.

Item 3 is the important one: it pins the two behaviours most likely to regress
silently — emoji-vs-words parsing and gap handling.

## Out of scope

- Changing the monitoring configuration or check definitions; those were settled
  earlier today.
- Notifications; the repo deliberately uses GitHub Issues as its incident record.
- `nomercy.tv`'s 4.4 MB homepage — that size is intentional, a large SVG.
- Replacing Upptime's Sapper build. It continues to run and its output stays
  underneath ours. Removing it would mean editing generated workflows, which
  constraint 1 forbids for a purely cosmetic gain.
