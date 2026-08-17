#!/usr/bin/env sh
set -eu

PORT="${FRIDAY_UI_PORT:-3010}"

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
  curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null
  curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null
  curl -fsS "http://127.0.0.1:${PORT}/api/overview" >/dev/null
  echo "Friday health and overview endpoints: ok"
else
  echo "curl not installed; skipped HTTP health checks"
fi
