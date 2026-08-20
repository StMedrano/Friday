# Friday API Contract

Base URL is same-origin with the UI. The browser should call relative `/api/...` paths.

## `GET /healthz`
Container health probe.

Response:
```json
{"status":"ok","service":"friday","mode":"mock"}
```

## `GET /api/health`
Runtime health and feature flags.

Response fields:
- `status`: `ok`
- `mode`: `mock` or `live`
- `ai`: boolean
- `time`: ISO timestamp

## `GET /api/overview`
Returns normalized Friday state. Consumers should tolerate integrations being absent/degraded and monitoring being disabled.

Primary fields include:
- `mode`
- `sites`
- `services`
- `resources`
- `alerts`
- `activities`
- `integrations`
- optional `incidents`
- optional `monitoring`

When monitoring is enabled and has completed a poll, the controller serves the cached normalized live overview decorated with current incidents and monitoring summary. Incident-derived alerts are appended without changing provider-specific adapter data.

Provider-specific payloads must be normalized before this boundary.

## `GET /api/incidents`
Returns FRIDAY-owned monitoring incidents. The route is read-only.

Shape:
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

Open incidents are returned before recently resolved incidents. There is no POST/PUT/PATCH/DELETE incident endpoint in this milestone.

## `GET /api/monitoring/history`
Returns recent FRIDAY-owned monitoring events newest-first.

Event types include:
- `service-status-changed`
- `incident-opened`
- `incident-resolved`
- `integration-degraded`
- `integration-recovered`
- `monitoring-poll-failed`

The history is bounded by `FRIDAY_MONITORING_HISTORY_LIMIT`. It must not contain provider credentials or raw authorization headers. There is no monitoring mutation endpoint.

## `POST /api/commands/preview`
Deterministic safety classifier. It never executes infrastructure work.

Request:
```json
{"command":"check system health"}
```

Response includes:
- `accepted`
- `mode`: always `preview`
- `command`
- `destructive`: always `false` in the current MVP
- `message` or rejection reason

## `POST /api/assistant`
Optional advisory AI analysis. Disabled unless `FRIDAY_AI_ENABLED=true` and a server-side API key is configured.

The assistant receives the same monitoring-aware overview used by the UI when monitoring is enabled. It receives no infrastructure execution tools.

Request:
```json
{"prompt":"What needs my attention across both sites?"}
```

Success response:
```json
{
  "available": true,
  "provider": "openai",
  "model": "gpt-5.6-terra",
  "text": "..."
}
```

Disabled response uses HTTP 503 with `available:false`. Provider failures use HTTP 502.

## Future action APIs
Do not add action execution to the endpoints above. Action proposals, approvals, and execution must use separate endpoints and durable action-audit IDs after authentication/RBAC exists.
