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

The diagnostic container ID must come from sanitized inventory. The observer re-validates it against current local inventory before making one fixed Docker GET request. It never forwards arbitrary Docker paths or query strings.

Inspect output is allowlisted. Environment variables, raw labels, bind paths, command arguments, health-check output text, and raw Docker inspect JSON are excluded. Logs are explicit-request only, sanitized, bounded, and ephemeral at the controller/UI boundary.

## Monitoring & Incidents

- Runtime: `server/monitoring/runtime.mjs`
- Rules: `server/monitoring/incidents.mjs`
- Durable store: `server/monitoring/store.mjs`
- State: FRIDAY-owned `/data/monitoring-state.json` in the `friday_data` volume.
- Inputs: normalized read-only overview from configured adapters.
- Outputs: current incidents, bounded health history, monitoring summary, incident-derived alerts.
- APIs: `GET /api/incidents` and `GET /api/monitoring/history`.
- Monitoring grants no provider write permissions.
- Recommended remediation is advisory; infrastructure execution remains unavailable.

## Incident Diagnostics

Diagnostics are environment-gated:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

When enabled after the VM100 observer routes are validated:

- supported VM100 `service-offline`, `service-degraded`, and `service-flapping` incidents receive one automatic metadata-only diagnostic snapshot;
- already-open supported incidents without a report receive one startup backfill attempt;
- deterministic analysis separates observed facts from findings, likely causes, and recommendations;
- raw logs are never fetched automatically;
- `GET /api/incidents/:incidentId/logs` performs an explicit read-only request only;
- raw log text is never persisted in FRIDAY monitoring state or history;
- failures degrade diagnostics without closing incidents or crashing monitoring.

Controller routes:

```text
GET /api/incidents/:incidentId/diagnostics
GET /api/incidents/:incidentId/logs
```

There are no diagnostic POST/PUT/PATCH/DELETE routes and no restart/repair/exec authority.

## Local Docker Engine on VM102

- Adapter: `server/adapters/docker.mjs`
- Transport: local Unix socket.
- Disabled in normal production operation.
- Host label defaults to `VM 102` through `FRIDAY_DOCKER_HOST_NAME`.
- Use the explicit live override only when local controller Docker inventory is intentionally required.

Normal Proxmox + VM100 observer + monitoring + diagnostics operation keeps `FRIDAY_DOCKER_ENABLED=false` and uses base `compose.yaml`.

## Proxmox VE

- Adapter: `server/adapters/proxmox.mjs`
- Authentication: dedicated API token.
- Use the smallest read-only role that can list nodes, VMs/CTs, and status.
- Never reuse the root password or a broad administrator token.
- `FRIDAY_PROXMOX_INSECURE=true` is a bootstrap exception for a trusted self-signed certificate.

## HTTP endpoint checks

- Adapter: `server/adapters/endpoints.mjs`
- Purpose: read-only availability checks of approved HTTP/HTTPS services.
- Do not place credentials in `FRIDAY_ENDPOINT_URLS` query strings.

## Advisory AI providers

Friday's preferred sequential assistant chain is:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

Provider adapters:

- Groq: `server/ai/groq.mjs`
- Gemini: `server/ai/gemini.mjs`
- Ollama: `server/ai/ollama.mjs`
- OpenAI compatibility: `server/ai/openai.mjs`
- Anthropic compatibility: `server/ai/anthropic.mjs`

OpenAI and Anthropic adapters remain available for explicit compatibility but are not in the default provider order.

Provider credentials stay on the FRIDAY server/container only. Never place Groq, Gemini, OpenAI, Anthropic, observer, or infrastructure credentials in `VITE_*` variables.

Production local AI uses CT108 (`192.168.1.70:11434`) with `qwen3:4b-instruct`. CT108 should accept TCP/11434 only from VM102. The optional Compose Ollama service remains a private development/recovery path with no host/LAN-published port.

AI providers receive the shared read-only policy, operator request, and normalized Friday state. They receive no Docker, Proxmox, shell, network, deployment, or remediation tools. The policy requires exact infrastructure identifier preservation.

## Adapter checklist

Every provider must have explicit opt-in configuration, least-privilege credentials, timeouts, degraded-state handling, normalized responses, tests without real credentials, server-side secrets, and a working credential-free mock mode where applicable.
