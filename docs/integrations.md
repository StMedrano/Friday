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

### Uptime history

- `FRIDAY_MONITORING_UPTIME_ENABLED=false` by default. When on (and monitoring is on), every successful monitoring poll adds one sample per service to hourly buckets kept for seven days in the existing monitoring state file (`server/monitoring/uptime.mjs`). At most 300 services are tracked; services with no samples left in the window are dropped, and retired services are removed.
- Online and degraded count as up, offline as down, and maintenance (intentionally stopped guests) is left out. Nothing is backfilled: the record starts when the flag is turned on.
- `GET /api/monitoring/uptime` returns 24 hour and 7 day uptime, check counts and the last 24 hourly buckets per service. It answers 503 `monitoring-disabled`, `uptime-disabled` or `uptime-unavailable` instead of an empty success, and rejects queries. The Applications page shows the 24 hour figure, hourly bars and a detail panel from it.

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

### Agent activity log

- `FRIDAY_AGENT_ACTIVITY_ENABLED=false` by default. When on, every `POST /api/agents/:id/ask` adds one entry to `FRIDAY_AGENT_ACTIVITY_PATH` (default `/data/agent-activity.json`, mode 0600, newest `FRIDAY_AGENT_ACTIVITY_LIMIT` entries, 50 to 2000, default 500): time, agent ID and name, outcome (`answered`, `unavailable`, `not-found`, `failed`), provider, model and profile when answered, `grounding-invalid` when the answer failed grounding, and duration.
- Prompts, answers, error text and the asking identity are never stored. A failed write never fails the answer.
- `GET /api/agents/activity` returns the entries newest first; queries and other methods are refused, and it answers 503 `agent-activity-disabled` when off. The Agents page shows them under Live agent events.

### Approvals queue

- `FRIDAY_APPROVALS_ENABLED=false` by default. When on, each open monitoring incident that carries a recommended action is a pending proposal. An operator approves or denies it on the Approvals page or in the Agents action center.
- Decisions go to `FRIDAY_APPROVALS_PATH` (default `/data/approvals.json`, mode 0600, newest `FRIDAY_APPROVALS_LIMIT` decisions, 50 to 2000, default 500) with the incident's title, service, severity and recommended action, the time, and the operator's email. Each decision is also written to the action audit as `approvals.decide` when the audit is on.
- A decision is a record only. Nothing is executed: every response carries `execution.performed: false`. Automated fixes are a separate, approval-gated change.
- `GET /api/approvals` returns `pending` (oldest first) and the 20 most recent decisions. `POST /api/approvals/:incidentId/decision` with `{"decision":"approve"|"deny"}` is operator-only, JSON-only and refused cross-site. Errors: 503 `approvals-disabled` or `monitoring-disabled`, 400 `invalid-approval-decision`, 404 `approval-not-found` (the incident is no longer open), 409 `approval-already-decided`. Decisions on one proposal are serialized, so only the first wins.

### Project tasks (read)

- `FRIDAY_WORK_READ_ENABLED=false` by default. When on, the Tasks screen lists tasks for the projects a signed-in person is granted. It reads through `FRIDAY_SUPABASE_URL` with `FRIDAY_WORK_READ_KEY`, a SELECT-only database credential (never the service key); `FRIDAY_WORK_READ_GATEWAY_KEY` is the gateway key the Supabase gateway expects.
- Who sees what comes from the grant file at `FRIDAY_WORK_GRANTS_PATH` (default `/data/work-grants.json`, mode 0600). Grants are re-read and expiry-checked on every request, so removing a person or project takes effect without a restart.
- Settings shows it as configured when the Supabase URL and read key are present; a missing or expired grant file still shows no tasks. Background: `docs/shared-work-phase2b.md`.

### New tasks (Tasks write path)

