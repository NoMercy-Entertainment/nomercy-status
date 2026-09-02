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
