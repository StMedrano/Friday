#!/bin/sh
# Verify an isolated, non-root Friday image with no production connections.
# Creates/removes only a disposable container and Docker volume.
set -eu
image="${1:-friday-ci}"
container="friday-hardening-smoke-$$"
volume="friday-hardening-smoke-data-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
docker volume create "$volume" >/dev/null
docker run --rm -d --name "$container" --network none \
  --read-only --user 10001:10001 --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,size=16m \
  --mount "type=volume,source=$volume,target=/data" \
  -e FRIDAY_MODE=mock -e FRIDAY_MONITORING_ENABLED=true \
  "$image" >/dev/null
i=0
until docker exec "$container" wget -qO- http://127.0.0.1:3010/healthz >/dev/null 2>&1; do
  i=$((i+1))
  [ "$i" -lt 25 ] || { echo 'Hardened controller did not start' >&2; exit 1; }
  sleep 1
done
[ "$(docker exec "$container" id -u)" = 10001 ]
[ "$(docker inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}')" = true ]
[ "$(docker inspect "$container" --format '{{.HostConfig.CapDrop}}')" = '[ALL]' ]
docker exec "$container" sh -c 'touch /data/hardening-check && rm /data/hardening-check && touch /tmp/hardening-check && rm /tmp/hardening-check'
docker exec "$container" sh -c 'if touch /app/should-not-write 2>/dev/null; then exit 1; else exit 0; fi'
i=0
until docker exec "$container" test -f /data/monitoring-state.json; do
  i=$((i+1))
  [ "$i" -lt 25 ] || { echo 'Monitoring state was not written to /data' >&2; exit 1; }
  sleep 1
done
[ "$(docker exec "$container" stat -c '%u:%g' /data/monitoring-state.json)" = 10001:10001 ]
echo 'PASS: controller is non-root, read-only, no capabilities, health-ready, and writes monitoring state only to /data'
