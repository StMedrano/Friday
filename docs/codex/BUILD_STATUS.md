# Friday Build Status

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Authoritative branch, host, and UI

- `main` is the authoritative FRIDAY build after reviewed feature work is merged.
- VM 102 (`friday-controller`, `192.168.1.64`) is the authoritative controller host.
- VM 100 (`192.168.1.124`) is managed infrastructure and hosts the separate read-only Docker observer.
- CT108 (`friday-ollama`, `192.168.1.70`) is the GPU-backed local Ollama fallback host.
- The deployed frontend is **FRIDAY UI v3** in React/TypeScript under `src/`.
- PR #5 is merged. Incident Diagnostics and the Mobile Dashboard are part of `main`; they are no longer candidates.
- PR #11 is merged. Groq -> Gemini -> CT108 Ollama is the preferred sequential AI chain.
- PR #12 is merged. The default local AI timeout is 45 seconds and the shared AI policy requires exact infrastructure identifier preservation.

## Current deployed controller baseline

VM102 was updated from `main` through PR #12 merge commit `02e4ba326ead580e6432928b0d25f23088448ff2` and rebuilt successfully.

Fresh production validation confirmed:

- `friday` container healthy on port `3010`;
- `/healthz` returns `{"status":"ok","service":"friday","mode":"live"}`;
- `FRIDAY_AI_PROVIDER_ORDER=groq,gemini,ollama`;
- `FRIDAY_CLOUD_AI_TIMEOUT_MS=15000`;
- `FRIDAY_LOCAL_AI_TIMEOUT_MS=45000`;
- `FRIDAY_LOCAL_AI_MODEL=qwen3:4b-instruct`;
- Groq primary response succeeds without fallback;
- Gemini was independently validated as the secondary cloud provider;
- CT108 `qwen3:4b-instruct` was independently validated as the local GPU fallback;
- a grounding regression check returned `friday-ollama – LXC 108`, matching normalized state;
- local VM102 Docker observation remains disabled in normal production operation;
- no infrastructure mutation authority exists.

## Monitoring & Incidents — merged and production validated

Monitoring & Incidents shipped through PR #4 and is part of `main`.

Implemented behavior:

- durable schema-backed state at `/data/monitoring-state.json`;
- atomic state replacement;
- offline, degraded, integration-unavailable, and flapping rules;
- GET-only `/api/incidents` and `/api/monitoring/history`;
- read-only incident UI and recommended actions;
- cached monitoring-aware overview;
- no restart/repair/execute endpoint.

## Incident Diagnostics — merged in PR #5

Incident Diagnostics is part of `main` and remains environment-gated with `FRIDAY_DIAGNOSTICS_ENABLED`.

Implemented behavior:

- monitoring state schema preserves a per-incident diagnostics map;
- VM100 observer code includes only fixed bearer-authenticated GET inspect/log routes;
- inspect output is allowlisted and omits environment variables, raw labels, bind paths, command arguments, and raw Docker JSON;
- observer log output is bounded and sanitized;
- supported VM100 `service-offline`, `service-degraded`, and `service-flapping` incidents can receive one automatic metadata-only diagnostic report;
- already-open supported incidents can receive one startup backfill if no report exists;
- deterministic analysis separates observed facts, findings, likely causes, and recommendations;
- raw logs are never collected automatically and are never persisted;
- explicit log inspection records metadata-only audit history;
- diagnostic failures do not crash monitoring or change incident lifecycle state.

Controller routes:

```text
GET /api/incidents/:incidentId/diagnostics
GET /api/incidents/:incidentId/logs
```

Observer routes implemented in source:

```text
GET /health
GET /api/v1/containers
GET /api/v1/containers/:id/inspect
GET /api/v1/containers/:id/logs?tail=100
```

There are no diagnostic POST/PUT/PATCH/DELETE routes and no arbitrary Docker proxy, SSH, shell, exec, or remediation path.

### Remaining diagnostics rollout verification

The current controller has the merged PR #5 code because VM102 was updated from `main`. Before relying on VM100 diagnostics operationally, re-run the observer-side production checks: `/health`, authenticated inventory, fixed inspect, bounded logs, and confirmation that the target container state is unchanged. Do not infer observer rollout state from the controller deployment alone.

## Mobile Dashboard — merged in PR #5

The Mobile Dashboard is part of `main`.

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
- safe-area-aware bottom navigation and minimum 44px primary touch targets are styled;
- width containment, log-panel containment, and reduced-motion treatment are present;
- frontend tests explicitly reject restart/repair/execute/stop/start-container diagnostic controls.

Representative real-device phone and desktop screenshots were reviewed during PR #5. Exact 360px/390px/430px acceptance and a real incident-detail/log-panel pass remain production-polish checks and must not be represented as completed until performed.

## Friday AI — merged, deployed, and provider-chain validated

Preferred sequence:

```text
Groq -> Gemini -> CT108 GPU Ollama -> deterministic local analysis
```

Production defaults/overrides currently validated on VM102:

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

The shared AI policy requires exact service IDs, VM/LXC numbers, host names, and service-name mappings from normalized state. AI receives normalized Friday state and no Docker, Proxmox, shell, network, deployment, or remediation tools.

## VM100 observer security boundary

Docker's native TCP API must never be exposed. Container IDs are accepted only after resolving them against current sanitized inventory. Fixed Docker GET calls are the code boundary around the privileged Unix socket.

The observer must never gain restart, stop, kill, exec, remove, image creation, volume mutation, network mutation, archive write, or arbitrary Docker-path proxy behavior.

## Docker semantics

- VM100 inventory/diagnostics go through the VM100 observer.
- `FRIDAY_DOCKER_ENABLED` refers only to local Docker on VM102.
- Normal Proxmox + VM100 observer + monitoring + diagnostics uses base `compose.yaml` with `FRIDAY_DOCKER_ENABLED=false`.
- `make live` is reserved for an explicit decision to mount VM102's Docker socket for local observation.

## Not implemented yet

- Full Friday assistant conversation/history UI connected to `/api/assistant`.
- Omada authenticated read-only site/device/health adapter.
- AdGuard authenticated read-only API/statistics adapter.
- Uptime Kuma/Prometheus/Grafana native adapters.
- Approved HTTP endpoint checks for both sites.
- Application authentication and RBAC.
- Durable action audit log/action request store.
- Human approval queue and global automation kill switch.
- Infrastructure mutation/execution endpoints.
- Notification delivery.
- Voice input pipeline.

## Next product milestone

After this source-of-truth cleanup, the next feature milestone is the **Friday Assistant experience**: connect the command composer to `/api/assistant`, preserve `/api/commands/preview` as the deterministic safety/no-AI path, expose provider/fallback provenance, and add read-only conversation/history UX without granting execution authority.

## Safety gate

Do not implement infrastructure-changing actions until authentication, role policy, approval, and durable action audit logging exist and are tested.