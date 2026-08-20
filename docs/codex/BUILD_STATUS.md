# Friday Build Status

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Authoritative branch, host, and UI

- `main` is the authoritative FRIDAY build source after reviewed feature work is merged.
- VM 102 (`friday-controller`, `192.168.1.64`) is the authoritative FRIDAY controller host.
- VM 100 (`192.168.1.124`) is managed infrastructure and hosts the separate read-only Docker observer; it is not the FRIDAY controller.
- The approved frontend is **FRIDAY UI v3**, implemented in React/TypeScript under `src/`.
- Older dashboards and standalone prototypes are reference artifacts only.

## Current deployed baseline

VM 102 has a healthy FRIDAY v3 deployment on port `3010` with Docker/Compose available, QEMU guest agent healthy, a live read-only Proxmox integration to `192.168.1.211:8006`, and the VM100 observer integration enabled. Local VM102 Docker observation remains disabled.

VM100's observer is deployed at `192.168.1.124:3199` and returns authenticated sanitized Docker inventory. End-to-end verification from VM102 returned 16 VM100 containers; `nginx-proxy-manager` was observed offline while the remaining reported services were online.

## Implemented controller capabilities

- FRIDAY UI v3 React + TypeScript + Vite command center.
- Node 22 HTTP server for UI + API.
- `GET /healthz`, `GET /api/health`, `GET /api/overview`.
- `GET /api/incidents` and `GET /api/monitoring/history` in the Monitoring & Incidents milestone.
- `POST /api/commands/preview` with read-only intent classification.
- Optional `POST /api/assistant` advisory AI boundary.
- Mock adapter, Proxmox read-only API adapter, VM100 observer adapter, optional local Docker adapter, and endpoint checks.
- Adapter failures degrade integrations without taking down the overview.
- Durable FRIDAY-owned monitoring state with atomic file replacement under `/data`.
- Deterministic offline, degraded, integration-unavailable, and flapping incident rules.
- V3 Active Incidents and Incidents workspace with read-only recommended actions.
- No infrastructure mutation endpoints.

The Monitoring & Incidents capability is developed on `feature/monitoring-incidents` / PR #4 until reviewed and merged. Production monitoring remains disabled until VM102 pulls the merged `main` and explicitly sets `FRIDAY_MONITORING_ENABLED=true`.

## VM100 observer architecture

```text
Proxmox 192.168.1.211
  ├─ VM100 192.168.1.124
  │    └─ friday-observer :3199 -> local Docker inventory, GET-only
  └─ VM102 192.168.1.64
       └─ FRIDAY controller :3010
            ├─ Proxmox read-only adapter
            ├─ VM100 observer adapter
            └─ Monitoring runtime -> FRIDAY-owned /data state
```

The observer is token-authenticated and exposes only:

```text
GET /health
GET /api/v1/containers
```

Docker's native TCP API must never be exposed. The observer must never gain restart, stop, exec, remove, image, volume, network, or daemon mutation routes.

## Monitoring semantics

- Monitoring is disabled by default and grants no provider/infrastructure write permission when enabled.
- Default poll interval: 30 seconds.
- Default offline/degraded grace period: 300 seconds.
- Integration loss opens an incident immediately because loss of observability is itself operationally important.
- State path: `/data/monitoring-state.json` in the existing persistent `friday_data` volume.
- State includes service observations, incidents, and bounded monitoring history; it must not contain provider credentials.
- `/api/incidents` and `/api/monitoring/history` are GET-only.
- Recommended actions are advisory. There is no restart/repair/execute endpoint in this milestone.

## Docker semantics

- VM100 inventory comes through the VM100 observer.
- `FRIDAY_DOCKER_ENABLED` refers only to local Docker on the controller host.
- `FRIDAY_DOCKER_HOST_NAME` defaults to `VM 102`.
- `make live` is only for intentionally mounting VM102's local Docker socket read-only.
- Normal Proxmox + VM100-observer + monitoring operation uses the base `compose.yaml` with `FRIDAY_DOCKER_ENABLED=false`.

## AI boundary

- AI is disabled by default.
- Provider credentials remain server-side only.
- AI receives normalized infrastructure/monitoring state and no infrastructure execution tools.

## Deployment and verification

- FRIDAY controller repository: `/srv/infrastructure/apps/friday` on VM102.
- VM100 observer deployment path: `/srv/infrastructure/friday-observer`.
- Observer port: `3199` on `192.168.1.124`.
- `make preflight` and `make update` are controller-oriented.
- CI must run frontend tests, top-level server tests, server adapter tests, monitoring tests, observer tests, production build, shell syntax, monitoring/observer security checks, both controller Compose variants, observer Compose validation, and both Docker image builds.

## Not implemented yet

- Omada authenticated read-only API adapter.
- AdGuard authenticated read-only API adapter/statistics.
- Uptime Kuma/Prometheus/Grafana native adapters.
- Application authentication and RBAC.
- Durable action audit log and action request store.
- Human approval queue.
- Infrastructure mutation/execution endpoints.
- Notification delivery.
- Full Friday chat/history UI connected to `/api/assistant`.
- Voice input pipeline.

## Safety gate

Do not implement infrastructure-changing actions until authentication, role policy, approval, and durable action audit logging exist and are tested.
