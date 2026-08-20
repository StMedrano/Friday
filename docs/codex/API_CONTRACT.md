# Friday API Contract

Base URL is same-origin with the UI. Browser clients call relative `/api/...` paths. Provider credentials stay server-side.

## `GET /healthz`

Container health probe.

```json
{"status":"ok","service":"friday","mode":"mock"}
```

## `GET /api/health`

Runtime health and feature flags. Response includes `status`, `mode`, `ai`, and an ISO `time`.

## `GET /api/overview`

Returns normalized FRIDAY state. Primary fields include `mode`, `sites`, `services`, `resources`, `alerts`, `activities`, `integrations`, optional `incidents`, and optional `monitoring`.

When monitoring is enabled and a poll has completed, the controller serves the cached normalized live overview decorated with current incidents and monitoring summary. Provider-specific payloads are normalized before this boundary.

## `GET /api/incidents`

Returns FRIDAY-owned monitoring incidents. Open incidents are returned before recently resolved incidents.

```json
{
  "summary": {"active":1,"high":1,"warning":0,"resolved":0},
  "incidents": [
    {
      "id":"...",
      "type":"service-offline",
      "severity":"high",
      "status":"open",
      "host":"VM 100",
      "serviceName":"nginx-proxy-manager",
      "recommendedAction":"...",
      "evidence":["Exited (255)"]
    }
  ]
}
```

There is no POST/PUT/PATCH/DELETE incident mutation endpoint.

## `GET /api/monitoring/history`

Returns recent FRIDAY-owned monitoring events newest-first. Event types include service status changes, incident lifecycle events, integration degraded/recovered events, monitoring poll failures, and metadata-only diagnostic log-inspection events.

The history is bounded by `FRIDAY_MONITORING_HISTORY_LIMIT` and must not contain provider credentials, authorization headers, or raw application logs.

## `GET /api/incidents/:incidentId/diagnostics`

Returns the persisted safe diagnostic report for one existing incident. Diagnostics are opt-in with:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

When disabled, a known incident returns a normalized `not-supported` response without contacting the observer. When enabled, supported VM100 container incidents can return:

- `pending`
- `available`
- `degraded`
- `unavailable`
- `not-supported`

Representative available response:

```json
{
  "id":"diagnostic-INCIDENT_ID",
  "incidentId":"INCIDENT_ID",
  "source":"vm100-observer",
  "host":"VM 100",
  "serviceName":"nginx-proxy-manager",
  "collectedAt":"2026-08-20T01:00:00.000Z",
  "status":"available",
  "metadata":{"state":"exited","exitCode":255,"oomKilled":false,"restartCount":0},
  "facts":[{"id":"exit-code","label":"Exit code","value":"255"}],
  "findings":["The container exited with an application/startup failure rather than an OOM termination."],
  "likelyCauses":["Application or startup configuration failure is likely."],
  "recommendations":["Inspect recent sanitized application logs and recent configuration/deployment changes."],
  "logsAvailable":true,
  "lastLogInspectionAt":null,
  "error":null
}
```

Facts are direct observations. Findings and likely causes are deterministic interpretations and must not be represented as observed evidence.

Automatic collection occurs once when a supported incident opens. On diagnostics startup, existing open supported incidents without a report receive one safe backfill attempt. Normal monitoring polls do not repeatedly re-inspect an incident once its report exists.

## `GET /api/incidents/:incidentId/logs`

Performs the explicit read-only log inspection requested by the user. This endpoint is **not** called automatically when an incident opens.

The controller requests a fixed 100-line tail from the VM100 observer. The observer caps requested tail at 200 and returns at most 64 KiB of sanitized log text, with `truncated:true` when clipping occurred.

Representative response:

```json
{
  "incidentId":"INCIDENT_ID",
  "serviceName":"nginx-proxy-manager",
  "host":"VM 100",
  "tail":100,
  "logs":"sanitized ephemeral text",
  "truncated":false,
  "observedAt":"2026-08-20T01:00:00.000Z"
}
```

Raw log text is response-only. It is never written to `/data/monitoring-state.json`, monitoring history, or another FRIDAY durable store. FRIDAY may persist only metadata such as the incident, timestamp, tail count, success/failure, and truncation state.

Unknown incidents return 404. Disabled/unsupported diagnostics return a non-success response without contacting the observer. Provider failure returns a sanitized diagnostic error and does not change incident status.

No POST/PUT/PATCH/DELETE diagnostics or logs action route exists.

## `POST /api/commands/preview`

Deterministic safety classifier. It never executes infrastructure work.

```json
{"command":"check system health"}
```

Response includes `accepted`, `mode:"preview"`, `command`, `destructive:false`, and a message or rejection reason.

## `POST /api/assistant`

Optional advisory AI analysis. Disabled unless `FRIDAY_AI_ENABLED=true` and a server-side API key is configured. The assistant receives normalized monitoring-aware state and no infrastructure execution tools.

## VM100 observer contract

The controller's diagnostic APIs depend on the separately deployed observer at `192.168.1.124:3199`:

```text
GET /health
GET /api/v1/containers
GET /api/v1/containers/:id/inspect
GET /api/v1/containers/:id/logs?tail=100
```

The observer accepts only a known hexadecimal container ID obtained from its sanitized inventory. It is not a generic Docker API proxy.

## Future action APIs

Do not add execution to the endpoints above. Action proposals, approvals, and execution must use separate policy-gated endpoints and durable action-audit IDs only after authentication/RBAC and the approval workflow exist.
