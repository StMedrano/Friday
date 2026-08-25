# Friday

Friday is a two-site homelab control plane hosted on **VM 102 (`friday-controller`, `192.168.1.64`)**. It combines the authoritative **FRIDAY UI v3 command center**, a server-side infrastructure API, read-only live adapters, durable monitoring/incidents, incident diagnostics, a purpose-built mobile operations shell, and optional advisory AI without exposing privileged credentials to the browser.

## Authoritative build

`main` is the canonical FRIDAY build and deployment source after reviewed feature work is merged.

The production UI is the React/TypeScript implementation under `src/`. Standalone HTML prototypes and older dashboards are reference artifacts only.

VM 102 deploys FRIDAY. VM 100 (`192.168.1.124`) is managed infrastructure and hosts a separate read-only Docker observer; it is not the FRIDAY controller.

## Current production baseline

The current `main` baseline includes:

- FRIDAY UI v3 command center
- React + TypeScript + Vite frontend
- unified Node 22 UI/API server
- live read-only Proxmox integration
- token-authenticated VM100 Docker inventory observer
- local VM102 Docker observation disabled
- durable monitoring and incidents
- deterministic offline/degraded/integration/flapping incident rules
- read-only Incidents workspace
- merged Incident Diagnostics from PR #5, gated by `FRIDAY_DIAGNOSTICS_ENABLED`
- merged purpose-built Mobile Dashboard from PR #5
- multi-provider advisory AI from PR #11: Groq -> Gemini -> CT108 GPU Ollama -> deterministic local analysis
- 45-second default local AI timeout and exact infrastructure identifier grounding from PR #12
- one shared session-only Friday conversation across Overview, FRIDAY, and mobile surfaces
- safe base Compose with no controller Docker socket mount
- no infrastructure mutation endpoints

The VM102 controller was updated from `main` after PR #12 and validated healthy. Provider validation confirmed Groq primary, Gemini fallback, CT108 `qwen3:4b-instruct` local fallback, and exact `friday-ollama -> LXC 108` grounding. Production validation of VM100 observer diagnostic routes should still be treated as a separate observer-side check before relying on those routes operationally.

## Safety model

Friday read adapters cannot mutate infrastructure. Monitoring writes only FRIDAY-owned state under the persistent `/data` volume. The AI endpoint is advisory only and receives normalized Friday state, not Docker/Proxmox execution tools.

No restart/delete/network/firewall/VLAN/device-adoption execution endpoint exists. Infrastructure-changing actions remain blocked until authentication/RBAC, durable action audit logging, and an approval workflow exist.

The VM100 observer diagnostics surface is limited to fixed, token-authenticated GET routes:

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

Monitoring is deployed on VM102. Current settings are server-side and use the persistent FRIDAY data volume:

```env
FRIDAY_MONITORING_ENABLED=true
FRIDAY_MONITORING_POLL_SECONDS=30
FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS=300
FRIDAY_MONITORING_STATE_PATH=/data/monitoring-state.json
FRIDAY_MONITORING_HISTORY_LIMIT=2000
```

Monitoring uses a non-overlapping poll loop, persists observations/incidents/history, and exposes GET-only incident/history APIs. It does **not** restart, stop, start, exec into, or modify containers or Proxmox guests.

## Incident Diagnostics

Incident Diagnostics shipped in PR #5 and is part of `main`. The feature remains environment-gated:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

When enabled, supported VM100 service incidents receive one metadata-only diagnostic snapshot. Existing open supported incidents without a report receive one startup backfill. Analysis is deterministic and separates observed facts, findings, likely causes, and recommendations.

Raw container logs are **never fetched automatically**. They are fetched only through an explicit GET request, sanitized and bounded to a maximum 100-line controller request / 200-line observer cap, returned ephemerally, and never persisted in monitoring state or history.

Controller diagnostics APIs:

```text
GET /api/incidents/:incidentId/diagnostics
GET /api/incidents/:incidentId/logs
```

There is no diagnostic remediation endpoint.

Observer rollout and route validation remain observer-first: validate `/health`, authenticated inventory, fixed inspect, and bounded logs on VM100 before depending on controller diagnostics. See `observer/README.md` and `docs/live-integrations.md` for the validation commands.

## Mobile Dashboard

The Mobile Dashboard shipped in PR #5 and is part of `main`. It uses a purpose-built phone operations shell at the exact `(max-width: 700px)` boundary. It does not shrink the desktop rail onto a phone; React renders a separate phone shell while desktop FRIDAY UI v3 remains the layout above 700px.

Phone navigation is:

```text
Home | FRIDAY | Infrastructure | Incidents | More
```

`More` exposes Applications, Agents, Tasks, Approvals, Memory, Audit, and Settings.

Mobile Home priority is:

```text
Incident attention -> Health -> FRIDAY -> Infrastructure -> Services
```

