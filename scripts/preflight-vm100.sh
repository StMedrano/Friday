#!/usr/bin/env sh
set -eu

echo 'DEPRECATED: scripts/preflight-vm100.sh now delegates to the VM102 controller preflight.' >&2
exec sh "$(dirname "$0")/preflight-controller.sh" "$@"
