#!/usr/bin/env sh
set -eu

PORT="${FRIDAY_UI_PORT:-3010}"
FAILED=0

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    printf 'ok   %-18s %s\n' "$1" "$(command -v "$1")"
  else
    printf 'FAIL %-18s missing\n' "$1" >&2
    FAILED=1
  fi
}

printf '%s\n' 'Friday VM102 controller preflight (read-only)'
printf '%s\n' '---------------------------------------------'
check_cmd git
check_cmd docker
check_cmd curl

if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    echo 'ok   docker compose     available'
  else
    echo 'FAIL docker compose     unavailable' >&2
    FAILED=1
  fi

  if docker info >/dev/null 2>&1; then
    echo 'ok   docker daemon      reachable'
  else
    echo 'FAIL docker daemon      not reachable by current user' >&2
    FAILED=1
  fi
fi

if [ -f .env ]; then
  echo 'ok   .env               present'
else
  echo 'WARN .env               missing; copy .env.example before deployment'
fi

if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${PORT}$"; then
    echo "WARN port ${PORT}           already listening; inspect before starting Friday"
  else
    echo "ok   port ${PORT}           available"
  fi
fi

if [ -f .env ]; then
  MODE=$(grep '^FRIDAY_MODE=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  DOCKER_ENABLED=$(grep '^FRIDAY_DOCKER_ENABLED=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  PROXMOX_ENABLED=$(grep '^FRIDAY_PROXMOX_ENABLED=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  PROXMOX_SECRET=$(grep '^FRIDAY_PROXMOX_TOKEN_SECRET=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  OBSERVER_ENABLED=$(grep '^FRIDAY_VM100_OBSERVER_ENABLED=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  OBSERVER_URL=$(grep '^FRIDAY_VM100_OBSERVER_URL=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  OBSERVER_TOKEN=$(grep '^FRIDAY_VM100_OBSERVER_TOKEN=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  AI_ENABLED=$(grep '^FRIDAY_AI_ENABLED=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  OPENAI_KEY=$(grep '^OPENAI_API_KEY=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)

  if [ "$MODE" = 'live' ] && [ "$DOCKER_ENABLED" = 'true' ] && [ ! -S /var/run/docker.sock ]; then
    echo 'FAIL local Docker requested but Docker socket is unavailable' >&2
    FAILED=1
  fi
  if [ "$PROXMOX_ENABLED" = 'true' ] && [ -z "$PROXMOX_SECRET" ]; then
    echo 'FAIL Proxmox enabled but FRIDAY_PROXMOX_TOKEN_SECRET is empty' >&2
    FAILED=1
  fi
  if [ "$OBSERVER_ENABLED" = 'true' ] && { [ -z "$OBSERVER_URL" ] || [ -z "$OBSERVER_TOKEN" ]; }; then
    echo 'FAIL VM100 observer enabled but URL or token is empty' >&2
    FAILED=1
  fi
  if [ "$AI_ENABLED" = 'true' ] && [ -z "$OPENAI_KEY" ]; then
    echo 'FAIL Friday AI enabled but OPENAI_API_KEY is empty' >&2
    FAILED=1
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  echo 'Friday controller preflight failed.' >&2
  exit 1
fi

echo 'Friday controller preflight completed without blocking errors.'
