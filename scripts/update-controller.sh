#!/usr/bin/env sh
set -eu

APP_DIR="${FRIDAY_APP_DIR:-/srv/infrastructure/apps/friday}"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Friday repository not found at $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

if [ -n "$(git status --porcelain)" ]; then
  echo "Friday working tree has local changes; refusing to update." >&2
  git status --short >&2
  exit 2
fi

[ -f .env ] || cp .env.example .env
sh scripts/preflight-controller.sh

MODE=$(grep '^FRIDAY_MODE=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
LOCAL_DOCKER=$(grep '^FRIDAY_DOCKER_ENABLED=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)

printf '%s\n' 'Fetching Friday updates...'
git fetch origin main
printf '%s\n' 'Fast-forwarding main...'
git checkout main
git pull --ff-only origin main

if [ "$MODE" = 'live' ] && [ "$LOCAL_DOCKER" = 'true' ]; then
  echo 'Validating live controller Compose with local Docker override...'
  docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
  echo 'Building and restarting Friday with local Docker observation...'
  docker compose -f compose.yaml -f compose.live.yaml up -d --build
else
  echo 'Validating controller Compose configuration...'
  docker compose config >/dev/null
  echo 'Building and restarting Friday without local Docker socket mount...'
  docker compose up -d --build
fi

sh scripts/verify.sh
