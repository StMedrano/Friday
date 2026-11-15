#!/bin/sh
# Prepare the VM100 observer for a redeploy without touching what is running.
# Run on VM100 from the observer checkout:
#   sh scripts/prepare-observer-redeploy.sh [--write-gid] [--env observer/.env]
#     [--socket /var/run/docker.sock] [--no-docker]
# Checks the private .env (mode 600, 64-hex token), works out the Docker
# socket's group id for FRIDAY_DOCKER_SOCKET_GID and, only with --write-gid,
# writes it into .env. Then validates the Compose file and prints the image
# ids to keep for rollback. It never starts, stops, restarts or builds
# anything and never prints the token.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT/observer/.env"
SOCKET=/var/run/docker.sock
WRITE_GID=false
USE_DOCKER=true
while [ "$#" -gt 0 ]; do
  case "$1" in
    --write-gid) WRITE_GID=true ;;
    --no-docker) USE_DOCKER=false ;;
    --env) shift; ENV_FILE=${1:?--env needs a path} ;;
    --socket) shift; SOCKET=${1:?--socket needs a path} ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE is missing; copy observer/.env.example and set the token first"
mode=$(stat -c %a "$ENV_FILE")
[ "$mode" = 600 ] || fail "$ENV_FILE is mode $mode; run chmod 600 on it"
ok ".env is mode 600"

value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
grep -qE '^FRIDAY_OBSERVER_TOKEN=[0-9a-f]{64}$' "$ENV_FILE" || fail 'FRIDAY_OBSERVER_TOKEN is not 64 hex characters (openssl rand -hex 32)'
ok 'observer token is set (not shown)'

[ -S "$SOCKET" ] || fail "$SOCKET is not a socket"
gid=$(stat -c %g "$SOCKET")
case "$gid" in ''|*[!0-9]*) fail "could not read the group id of $SOCKET" ;; esac
[ "$gid" != 0 ] || echo "warning: $SOCKET is owned by group 0 (root); the proxy would join the root group. Prefer a docker group." >&2

current=$(value FRIDAY_DOCKER_SOCKET_GID)
if [ "$current" = "$gid" ]; then
  ok "FRIDAY_DOCKER_SOCKET_GID=$gid matches $SOCKET"
elif [ -n "$current" ]; then
  fail "FRIDAY_DOCKER_SOCKET_GID=$current but $SOCKET belongs to group $gid; fix .env by hand"
elif [ "$WRITE_GID" = true ]; then
  if grep -q '^FRIDAY_DOCKER_SOCKET_GID=' "$ENV_FILE"; then
    sed -i "s/^FRIDAY_DOCKER_SOCKET_GID=.*/FRIDAY_DOCKER_SOCKET_GID=$gid/" "$ENV_FILE"
  else
    # Keep a trailing newline so the new line is not glued to the last one.
    [ -z "$(tail -c 1 "$ENV_FILE")" ] || printf '\n' >> "$ENV_FILE"
    printf 'FRIDAY_DOCKER_SOCKET_GID=%s\n' "$gid" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
  ok "wrote FRIDAY_DOCKER_SOCKET_GID=$gid to $ENV_FILE"
else
  fail "FRIDAY_DOCKER_SOCKET_GID is not set; rerun with --write-gid to set it to $gid"
fi

if [ "$USE_DOCKER" = true ]; then
  docker compose --env-file "$ENV_FILE" -f "$ROOT/observer/compose.yaml" config -q || fail 'docker compose config failed'
  ok 'observer compose.yaml validates'
  echo 'Images to keep for rollback (docker tag <image> friday-observer-rollback:<name> before rebuilding):'
  for name in friday-observer friday-docker-readonly; do
    image=$(docker container inspect --format '{{.Image}}' "$name" 2>/dev/null || true)
    echo "  $name: ${image:-not running}"
  done
fi

echo 'Ready. In the approved window: cd observer && docker compose up -d --build, then check /health, inventory, inspect and logs.'
