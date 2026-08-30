# Friday

Friday is a two-site homelab control plane hosted on **VM102 (`friday-controller`, `192.168.1.64`)**. The production architecture combines FRIDAY UI v3, server-side read-only infrastructure adapters, monitoring/incidents, incident diagnostics, a mobile operations shell, the shared advisory Friday Assistant, and a local-first advisory agent platform without exposing privileged credentials to the browser.

## Authoritative build

`main` is the canonical FRIDAY deployment source after reviewed feature work is merged. The React/TypeScript application under `src/` is the authoritative UI.

Host roles:

- VM102 `192.168.1.64` — Friday controller.
- VM100 `192.168.1.124` — managed infrastructure + separate read-only Docker observer on port `3199`.
- CT108 `192.168.1.70` — local Ollama model host.

## Current main baseline

`main` includes:

- FRIDAY UI v3;
- live read-only Proxmox integration;
- token-authenticated VM100 observer;
- durable monitoring/incidents;
- Incident Diagnostics + Mobile Dashboard from PR #5;
- multi-provider advisory assistant from PR #11/#12;
- shared session-only Friday Assistant UX from merged PR #14;
- safe base Compose with local VM102 Docker observation disabled;
- no infrastructure mutation endpoints.

The shared assistant session is browser-memory-only and reuses one conversation across Overview, FRIDAY, Mobile Home, and mobile FRIDAY. Fresh normalized Friday state remains authoritative over conversation history.

## Safety model

Friday's live adapters and AI surfaces are read-only/advisory. No restart/delete/network/firewall/VLAN/device-adoption execution endpoint exists. Monitoring writes only FRIDAY-owned monitoring state. Raw diagnostic logs are explicit-request only and are not persisted.

Infrastructure-changing actions remain blocked until authentication/RBAC, durable append-only action audit, explicit approval, and a global automation kill switch are implemented and tested.

# Local Agent Platform Phase 1

Draft PR #19 implements the first local-only advisory agent platform. Source implementation is complete; **live VM102/Supabase/API/UI acceptance is still required before merge readiness**.

## Phase 1 architecture

- Git under `agents/` is authoritative for agent definitions and enabled state.
- Agent Spec v1.1 references server-side model profiles rather than deployment URLs/models.
- Self-hosted Supabase stores runtime registry state only.
- Approved runtime tables are exactly `friday_agents` and `friday_agent_registry_state`.
- `local-router`, `local-general`, and `local-coder` resolve to local Ollama on CT108.
- Manual agent override is supported.
- Strong platform/scope language routes deterministically.
- Ambiguous requests may use the bounded CT108 `local-router` profile.
- The shared Friday composer tries local-agent routing before the general assistant.
- A matched agent runs on CT108/Ollama only and **never cloud-fallbacks after a match**.
- No-match preserves the existing Friday Assistant path.
- Every local-agent result is advisory with `execution.performed=false`.

Phase 1 intentionally has no executor, shell/SSH path, agent create/edit/delete API, restart endpoint, durable agent memory/task system, approval system, or infrastructure mutation authority.

## Agents workspace

The responsive Agents workspace exposes:

- registry health/status;
- Git source/checksum/sync metadata;
- agent definition, scope, tools, and model profile;
- explicit registry sync;
- manual agent selection + direct ask;
- local Ollama provider/model provenance;
- `Advisory only · No actions executed` safety copy.

It exposes no Restart, Execute, Delete, Approve, Shell, Edit agent, or Create agent controls.

## Phase 1 API

```text
GET  /api/agents
GET  /api/agents/:agentId
GET  /api/agents/registry/status
POST /api/agents/route
POST /api/agents/:agentId/ask
POST /api/agents/registry/sync
```

See `docs/codex/API_CONTRACT.md` for request/response and fail-closed behavior.

# Deploy/update Friday on VM102

For a normal clean deployment:

```bash
cd /srv/infrastructure/apps/friday
make preflight
make update
make health
```

The updater must preserve the production `.env`, refuse unexplained dirty source state, and avoid mounting the VM102 Docker socket unless local Docker observation is explicitly intended.

## Phase 1 Supabase migration

Before enabling the registry, apply this checked-in migration to the intended **self-hosted** Supabase/Postgres database:

