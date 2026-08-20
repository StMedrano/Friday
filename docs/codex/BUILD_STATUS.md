# Friday Build Status

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Authoritative branch, host, and UI

- `main` is the authoritative deployed FRIDAY build after reviewed feature work is merged.
- VM 102 (`friday-controller`, `192.168.1.64`) is the authoritative controller host.
- VM 100 (`192.168.1.124`) is managed infrastructure and hosts the separate read-only Docker observer.
- The approved deployed frontend is **FRIDAY UI v3** in React/TypeScript under `src/`.
- PR #5 branch `feature/incident-diagnostics-mobile` contains the completed Incident Diagnostics + Mobile Dashboard candidate and is not deployed until merged and explicitly rolled out.

## Current deployed baseline

VM102 is healthy on port `3010` with:

- live read-only Proxmox integration to `192.168.1.211:8006`;
- VM100 observer integration enabled;
- `FRIDAY_DOCKER_ENABLED=false`;
- durable monitoring enabled with a 30-second poll and 300-second service grace period;
- one production `service-offline` incident for VM100 `nginx-proxy-manager`;
- no infrastructure mutation authority.

VM100's deployed observer is healthy at `192.168.1.124:3199` and returns authenticated sanitized Docker inventory. Production validation previously observed 16 containers. Nginx Proxy Manager remained `Exited (255)` after monitoring validation.

## Monitoring & Incidents — merged and production validated

Monitoring & Incidents shipped through PR #4 and is live on VM102.

Implemented behavior:

- durable schema-backed state at `/data/monitoring-state.json`;
- atomic state replacement;
- offline, degraded, integration-unavailable, and flapping rules;
- GET-only `/api/incidents` and `/api/monitoring/history`;
- read-only incident UI and recommended actions;
- cached monitoring-aware overview;
- no restart/repair/execute endpoint.

## Incident Diagnostics — PR #5 candidate implemented

The diagnostics backend is implemented on `feature/incident-diagnostics-mobile` but is **not merged or deployed**.

Candidate behavior:

- `FRIDAY_DIAGNOSTICS_ENABLED=false` by default;
- monitoring state schema v2 preserves a per-incident diagnostics map;
- VM100 observer adds only fixed bearer-authenticated GET inspect/log routes;
- inspect output is allowlisted and omits environment variables, raw labels, bind paths, command arguments, and raw Docker JSON;
- observer log output is bounded and sanitized;
- supported VM100 `service-offline`, `service-degraded`, and `service-flapping` incidents receive one automatic metadata-only diagnostic report;
- already-open supported incidents receive one startup backfill if no report exists;
- deterministic analysis separates observed facts, findings, likely causes, and recommendations;
- raw logs are never collected automatically and are never persisted;
- explicit log inspection records metadata-only audit history;
- diagnostic failures do not crash monitoring or change incident lifecycle state.

Candidate controller routes:

```text
GET /api/incidents/:incidentId/diagnostics
GET /api/incidents/:incidentId/logs
```

Candidate observer routes:

```text
GET /health
GET /api/v1/containers
GET /api/v1/containers/:id/inspect
GET /api/v1/containers/:id/logs?tail=100
```

There are no diagnostic POST/PUT/PATCH/DELETE routes and no arbitrary Docker proxy, SSH, shell, exec, or remediation path.

## Mobile Dashboard — PR #5 candidate implemented

The mobile dashboard is implemented on the same PR #5 branch and remains **unmerged and undeployed**.

Phone layout boundary:

```text
(max-width: 700px)
```

Phone navigation:

```text
Home | FRIDAY | Infrastructure | Incidents | More
```

`More` contains Applications, Agents, Tasks, Approvals, Memory, Audit, and Settings.

Mobile Home priority:

```text
Incident attention -> Health -> FRIDAY -> Infrastructure -> Services
```

Implemented behavior:

