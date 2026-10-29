# Friday API Contract

Base URL is same-origin with the UI. Browser clients call relative `/api/...` paths. Provider and registry credentials stay server-side.

## Optional cloud automation listener

The separate, disabled-by-default port 3011 listener serves only exact `GET /api/health`, `GET /api/overview`, `GET /api/incidents`, and `GET /api/monitoring/history`. Every route, including health, requires a signed Access service-token JWT for its independent configured application audience and allowlisted Client ID. Browser identities are rejected. Other methods return 405; other paths and all query strings return 404 after authentication. Missing credentials return 403; missing authentication configuration, disabled monitoring, missing snapshots, oversized responses and collection-access failures return 503.

Overview/incidents/history read the existing monitoring cache and never trigger collection, diagnostics, repository reads, AI, or writes. Overview is the cached normalized snapshot, not a new collection or a freshly decorated monitoring response; clients must inspect its timestamps. Replies have `Cache-Control: no-store`, a generated `X-Request-Id`, and a 2 MiB maximum. The UI server's health and operational API behavior remain separate. See [cloud-connection.md](../cloud-connection.md) for deployment, request logging, identity configuration and cloud acceptance checks.

## Core health/state

### `GET /healthz`

Container health probe.

### `GET /api/health`

Runtime health and feature flags.

### `GET /api/overview`

Returns normalized FRIDAY state. Fresh normalized state is the authoritative infrastructure boundary for assistant and local-agent reasoning.

When explicitly enabled, the server-only Omada adapter adds `network` services for observed site summaries and devices, plus an `omada` entry in `integrations`. Adapter errors become sanitized integration-degraded alerts without failing other adapters. No Omada-specific browser route, raw upstream response, credential, or mutation operation is exposed. These services describe device connectivity, not unobserved WAN/VPN/topology health.

The optional AdGuard Home adapter adds an `adguard` integration entry and a `dns` service with stable ID `adguard`. Its detail contains process/protection state and aggregate query/filtering counts and average processing time for the configured statistics window. Raw domain/client statistics, credentials, and configuration are excluded. Failures degrade the integration independently; no AdGuard-specific route or mutation operation exists. Online reflects reported process/protection state, not a DNS resolution probe.

The optional Prometheus adapter adds a `prometheus` integration entry and `monitoring` services for active scrape targets. IDs hash the scrape pool and sorted final labels; names identify the Prometheus job and the host field contains only the instance host/port. Site comes from the target's nonempty `site` label or the required configured fallback. Status describes the last reported scrape outcome, with its timestamp in `updated`; it does not establish application health. Raw label maps, scrape URLs, discovery data, errors, and credentials are excluded. No Prometheus-specific browser route, query execution, or mutation operation exists.

The optional Uptime Kuma adapter adds an `uptime-kuma` integration entry and `monitoring` services with stable IDs `uptime-kuma-{monitor_id}`. It exposes monitor name/type and last reported status (including pending and maintenance), with the configured site and collector hostname. `updated` is the collection time, not a fresh heartbeat timestamp. Monitored URLs, tags, raw metrics, and API keys are excluded. No Kuma-specific browser route, live probe, or control operation exists.

### `GET /api/settings`

Read-only projection of the controller's effective configuration, behind
the same verified Access identity as `/api/overview`. Reports posture
only: mode, Access (origin verification, configured, operator count),
each integration's `enabled`, `configured` (required fields present),
`credentials` (`present`/`missing`/`not-required`), site label and
Proxmox TLS verification, AI provider order with credential presence and
model names, monitoring/diagnostics, the automation API, action audit
state (`enabled`, `integrity`, event count; never its directory), and fixed
`safety` facts (`writableSettings`, `infrastructureActions`, `executor`
all `false`). It never returns secrets, tokens, usernames, operator
emails, Access team/audience values, URLs or addresses. No write method
exists; settings change only through the server environment.

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

## Local repository metadata

### `GET /api/repositories`

Returns enabled repositories from the server-side local registry. Response metadata includes ID, display name, remote without URL credentials or query parameters, default branch, and access mode. It never includes local filesystem paths or per-repository exclusions. Missing or invalid registry data returns a generic `503`; the route has no mutation methods.

