#!/bin/sh
# REHEARSAL ONLY: new, disposable fixture volumes. NEVER use a live volume.
# Verify that root-owned monitoring state can be copied read-only to an
# isolated UID 10001 volume and consumed by the hardened Friday image.
set -eu
image="${1:-friday-ci}"
suffix="$$-$(date +%s)"
source_volume="friday-migration-fixture-source-$suffix"
target_volume="friday-migration-fixture-target-$suffix"
container="friday-migration-fixture-app-$suffix"
created_source=0
created_target=0
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [ "$created_target" -eq 1 ]; then docker volume rm "$target_volume" >/dev/null 2>&1 || true; fi
  if [ "$created_source" -eq 1 ]; then docker volume rm "$source_volume" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT HUP INT TERM
# Never adopt an existing volume, even if its name resembles a fixture.
if docker volume inspect "$source_volume" >/dev/null 2>&1 || docker volume inspect "$target_volume" >/dev/null 2>&1; then
  echo 'Migration fixture volume name collision; refusing to run' >&2
  exit 1
fi
docker volume create "$source_volume" >/dev/null
created_source=1
docker volume create "$target_volume" >/dev/null
created_target=1

# Generate fake, root-owned data solely inside the disposable source volume.
docker run --rm --network none --read-only --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount "type=volume,source=$source_volume,target=/old" \
  --entrypoint sh "$image" -c '
    set -eu
    mkdir -p /old/extra
    printf "%s\n" "{\"schemaVersion\":2,\"observations\":{},\"incidents\":[],\"history\":[],\"diagnostics\":{}}" > /old/monitoring-state.json
    printf "%s\n" "fixture-preserve-data" > /old/extra/keep.txt
    chmod 600 /old/monitoring-state.json
    chmod 600 /old/extra/keep.txt
    chmod 700 /old/extra
    test "$(stat -c "%u:%g" /old/monitoring-state.json)" = 0:0
  '
# Read-only source! All chmod/chown operations apply exclusively to NEW data.
docker run --rm --network none --read-only --user 0:0 \
  --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges \
  --mount "type=volume,source=$source_volume,target=/old,readonly" \
  --mount "type=volume,source=$target_volume,target=/new" \
  --entrypoint sh "$image" -c '
    set -eu
    cp -a /old/. /new/
    chown -R 10001:10001 /new
    test "$(stat -c "%u:%g" /new/monitoring-state.json)" = 10001:10001
    test "$(stat -c "%a" /new/monitoring-state.json)" = 600
    test "$(stat -c "%a" /new/extra)" = 700
  '
# A non-root process can read, write and persist state on the COPIED volume.
docker run --rm --network none --read-only --user 10001:10001 \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=volume,source=$target_volume,target=/data" \
  --entrypoint sh "$image" -c '
    set -eu
    test "$(stat -c "%u:%g" /data/monitoring-state.json)" = 10001:10001
    test "$(stat -c "%a" /data/monitoring-state.json)" = 600
    test -r /data/monitoring-state.json
    test "$(cat /data/extra/keep.txt)" = fixture-preserve-data
    echo test-copy-write > /data/.migration-smoke
    rm /data/.migration-smoke
  '
# Boot the actual Friday server against the copied volume, with monitoring
# disabled so the sample state remains byte-identical for the comparison.
docker run -d --rm --name "$container" --network none --read-only \
  --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,size=16m \
  --mount "type=volume,source=$target_volume,target=/data" \
  -e FRIDAY_MODE=mock -e FRIDAY_MONITORING_ENABLED=false "$image" >/dev/null
i=0
until docker exec "$container" wget -qO- http://127.0.0.1:3010/healthz >/dev/null 2>&1; do
  i=$((i+1))
  [ "$i" -lt 25 ] || { echo 'Migrated fixture image failed health check' >&2; exit 1; }
  sleep 1
done
docker exec "$container" sh -c 'test -r /data/monitoring-state.json && test -w /data'
docker stop "$container" >/dev/null

# Verify a byte-for-byte copy and the source remains root-owned and unchanged.
# DAC_OVERRIDE allows read-only comparison of 0600 files owned by different UIDs.
docker run --rm --network none --read-only --user 0:0 --cap-drop ALL --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges \
  --mount "type=volume,source=$source_volume,target=/old,readonly" \
  --mount "type=volume,source=$target_volume,target=/new,readonly" \
  --entrypoint sh "$image" -c '
    set -eu
    cmp /old/monitoring-state.json /new/monitoring-state.json
    cmp /old/extra/keep.txt /new/extra/keep.txt
    test "$(stat -c "%u:%g" /old/monitoring-state.json)" = 0:0
    test "$(stat -c "%a" /old/monitoring-state.json)" = 600
    test "$(stat -c "%u:%g" /old/extra/keep.txt)" = 0:0
    test "$(stat -c "%u:%g" /new/extra/keep.txt)" = 10001:10001
  '
echo 'PASS: disposable root-owned state copied read-only to non-root volume without modifying source'
