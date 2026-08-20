#!/usr/bin/env sh
set -eu

PORT="${FRIDAY_UI_PORT:-3010}"
HEALTH_ATTEMPTS="${FRIDAY_HEALTH_ATTEMPTS:-15}"
HEALTH_RETRY_SECONDS="${FRIDAY_HEALTH_RETRY_SECONDS:-2}"

if command -v docker >/dev/null 2>&1; then
  docker compose config >/dev/null
  if docker ps --format '{{.Names}}' | grep -qx 'friday'; then
    echo "friday container: running"
  else
    echo "friday container: not running" >&2
    exit 1
  fi
fi

if command -v curl >/dev/null 2>&1; then
  attempt=1
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null \
      && curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null \
      && curl -fsS "http://127.0.0.1:${PORT}/api/overview" >/dev/null; then
      echo "Friday health and overview endpoints: ok"
      exit 0
    fi

    if [ "$attempt" -lt "$HEALTH_ATTEMPTS" ]; then
      echo "Friday health checks not ready (attempt ${attempt}/${HEALTH_ATTEMPTS}); retrying..." >&2
      sleep "$HEALTH_RETRY_SECONDS"
    fi
    attempt=$((attempt + 1))
  done

  echo "Friday health checks failed after ${HEALTH_ATTEMPTS} attempts" >&2
  exit 1
else
  echo "curl not installed; skipped HTTP health checks"
fi
