#!/usr/bin/env sh
set -eu

PORT="${FRIDAY_UI_PORT:-3010}"
MAX_ATTEMPTS=16
RETRY_DELAY_SECONDS=2

if command -v docker >/dev/null 2>&1; then
  docker compose config >/dev/null
  if docker ps --format '{{.Names}}' | grep -qx 'friday'; then
    echo "friday container: running"
  else
    echo "friday container: not running" >&2
    exit 1
  fi
fi

check_http_endpoints() {
  curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 &&
    curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 &&
    curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/overview" >/dev/null 2>&1
}

if command -v curl >/dev/null 2>&1; then
  attempt=1
  while ! check_http_endpoints; do
    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
      echo "Friday health and overview endpoints did not become ready after ${MAX_ATTEMPTS} attempts" >&2
      exit 1
    fi
    if [ "$attempt" -eq 1 ]; then
      echo "Friday endpoints are still starting; retrying up to ${MAX_ATTEMPTS} attempts (2 seconds apart; 5 seconds per HTTP request)..."
    fi
    sleep "$RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
  echo "Friday health and overview endpoints: ok"
else
  echo "curl not installed; skipped HTTP health checks"
fi
