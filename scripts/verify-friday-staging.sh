#!/bin/sh
# Offline deployment/config contract only. Starts NO containers, no CF requests.
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT HUP INT TERM
printf '%s\n' 'SYNTHETIC-NOT-A-REAL-TUNNEL-TOKEN' > "$fixture"
# Valid synthetic staging AUD, intentionally different from Friday production.
aud=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
FRIDAY_STAGE_CF_ACCESS_AUD="$aud" FRIDAY_STAGE_TUNNEL_TOKEN_FILE="$fixture" \
 docker compose --profile tunnel -f "$root/deploy/staging/compose.yaml" config --format json \
 | node "$root/scripts/verify-friday-staging.mjs"
