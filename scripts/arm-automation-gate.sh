#!/bin/sh
# Arm (or close) Friday's automation gate on VM 102.
#
# Execute-mode homelab changes and automated fixes only run while the gate file
# holds an unexpired "allow-approved-actions" state, at most 5 minutes ahead.
# The file must be owned by the user Friday runs as, so it is written from
# inside the running container.
#
#   sh scripts/arm-automation-gate.sh          # arm for 5 minutes
#   sh scripts/arm-automation-gate.sh 2        # arm for 2 minutes (1-5)
#   sh scripts/arm-automation-gate.sh close    # close it now
set -eu

SERVICE="${FRIDAY_GATE_SERVICE:-friday}"
ARG="${1:-5}"

case "$ARG" in
  close) MINUTES=0 ;;
  1|2|3|4|5) MINUTES="$ARG" ;;
  *) echo 'Usage: arm-automation-gate.sh [1-5|close]' >&2; exit 2 ;;
esac

docker compose exec -T -e FRIDAY_GATE_MINUTES="$MINUTES" "$SERVICE" node -e '
const fs = require("node:fs")
const path = require("node:path")
const file = process.env.FRIDAY_AUTOMATION_GATE_PATH || "/data/automation-gate/state.json"
const minutes = Number(process.env.FRIDAY_GATE_MINUTES)
const dir = path.dirname(file)
if (minutes === 0) {
  fs.rmSync(file, { force: true })
  console.log("Automation gate closed.")
  process.exit(0)
}
fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
fs.chmodSync(dir, 0o700)
// One second short of the limit, so clock rounding never makes it too far ahead.
const expiresAt = Date.now() + minutes * 60 * 1000 - 1000
const temp = path.join(dir, `.state.${process.pid}.tmp`)
fs.writeFileSync(temp, JSON.stringify({ schemaVersion: 1, state: "allow-approved-actions", expiresAt }) + "\n", { mode: 0o600 })
fs.chmodSync(temp, 0o600)
fs.renameSync(temp, file)
console.log(`Automation gate armed until ${new Date(expiresAt).toISOString()} (${minutes} min).`)
'