- phone React shell replaces the desktop rail at or below 700px instead of shrinking it;
- desktop FRIDAY UI v3 remains the render path above 700px;
- active incidents are prioritized above the command surface;
- `View Diagnosis` shares incident selection with the Incidents workspace;
- diagnosis shows read-only facts, findings, likely causes, and recommendations;
- `Inspect Logs · Read Only` is the only log-fetch control and logs are not requested before explicit activation;
- mobile command bar has five primary destinations plus a More sheet;
- safe-area-aware fixed bottom navigation and minimum 44px primary touch targets are styled;
- width containment, log-panel containment, and reduced-motion treatment are present;
- frontend tests explicitly reject restart/repair/execute/stop/start-container diagnostic controls.

Automated tests prove the 700px routing behavior and desktop component regression, but this connector session has no browser/device runner that can reach private VM102. True visual acceptance at 360px, 390px, 430px, and desktop 1440px remains required before merge or rollout; JSDOM is not being treated as proof of pixel-level overflow/clipping.

## Diagnostics rollout contract

Do not enable controller diagnostics before the expanded observer is deployed and validated.

1. Merge only after exact-head PR verification and explicit owner approval.
2. Upgrade VM100 observer first.
3. Obtain the NPM ID only from sanitized observer inventory.
4. Validate fixed inspect/log GET routes.
5. Re-check `docker ps -a` and require NPM to remain in the same pre-validation state.
6. Upgrade VM102 with `FRIDAY_DIAGNOSTICS_ENABLED=false`.
7. Confirm Proxmox, observer, monitoring, and the existing incident still work.
8. Enable only `FRIDAY_DIAGNOSTICS_ENABLED=true`, recreate with base Compose, and validate the diagnostic/backfill APIs.
9. Re-check VM100 NPM state again.

Rollback is controller-only: disable `FRIDAY_DIAGNOSTICS_ENABLED` and recreate FRIDAY. Monitoring history/state remains intact.

## VM100 observer security boundary

Docker's native TCP API must never be exposed. Container IDs are accepted only after resolving them against current sanitized inventory. Fixed Docker GET calls are the code boundary around the privileged Unix socket.

The observer must never gain restart, stop, kill, exec, remove, image creation, volume mutation, network mutation, archive write, or arbitrary Docker-path proxy behavior.

## Docker semantics

- VM100 inventory/diagnostics go through the VM100 observer.
- `FRIDAY_DOCKER_ENABLED` refers only to local Docker on VM102.
- Normal Proxmox + VM100 observer + monitoring + diagnostics uses base `compose.yaml` with `FRIDAY_DOCKER_ENABLED=false`.
- `make live` is reserved for an explicit decision to mount VM102's Docker socket for local observation.

## AI boundary

- AI is disabled by default.
- Provider credentials remain server-side only.
- AI receives normalized state and no Docker, Proxmox, shell, or network mutation tools.

## Verification status for PR #5

Merge-gate verification is always tied to the **exact current PR head SHA**. Before any merge decision, the Friday CI run associated with that exact head must be successful; do not reuse an older green run after the head moves.

The required Friday CI pipeline includes:

- all Vitest frontend tests, including mobile CSS and no-remediation assertions;
- all Node/server/observer/monitoring/diagnostics tests;
- production TypeScript/Vite build;
- shell validation;
- observer security boundary;
- monitoring safety boundary;
- diagnostics safety boundary;
- controller/local-Docker/VM100-observer Compose validation;
- controller image build;
- VM100 observer image build.

In addition to automated CI, real-browser visual acceptance at 360px, 390px, 430px, and desktop 1440px remains a separate pre-merge/rollout requirement.

## Not implemented yet

- Real-device/browser visual acceptance of PR #5 at 360/390/430px and desktop 1440px.
- Omada authenticated read-only API adapter.
- AdGuard authenticated read-only API/statistics adapter.
- Uptime Kuma/Prometheus/Grafana native adapters.
- Application authentication and RBAC.
- Durable action audit log/action request store.
- Human approval queue.
- Infrastructure mutation/execution endpoints.
- Notification delivery.
- Full Friday chat/history UI connected to `/api/assistant`.
- Voice input pipeline.

## Safety gate

Do not implement infrastructure-changing actions until authentication, role policy, approval, and durable action audit logging exist and are tested.
