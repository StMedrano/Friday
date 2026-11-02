#!/usr/bin/env sh
set -eu

echo 'DEPRECATED: scripts/update-vm100.sh now delegates to the VM102 controller updater.' >&2
exec sh "$(dirname "$0")/update-controller.sh" "$@"