```text
supabase/migrations/202608300001_friday_agent_registry.sql
```

Use the local Supabase SQL editor or a trusted local `psql` connection. After migration, the Phase 1 registry schema must contain exactly:

```text
friday_agents
friday_agent_registry_state
```

The migration is enforced in CI by:

```bash
npm run validate:agent-registry-schema
```

## Preserve and configure VM102 `.env`

Before changing production configuration:

```bash
cd /srv/infrastructure/apps/friday
cp .env ".env.before-agent-platform-$(date +%Y%m%d-%H%M%S)"
chmod 600 .env
```

Then add/update only the checked-in server-side Phase 1 variables:

```env
FRIDAY_AGENT_REGISTRY_ENABLED=true
FRIDAY_SUPABASE_URL=
FRIDAY_SUPABASE_SERVICE_KEY=
FRIDAY_AGENT_LOCAL_ROUTER_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_ROUTER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_GENERAL_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_GENERAL_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_CODER_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_CODER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_MODEL_CONTEXT=8192
FRIDAY_AGENT_MODEL_MAX_TOKENS=768
```

Never commit the production `.env` or expose the Supabase service key/provider credentials through browser configuration.

After configuration, rebuild only Friday and verify normal health:

```bash
docker compose up -d --build friday
make health
```

# Phase 1 live acceptance

Set the deployed Friday base URL:

```bash
BASE=http://192.168.1.64:3010
```

## 1. Registry list and status

```bash
curl -fsS "$BASE/api/agents" | jq
curl -fsS "$BASE/api/agents/registry/status" | jq
```

Expect the registered `proxmox-observer` definition and a healthy registry status after configuration/sync.

## 2. Explicit registry sync

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  "$BASE/api/agents/registry/sync" | jq
```

The sync updates only Friday-owned registry state from Git; it does not execute infrastructure work.

## 3. Proxmox routing

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Check Proxmox VM status"}' \
  "$BASE/api/agents/route" | jq
```

Require a matched `proxmox-observer` response with routing provenance.

## 4. Direct local-agent ask

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Check VM 100 and summarize what you observe"}' \
  "$BASE/api/agents/proxmox-observer/ask" | jq
```

Require:

```text
provider = ollama
mode = local-agent
agentId = proxmox-observer
modelProfile = local-general
model = expected CT108 local model
execution.performed = false
```

If local inference fails after the agent matched, the request must fail safely as local-agent unavailable; it must not fall back to a cloud provider.

## 5. Shared Friday composer

In the normal FRIDAY conversation, submit a clear Proxmox-specific prompt. Require automatic local-agent routing and local Ollama provenance on the assistant message. Then submit an unrelated/no-match prompt and confirm the existing general assistant path remains available.

## 6. Agents workspace acceptance

Check desktop plus representative phone widths. Confirm registry status, agent metadata, manual ask, local provenance, and sync remain usable without horizontal overflow. Confirm no infrastructure action controls appear.

# Existing live integrations

Normal production keeps controller-local Docker observation disabled:

```env
FRIDAY_MODE=live
FRIDAY_DOCKER_ENABLED=false
FRIDAY_VM100_OBSERVER_ENABLED=true
FRIDAY_VM100_OBSERVER_URL=http://192.168.1.124:3199
FRIDAY_VM100_OBSERVER_TOKEN=
FRIDAY_VM100_OBSERVER_HOST_NAME=VM 100
```

The general Friday Assistant remains separately configurable with its preferred chain:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

Matched Phase 1 agents do not use that cloud chain.

# Development / verification

```bash
make install
make test
make build
make verify
npm run validate:agent-registry-schema
```

GitHub CI verifies frontend/server/observer tests, production build, shell syntax, observer/monitoring/diagnostics boundaries, the local-agent registry schema, matched-agent local-only/no-execution safety, Compose variants, and both Docker images.

# Codex start point

Codex should begin with:

1. `AGENTS.md`
2. `CODEX.md`
3. `docs/codex/BUILD_STATUS.md`
4. `docs/codex/NEXT_STEPS.md`
5. `docs/agent-spec-v1.md`
6. `docs/local-agent-platform.md`
7. the relevant workflow under `skills/`

Treat `main` as authoritative after merge and VM102 as the controller. Do not infer live rollout state from source/CI state.