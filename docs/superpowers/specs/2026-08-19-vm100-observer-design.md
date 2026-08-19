# FRIDAY VM100 Read-Only Observer Design

## Status
Approved architecture for implementation planning.

## Goal
Make VM 102 (`friday-controller`, `192.168.1.64`) the authoritative FRIDAY controller while allowing it to observe Docker services running on VM 100 (`192.168.1.74`) without exposing the Docker API remotely and without giving FRIDAY shell or mutation authority on VM 100.

## Current State
- FRIDAY v3 runs on VM 102.
- FRIDAY is healthy in Docker on port `3010`.
- FRIDAY is in live mode with read-only Proxmox API access to `192.168.1.211:8006`.
- Docker observation is intentionally disabled because the current live override mounts VM 102's local Docker socket.
- The existing Docker adapter hard-codes discovered containers as host `VM 100`, which is no longer correct for local Docker observation.

## Architecture

```text
VM 100 — 192.168.1.74
┌──────────────────────────────────┐
│ friday-observer                  │
│                                  │
│ Docker socket mounted read-only  │
│        ↓                         │
│ sanitize inventory              │
│        ↓                         │
│ token-authenticated GET API     │
└──────────────┬───────────────────┘
               │ read-only HTTP API
               ▼
VM 102 — 192.168.1.64
┌──────────────────────────────────┐
│ FRIDAY Controller                │
│                                  │
│ VM100 Observer Adapter           │
│ Proxmox Adapter                  │
│ Endpoint Monitor                 │
└──────────────────────────────────┘
```

## VM100 Observer Responsibilities
The observer is a dedicated read-only service deployed on VM 100. It may read the local Docker socket but must not expose Docker's native API over the network.

Allowed HTTP routes:
- `GET /health`
- `GET /api/v1/containers`

The container inventory response may include only:
- container ID prefix
- container name
- image
- runtime state
- human-readable status
- published ports
- explicitly allow-listed labels
- observer host identity
- observation timestamp

The observer must not implement routes or code paths for:
- create
- start
- stop
- restart
- kill
- exec
- remove
- image pull/build
- volume mutation
- network mutation
- Docker daemon configuration

## Authentication
- VM 102 authenticates to the observer with a dedicated bearer token.
- The token is stored only in server-side `.env` files and never exposed to the browser.
- Unauthorized and missing-token requests return `401`.
- The observer binds only to the VM 100 interface/port intended for the management LAN.

## FRIDAY Controller Changes
Add a remote observer configuration block:
- `FRIDAY_VM100_OBSERVER_ENABLED`
- `FRIDAY_VM100_OBSERVER_URL`
- `FRIDAY_VM100_OBSERVER_TOKEN`
- `FRIDAY_VM100_OBSERVER_HOST_NAME`

Add a server-side remote observer adapter that:
1. performs authenticated `GET` requests only;
2. applies a short timeout;
3. maps observer container data into FRIDAY service records;
4. reports integration failures as degraded alerts rather than crashing the overview.

## Existing Docker Adapter Cleanup
The local Docker adapter must stop hard-coding `host: 'VM 100'`.

Local Docker observation, when intentionally enabled, must use a configurable host label such as:
- `FRIDAY_DOCKER_HOST_NAME=VM 102`

The VM100 observer integration is the authoritative path for VM 100 Docker inventory.

## Operating Modes
### Safe / Mock
No infrastructure reads.

### Live — Current Target
- Proxmox: enabled, read-only
- VM100 observer: enabled, read-only
- local VM102 Docker socket: disabled by default
- endpoints: optional, read-only
- AI: independent from infrastructure authority
- mutations: none

## Data Flow
1. Browser requests `/api/overview` from FRIDAY on VM 102.
2. FRIDAY queries Proxmox read-only.
3. FRIDAY queries the VM100 observer using the bearer token.
4. FRIDAY normalizes both sources into one service inventory.
5. Integration errors become warning alerts.
6. No model or browser request can invoke infrastructure mutation through this observer.

## Deployment Layout
### VM 102
Repository:
`/srv/infrastructure/apps/friday`

FRIDAY remains the authoritative UI/API/controller.

### VM 100
Observer deployment directory:
`/srv/infrastructure/friday-observer`

The observer runs as its own Docker Compose project and does not modify existing application Compose projects.

## Port
Use a dedicated observer port that is checked for conflicts before deployment. The implementation plan must select and document the final port after validating VM 100's current listeners.

## Failure Handling
- Observer unavailable: FRIDAY remains healthy and shows an integration-degraded warning.
- Invalid token: FRIDAY records a `401`-based integration warning.
- Docker socket unavailable on VM 100: observer health may remain up but inventory route returns a controlled error; FRIDAY shows degraded state.
- Malformed observer response: FRIDAY ignores unsafe/invalid fields and reports a degraded integration.

## Security Requirements
- No Docker TCP socket exposure.
- No SSH-based Docker execution from FRIDAY.
- No write endpoints in the observer.
- No Docker mutation methods in observer source code.
- Observer token never enters frontend code or `VITE_*` variables.
- `.env` files containing secrets use restricted permissions.
- Existing FRIDAY infrastructure write endpoints remain absent.

## Repository Cleanup
Generalize stale VM100 deployment assumptions:
- rename or replace `scripts/preflight-vm100.sh` with controller-oriented naming;
- rename or replace `scripts/update-vm100.sh` with controller-oriented naming;
- update Makefile text to identify VM 102 as controller;
- update deployment documentation to make VM 102 authoritative;
- preserve compatibility where practical, but do not silently point local Docker observation at VM 100.

## Testing
Required tests:
- observer rejects missing token;
- observer rejects invalid token;
- observer returns sanitized container inventory;
- observer exposes no mutation routes;
- remote adapter maps observer records correctly;
- remote adapter times out/fails safely;
- overview reports observer failure as a warning instead of failing the entire request;
- local Docker host label is configurable and no longer hard-coded to VM 100;
- existing frontend/backend tests remain passing;
- production build succeeds;
- Compose configurations validate.

## Rollout
1. Implement and test on `feature/vm100-observer`.
2. Review CI and code changes.
3. Merge to `main` only after verification.
4. Pull `main` onto VM 102.
5. Deploy `friday-observer` on VM 100.
6. Test observer directly from VM 102.
7. Add observer settings to VM 102 `.env`.
8. Recreate FRIDAY.
9. Confirm real VM 100 containers appear in FRIDAY.
10. Keep all infrastructure write actions disabled.

## Success Criteria
- FRIDAY on VM 102 shows real VM 100 Docker containers.
- Proxmox inventory continues working.
- VM 102's local Docker socket is not required for VM 100 inventory.
- VM 100's native Docker API is not exposed remotely.
- Observer has no mutation capability.
- FRIDAY remains operational if the observer is offline.