- `FRIDAY_WORK_WRITE_ENABLED=false` by default, and it only works when project task reads are on (`FRIDAY_WORK_READ_ENABLED=true` with a valid grant file). When both are on, the Tasks screen shows a "New task" form with a title and optional details.
- Who can add: a signed-in person whose email is in `FRIDAY_ACCESS_OPERATOR_EMAILS` **and** whose grant file entry lists the project. Everyone else gets 403 `work-write-denied`. The browser never sends a role or principal; the server derives `access:<sha256 of the Access subject>` itself.
- What it writes: one row in `friday_work_items` with status `ready`, version 1, no claim and no acceptance criteria. If details are left blank the title is used as the objective. Nothing claims, moves, edits or runs a task.
- Database role: apply `supabase/migrations/202611060001_friday_work_writer.sql` on VM132 (safe to re-run). It creates the NOLOGIN role `friday_work_writer` that may only insert those columns and read tasks back; RLS only accepts new `ready` rows from an `access:` principal. Mint a PostgREST JWT with `"role":"friday_work_writer"` and put it in `FRIDAY_WORK_WRITE_KEY`. Never use the service key. The gateway key (`FRIDAY_WORK_READ_GATEWAY_KEY`) is reused.
- `POST /api/work/tasks` with `{"projectId","title","objective"?,"requestId"}` is operator-only, JSON-only, refused cross-site, and written to the action audit as `work.tasks.create` with the project as target. `requestId` makes retries safe: the same person and id return the first task; reusing the id with different content is 409 `work-task-request-reused`. Other errors: 400 `invalid-work-task`, 404 when the path is off, 503 `work-write-unavailable`. `GET /api/work/tasks` adds `"canCreate": true` only when the path is on.

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

