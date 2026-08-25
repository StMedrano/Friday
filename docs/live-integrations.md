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

## Incident Diagnostics validation

Incident Diagnostics is part of merged `main` and remains environment-gated:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

Do not infer VM100 observer diagnostic-route deployment from the VM102 controller version. Before relying on diagnostics operationally, validate the observer first and preserve the inspected container state.

### Phase 1 — validate/update the VM100 observer

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

Privately load the existing observer token into `$TOKEN`, then confirm inventory works and obtain the target container ID from sanitized inventory:

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

Confirm observer validation changed nothing:

```bash
docker ps -a --filter name=nginx-proxy-manager \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

Use the actual pre-validation state as the comparison point. Do not restart or repair the target as part of diagnostics validation.

### Phase 2 — validate VM102 diagnostics

Only after Phase 1 is healthy, verify the live controller with:

```env
FRIDAY_DOCKER_ENABLED=false
```

Confirm Proxmox, VM100 observer, and monitoring remain healthy. Then, if diagnostics are intentionally enabled, set:

```env
FRIDAY_DIAGNOSTICS_ENABLED=true
```

Recreate only FRIDAY with base Compose and validate health:

```bash
cd /srv/infrastructure/apps/friday
docker compose up -d --force-recreate friday
make health
```

For an existing supported incident, validate:

```bash
curl -fsS http://127.0.0.1:3010/api/incidents | jq
curl -fsS http://127.0.0.1:3010/api/incidents/INCIDENT_ID/diagnostics | jq
curl -fsS http://127.0.0.1:3010/api/incidents/INCIDENT_ID/logs | jq
```

The final logs call is explicit read-only inspection. Raw logs are returned ephemerally and are not persisted.

Finally repeat the VM100 container-state proof and require the target to remain in its pre-validation state.

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

Then use the explicit live override. Keep this disabled for normal Proxmox + VM100 observer + monitoring + diagnostics operation.

## HTTP endpoint checks

`FRIDAY_ENDPOINTS_ENABLED=true` enables approved read-only health URLs. Do not embed credentials in URLs.

## Advisory AI on VM102

The validated production provider order is:

```text
Groq -> Gemini -> CT108 GPU Ollama -> deterministic local analysis
```

Relevant server-side configuration:

```env
FRIDAY_AI_ENABLED=true
FRIDAY_AI_PROVIDER_ORDER=groq,gemini,ollama
FRIDAY_CLOUD_AI_TIMEOUT_MS=15000
FRIDAY_LOCAL_AI_TIMEOUT_MS=45000
FRIDAY_LOCAL_AI_ENABLED=true
FRIDAY_LOCAL_AI_URL=http://192.168.1.70:11434
FRIDAY_LOCAL_AI_MODEL=qwen3:4b-instruct
FRIDAY_LOCAL_AI_CONTEXT=8192
FRIDAY_LOCAL_AI_MAX_TOKENS=512
```

Provider credentials remain server-side. CT108 should allow TCP/11434 only from VM102. AI receives normalized state only and no infrastructure execution tools.

## Actions

`POST /api/commands/preview` remains preview-only. `/api/assistant` remains advisory-only. Incident, monitoring, diagnostics, and log-inspection APIs expose no infrastructure mutation path. Neither the controller nor VM100 observer implements restart, stop, delete, exec, firewall, VLAN, or other infrastructure mutation endpoints.
