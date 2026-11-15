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
NONROOT=$(grep '^FRIDAY_CONTROLLER_NONROOT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
# Non-root controller (compose.nonroot.yaml) only after the data volume copy.
EXTRA=''
if [ "$NONROOT" = 'true' ]; then
  docker volume inspect friday_data_nonroot >/dev/null 2>&1 || {
    echo 'FRIDAY_CONTROLLER_NONROOT=true but volume friday_data_nonroot does not exist; run scripts/migrate-friday-data-nonroot.sh first' >&2
    exit 1
  }
  EXTRA='-f compose.nonroot.yaml'
  echo 'Running the controller as UID 10001 (compose.nonroot.yaml).'
fi

printf '%s\n' 'Fetching Friday updates...'
git fetch origin main
printf '%s\n' 'Fast-forwarding main...'
git checkout main
git pull --ff-only origin main

if [ "$MODE" = 'live' ] && [ "$LOCAL_DOCKER" = 'true' ]; then
  echo 'Validating live controller Compose with local Docker override...'
  docker compose -f compose.yaml -f compose.live.yaml $EXTRA config >/dev/null
  echo 'Building and restarting Friday with local Docker observation...'
  docker compose -f compose.yaml -f compose.live.yaml $EXTRA up -d --build
else
  echo 'Validating controller Compose configuration...'
  docker compose -f compose.yaml $EXTRA config >/dev/null
  echo 'Building and restarting Friday without local Docker socket mount...'
  docker compose -f compose.yaml $EXTRA up -d --build
fi

sh scripts/verify.sh
