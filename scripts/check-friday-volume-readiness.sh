#!/bin/sh
# Read-only production volume and running controller checks. No backups/copies,
# chmod, chown, data writes, restarts, container exec mutations, or destructive commands.
set -eu
name="${FRIDAY_CONTAINER_NAME:-friday}"
volume="${FRIDAY_DATA_VOLUME_SOURCE:-friday_data}"
if ! docker container inspect "$name" >/dev/null 2>&1; then
 echo "BLOCKED: Friday container could not be inspected" >&2
 exit 2
fi
mounted="$(docker inspect "$name" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
if [ "$mounted" != "$volume" ]; then
 echo "BLOCKED: expected volume is not mounted at /data; no action taken" >&2
 exit 2
fi
docker volume inspect "$volume" --format 'volume={{.Name}} driver={{.Driver}}' >/dev/null
echo "Source volume mounted at /data: $volume (read-only inspection only)"
docker exec "$name" sh -c '
 set -eu
 stat -c "/data uid=%u gid=%g mode=%a" /data
 if [ -f /data/monitoring-state.json ]; then
  stat -c "monitoring-state.json uid=%u gid=%g mode=%a bytes=%s" /data/monitoring-state.json
 else
  echo "BLOCKED: expected monitoring state is absent"
  exit 2
 fi
'
echo "CHECK ONLY: production volume not copied, backed up, changed or migrated."
echo "RELEASE NOT APPROVED: verify offline backup and authorize maintenance window."
