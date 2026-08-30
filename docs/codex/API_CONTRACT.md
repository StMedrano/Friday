# Friday API Contract

Base URL is same-origin with the UI. Browser clients call relative `/api/...` paths. Provider and registry credentials stay server-side.

## Core health/state

### `GET /healthz`

Container health probe.

### `GET /api/health`

Runtime health and feature flags.

### `GET /api/overview`

Returns normalized FRIDAY state. Fresh normalized state is the authoritative infrastructure boundary for assistant and local-agent reasoning.

## Monitoring and diagnostics

### `GET /api/incidents`

Returns FRIDAY-owned monitoring incidents. There is no incident mutation endpoint.

### `GET /api/monitoring/history`

Returns bounded recent FRIDAY-owned monitoring events newest-first. History must not contain provider credentials, authorization headers, or raw application logs.

### `GET /api/incidents/:incidentId/diagnostics`

Returns the persisted safe diagnostic report for one existing incident when diagnostics are supported/enabled.

### `GET /api/incidents/:incidentId/logs`

Performs explicit read-only bounded log inspection. Raw log text is response-only and is not persisted.

There is no diagnostic remediation endpoint.

## `POST /api/commands/preview`

Deterministic safety classifier. It never executes infrastructure work.

```json
{"command":"check system health"}
```

Response includes preview/rejection metadata and never represents infrastructure execution.

## `POST /api/assistant`

Optional general advisory AI analysis. The request accepts a required current `prompt` plus optional client-supplied conversational `history`.

```json
{
  "prompt": "Compare it to VM102",
  "history": [
    {"role":"user","content":"Check friday-ollama"},
    {"role":"assistant","content":"friday-ollama is LXC 108"}
  ]
}
```

The HTTP endpoint is stateless. The browser owns the current in-memory Friday session. Prompt/history inputs are bounded and sanitized before provider invocation. Fresh normalized Friday state is rebuilt for every request and remains authoritative over conversation context.

Preferred general assistant sequence:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

The general assistant remains advisory and has no Docker, Proxmox, shell, network, deployment, or remediation tools.

# Local Agent Platform Phase 1 API

Phase 1 local agents are distinct from the general multi-provider assistant. Git is authoritative for definitions, self-hosted Supabase stores runtime registry state, and matched agents infer through CT108/Ollama only.

All local-agent prompt inputs are trimmed, required to be non-empty, and capped at 4,000 characters. Agent IDs accept only bounded machine-readable IDs; path/query/control forms are rejected.

## `GET /api/agents`

Returns the sanitized enabled/runtime agent registry view for UI and routing.

Representative item:

```json
{
  "version": "1.1",
  "id": "proxmox-observer",
  "name": "Proxmox Observer",
  "description": "Read-only Proxmox inventory and diagnostics.",
  "enabled": true,
  "model": { "profile": "local-general" },
  "scope": { "platforms": ["proxmox"] },
  "tools": ["proxmox_read", "inventory_read"],
  "source": {
    "path": "agents/proxmox-observer.json",
    "checksum": "...",
    "syncedAt": "..."
  }
}
```

If the registry is disabled/unavailable, the endpoint fails closed with a sanitized service error; it does not invent agents.

## `GET /api/agents/:agentId`

Returns one sanitized registered agent definition. Unknown agents return 404 / `agent-not-found`.

## `GET /api/agents/registry/status`

Returns the current Friday-owned registry sync state, including normalized status, last sync/source commit when available, counts of definitions seen/synced/rejected, and sanitized errors.

## `POST /api/agents/registry/sync`

Explicitly synchronizes valid Git-owned definitions into the runtime registry. The only accepted request body is an empty object:

```json
{}
```

This endpoint may update only the approved Friday registry tables. It does not edit Git definitions and does not execute infrastructure work. Extra request fields are rejected.

## `POST /api/agents/route`

Selects an enabled registered local agent for the supplied prompt.

```json
{"prompt":"Check Proxmox VM status"}
```

Routing precedence:

1. valid explicit/manual agent override when supplied by the internal caller;
2. deterministic routing for strong registered platform/scope language;
3. CT108 `local-router` classification for ambiguity;
4. safe no-match/unavailable result.

The local router may return only an exact enabled registered candidate ID or no match. Unknown output and router failure do not invent a route.

A route response identifies whether a match occurred, the selected `agentId` when matched, and routing provenance such as deterministic/manual/local-router.

## `POST /api/agents/:agentId/ask`

Runs one advisory request through the selected registered local agent using a fresh normalized Friday overview.

```json
{"prompt":"Check VM 100"}
```

Representative successful response:

```json
{
  "available": true,
  "mode": "local-agent",
  "provider": "ollama",
  "agentId": "proxmox-observer",
  "agentName": "Proxmox Observer",
  "modelProfile": "local-general",
  "model": "qwen3:4b-instruct",
  "text": "read-only advisory response",
  "execution": {
    "performed": false,
    "reason": "Phase 1 agents are advisory only."
  }
}
```

A matched agent uses only its resolved local Ollama profile. It never falls back to Groq, Gemini, OpenAI, Anthropic, or the general assistant provider chain after a match. Local inference failure returns a sanitized local-agent unavailable result with `execution.performed=false`.

## Shared Friday session routing

The browser's merged Friday session sends each new prompt through local-agent routing first. When a registered agent matches, the UI records the returned local-agent provenance on the same conversation surface. When no agent matches, the existing `/api/assistant` path remains the general advisory fallback.

“No agent match” and “matched agent failed” are deliberately different:

- **no match** -> normal Friday assistant may answer;
- **matched agent local inference failure** -> return local-agent unavailable; do not cloud-fallback that matched request.

## Phase 1 forbidden API surface

The following capabilities do not exist in Phase 1:

- agent create/edit/delete APIs;
- restart/stop/start endpoints;
- arbitrary agent tool execution;
- shell/SSH execution;
- approval/task/memory/action endpoints;
- infrastructure mutation through an agent response.

PUT/PATCH/DELETE agent mutation routes and POST execution/restart/tool routes must remain absent. Every successful local-agent result remains advisory with `execution.performed=false`.

## VM100 observer contract

```text
GET /health
GET /api/v1/containers
GET /api/v1/containers/:id/inspect
GET /api/v1/containers/:id/logs?tail=100
```

The observer is not a generic Docker API proxy.

## Future action APIs

Do not add execution to the endpoints above. Future actions require a separate, explicitly reviewed policy-gated design after authentication/RBAC, durable append-only action audit, explicit approval workflow, and a global automation kill switch exist and are tested.