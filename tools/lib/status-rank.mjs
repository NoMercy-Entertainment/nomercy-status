/**
 * The single definition of how service states compare.
 *
 * This lived in two modules independently, which is a quiet hazard on a status
 * page: if the two copies ever disagreed, the day classifier and the page
 * renderer would reach different conclusions about the same data, and the bar
 * would contradict the banner above it.
 */
const RANK = { up: 0, degraded: 1, down: 2 };

/**
 * Anything unrecognised is treated as the WORST case, never the best. An
 * unknown value means we do not know the service is healthy, and a status page
 * that resolves uncertainty in its own favour is worse than useless.
 */
export function normaliseStatus(status) {
  return status === "up" || status === "degraded" || status === "down" ? status : "down";
}

/** Rank of a status; unknown values rank as the worst. */
export function rankOf(status) {
  return RANK[normaliseStatus(status)];
}

/** The worst status in a list. Returns "up" for an empty list. */
export function worstStatus(statuses) {
  let worst = "up";
  for (const status of statuses) {
    if (rankOf(status) > rankOf(worst)) worst = normaliseStatus(status);
  }
  return worst;
}