The file named by `FRIDAY_REPOSITORY_REGISTRY_PATH` is excluded from Git and the container build context. Enabled entries require string IDs; numbers, booleans, arrays, and objects are rejected rather than coerced. Registry path resolution accepts only explicitly registered Git working trees, rejects traversal and symlink escapes, and refuses secret, dependency, and build paths.

The optional `enabled` field must be a JSON boolean: omission defaults to enabled, and `false` excludes the entry. Other values, including the string `"false"` and `null`, invalidate the registry rather than enabling a checkout unintentionally.

Registry `exclude` patterns support `*` within a path segment, `?` for exactly one non-separator character, and `**` across segments, including paths containing line terminators. A `**/` prefix matches zero or more directories, so `**/inventory.json` excludes both root-level and nested files named `inventory.json`. Excluded directories also exclude their descendants. The same exclusions apply to file listings and text reads.

### Read-only repository tools

- `GET /api/repositories/:id/status` returns the branch and a dirty flag, without file names. Repositories with no commits report their actual branch name. The dirty flag includes staged changes but ignores untracked files.
- `GET /api/repositories/:id/files?path=.&limit=100` returns at most 200 in-root file paths. The optional limit defaults to 100 and must contain only decimal digits representing an integer from 1 to 200; malformed or out-of-range values return HTTP 400 (`repository-request-rejected`). Directory traversal is depth- and entry-bounded.
- `GET /api/repositories/:id/file?path=README.md` returns UTF-8 text for a regular file no larger than 64 KiB. Files containing NUL bytes or invalid UTF-8 are rejected with HTTP 400 (`repository-request-rejected`).

All paths resolve under an enabled registered Git root and repeat exclusion checks after symlink resolution. Failures return a generic rejection; arbitrary shell, Git arguments, write methods, and repository mutation are not exposed.

The Repositories workspace uses these GET routes only. It displays registered metadata, branch/dirty status, file paths, and selected text; it does not perform repository writes or execute code.

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

## Durable action audit

### `GET /api/audit/events`

Operator-only (same Access operator list as registry sync). Read-only;
no write, update or delete method exists. Query: `limit` (1–200,
default 50), `before` (sequence cursor), `action` (one of the audited
actions). Returns newest first:

```json
{ "integrity": "verified", "nextBefore": 12,
  "events": [{ "seq": 13, "requestId": "uuid", "at": "ISO-8601",
    "action": "agents.registry.sync", "phase": "succeeded",
    "actor": { "kind": "human", "id": "sha256", "label": "owner@example.com" },
    "target": null, "detail": null, "prev": "sha256", "hash": "sha256" }] }
```

`integrity` is `broken` (with no events) when the hash chain, sequence or
any line fails verification. Errors: `503 audit-not-enabled` when
`FRIDAY_AUDIT_ENABLED` is off, `503 audit-unavailable`, `400 invalid-audit-query`.

Audited actions today are `POST /api/agents/registry/sync` and
`POST /api/incidents/:id/diagnostics/rerun`. Each writes `requested`
before running and `succeeded`/`failed` after, sharing a `requestId`.
With auditing enabled, an action whose `requested` record cannot be
persisted is refused with `503 audit-unavailable` and does not run.

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

### Task keyset pages

The task GET response now includes nextCursor:string|null alongside tasks (maximum50). Optional exactly-one cursor query continues older records. No other query keys, duplicate cursor or POST queries are accepted. Cursor is bounded base64url JSON position metadata tied to the selected project, not an authentication or grant token. Every request still resolves current identity/catalog scope. Invalid cursor400, denied project403, malformed/unordered/duplicate/overlapping store results503. Ordering is created_at DESC,id DESC with a51-record lookahead and exact UTC microsecond precision. A concurrent newer insert cannot shift the older boundary. Responses are not frozen database snapshots; Refresh discovers newest records. Client requires valid pagination metadata and never infers there are no older records from a malformed envelope. No runtime wiring or private grant is enabled.