Protocol reference: [Prometheus HTTP API — Targets](https://prometheus.io/docs/prometheus/latest/querying/api/#targets), inspected 2026-10-25. Live acceptance requires the intended Prometheus HTTPS origin/trusted certificate, appropriate Basic-auth access restrictions, correct fallback/site labels, and comparison of counts, job/instance identities, scrape health, and timestamps against Prometheus. The adapter is implemented locally but has not been activated or validated against the user's monitoring server. Uptime Kuma and Grafana are documented below.

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

## Grafana health and alert rule state

- Adapter: `server/adapters/grafana.mjs`, disabled by default with `FRIDAY_GRAFANA_ENABLED=false`. It reads Grafana's own health and the state of existing **Grafana-managed** alert rules; it does not evaluate queries or run probes.
- Server settings: `FRIDAY_GRAFANA_URL` (trusted HTTPS origin, no path), `FRIDAY_GRAFANA_TOKEN` (a dedicated service account token), and `FRIDAY_GRAFANA_SITE` (required public site label, up to 80 characters). All default to empty and are passed only to the Friday controller.
- Create a dedicated service account with the **Viewer** role and a token for it. Viewer can read alert rules but cannot edit dashboards, rules, silences, data sources or users. Friday does not create the account or change Grafana.
- Only two sequential requests are made, sharing one five-second deadline and a 512 KiB cap per response: `GET /api/health` and `GET /api/prometheus/grafana/api/v1/rules`, with `Authorization: Bearer`. Redirects are rejected and TLS verification stays enabled. Configured URL credentials, paths, queries and fragments are rejected.
- Normalized output: one `grafana` service (database `ok` maps to online, anything else to degraded; detail shows version and how many alert rules are firing), plus one `monitoring` service per alerting rule, named `Grafana alert · {rule}`, with host `{folder} / {group}`. Recording rules are skipped. IDs are SHA-256 over folder, group and rule name, so they survive ordering and state changes.
- Rule mapping: `firing` maps to degraded, so a rule firing beyond the monitoring grace period opens a warning incident that resolves under the same identity. `inactive`, `normal`, `pending` and `recovering` map to online. Rule health `error` or `nodata` and unknown states map to degraded. The detail always says this is alert rule state, not service health.
- Only folder, group, rule name, state, rule health, the `severity` label and evaluation time are kept. Queries, annotations, other labels, alert instances and raw errors are discarded and never reach the browser, assistant or monitoring store. Known token values are redacted from displayed text.
- Malformed, duplicate or oversized responses (more than 200 alerting rules), authentication failures and timeouts fail as a sanitized integration-degraded alert without partial state; other integrations remain available.
- Data-source alert rules (Prometheus/Loki-managed) and dashboards are out of scope for this slice.

Protocol references: [Grafana health API](https://grafana.com/docs/grafana/latest/developers/http_api/other/#health-api) and the Prometheus-compatible Grafana-managed rules endpoint used by Grafana's alerting UI. Live acceptance needs the intended HTTPS endpoint with a trusted certificate, a Viewer service account token, the site label, and a comparison of rule names and states against Grafana's alert list. No live connection or Grafana change was made from the cloud workspace.

## GitHub pull requests, CI and last commit

- Adapter: `server/adapters/github.mjs`, disabled by default with `FRIDAY_GITHUB_ENABLED=false`. It fills the Open PRs, CI status and Last commit columns and the pull request panel on the Repositories page for registered repositories whose `remote` is on `github.com`.
- Server settings: `FRIDAY_GITHUB_TOKEN` (optional for public repositories), `FRIDAY_GITHUB_API_URL` (HTTPS, default `https://api.github.com`), `FRIDAY_GITHUB_CACHE_SECONDS` (30 to 3600, default 120). They are passed only to the Friday controller and listed explicitly in `compose.yaml`.
- GitHub-only repositories: in Settings, Repositories, an operator can add a repository with just its GitHub URL (`https://github.com/owner/name` or `git@github.com:owner/name.git`) and no checkout path. It lists on the Repositories page with its pull requests, CI and last commit; file browsing and working tree status need a checkout path under `FRIDAY_REPOSITORY_ROOTS`. Without a path, a non-GitHub remote is rejected (`invalid-repository-github-remote`).
- Token: a fine-grained personal access token limited to the registered repositories with read-only **Metadata**, **Contents**, **Pull requests** and **Commit statuses**. Friday never needs write access. If the token cannot read check runs, CI falls back to commit statuses only.
- Route: `GET /api/repositories/:id/github`, behind the same Access gate as other repository reads. Queries are rejected. Errors are stable codes: `github-disabled` (503), `github-remote-unsupported` (404, the remote is not on GitHub or the branch name is unsafe), `github-unavailable` (502). The token and raw GitHub errors never reach the browser.
- Requests per repository, all `GET` with redirects refused, an 8 second timeout and a 4 MiB response cap: open pulls (one page of 100), the default branch head commit, its check runs and its combined status. Results are cached per repository and branch for the configured time so the page does not spend the rate limit.
- Normalized output: open PR count (`more` when a full page came back), the five most recently updated PRs (number, title, author, draft, updated time, a `github.com` link only), CI state (`success`, `failure`, `pending`, `none` with counts) and the last commit (short SHA, first line of the message, author, date, link). PR bodies and other fields are dropped.

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

## AIDesigner design generation

Friday can call the [AIDesigner REST API](https://www.aidesigner.ai/docs/api) to generate UI designs into AIDesigner editor projects. It is off by default.

- Enable with `FRIDAY_AIDESIGNER_ENABLED=true` and `AIDESIGNER_API_KEY` (created in AIDesigner under Settings, API Keys). `AIDESIGNER_BASE_URL` must be an `https` origin; `FRIDAY_AIDESIGNER_TIMEOUT_MS` (default 180000) bounds one generation.
- Needs live mode with Cloudflare Access. Service tokens are refused.
- `GET /api/aidesigner/sessions`: any signed-in person; returns up to 20 recent sessions (id, title, editor link, canvas count, published link, updated time).
- `POST /api/aidesigner/designs` with JSON `{ "prompt", "viewport"?: "desktop" | "mobile", "sessionId"?, "idempotencyKey"? }`: operator-only, audited as `aidesigner.design.generate`. It spends AIDesigner credits (1 per classic design). The design is written to a new session, or to `sessionId`, and Friday returns only the session, canvas and editor link, never the HTML. Unknown fields are refused, and the premium `ultradesign` mode is not exposed.
- Provider errors are mapped without detail: 402 out of credits, 429 rate limited (with `Retry-After`), 404 unknown session, 409 canvas busy, 502 key rejected, 503 unavailable.
- AIDesigner's own limits apply per account: 30 generations per minute and 4 at once.

This is separate from the AIDesigner MCP server (`https://api.aidesigner.ai/api/v1/mcp`), which uses OAuth and is connected in the AI assistant, not in Friday.

## Opt-in features in Settings

Settings, General lists each opt-in feature (GitHub, uptime history, agent activity, approvals, project tasks, new tasks, free model routing, Web Growth) as on or off, and whether the settings it needs next to its flag are present (for example, uptime history and the approvals queue both need `FRIDAY_MONITORING_ENABLED=true`). It never shows the values. `GET /api/settings` returns them as `features: [{id, name, enabled, configured, setup}]`, where `setup` is the heading in this document that explains the feature.

## Service token expiry

Cloudflare Access service tokens expire, and Friday cannot see their expiry by
itself. Set `FRIDAY_SERVICE_TOKEN_EXPIRES_AT` to the token's expiry date
(`YYYY-MM-DD`; the `friday-cloud-reader` token expires `2026-11-24`) and
Settings, Access & roles shows "Expires in N days". With 14 days or fewer left
it shows a warning, and once the date has passed it shows the token as expired.

- It is a date only, never the token, and `GET /api/settings` returns only
  `serviceToken: { expiresAt, daysRemaining, state }` (`ok`, `warning` or
  `expired`), or `null`.
- Unset or not a valid date: nothing is shown and startup is unaffected.
- Days are whole calendar days in UTC; on the expiry date itself it reads
  "Expires today".
- After renewing the token, update the date and redeploy.

## Free model routing

- `FRIDAY_MODEL_FABRIC_ENABLED=false` by default. When on (with `FRIDAY_AI_ENABLED=true`), chat asks free models first and falls back to the normal provider order. It only has something to ask once at least one free target is configured: hosted NVIDIA (`FRIDAY_NVIDIA_ENABLED`, `NVIDIA_API_KEY`, `FRIDAY_NVIDIA_MODELS_JSON`) or local NIM (`FRIDAY_NVIDIA_LOCAL_ENABLED`, `FRIDAY_NVIDIA_LOCAL_MODELS_JSON`).
- Settings shows it as configured when `FRIDAY_AI_ENABLED=true` and at least one target the router would try exists: enabled, free-class, and for hosted targets with `NVIDIA_API_KEY` set. Policy, model list format and verification: `docs/model-fabric.md`.

## Web Growth leads

- `FRIDAY_WEB_GROWTH_ENABLED=false` by default. When on, the TechTactics group shows the Web Growth lead pipeline read from the isolated reader in `integrations/web-growth-reader/`, never from the Web Growth application itself.
- Needs `FRIDAY_WEB_GROWTH_READER_URL`, `FRIDAY_WEB_GROWTH_READER_TOKEN` (the reader's bearer token) and `FRIDAY_WEB_GROWTH_READER_EMAILS` (comma-separated people allowed to see it). Settings shows it as configured when all three are present. Deploying the reader is a separate, owner-approved step; see its README.

## Checking .env before a deploy

`compose.yaml` passes every variable to the container explicitly, so a setting
added to `.env` but not to `compose.yaml`, or a flag turned on without the
settings it needs, fails silently. Before a deploy, run on the controller:

```bash
make env-check                       # checks ./.env against compose.yaml
make env-check ENV_FILE=/path/.env COMPOSE_FILES="compose.yaml compose.cloud-tunnel.yaml"
```

It is offline (no network, no Docker) and prints names and line numbers only,
never values:

- variables in `.env` that none of the given Compose files pass through
  (they never reach Friday; harmless if another overlay uses them),
- `*_ENABLED=true` flags whose companion settings are empty, using the same
  rules as Settings (for example `FRIDAY_WORK_WRITE_ENABLED` needs
  `FRIDAY_WORK_READ_ENABLED`, `FRIDAY_SUPABASE_URL`, `FRIDAY_WORK_READ_KEY`
  and `FRIDAY_WORK_WRITE_KEY`); a companion set in `.env` but not passed
  through counts as empty,
- malformed lines and names set more than once.

Values are read the way Compose reads them: double-quoted escapes are decoded
and `${NAME}` / `${NAME:-default}` resolve from earlier `.env` lines (a name
not set earlier counts as empty, because shell variables are not visible
offline). It exits 1 only when a flag is missing a companion, and 2 when a file
cannot be read.

## Adapter checklist

Every integration must have explicit opt-in configuration, least-privilege credentials, timeouts, degraded-state handling, normalized/sanitized responses, automated tests without real credentials, server-side secrets, and a working credential-free mock/degraded mode where applicable.
