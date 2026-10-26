# Friday Integrations

Friday integrations are server-side and read-only unless a future action adapter is explicitly introduced after authentication, role policy, approval, global kill-switch, and durable action-audit controls exist.

## VM100 Docker observer

- Inventory adapter: `server/adapters/vm100-observer.mjs`
- Diagnostics adapter: `server/adapters/vm100-observer-diagnostics.mjs`
- Observer service: `observer/`
- Transport: bearer-authenticated HTTP from VM102 to VM100 nic1 on `10.1.10.10:3199` (VLAN 10).
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

The values below use CT108's verified nic1 endpoint on vmbr1/VLAN 10. The running-container interface reports `10.1.10.12/24`, and authoritative VM102 passes TCP/11434, `/api/tags`, and `/api/chat` over that path.

```env
FRIDAY_AGENT_LOCAL_ROUTER_URL=http://10.1.10.12:11434
FRIDAY_AGENT_LOCAL_ROUTER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_GENERAL_URL=http://10.1.10.12:11434
FRIDAY_AGENT_LOCAL_GENERAL_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_CODER_URL=http://10.1.10.12:11434
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
- Preferred configuration: `FRIDAY_ENDPOINT_CHECKS_JSON`, a server-only JSON array of at most 16 checks with stable `id`, `name`, `site`, `url`, and `expectedStatuses` fields.
- Friday performs bounded GET requests without credentials, response-body reads, or redirect following. The URL cannot contain credentials, a query string, or a fragment.
- Each check becomes a stable monitoring service. Unexpected HTTP responses are degraded; timeouts and network failures are offline and enter the existing incident grace-period flow.
- `FRIDAY_ENDPOINT_URLS` remains available for legacy comma-separated Site A checks. Do not configure both formats.

## Omada site and device inventory

- Adapter: `server/adapters/omada.mjs`, disabled by default with `FRIDAY_OMADA_ENABLED=false`.
- Protocol: Omada **Open API v1**, using a dedicated Client Credentials application with the controller's read-only/viewer role and access only to the intended sites. Do not use a controller administrator account or the private web-session API. Controllers without read-only Open API access are not supported by this adapter.
- Server settings: `FRIDAY_OMADA_URL` (the HTTPS Interface Access Address, origin only), `FRIDAY_OMADA_CONTROLLER_ID` (Omada ID), `FRIDAY_OMADA_CLIENT_ID`, and `FRIDAY_OMADA_CLIENT_SECRET`. Copy these from Global View → Settings → Platform Integration → Open API. All four default to empty and are passed only to the controller container.
- TLS verification remains enabled. The controller certificate must be trusted by Node; configure trust before activation. Credentials in URLs, HTTP origins, path prefixes, queries, fragments, and redirects are rejected.
- The only POST is OAuth authentication at `/openapi/authorize/token?grant_type=client_credentials`. The token is cached in server memory until expiry and discarded on failure or changed configuration. No refresh token is persisted. Inventory uses only `GET /openapi/v1/{omadacId}/sites` and `GET /openapi/v1/{omadacId}/sites/{siteId}/devices` with numeric pagination parameters.
- A poll has a 10-second total deadline, 512 KiB per-response limit, and 50-request ceiling. Inventory is limited to 16 sites, 200 devices per site, and 1,000 devices in total. Malformed, duplicate, incomplete, changing, or oversized inventory produces a sanitized integration-degraded alert; Friday never publishes a partial inventory as complete.
- Site summaries and devices become `network` services in the existing overview, dashboard service lists, assistant context, and monitoring pipeline. IDs use `omada-site-{siteId}` and `omada-device-{siteId}-{normalizedMac}`. Only names, models, status, site labels, controller hostname, and observation time are published; raw responses and credentials are excluded.
- Numeric Open API device status `1` maps to online and `0` to offline. Other/missing values are degraded with an explicit unknown-status detail; legacy web API status codes are not interpreted. An empty site is degraded (`No devices observed`). Site summaries describe device connectivity only; they do not assert WAN, VPN, DNS, routing, or gateway health. The top-level site topology remains unchanged because those fields are not observed by these endpoints.

Protocol references: [TP-Link Open API authorization and pagination](https://use1-omada-northbound.tplinkcloud.com/doc.html) and [controller application setup](https://support.omadanetworks.com/en/document/109315/). Consult the target controller's Online API Document when performing acceptance; firmware compatibility and actual device status mappings have **not** been validated against the user's controller.

Live acceptance requires a reachable HTTPS controller, trusted certificate, its Open API version, a dedicated read-only application, and explicit selection of the intended sites in that application's privileges. Compare site names, MAC identities, device counts, and connected/disconnected states against Omada, then verify failures degrade Friday without affecting its other integrations. This cloud implementation does not activate the adapter, create the Omada application, deploy Friday, or change any network configuration.

## AdGuard Home status and DNS statistics

- Adapter: `server/adapters/adguard.mjs`, disabled by default with `FRIDAY_ADGUARD_ENABLED=false`. This slice supports one explicitly configured instance; secondary DNS instances remain future work.
- Server settings: `FRIDAY_ADGUARD_URL` (HTTPS origin, no path), `FRIDAY_ADGUARD_USERNAME`, `FRIDAY_ADGUARD_PASSWORD`, and `FRIDAY_ADGUARD_SITE` (required public site label, up to 80 characters). All default to empty. Base Compose passes them only to the Friday controller; no browser credential or new API route is introduced.
- Only `GET /control/status` and `GET /control/stats` are requested, sequentially with a single five-second deadline and a 512 KiB cap per response. HTTP origins, URL credentials, path prefixes, query strings, fragments, and redirects are rejected. TLS verification stays enabled; the origin's certificate must be trusted by Node.
- AdGuard uses HTTP Basic authentication. A native account is **not inherently read-only**: prefer a dedicated HTTPS proxy identity that allows only these two GET paths and denies other paths/methods, with any upstream account credential retained at the proxy. Friday does not configure that proxy or create accounts. Never describe a full-access AdGuard account as a read-only token.
- The normalized `adguard` service belongs to category `dns`, uses the configured site label, and displays observed running/protection state, total query count, filtering-rule blocked count, and average processing time converted from seconds to milliseconds. Counts refer to AdGuard's configured statistics window; Friday does not assume a 24-hour window or that filtering-rule blocks include other protection categories.
- A stopped DNS process maps to offline; a running process with protection disabled maps to degraded. Only a running process with protection enabled maps to online. This is reported application state, not proof of end-to-end DNS resolution. Existing monitoring grace periods and recovery behavior apply.
- Missing/malformed status or aggregate fields, authentication failures, timeouts, and either endpoint failing produce a sanitized integration-degraded alert while other integrations remain available. Incomplete statistics are never filled with fabricated zero values.
- The upstream statistics response can contain domain/client breakdowns. Friday discards those fields during normalization; they are not sent to the browser, assistant, or monitoring store. It never requests query logs, clients, protection toggles, statistics reset, configuration updates, or any mutation route.

Protocol source: [AdGuard Home OpenAPI specification](https://github.com/AdguardTeam/AdGuardHome/blob/master/openapi/openapi.yaml), API version `0.107`, inspected 2026-10-25. Live acceptance still requires a reachable HTTPS endpoint with a trusted certificate, suitable credentials/access restrictions, the intended site label, and comparison of returned process state and aggregate counters against the target instance. No live connection, DNS change, proxy configuration, or deployment was performed in this cloud workspace.

## Prometheus target scrape health

- Adapter: `server/adapters/prometheus.mjs`, disabled by default with `FRIDAY_PROMETHEUS_ENABLED=false`. It consumes the existing Prometheus inventory rather than issuing duplicate probes.
- Server settings: `FRIDAY_PROMETHEUS_URL` (trusted HTTPS origin, no path), `FRIDAY_PROMETHEUS_USERNAME`, `FRIDAY_PROMETHEUS_PASSWORD`, and `FRIDAY_PROMETHEUS_SITE` (required fallback site label, up to 80 characters). All default to empty. A target's nonempty `site` label overrides the configured fallback.
- The only request is `GET /api/v1/targets?state=active`, using server-side Basic authentication. Prefer a dedicated proxy identity restricted to that GET path; native Prometheus Basic authentication does not itself enforce a per-route read-only role. Friday does not configure the proxy, Prometheus, scrape jobs, or credentials.
- HTTPS certificate verification remains enabled. URL credentials, path prefixes, query strings, fragments, and redirects are rejected in the configured origin. The adapter has a five-second total deadline, 512 KiB response cap, and 200-target limit. Oversized, malformed, or duplicate inventory fails as a sanitized integration-degraded alert without publishing partial state or interrupting other adapters.
- Each active target becomes a `monitoring` service named `Prometheus · {job}`. A SHA-256 ID over the scrape pool and sorted final labels remains stable across target ordering, label ordering, scrape timestamps, and health transitions; relabeling or pool changes create a new identity. Identical pool/label identities are rejected rather than collapsed. Dropped targets are excluded.
- Health `up` maps to online, `down` to offline, and other reported health values to degraded. The service detail explicitly describes **scrape health**, not application health. `updated` contains the last scrape timestamp; an unknown target with Prometheus's zero timestamp shows `Not yet scraped`. Friday does not run a DNS/HTTP availability probe or impose a new scrape schedule/staleness threshold.
- Displayed fields are job name, instance host/port, site, scrape health, and last scrape time. Instance URLs are reduced to host/port so userinfo, paths, queries, and fragments cannot leak into the public view. Known authentication values are redacted from displayed labels. Raw discovery/final label maps, target URLs, and upstream error messages are not exposed to the browser, assistant, or monitoring store. Full final labels are used only in memory to compute identity.
- Existing monitoring grace periods and recovery apply to target scrape failures. No query evaluator, remote write, admin API, reload, configuration write, or target URL follow is introduced. An empty active inventory stays empty rather than reporting synthetic healthy targets.

Protocol reference: [Prometheus HTTP API — Targets](https://prometheus.io/docs/prometheus/latest/querying/api/#targets), inspected 2026-10-25. Live acceptance requires the intended Prometheus HTTPS origin/trusted certificate, appropriate Basic-auth access restrictions, correct fallback/site labels, and comparison of counts, job/instance identities, scrape health, and timestamps against Prometheus. The adapter is implemented locally but has not been activated or validated against the user's monitoring server. Uptime Kuma is documented below; Grafana integration remains future work.

## Uptime Kuma monitor health

- Adapter: `server/adapters/uptime-kuma.mjs`, disabled by default with `FRIDAY_UPTIME_KUMA_ENABLED=false`. It consumes existing monitor results through the fixed `GET /metrics` route and does not run additional probes.
- Server settings: `FRIDAY_UPTIME_KUMA_URL` (trusted HTTPS origin, no path), `FRIDAY_UPTIME_KUMA_API_KEY` (a dedicated metrics API key), and `FRIDAY_UPTIME_KUMA_SITE` (required public site label, up to 80 characters). All default to empty and are passed only to the Friday controller. This slice supports one configured Kuma instance and one explicit site label for its exported monitors.
- Kuma metrics API keys authenticate with HTTP Basic using an empty username and the key as password. Friday never uses a Kuma administrator login, browser session, or Socket.IO connection. The key cannot authenticate to Kuma's web interface. Creating Kuma's **first** metrics key disables the endpoint's previous username/password authentication; account for existing metrics consumers when configuring that key. Friday does not create keys or change Kuma settings.
- The endpoint must return Prometheus text format (`text/plain`) and `monitor_status` samples with `monitor_id`, `monitor_name`, and `monitor_type` labels. Releases/exporters without `monitor_id` are intentionally rejected rather than assigned unstable identities. Confirm the target installation's output before activation; an explicitly declared empty `monitor_status` gauge remains empty.
- Each service has ID `uptime-kuma-{monitor_id}` and category `monitoring`. Names identify the original monitor, and `host` identifies the Kuma collector, not an inferred monitored host. State codes map as follows: 0 offline, 1 online, 2 degraded/pending, 3 maintenance; other nonnegative integer codes are degraded/unknown. Existing incident grace periods and recovery apply; maintenance does not create an outage incident by itself.
- Only monitor ID/name/type and status enter normalized state. URLs, target hostnames/ports, tags, other metric families, and raw response text are discarded. Monitored URLs are never followed. Known API-key values are redacted from displayed fields. `updated` is the collection time; the metrics gauge reports Kuma's last known result and does not establish the age of the underlying heartbeat or a fresh connectivity test.
- Requests have a five-second total deadline, 512 KiB response cap, and 200-monitor limit. Labels are bounded and Prometheus quote/backslash/newline escapes are parsed explicitly. Duplicate IDs/labels, malformed status rows, missing required fields, invalid UTF-8, incorrect response types, and exceeded bounds fail as a sanitized integration-degraded alert; partial inventories are not returned. Other integrations remain available.
- HTTPS verification stays enabled. Configured URL credentials, paths, queries, fragments, and redirects are rejected. No monitor creation/editing, pause/resume, notification, maintenance configuration, or other mutation operation is introduced.

Protocol references: [Kuma metrics integration](https://github.com/louislam/uptime-kuma/wiki/Prometheus-Integration), [metrics API keys](https://github.com/louislam/uptime-kuma/wiki/Prometheus-API-Keys), and [exported metric labels/status codes](https://github.com/louislam/uptime-kuma/blob/master/server/prometheus.js), inspected 2026-10-25. Live acceptance needs the intended HTTPS endpoint/trusted certificate, enabled metrics API, dedicated key, explicit site, and comparison of exported IDs/names/status against Kuma. This implementation has not connected to the user's instance or changed any live monitor settings.

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
