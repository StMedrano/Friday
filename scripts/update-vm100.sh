#!/usr/bin/env sh
set -eu

APP_DIR="${FRIDAY_APP_DIR:-/srv/infrastructure/apps/friday}"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Friday repository not found at $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

echo "Fetching Friday updates..."
git fetch origin main

echo "Fast-forwarding main..."
git checkout main
git pull --ff-only origin main

[ -f .env ] || cp .env.example .env

echo "Validating Compose configuration..."
docker compose config >/dev/null

echo "Building and restarting Friday..."
docker compose up -d --build

sh scripts/verify.sh