Active incidents therefore appear before the command surface. `View Diagnosis` opens the selected incident detail. Diagnostic metadata loads read-only; raw logs remain explicit-request only through `Inspect Logs · Read Only`. There are no restart, repair, execute, stop, or start-container controls.

The phone shell includes safe-area-aware fixed bottom navigation, 44px minimum primary touch targets, width/overflow containment, reduced-motion handling, and single-column diagnostic/log containment. Automated JSDOM/component/CSS contract tests cover the 700px routing contract and desktop regression.

Representative phone and desktop render paths were visually reviewed during PR #5. Exact 360px/390px/430px acceptance and a real incident-detail/log-panel pass remain useful production-polish checks and should not be represented as completed unless performed.

## Deploy/update the VM100 observer

Target:

```text
VM 100: 192.168.1.124
Port:   3199
Path:   /srv/infrastructure/friday-observer
```

See `observer/README.md` for preflight, update, authentication, diagnostic validation, and the Docker-socket security boundary.

## Friday multi-provider assistant

Friday AI is disabled by default and remains advisory/read-only when enabled. Provider credentials stay server-side. The preferred provider order is sequential and falls through to deterministic local analysis:

```text
Groq -> Gemini -> CT108 GPU Ollama -> deterministic local analysis
```

Start from the checked-in environment template:

```bash
cp .env.example .env
```

Configure one or more providers in `.env`. The current VM102/CT108 deployment uses:

```env
FRIDAY_AI_ENABLED=true
FRIDAY_AI_PROVIDER_ORDER=groq,gemini,ollama
FRIDAY_CLOUD_AI_TIMEOUT_MS=15000
FRIDAY_LOCAL_AI_TIMEOUT_MS=45000

GROQ_API_KEY=
GROQ_MODEL=

GEMINI_API_KEY=
GEMINI_MODEL=

FRIDAY_LOCAL_AI_ENABLED=true
FRIDAY_LOCAL_AI_URL=http://192.168.1.70:11434
FRIDAY_LOCAL_AI_MODEL=qwen3:4b-instruct
FRIDAY_LOCAL_AI_CONTEXT=8192
FRIDAY_LOCAL_AI_MAX_TOKENS=512
```

`FRIDAY_AI_REQUEST_TIMEOUT_MS` remains available as a backward-compatible single timeout. Leave it blank when using the split cloud/local timeout budgets.

OpenAI and Anthropic adapters are retained for compatibility but are no longer in the default provider order. Groq and Gemini models must be selected explicitly in `.env`.

CT108 (`192.168.1.70`) runs native Ollama on the AMD Radeon 780M through RADV/Vulkan. Its firewall should permit TCP/11434 only from VM102 (`192.168.1.64`). `qwen3:4b-instruct` is the recommended local model for routine Friday summaries and the local output budget is bounded by `FRIDAY_LOCAL_AI_MAX_TOKENS`.

The shared AI policy requires providers to preserve exact service IDs, VM/LXC numbers, host names, and service-name mappings from normalized Friday state rather than infer, renumber, merge, or substitute identifiers.

The Compose `local-ai` Ollama service remains an optional private development/recovery path. To start it and pull the configured model:

```bash
docker compose --profile local-ai up -d
./scripts/pull-local-model.sh
```

That Compose Ollama service has **no host/LAN-published port**. Friday receives no Docker, Proxmox, shell, or infrastructure mutation tools regardless of provider.

See `docs/ai-providers.md` for provider behavior, timeout semantics, and the CT108 GPU deployment.

Never place provider or infrastructure secrets in `VITE_*` variables.

### Friday assistant session UX

The UI owns exactly one in-memory Friday conversation for the lifetime of the mounted Dashboard. The same session is reused by desktop Overview, the dedicated FRIDAY workspace, Mobile Home, and the mobile FRIDAY workspace.

- Overview and Mobile Home show a compact transcript: the newest two completed exchanges plus any active trailing loading/error turn.
- The FRIDAY workspace shows the full current client transcript and labels the boundary with `FRIDAY / SESSION` and `Advisory only · No actions executed`.
- Each provider response keeps its provenance badge/model metadata. When fallback occurred, the response exposes normalized fallback-attempt details.
- Up to the newest 10 completed exchanges are sent as context for the next AI-backed request.
- `Clear session` clears only browser memory and is disabled while a request is in flight.
- Refreshing, remounting, or opening a new browser session starts with an empty Friday transcript.
- There is no localStorage, sessionStorage, IndexedDB, server-side conversation record, session ID, or `/data` assistant-history persistence.
- There is no automatic retry and providers remain sequential rather than parallel.

Fresh normalized Friday infrastructure state remains authoritative on every turn; conversation history is context, not evidence. Exact request/history limits are documented in `docs/codex/API_CONTRACT.md`.

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

VM100 observer contract:

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
