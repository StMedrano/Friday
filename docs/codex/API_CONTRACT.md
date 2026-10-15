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

Availability is explicit: HTTP 503 `monitoring-disabled` when configured off; 503 `monitoring-history-unavailable` if the reader is missing or throws; 502 `monitoring-history-invalid` if its result is malformed. Only a validated successful read may return HTTP 200 `{events: []}`. Reads are awaited, bounded to 5000 unique records and projected onto id/type/at/source/detail plus optional host/serviceId/serviceName. Failures never carry fabricated empty events or raw exception details. Existing signed Access and GET-only boundaries apply. History availability is not proof that incidents are absent or that current polling is healthy.

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

The HTTP endpoint is stateless. The browser owns the current in-memory Friday session. Prompt/history inputs are bounded and sanitized before provider invocation. Fresh normalized Friday state is rebuilt exactly once for every request and remains authoritative over conversation context.

When the agent service is available, this endpoint routes first. A matched registered agent receives that same current overview and returns immediately through local Ollama. A successful match does not invoke the general provider chain. If routing returns no match, or the routing service itself is unavailable, the general assistant behavior below is preserved. If a matched agent's local inference fails, the endpoint returns `local-agent-unavailable` and never invokes a cloud/general provider.

Representative auto-routed response:

```json
{
  "available": true,
  "mode": "local-agent",
  "provider": "ollama",
  "model": "qwen3:4b-instruct",
  "modelProfile": "local-general",
  "agentId": "proxmox-observer",
  "agentName": "Proxmox Observer",
  "routing": {
    "matched": true,
    "method": "deterministic",
    "confidence": 0.98,
    "reason": "Strong Proxmox scope match."
  },
  "text": "read-only grounded advisory response",
  "execution": {
    "performed": false,
    "reason": "Phase 1 agents are advisory only."
  }
}
```

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

The browser's merged Friday session sends each new prompt once to `/api/assistant`. The server performs local-agent routing before any general provider call. When a registered agent matches, the UI records the returned local-agent provenance on the same conversation surface. When no agent matches, `/api/assistant` continues through the general advisory path.

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


## Internal Phase 2B Shared Work + Scoped Memory

The Phase 2B modules under `server/work/` expose **internal JavaScript service methods only**.
They do not add HTTP routes or an MCP bridge. Trusted Friday server code
must supply a separately verified ActorContext; an agent cannot choose
its own identity or gain capability grants through model output.

- Work: `createWorkService({repository,agentAuthorizer})`
- Database adapter: `createSupabaseWorkRepository({baseUrl,serviceKey})`
- Memory: `createMemoryService({repository,sessionStore})`
- Decisions and artifact metadata: `createDecisionService({repository,reviewAuthorizer})`
- Continuation: `buildWorkContinuation({actor,workService,decisionService,memoryService,workItemId,scopes})`

All shared work tables are private, protected by RLS and explicitly restricted
to the trusted `service_role`. The database migration must be reviewed
separately before application to homelab production. This does not change
the local-Ollama-only matched-agent contract or introduce an executor.

See `docs/shared-work-phase2b.md`.
## POST /api/group-advisory

Authenticated non-executing Friday assistance for fixed public groups. This does not invoke a registered specialist or activate Phase 2C. Same-origin and the existing shared per-identity inference quota apply; live mode fails closed without verified Access identity.

Request has exactly two fields:
```json
{"groupId":"app-builder","prompt":"Propose an implementation and QA plan for a booking app."}
```
Allowed group IDs are `techtactics`, `app-builder`, `homelab`; prompt is a nonempty string of at most 4000 characters. Actor, role, system-prompt, assignment, tool and history fields are rejected. Fixed server policy owns the group brief.

TechTactics/App Builder receive no infrastructure snapshot or private business records. HomeLab receives fresh normalized overview evidence. The existing configured AI providers are tried sequentially; NVIDIA activation/provider configuration is unchanged. A deterministic infrastructure fallback is not a generated group plan and returns unavailable.

Successful output includes `available:true`, the exact `groupId`, text, actual mode/provider/model and optional fallback provenance. `execution.performed` is always false. No shared work is created or stored, no private-data grant is inferred and no action is performed. Invalid brief returns 400, denied Access/origin/quota returns 401/403/429, unavailable AI returns 503, and internal failure returns a sanitized 502. Responses are no-store.

## HomeLab workspace observation panel

Consumes the existing protected GET /api/overview with a bounded timeout. The client projects mode/timestamp, validated service identity/status/detail and incident summaries. It retains exact source identifiers, labels mock data as demo, clears old evidence on refresh, and shows unavailable on HTTP/schema/timeouts instead of substituting mock success. Refresh is an explicit read; there is no mutation or restart control.

## Private Web Growth projection

GET `/api/web-growth` requires live mode, signed Access and an explicit exact email in `FRIDAY_WEB_GROWTH_READER_EMAILS`. Group/operator status alone grants nothing. Queries rejected400, writes405 (same-origin guard may deny earlier), ungranted actor403, invalid Access401/unconfigured503, disabled/unavailable/malformed reader503. No-store, no mock private records, no empty fallback. Defaults are disabled/empty grants.

Reader URL is HTTPS origin-only with no embedded credentials/query/path. Server-only token, fixed GET `/v1/friday/web-growth`, no redirects, eight-second timeout, 1MiB streamed response bound. Canonical snapshot: schemaVersion1, projectId techtactics-web-growth, generatedAt, reported sourceRevision hex7–40, original-byte SHA256 sourceChecksum, max1000 unique leads. Lead projection contains id/businessName/stage, discoveredAt/updatedAt, recorded approval/send flags/timestamps, nullable0–100score/auditCheckedAt and proposal/demo availability. No contact/address/messages/notes/sales text/credentials. Invalid record rejects entire snapshot. Reported revision is not deployment attestation; read timestamp is not record freshness. Companion source/configuration prerequisites are documented in `integrations/web-growth-reader/README.md`.

## Optional local project/task slice (not bootstrapped)

GET /api/projects returns {projects:[{id,name}]} from the trusted provisioned catalog only. GET /api/projects/:id/tasks returns {tasks:[{id,projectId,title,objective,acceptanceCriteria,status,version}]}, latest50. POST on that task collection accepts exactly title, objective, acceptanceCriteria and requestId; project scope comes only from the URL intersected with the current trusted catalog/owner binding. Returns201 {task} after confirmed storage. An unchanged retry reuses requestId; changed input with a reused ID conflicts409. No claim/status/delete/memory/worker API exists in this slice.

Requires live mode, signed Access owner identity and explicit trusted server service injection. Bootstrap has no wiring or credentials. Default503 unavailable; unknown identity/project403; invalid fields/query400; unsupported method405; request conflicts409; existing per-identity POST quota429; storage/malformed result503. Writes require exact configured Origin and JSON. All responses no-store. Denied access precedes private catalog reads; group/operator/model claims cannot grant access. Catalog >50, invalid/duplicate IDs and malformed task output fail closed. Catalog removal invalidates later operations. No production activation or grants implied.
