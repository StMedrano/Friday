#!/bin/sh
# Copy the root-owned friday_data volume into a NEW volume owned by 10001:10001
# for the non-root controller (compose.nonroot.yaml). Run on VM102 in an
# approved maintenance window, after stopping the Friday container:
#   docker compose stop friday
#   sh scripts/migrate-friday-data-nonroot.sh --confirm
# The source volume is mounted read only and is never changed or removed. The
# script refuses if Friday is running or if the target volume already exists.
set -eu

SOURCE=friday_data
TARGET=friday_data_nonroot
CONTAINER=friday
IMAGE=${FRIDAY_MIGRATION_IMAGE:-node:22.23.2-alpine3.23}
[ "${1:-}" = --confirm ] || { echo 'Refusing to run without --confirm (see docs/controller-nonroot-migration.md)' >&2; exit 2; }

fail() { echo "FAIL: $*" >&2; exit 1; }

docker volume inspect "$SOURCE" >/dev/null 2>&1 || fail "volume $SOURCE does not exist"
if docker volume inspect "$TARGET" >/dev/null 2>&1; then
  fail "volume $TARGET already exists; inspect it, and remove it by hand only if it is a failed earlier copy"
fi
state=$(docker container inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo absent)
[ "$state" != true ] || fail "container $CONTAINER is running; run docker compose stop friday first"

docker volume create "$TARGET" >/dev/null
echo "Created $TARGET. Copying $SOURCE (read only) into it..."

# Source read only; ownership changes apply to the NEW volume alone.
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --user 0:0 \
  --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges \
  --mount "type=volume,source=$SOURCE,target=/old,readonly" \
  --mount "type=volume,source=$TARGET,target=/new" \
  --entrypoint sh "$IMAGE" -c '
    set -eu
    cp -a /old/. /new/
    chown -R 10001:10001 /new
    # Same files, same sizes, same modes; only the owner differs.
    (cd /old && find . -exec stat -c "%n %s %a %F" {} + | sort) > /tmp/old.txt
    (cd /new && find . -exec stat -c "%n %s %a %F" {} + | sort) > /tmp/new.txt
    cmp /tmp/old.txt /tmp/new.txt
    test -z "$(find /new ! -user 10001 -print -quit)"
    find /old -type f -exec sh -c "cmp \"\$1\" \"/new\${1#/old}\"" _ {} \;
    echo "Copied $(wc -l < /tmp/new.txt) entries."
  '

echo "Done. $SOURCE is unchanged. Next: set FRIDAY_CONTROLLER_NONROOT=true in .env, point the grants timer at $TARGET, then make update."
