#!/usr/bin/env sh
set -eu

APP_DIR="${FRIDAY_APP_DIR:-/srv/infrastructure/apps/friday}"
REPO_URL="${FRIDAY_REPO_URL:-https://github.com/StMedrano/Friday.git}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required" >&2
  exit 1
fi

if [ -d "$APP_DIR/.git" ]; then
  echo "Friday already exists at $APP_DIR; refusing to overwrite it."
  exit 2
fi

parent=$(dirname "$APP_DIR")
mkdir -p "$parent"
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"
[ -f .env ] || cp .env.example .env

sh scripts/preflight-vm100.sh
docker compose config >/dev/null
docker compose up -d --build
sh scripts/verify.sh

echo "Friday installed in safe/mock mode at $APP_DIR"
echo "Review .env and docs/integrations.md before enabling live adapters."
