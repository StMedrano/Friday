# Friday Integrations

Friday integrations are server-side and read-only unless a future action adapter is explicitly introduced after authentication, role policy, approval, global kill-switch, and durable action-audit controls exist.

## VM100 Docker observer

- Inventory adapter: `server/adapters/vm100-observer.mjs`
- Diagnostics adapter: `server/adapters/vm100-observer-diagnostics.mjs`
- Observer service: `observer/`
- Transport: bearer-authenticated HTTP from VM102 to VM100 on `192.168.1.124:3199`.
- Observer Docker access: local Unix socket only.
- Purpose: sanitized VM100 container inventory plus narrowly scoped read-only incident diagnostics.
- Never expose Docker's native TCP API.

Observer routes:

```text
GET /health
GET /api/v1/containers
GET /api/v1/containers/:id/inspect
GET /api/v1/containers/:id/logs?tail=100
```

Inspect output is allowlisted. Logs are explicit-request only, sanitized, bounded, and ephemeral at the controller/UI boundary.

## Monitoring & Incidents

- Runtime: `server/monitoring/runtime.mjs`
- Rules: `server/monitoring/incidents.mjs`
- Durable store: `server/monitoring/store.mjs`
- State: FRIDAY-owned `/data/monitoring-state.json`.
- APIs: `GET /api/incidents` and `GET /api/monitoring/history`.
- Monitoring grants no provider write permissions.

## Incident Diagnostics

Diagnostics remain environment-gated by `FRIDAY_DIAGNOSTICS_ENABLED`. Supported VM100 incidents can receive metadata-only diagnostic snapshots; raw logs are never fetched automatically and are never persisted. Explicit log inspection is read-only.

Controller routes:

```text
GET /api/incidents/:incidentId/diagnostics
GET /api/incidents/:incidentId/logs
```

There is no diagnostic remediation API.

## Local Agent Platform Phase 1

Phase 1 adds two local integrations that are independent from the general multi-provider assistant:

### Self-hosted Supabase runtime registry

Git under `agents/` remains authoritative. Supabase/Postgres stores only validated runtime registry state. The checked-in migration is:

```text
supabase/migrations/202608300001_friday_agent_registry.sql
```

The approved Phase 1 database surface is exactly:

```text
friday_agents
friday_agent_registry_state
```

Server configuration:

```env
FRIDAY_AGENT_REGISTRY_ENABLED=false
FRIDAY_SUPABASE_URL=
FRIDAY_SUPABASE_SERVICE_KEY=
```

The service credential stays on the Friday server/container. It must never be exposed through frontend/browser configuration. The registry client is constrained to the two approved Friday resources, normalizes upstream failures, and does not return the service key in errors.

Registry sync is explicit and Git-owned. It is not an agent editor and cannot create infrastructure actions, approvals, tasks, memory, or executor records.

### CT108 local Ollama agent inference

Agent profiles are server-side and Ollama-only:

```env
FRIDAY_AGENT_LOCAL_ROUTER_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_ROUTER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_GENERAL_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_GENERAL_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_CODER_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_CODER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_MODEL_CONTEXT=8192
FRIDAY_AGENT_MODEL_MAX_TOKENS=768
```

CT108 should accept TCP/11434 only from VM102. Matched local agents use only their resolved CT108/Ollama profile. They do not participate in Groq/Gemini/OpenAI/Anthropic failover and never fall back to those providers after a match.

Agent APIs:

```text
GET  /api/agents
GET  /api/agents/:agentId
GET  /api/agents/registry/status
POST /api/agents/route
POST /api/agents/:agentId/ask
POST /api/agents/registry/sync
```

The first three are registry reads. `route` performs bounded selection only. `ask` performs local advisory inference using fresh normalized Friday state. `registry/sync` accepts only `{}` and updates Friday-owned registry state from Git. No create/edit/delete/execute/restart/shell agent route exists.

Every successful Phase 1 agent reply remains advisory and reports `execution.performed=false`.

## Local Docker Engine on VM102

- Adapter: `server/adapters/docker.mjs`
- Transport: local Unix socket.
- Disabled in normal production operation.
- Use the explicit live override only when local controller Docker inventory is intentionally required.

## Proxmox VE

- Adapter: `server/adapters/proxmox.mjs`
- Authentication: dedicated API token.
- Use the smallest read-only role that can list nodes, VMs/CTs, and status.
- Never reuse the root password or a broad administrator token.

## HTTP endpoint checks

- Adapter: `server/adapters/endpoints.mjs`
- Purpose: read-only availability checks of approved HTTP/HTTPS services.
- Do not place credentials in endpoint URL query strings.

## General advisory AI providers

Friday's general assistant remains separate from matched local agents. Preferred sequential assistant chain:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

Provider adapters:

- Groq: `server/ai/groq.mjs`
- Gemini: `server/ai/gemini.mjs`
- Ollama: `server/ai/ollama.mjs`
- OpenAI compatibility: `server/ai/openai.mjs`
- Anthropic compatibility: `server/ai/anthropic.mjs`

Provider credentials stay server-side. General assistant providers receive normalized Friday state and no infrastructure execution tools.

## Adapter checklist

Every integration must have explicit opt-in configuration, least-privilege credentials, timeouts, degraded-state handling, normalized/sanitized responses, automated tests without real credentials, server-side secrets, and a working credential-free mock/degraded mode where applicable.