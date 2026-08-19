# Friday Build Status

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Authoritative branch, host, and UI

- `main` is the authoritative FRIDAY build source after reviewed feature work is merged.
- VM 102 (`friday-controller`, `192.168.1.64`) is the authoritative FRIDAY controller host.
- VM 100 (`192.168.1.74`) is managed infrastructure and hosts the separate read-only Docker observer; it is not the FRIDAY controller.
- The approved frontend is **FRIDAY UI v3**, implemented in React/TypeScript under `src/`.
- Older dashboards and standalone prototypes are reference artifacts only.

## Current deployed baseline

VM 102 has a healthy FRIDAY v3 deployment on port `3010` with Docker/Compose enabled, QEMU guest agent healthy, and a live read-only Proxmox integration to `192.168.1.211:8006`. Local VM102 Docker observation remains disabled.

The VM100 observer feature is developed on `feature/vm100-observer` / PR #3 until verification and merge are complete. Do not treat unmerged observer code as deployed production state.

## Implemented controller capabilities

- FRIDAY UI v3 React + TypeScript + Vite command center.
- Node 22 HTTP server for UI + API.
- `GET /healthz`, `GET /api/health`, `GET /api/overview`.
- `POST /api/commands/preview` with read-only intent classification.
- Optional `POST /api/assistant` advisory AI boundary.
- Mock adapter, Proxmox read-only API adapter, local Docker adapter, and endpoint checks.
- Adapter failures degrade integrations without taking down the overview.
- No infrastructure mutation endpoints.

## VM100 observer architecture

Target topology:

```text
Proxmox 192.168.1.211
  ├─ VM100 192.168.1.74
  │    └─ friday-observer :3199 -> local Docker inventory, GET-only
  └─ VM102 192.168.1.64
       └─ FRIDAY controller :3010
            ├─ Proxmox read-only adapter
            └─ VM100 observer adapter
```

The observer is token-authenticated and exposes only:

```text
GET /health
GET /api/v1/containers
```

Docker's native TCP API must never be exposed. The observer must never gain restart, stop, exec, remove, image, volume, network, or daemon mutation routes.

## Docker semantics

- VM100 inventory comes through the VM100 observer.
- `FRIDAY_DOCKER_ENABLED` refers only to local Docker on the controller host.
- `FRIDAY_DOCKER_HOST_NAME` defaults to `VM 102`.
- `make live` is only for intentionally mounting VM102's local Docker socket read-only.
- Normal Proxmox + VM100-observer live operation uses the base `compose.yaml` with `FRIDAY_DOCKER_ENABLED=false`.

## AI boundary

- AI is disabled by default.
- Provider credentials remain server-side only.
- AI receives normalized infrastructure state and no infrastructure execution tools.

## Deployment and verification

- FRIDAY controller repository: `/srv/infrastructure/apps/friday` on VM102.
- VM100 observer deployment path: `/srv/infrastructure/friday-observer`.
- Observer port: `3199`, and rollout must abort if already occupied.
- `make preflight` and `make update` are controller-oriented.
- Legacy `preflight-vm100.sh` and `update-vm100.sh` names are compatibility wrappers only.
- CI must run frontend tests, top-level server tests, server adapter tests, observer tests, production build, shell syntax, both controller Compose variants, observer Compose validation, and both Docker image builds.

## Not implemented yet

- Omada authenticated read-only API adapter.
- AdGuard authenticated read-only API adapter/statistics.
- Uptime Kuma/Prometheus/Grafana native adapters.
- Application authentication and RBAC.
- Durable audit log and action request store.
- Human approval queue.
- Infrastructure mutation/execution endpoints.
- Notification delivery.
- Full Friday chat/history UI connected to `/api/assistant`.
- Voice input pipeline.

## Safety gate

Do not implement infrastructure-changing actions until authentication, role policy, approval, and durable audit logging exist and are tested.
