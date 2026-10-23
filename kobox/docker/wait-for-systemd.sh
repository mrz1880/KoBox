#!/usr/bin/env bash
# Waits until systemd (PID 1 of the kobox-dev service) reports running or
# degraded. Called by `make up` right after `docker compose up -d`; the Makefile
# exports COMPOSE_PROJECT_NAME, which picks this checkout's container.
# Fails fast if the container exits during boot, and dumps the compose logs on
# any failure so the cause is visible.
set -euo pipefail

: "${COMPOSE_PROJECT_NAME:?run through make, which names the compose project of this checkout}"

SERVICE=kobox-dev
BOOT_ATTEMPTS=30
BOOT_POLL_INTERVAL_SECONDS=2
COMPOSE_FILE="$(cd "$(dirname "$0")" && pwd)/docker-compose.yml"

fail() {
  # GitHub Actions turns ::error:: lines into annotations; elsewhere a plain line.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error::$1" >&2
  else
    echo "error: $1" >&2
  fi
  docker compose -f "$COMPOSE_FILE" logs >&2
  exit 1
}

# -a: an exited container must still resolve, so the loop reports it as exited.
container=$(docker compose -f "$COMPOSE_FILE" ps -aq "$SERVICE")
[ -n "$container" ] || fail "no $SERVICE container in project $COMPOSE_PROJECT_NAME"

for _ in $(seq 1 "$BOOT_ATTEMPTS"); do
  state=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo false)
  if [ "$state" != "true" ]; then
    fail "$SERVICE exited during boot"
  fi
  # is-system-running exits non-zero on "degraded" too, so read its output
  # rather than its status (under pipefail a pipe into grep would fail).
  systemd_state=$(docker exec "$container" systemctl is-system-running 2>/dev/null || true)
  case "$systemd_state" in
    running | degraded)
      echo "systemd is up ($systemd_state)"
      exit 0
      ;;
  esac
  sleep "$BOOT_POLL_INTERVAL_SECONDS"
done
fail "systemd did not come up"
