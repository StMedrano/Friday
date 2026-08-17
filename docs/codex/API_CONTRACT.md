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
Returns normalized Friday state. Consumers should tolerate integrations being absent/degraded.

Primary fields currently include:
- `mode`
- `sites`
- `services`
- `resources`
- `alerts`
- `activities`
- `integrations`

Provider-specific payloads must be normalized before this boundary.

## `POST /api/commands/preview`
Deterministic safety classifier. It never executes infrastructure work.

Request:
```json
{"command":"check system health"}
```

Response includes:
- `accepted`
- `mode`: always `preview`
- `intent`
- `destructive`: always `false` in the current MVP
- `message` or rejection reason

## `POST /api/assistant`
Optional advisory AI analysis. Disabled unless `FRIDAY_AI_ENABLED=true` and a server-side API key is configured.

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
Do not add action execution to the endpoints above. Action proposals, approvals, and execution must use separate endpoints and durable audit IDs after authentication/RBAC exists.
