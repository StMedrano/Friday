# Friday Live Integrations

Friday starts in `mock` mode. Live integrations are opt-in and read-only.

## Proxmox on VM102

Set `FRIDAY_MODE=live` and configure the dedicated read-only Proxmox token in VM102's `.env`. Proxmox uses the base `compose.yaml`; no Docker socket mount is required.

## VM100 Docker observer

The deployed VM100 address is `192.168.1.124`. Configure the bearer-authenticated observer on port `3199` and configure the same token server-side on VM102:

```env
FRIDAY_VM100_OBSERVER_ENABLED=true
FRIDAY_VM100_OBSERVER_URL=http://192.168.1.124:3199
FRIDAY_VM100_OBSERVER_TOKEN=
FRIDAY_VM100_OBSERVER_HOST_NAME=VM 100
```

The observer exposes sanitized inventory plus narrowly scoped read-only inspect/log diagnostics. Docker's native TCP API is not exposed.

## Monitoring & Incidents

Monitoring consumes the normalized live overview; it does not call Docker/Proxmox mutation APIs and grants no new infrastructure authority.

```env
FRIDAY_MONITORING_ENABLED=true
FRIDAY_MONITORING_POLL_SECONDS=30
FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS=300
FRIDAY_MONITORING_STATE_PATH=/data/monitoring-state.json
FRIDAY_MONITORING_HISTORY_LIMIT=2000
```

Use base `compose.yaml` and keep `FRIDAY_DOCKER_ENABLED=false` for the normal VM100-observer architecture. Monitoring state is persisted in FRIDAY's existing `/data` volume.

## Incident Diagnostics rollout

Diagnostics are merged/deployed disabled by default:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

Roll out in two phases and do not reverse the order.

### Phase 1 — upgrade the VM100 observer

After merge and explicit rollout approval:

```bash
cd /srv/infrastructure/friday-observer
git status --short
git checkout main
git pull --ff-only origin main
cd observer
docker compose config >/dev/null
docker compose up -d --build --force-recreate
curl -fsS http://192.168.1.124:3199/health | jq
```

Privately load the existing observer token into `$TOKEN`, then confirm inventory still works and obtain the known NPM container ID from sanitized inventory:

```bash
CONTAINER_ID=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://192.168.1.124:3199/api/v1/containers \
  | jq -r '.containers[] | select(.name=="nginx-proxy-manager") | .id')

curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://192.168.1.124:3199/api/v1/containers/$CONTAINER_ID/inspect" | jq

curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://192.168.1.124:3199/api/v1/containers/$CONTAINER_ID/logs?tail=100" | jq
```

Do not manually construct arbitrary Docker paths. `$CONTAINER_ID` must come from observer inventory.

Confirm the observer validation changed nothing:

```bash
docker ps -a --filter name=nginx-proxy-manager \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

For the current validation target, Nginx Proxy Manager must remain `Exited (255)`.

### Phase 2 — enable VM102 diagnostics

Only after Phase 1 is healthy:

```bash
cd /srv/infrastructure/apps/friday
git status --short
git checkout main
git pull --ff-only origin main
make preflight
docker compose up -d --build --force-recreate
make health
```

First verify the live controller with:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
FRIDAY_DOCKER_ENABLED=false
```

Confirm Proxmox, VM100 observer, monitoring, and the existing NPM incident are still present. Then change only:

```env
FRIDAY_DIAGNOSTICS_ENABLED=true
```

Recreate FRIDAY with base Compose:

```bash
docker compose up -d --force-recreate
make health
```

The existing open supported NPM incident should receive one metadata-only backfill. Validate:

```bash
curl -fsS http://127.0.0.1:3010/api/incidents | jq
curl -fsS http://127.0.0.1:3010/api/incidents/INCIDENT_ID/diagnostics | jq
curl -fsS http://127.0.0.1:3010/api/incidents/INCIDENT_ID/logs | jq
```

The final logs call is explicit read-only inspection. Raw logs are returned ephemerally and are not persisted.

Finally repeat the VM100 `docker ps -a` proof and require NPM to remain in its pre-validation state.

Rollback diagnostics by setting:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

and recreating only FRIDAY with base Compose. Monitoring and existing incident/history state continue normally.

## Optional local Docker on VM102

Local Docker observation is separate from VM100 inventory. Enable it only when intentionally needed:

```env
FRIDAY_DOCKER_ENABLED=true
FRIDAY_DOCKER_HOST_NAME=VM 102
```

Then use `make live`, which adds the read-only local socket mount. Keep this disabled for normal Proxmox + VM100 observer + monitoring + diagnostics operation.

## HTTP endpoint checks

`FRIDAY_ENDPOINTS_ENABLED=true` enables approved read-only health URLs. Do not embed credentials in URLs.

## Actions

`POST /api/commands/preview` remains preview-only. Incident, monitoring, diagnostics, and log-inspection APIs are GET-only. Neither the controller nor VM100 observer implements restart, stop, delete, exec, firewall, VLAN, or other infrastructure mutation endpoints.
