#!/usr/bin/env bash
#
# Trigger an uptime check on demand.
#
# Why this exists: `.upptimerc.yml` asks for a check every five minutes, but
# GitHub treats `schedule` as best-effort and drops most of them. Measured over
# 200 runs of this repository, the five-minute cron actually fired roughly five
# to seven times a day -- median gap 34 minutes, 90th percentile 3.7 hours,
# worst observed 12 hours. An outage can therefore sit unnoticed for hours.
#
# `uptime.yml` also accepts `repository_dispatch: types: [uptime]`, which is not
# throttled. Running this from a real scheduler on a machine you control gives
# the cadence the config already promises, with GitHub's own schedule left in
# place as a fallback.
#
# Usage:
#   NOMERCY_STATUS_TOKEN=ghp_xxx tools/dispatch-uptime.sh
#
# The token needs write access to this repository only:
#   fine-grained -> Contents: read and write
#   classic      -> repo
#
# Exit codes: 0 dispatched, 1 configuration error, 2 GitHub rejected the call.

set -euo pipefail

REPO="${NOMERCY_STATUS_REPO:-NoMercy-Entertainment/nomercy-status}"
EVENT="${NOMERCY_STATUS_EVENT:-uptime}"

if [ -z "${NOMERCY_STATUS_TOKEN:-}" ]; then
  echo "dispatch-uptime: NOMERCY_STATUS_TOKEN is not set" >&2
  echo "  export it, or put it in an EnvironmentFile for the systemd unit." >&2
  exit 1
fi

response="$(mktemp)"
trap 'rm -f "$response"' EXIT

code="$(
  curl --silent --show-error --location \
    --max-time 30 \
    --write-out '%{http_code}' \
    --output "$response" \
    --request POST \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${NOMERCY_STATUS_TOKEN}" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    --data "{\"event_type\":\"${EVENT}\"}" \
    "https://api.github.com/repos/${REPO}/dispatches"
)"

# A successful dispatch is 204 No Content, with an empty body.
if [ "$code" = "204" ]; then
  echo "dispatch-uptime: requested '${EVENT}' on ${REPO}"
  exit 0
fi

echo "dispatch-uptime: GitHub returned HTTP ${code}" >&2
sed 's/^/  /' "$response" >&2 || true
case "$code" in
  401) echo "  the token is invalid or expired" >&2 ;;
  403) echo "  the token lacks write access to ${REPO}" >&2 ;;
  404) echo "  repository not found, or the token cannot see it" >&2 ;;
esac
exit 2
