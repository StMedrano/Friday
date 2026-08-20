# Friday

Friday is a two-site homelab control plane hosted on **VM 102 (`friday-controller`, `192.168.1.64`)**. It combines the authoritative **FRIDAY UI v3 command center**, a server-side infrastructure API, read-only live adapters, durable monitoring/incidents, and optional advisory AI without exposing privileged credentials to the browser.

## Authoritative build

`main` is the canonical FRIDAY build and deployment source after reviewed feature work is merged.

The production UI is the React/TypeScript implementation under `src/`. Standalone HTML prototypes and older dashboards are reference artifacts only.

VM 102 deploys FRIDAY. VM 100 (`192.168.1.124`) is managed infrastructure and hosts a separate read-only Docker observer; it is not the FRIDAY controller.

## Current production baseline

Production currently has:

- FRIDAY UI v3 command center
- React + TypeScript + Vite frontend
- unified Node 22 UI/API server
- live read-only Proxmox integration
- token-authenticated VM100 Docker inventory observer
- local VM102 Docker observation disabled
- durable monitoring and incidents enabled on VM102
- deterministic offline/degraded/integration/flapping incident rules
- read-only Incidents workspace
- existing `nginx-proxy-manager` service-offline incident on VM100
- safe base Compose with no controller Docker socket mount
- no infrastructure mutation endpoints

The Incident Diagnostics work on PR #5 is a **candidate**, not part of the deployed baseline until it is reviewed, merged, and explicitly rolled out.

## Safety model

Friday read adapters cannot mutate infrastructure. Monitoring writes only FRIDAY-owned state under the persistent `/data` volume. The AI endpoint is advisory only and receives normalized Friday state, not Docker/Proxmox execution tools.

No restart/delete/network/firewall/VLAN/device-adoption execution endpoint exists. Infrastructure-changing actions remain blocked until authentication/RBAC, durable action audit logging, and an approval workflow exist.

The deployed VM100 observer currently provides sanitized inventory. The Incident Diagnostics candidate expands that observer only with fixed, token-authenticated GET routes:

```text
GET /health
GET /api/v1/containers
GET /api/v1/containers/:id/inspect
GET /api/v1/containers/:id/logs?tail=100
```

Diagnostic IDs must come from sanitized observer inventory. The observer never proxies arbitrary Docker paths, never exposes Docker TCP, and has no restart, stop, exec, remove, image, volume, or network mutation routes.

## Deploy FRIDAY on VM 102

```bash
sudo mkdir -p /srv/infrastructure/apps
sudo chown -R "$USER:$USER" /srv/infrastructure/apps
cd /srv/infrastructure/apps

git clone https://github.com/StMedrano/Friday.git friday
cd friday
cp .env.example .env
chmod 600 .env

make preflight
make up
make health
```

FRIDAY is available at:

```text
http://192.168.1.64:3010
```

## Live read-only integrations

Normal live operation uses base `compose.yaml` with local VM102 Docker observation disabled:

```env
FRIDAY_MODE=live
FRIDAY_DOCKER_ENABLED=false
FRIDAY_VM100_OBSERVER_ENABLED=true
FRIDAY_VM100_OBSERVER_URL=http://192.168.1.124:3199
FRIDAY_VM100_OBSERVER_TOKEN=
FRIDAY_VM100_OBSERVER_HOST_NAME=VM 100
```

Proxmox and the VM100 observer do **not** require the controller Docker socket. `make live` is reserved only for an explicit decision to observe local VM102 Docker.

## Monitoring & Incidents

Monitoring is already deployed on VM102. Current settings are server-side and use the persistent FRIDAY data volume:

```env
FRIDAY_MONITORING_ENABLED=true
FRIDAY_MONITORING_POLL_SECONDS=30
FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS=300
FRIDAY_MONITORING_STATE_PATH=/data/monitoring-state.json
FRIDAY_MONITORING_HISTORY_LIMIT=2000
```

Monitoring uses a non-overlapping poll loop, persists observations/incidents/history, and exposes GET-only incident/history APIs. It does **not** restart, stop, start, exec into, or modify containers or Proxmox guests.

## Incident Diagnostics candidate

Diagnostics are disabled by default even after the candidate is merged:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

The rollout is intentionally two-phase:

1. Upgrade and validate the VM100 observer first, keeping the existing Nginx Proxy Manager container unchanged.
2. Upgrade VM102 with diagnostics still disabled; only after observer validation, set `FRIDAY_DIAGNOSTICS_ENABLED=true` and recreate FRIDAY with base Compose.

When enabled, supported VM100 service incidents receive one metadata-only diagnostic snapshot. Existing open supported incidents without a report receive one startup backfill. Analysis is deterministic and separates observed facts, findings, likely causes, and recommendations.

Raw container logs are **never fetched automatically**. They are fetched only through an explicit GET request, sanitized and bounded to a maximum 100-line controller request / 200-line observer cap, returned ephemerally, and never persisted in monitoring state or history.

Controller diagnostics APIs:

```text
GET /api/incidents/:incidentId/diagnostics
GET /api/incidents/:incidentId/logs
```

There is no diagnostic remediation endpoint.

See `observer/README.md` and `docs/live-integrations.md` for the observer-first rollout and validation commands.

## Deploy/update the VM100 observer

Target:

```text
VM 100: 192.168.1.124
Port:   3199
Path:   /srv/infrastructure/friday-observer
```

See `observer/README.md` for preflight, update, authentication, diagnostic validation, and the Docker-socket security boundary.

## Optional Friday AI

Friday AI is disabled by default. Configure provider values server-side only:

```env
FRIDAY_AI_ENABLED=true
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
```

Never place provider or infrastructure secrets in `VITE_*` variables.

## Update Friday on VM 102

```bash
cd /srv/infrastructure/apps/friday
make update
```

The controller updater refuses a dirty Git tree, fast-forwards `main`, preserves `.env`, and avoids mounting the local Docker socket unless local Docker observation is explicitly enabled.

## Development / verification

```bash
make install
make test
make build
make verify
```

GitHub CI verifies frontend/server/observer tests, production build, shell syntax, observer/monitoring/diagnostics safety gates, Compose variants, and both Docker images.

## API

FRIDAY controller:

```text
GET  /healthz
GET  /api/health
GET  /api/overview
GET  /api/incidents
GET  /api/monitoring/history
GET  /api/incidents/:incidentId/diagnostics
GET  /api/incidents/:incidentId/logs
POST /api/commands/preview
POST /api/assistant
```

Incident, monitoring, diagnostics, and diagnostic-log routes expose no POST/PUT/PATCH/DELETE action API.

VM100 observer candidate contract:

```text
GET /health
GET /api/v1/containers
GET /api/v1/containers/:id/inspect
GET /api/v1/containers/:id/logs?tail=100
```

See `docs/codex/API_CONTRACT.md`, `docs/integrations.md`, and `docs/live-integrations.md`.

## Codex start point

Codex should begin with:

1. `AGENTS.md`
2. `CODEX.md`
3. `docs/codex/BUILD_STATUS.md`
4. `docs/codex/NEXT_STEPS.md`
5. the relevant workflow under `skills/`

Codex must treat the current React UI on `main` and VM102 controller architecture as authoritative.
