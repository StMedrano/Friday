# FRIDAY Monitoring & Incidents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable, read-only monitoring to FRIDAY that polls existing live adapters, tracks service health transitions, opens/resolves deterministic incidents, exposes GET-only incident/history APIs, and renders an operational incident workspace without executing infrastructure changes.

**Architecture:** Keep `buildOverview(config)` as the normalized read-only collection boundary. Add a focused monitoring domain under `server/monitoring/`: a pure incident engine, an atomic file-backed store, and a single non-overlapping polling runtime that caches the latest overview. The HTTP server reads monitoring state through that runtime, while the React V3 UI consumes normalized incident/monitoring fields and never receives infrastructure credentials.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, `node:fs/promises`, React 18, TypeScript 5.7, Vite 5, Vitest + Testing Library, Docker Compose, existing `/data` named volume.

**Spec:** `docs/superpowers/specs/2026-08-19-monitoring-incidents-design.md`

## Global Constraints

- Infrastructure access remains read-only; this milestone MUST NOT add restart, start, stop, exec, remove, image, volume, network, firewall, DNS, Proxmox mutation, or arbitrary shell execution paths.
- VM102 remains the authoritative FRIDAY controller.
- VM100 Docker inventory remains sourced through the existing token-authenticated observer; the observer contract is unchanged in this milestone.
- `FRIDAY_DOCKER_ENABLED=false` remains the normal VM102 production posture; do not use the local-Docker override for VM100 inventory.
- All monitoring endpoints added in this milestone are GET-only.
- Monitoring persistence is FRIDAY-owned state under `/data`, not provider state.
- Default monitoring settings are: poll interval `30` seconds, unhealthy grace period `300` seconds, history limit `2000`, state path `/data/monitoring-state.json`.
- Monitoring is opt-in at rollout with `FRIDAY_MONITORING_ENABLED=false` by default.
- No secret or credential may be written to monitoring history, incidents, browser code, `VITE_*`, committed `.env` files, or fixtures.
- UI v3 remains authoritative; reuse its operational panel/status patterns and communicate state with text/icon semantics, not color alone.
- Node target remains 22.
- Write a failing test before each behavior change.
- Keep mock mode functional with zero credentials.
- Run `make verify` before considering implementation complete.

---

## File Structure

### New backend files

- `server/monitoring/state.mjs` — state schema, defaults, history append/cap helpers, public summaries.
- `server/monitoring/incidents.mjs` — pure deterministic service/integration rule evaluation; no I/O or timers.
- `server/monitoring/store.mjs` — atomic JSON load/save and corrupt-file quarantine.
- `server/monitoring/runtime.mjs` — one background poller, latest-overview cache, persistence orchestration, GET-facing selectors.
- `server/monitoring/state.test.mjs`
- `server/monitoring/incidents.test.mjs`
- `server/monitoring/store.test.mjs`
- `server/monitoring/runtime.test.mjs`
- `server/http.mjs` — importable FRIDAY HTTP server factory so route behavior can be tested without binding the production entrypoint.
- `server/http.test.mjs`

### New frontend files

- `src/components/ActiveIncidents.tsx` — compact prioritized incident list for Overview.
- `src/components/ActiveIncidents.test.tsx`
- `src/components/IncidentsWorkspace.tsx` — active/resolved/history operational workspace.
- `src/components/IncidentsWorkspace.test.tsx`

### Existing files modified

- `server/config.mjs` — monitoring environment configuration.
- `server/overview.mjs` — helper for decorating a normalized overview with monitoring output; existing direct collection stays intact.
- `server/index.mjs` — production bootstrap only: create/start monitoring runtime, create HTTP server, listen.
- `.env.example` — monitoring defaults and corrected VM100 observer URL `http://192.168.1.124:3199`.
- `compose.yaml` — pass monitoring variables into the controller; keep existing `/data` volume and no Docker socket.
- `package.json` — expand Node test glob to include `server/monitoring/*.test.mjs` if shell glob behavior requires it explicitly.
- `src/lib/api.ts` — normalized Incident, MonitoringSummary, MonitoringEvent types and optional overview fields.
- `src/pages/Dashboard.tsx` — Overview incident section and real Incidents navigation content.
- `src/styles.css` — v3 incident/workspace styles.
- `.github/workflows/ci.yml` — monitoring tests/security boundary checks if not already covered by `npm test` and current security grep.
- `README.md` — monitoring configuration and safe rollout.
- `docs/codex/BUILD_STATUS.md` — deployed architecture/current capability; correct VM100 static address to `192.168.1.124`.
- `docs/codex/NEXT_STEPS.md` — mark observer rollout complete, place monitoring/incidents as completed/read-only visibility capability, correct VM100 address.
- `docs/codex/API_CONTRACT.md` — GET-only monitoring API response contracts.

---

### Task 1: Monitoring Configuration and State Model

**Files:**
- Modify: `server/config.mjs`
- Create: `server/monitoring/state.mjs`
- Create: `server/monitoring/state.test.mjs`
- Modify: `.env.example`
- Modify: `compose.yaml`

**Interfaces:**
- Consumes: existing `getConfig(env)` pattern and persistent `/data` mount.
- Produces: `config.monitoring` with `{ enabled, pollSeconds, offlineGraceSeconds, statePath, historyLimit }`; `createEmptyMonitoringState()`, `appendHistory(state, event, limit)`, `monitoringSummary(state, runtimeMeta)`, `incidentList(state)`.

- [ ] **Step 1: Write failing configuration and state tests**

Add assertions equivalent to:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from '../config.mjs'
import {
  appendHistory,
  createEmptyMonitoringState,
  incidentList,
  monitoringSummary,
} from './state.mjs'

test('monitoring config is safe and disabled by default', () => {
  const config = getConfig({})
  assert.deepEqual(config.monitoring, {
    enabled: false,
    pollSeconds: 30,
    offlineGraceSeconds: 300,
    statePath: '/data/monitoring-state.json',
    historyLimit: 2000,
  })
})

test('monitoring config accepts explicit server-side overrides', () => {
  const config = getConfig({
    FRIDAY_MONITORING_ENABLED: 'true',
    FRIDAY_MONITORING_POLL_SECONDS: '15',
    FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS: '60',
    FRIDAY_MONITORING_STATE_PATH: '/tmp/state.json',
    FRIDAY_MONITORING_HISTORY_LIMIT: '10',
  })
  assert.equal(config.monitoring.enabled, true)
  assert.equal(config.monitoring.pollSeconds, 15)
  assert.equal(config.monitoring.offlineGraceSeconds, 60)
  assert.equal(config.monitoring.statePath, '/tmp/state.json')
  assert.equal(config.monitoring.historyLimit, 10)
})

test('history is oldest-first capped at configured size', () => {
  const state = createEmptyMonitoringState()
  appendHistory(state, { id: '1', type: 'a', at: '2026-08-19T00:00:00.000Z' }, 2)
  appendHistory(state, { id: '2', type: 'b', at: '2026-08-19T00:01:00.000Z' }, 2)
  appendHistory(state, { id: '3', type: 'c', at: '2026-08-19T00:02:00.000Z' }, 2)
  assert.deepEqual(state.history.map((event) => event.id), ['2', '3'])
})

test('incidentList returns open first then recently resolved', () => {
  const state = createEmptyMonitoringState()
  state.incidents = [
    { id: 'resolved', status: 'resolved', openedAt: '2026-08-19T00:00:00.000Z', resolvedAt: '2026-08-19T00:03:00.000Z' },
    { id: 'open', status: 'open', openedAt: '2026-08-19T00:02:00.000Z', resolvedAt: null },
  ]
  assert.deepEqual(incidentList(state).map((incident) => incident.id), ['open', 'resolved'])
})
```

- [ ] **Step 2: Run the targeted tests and confirm RED**

Run:

```bash
node --test server/monitoring/state.test.mjs
```

Expected: FAIL because `server/monitoring/state.mjs` and `config.monitoring` do not exist.

- [ ] **Step 3: Implement the minimal state/config primitives**

`createEmptyMonitoringState()` must return:

```js
{
  schemaVersion: 1,
  observations: {},
  incidents: [],
  history: [],
}
```

`appendHistory` pushes one normalized event and trims from the front when `history.length > limit`.

`monitoringSummary` returns a browser-safe object with:

```js
{
  enabled,
  status,          // 'disabled' | 'starting' | 'ok' | 'degraded'
  lastPollAt,
  lastSuccessAt,
  lastError,
  activeIncidents,
  openHigh,
  openWarning,
}
```

`incidentList` sorts open incidents first, each group newest `openedAt` first, and returns cloned/plain objects.

Add `config.monitoring` values using positive-number fallbacks so invalid/zero values revert to defaults rather than creating a zero-millisecond loop.

Add these exact `.env.example` lines:

```env
FRIDAY_MONITORING_ENABLED=false
FRIDAY_MONITORING_POLL_SECONDS=30
FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS=300
FRIDAY_MONITORING_STATE_PATH=/data/monitoring-state.json
FRIDAY_MONITORING_HISTORY_LIMIT=2000
```

Also change the example observer URL to:

```env
FRIDAY_VM100_OBSERVER_URL=http://192.168.1.124:3199
```

Pass the five monitoring variables through `compose.yaml`; do not add any new host mount or socket.

- [ ] **Step 4: Run targeted tests and Compose validation**

Run:

```bash
node --test server/monitoring/state.test.mjs
docker compose config >/dev/null
```

Expected: PASS and Compose config exits 0.

- [ ] **Step 5: Commit**

```bash
git add server/config.mjs server/monitoring/state.mjs server/monitoring/state.test.mjs .env.example compose.yaml
git commit -m "feat: add monitoring configuration and state model"
```

---

### Task 2: Deterministic Incident Engine

**Files:**
- Create: `server/monitoring/incidents.mjs`
- Create: `server/monitoring/incidents.test.mjs`
- Use: `server/monitoring/state.mjs`

**Interfaces:**
- Consumes: normalized overview `{ services, alerts, integrations }`, monitoring state, monitoring config, explicit `now` Date/string.
- Produces: `evaluateMonitoring({ state, overview, config, now }) -> { state, changed }` and deterministic incident/history records.

- [ ] **Step 1: Write failing tests for offline grace, duplicate suppression, resolution, and recurrence**

Use a helper service with stable ID `vm100-observer-npm` and explicit fake timestamps. Required assertions:

```js
const offline = {
  id: 'vm100-observer-npm',
  name: 'nginx-proxy-manager',
  category: 'container',
  host: 'VM 100',
  site: 'Site A',
  status: 'offline',
  detail: 'jc21/nginx-proxy-manager:latest',
  updated: 'Exited (255)',
}
```

Test sequence:

```js
state = evaluateMonitoring({ state, overview: { services: [offline], alerts: [] }, config: { offlineGraceSeconds: 300, historyLimit: 2000 }, now: '2026-08-19T00:00:00.000Z' }).state
assert.equal(state.incidents.length, 0)

state = evaluateMonitoring({ state, overview: { services: [offline], alerts: [] }, config, now: '2026-08-19T00:05:01.000Z' }).state
assert.equal(state.incidents.filter((i) => i.status === 'open').length, 1)
assert.equal(state.incidents[0].type, 'service-offline')
assert.equal(state.incidents[0].serviceName, 'nginx-proxy-manager')
assert.equal(state.incidents[0].host, 'VM 100')
assert.equal(state.incidents[0].severity, 'high')
assert.match(state.incidents[0].recommendedAction, /approval/i)
```

Run another offline poll and assert the same incident ID remains and incident count stays 1. Then report the service `online` and assert `status === 'resolved'` with `resolvedAt`. Then report offline through grace again and assert a second incident with a different ID is created.

- [ ] **Step 2: Run tests and confirm RED**

```bash
node --test server/monitoring/incidents.test.mjs
```

Expected: FAIL because the engine does not exist.

- [ ] **Step 3: Implement observation tracking and service rules**

For every service ID persist an observation shaped as:

```js
{
  serviceId,
  serviceName,
  host,
  status,
  firstObservedAt,
  lastObservedAt,
  statusChangedAt,
  consecutive,
  transitions: [],
}
```

When status changes, append a transition timestamp, trim transitions older than 15 minutes, reset `consecutive=1`, and append `service-status-changed` history.

Use stable incident fingerprints:

```text
service-offline:<serviceId>
service-degraded:<serviceId>
service-flapping:<serviceId>
integration-unavailable:<integration-name>
```

Open incidents only when no matching open fingerprint exists. Reoccurrence after resolution creates a new unique `id`, for example `${fingerprint}:${openedAt}` encoded safely.

Service-offline and service-degraded grace is based on `statusChangedAt`, not number of polls.

Resolution rules:

```text
service-offline     -> resolve when service status is online
service-degraded    -> resolve when service status is online
service-flapping    -> resolve when fewer than 3 qualifying transitions remain in the rolling 15-minute window
```

- [ ] **Step 4: Add failing tests for degraded, flapping, integration loss/recovery, and history events**

Tests must assert:

```text
service-degraded severity = warning
3 status changes inside 15 minutes => one service-flapping warning
integration degraded alert => immediate high integration-unavailable incident
integration recovery => incident resolved + integration-recovered history
incident opening => incident-opened history
incident resolution => incident-resolved history
```

Use existing overview alert shape from `buildOverview`:

```js
{
  id: 'integration-0',
  title: 'Integration degraded',
  detail: 'vm100-observer: observer offline',
  severity: 'warning',
  source: 'Friday',
}
```

Parse only the stable prefix before `:` as the integration source; do not persist raw stack traces or credentials.

- [ ] **Step 5: Implement the remaining rules and pass all engine tests**

Run:

```bash
node --test server/monitoring/incidents.test.mjs
```

Expected: all incident engine tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/monitoring/incidents.mjs server/monitoring/incidents.test.mjs
git commit -m "feat: add deterministic monitoring incident engine"
```

---

### Task 3: Atomic Durable Monitoring Store

**Files:**
- Create: `server/monitoring/store.mjs`
- Create: `server/monitoring/store.test.mjs`

**Interfaces:**
- Consumes: monitoring state object and configured file path.
- Produces: `createFileMonitoringStore({ statePath, fsImpl? })` with async `load()` and `save(state)`.

- [ ] **Step 1: Write failing persistence tests using a temporary directory**

Use `mkdtemp`, `tmpdir`, and `join`. Required cases:

```js
const store = createFileMonitoringStore({ statePath })
await store.save({ schemaVersion: 1, observations: {}, incidents: [{ id: 'x' }], history: [] })
assert.deepEqual((await store.load()).incidents.map((i) => i.id), ['x'])
```

Also test:

- missing file returns `createEmptyMonitoringState()`;
- history/observations survive round trip;
- invalid JSON is renamed to `${statePath}.corrupt-<timestamp>` and load returns empty state;
- `save()` writes a temp file in the same directory and renames it over the destination;
- secrets are not introduced by the store itself; it serializes only the state object passed to it.

- [ ] **Step 2: Run store tests and confirm RED**

```bash
node --test server/monitoring/store.test.mjs
```

Expected: FAIL because `store.mjs` does not exist.

- [ ] **Step 3: Implement the file store**

Implementation requirements:

```js
await mkdir(dirname(statePath), { recursive: true })
await writeFile(tempPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
await rename(tempPath, statePath)
```

The temp path must be unique per write, e.g. `${statePath}.tmp-${process.pid}-${Date.now()}`.

On JSON parse failure:

```js
const corruptPath = `${statePath}.corrupt-${Date.now()}`
await rename(statePath, corruptPath).catch(() => {})
return createEmptyMonitoringState()
```

Do not throw on `ENOENT`; other read/write errors propagate so the runtime can record/degrade appropriately.

- [ ] **Step 4: Run tests**

```bash
node --test server/monitoring/store.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/monitoring/store.mjs server/monitoring/store.test.mjs
git commit -m "feat: persist monitoring state atomically"
```

---

### Task 4: Single-Poller Monitoring Runtime and Cached Overview

**Files:**
- Create: `server/monitoring/runtime.mjs`
- Create: `server/monitoring/runtime.test.mjs`
- Modify: `server/overview.mjs`
- Modify: `server/overview.test.mjs`

**Interfaces:**
- Consumes: `config`, `buildOverview`, incident engine, store, timer functions.
- Produces: `createMonitoringRuntime({ config, collectOverview, store, now?, setIntervalImpl?, clearIntervalImpl? })` exposing:
  - `start(): Promise<void>`
  - `stop(): void`
  - `poll(): Promise<void>`
  - `getOverview(): object | null`
  - `getIncidents(): { summary, incidents }`
  - `getHistory(): { events }`
  - `getSummary(): object`
- Produces `decorateOverviewWithMonitoring(overview, { incidents, summary })` in `overview.mjs`.

- [ ] **Step 1: Write failing runtime tests**

Required tests:

1. disabled runtime does not call `collectOverview`, `store.load`, `store.save`, or create a timer;
2. enabled `start()` loads prior state and performs an immediate poll before scheduling the interval;
3. two concurrent `poll()` calls cause only one collector invocation;
4. successful poll caches latest overview and persists evaluated state;
5. collection failure keeps prior cached overview, records `monitoring-poll-failed`, sets summary status `degraded`, and does not terminate future polling;
6. persistence failure keeps in-memory state and summary degraded but does not discard the successful overview;
7. `getIncidents()` returns open-first ordering from `incidentList`;
8. `getHistory()` returns newest-first API presentation while stored history remains bounded chronological order.

Use deferred Promises for the overlap test rather than real sleeps.

- [ ] **Step 2: Run runtime tests and confirm RED**

```bash
node --test server/monitoring/runtime.test.mjs
```

Expected: FAIL because runtime does not exist.

- [ ] **Step 3: Implement runtime with injected dependencies**

Runtime state must keep:

```js
let monitoringState = createEmptyMonitoringState()
let latestOverview = null
let inFlight = null
let timer = null
let meta = {
  status: config.monitoring.enabled ? 'starting' : 'disabled',
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null,
}
```

`poll()` must return the existing `inFlight` Promise when already running. In the successful path:

```js
const overview = await collectOverview(config)
const evaluated = evaluateMonitoring({ state: monitoringState, overview, config: config.monitoring, now: now() })
monitoringState = evaluated.state
latestOverview = overview
meta.lastSuccessAt = timestamp
meta.status = 'ok'
await store.save(monitoringState)
```

If store save fails, retain `monitoringState` and `latestOverview`, set `meta.status='degraded'`, store a sanitized `lastError`, and continue.

Scheduling interval is exactly `config.monitoring.pollSeconds * 1000`.

- [ ] **Step 4: Add overview decoration tests**

Add to `server/overview.test.mjs`:

```js
const decorated = decorateOverviewWithMonitoring(base, {
  incidents: [{ id: 'i1', status: 'open', severity: 'high', title: 'Service offline', detail: 'nginx-proxy-manager', source: 'monitoring' }],
  summary: { enabled: true, status: 'ok', activeIncidents: 1 },
})
assert.equal(decorated.incidents.length, 1)
assert.equal(decorated.monitoring.activeIncidents, 1)
assert.ok(decorated.alerts.some((a) => a.id === 'incident-i1'))
```

`decorateOverviewWithMonitoring` must preserve all existing overview fields and existing adapter alerts, then append incident-derived alerts without mutating the original object.

- [ ] **Step 5: Run runtime + overview tests**

```bash
node --test server/monitoring/runtime.test.mjs server/overview.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/monitoring/runtime.mjs server/monitoring/runtime.test.mjs server/overview.mjs server/overview.test.mjs
git commit -m "feat: add monitoring poll runtime"
```

---

### Task 5: GET-Only Monitoring HTTP API and Production Bootstrap

**Files:**
- Create: `server/http.mjs`
- Create: `server/http.test.mjs`
- Modify: `server/index.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `config`, optional monitoring runtime, existing `buildOverview`, command preview, assistant.
- Produces: `createFridayServer({ config, monitoringRuntime, buildOverviewImpl?, answerAssistantImpl? })` returning a Node HTTP server without calling `listen()`.
- Routes:
  - `GET /api/overview`
  - `GET /api/incidents`
  - `GET /api/monitoring/history`
  - existing routes preserved.

- [ ] **Step 1: Write failing HTTP route tests**

Create a test helper that starts `createFridayServer` on port `0`, reads `server.address().port`, performs requests, then closes it.

Required assertions:

```text
GET /api/incidents -> 200, calls runtime.getIncidents()
GET /api/monitoring/history -> 200, calls runtime.getHistory()
POST /api/incidents -> 404
PUT /api/incidents -> 404
DELETE /api/incidents -> 404
PATCH /api/incidents -> 404
```

Also assert:

- with monitoring enabled and cached overview present, `GET /api/overview` returns `decorateOverviewWithMonitoring(runtime.getOverview(), ...)`;
- with monitoring disabled/no cached overview, existing direct `buildOverview(config)` behavior is preserved;
- existing `POST /api/commands/preview` behavior is preserved;
- existing `POST /api/assistant` remains advisory and receives the same overview path used by the UI.

- [ ] **Step 2: Run tests and confirm RED**

```bash
node --test server/http.test.mjs
```

Expected: FAIL because `server/http.mjs` does not exist.

- [ ] **Step 3: Extract server factory from `server/index.mjs`**

Move `json`, body parsing, static serving, MIME map, and route handling into `server/http.mjs`. Do not change route semantics except adding the two GET-only monitoring endpoints and monitoring-aware overview selection.

Use a helper inside `http.mjs`:

```js
async function currentOverview({ config, monitoringRuntime, buildOverviewImpl }) {
  const cached = monitoringRuntime?.getOverview?.()
  if (config.monitoring?.enabled && cached) {
    const { incidents } = monitoringRuntime.getIncidents()
    return decorateOverviewWithMonitoring(cached, {
      incidents,
      summary: monitoringRuntime.getSummary(),
    })
  }
  return buildOverviewImpl(config)
}
```

- [ ] **Step 4: Make `server/index.mjs` production-bootstrap-only**

Production flow:

```js
const config = getConfig()
const store = createFileMonitoringStore({ statePath: config.monitoring.statePath })
const monitoringRuntime = createMonitoringRuntime({
  config,
  collectOverview: buildOverview,
  store,
})
await monitoringRuntime.start()
const server = createFridayServer({ config, monitoringRuntime })
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Friday listening on 0.0.0.0:${config.port} (${config.mode} mode)`)
})
```

Disabled monitoring must make `start()` inert and must not touch the state file.

- [ ] **Step 5: Ensure package test script covers monitoring tests**

Set Node portion of scripts to include:

```json
"test": "vitest run && node --test server/*.test.mjs server/adapters/*.test.mjs server/monitoring/*.test.mjs observer/*.test.mjs",
"test:server": "node --test server/*.test.mjs server/adapters/*.test.mjs server/monitoring/*.test.mjs observer/*.test.mjs"
```

- [ ] **Step 6: Run HTTP/server regression tests**

```bash
npm test
```

Expected: all frontend + server + adapter + observer + monitoring tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/http.mjs server/http.test.mjs server/index.mjs package.json
git commit -m "feat: expose read-only monitoring APIs"
```

---

### Task 6: V3 Active Incidents and Incidents Workspace

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/components/ActiveIncidents.tsx`
- Create: `src/components/ActiveIncidents.test.tsx`
- Create: `src/components/IncidentsWorkspace.tsx`
- Create: `src/components/IncidentsWorkspace.test.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes optional `overview.incidents` and `overview.monitoring` returned by the server.
- Produces normalized browser types:

```ts
export type FridayIncident = {
  id: string
  type: string
  title: string
  detail: string
  severity: 'high' | 'warning' | 'info'
  status: 'open' | 'resolved'
  source: string
  host: string
  serviceId?: string
  serviceName?: string
  firstSeen: string
  lastSeen: string
  openedAt: string
  resolvedAt?: string | null
  recommendedAction: string
  evidence?: string[]
}

export type MonitoringSummary = {
  enabled: boolean
  status: 'disabled' | 'starting' | 'ok' | 'degraded'
  lastPollAt?: string | null
  lastSuccessAt?: string | null
  lastError?: string | null
  activeIncidents: number
  openHigh: number
  openWarning: number
}

export type MonitoringEvent = {
  id: string
  type: string
  at: string
  source: string
  host?: string
  serviceId?: string
  serviceName?: string
  detail: string
}
```

Add optional fields to `FridayOverview`:

```ts
incidents?: FridayIncident[]
monitoring?: MonitoringSummary
```

- [ ] **Step 1: Write failing `ActiveIncidents` tests**

Render with one Nginx Proxy Manager incident and assert visible text includes:

```text
nginx-proxy-manager
VM 100
HIGH
READ ONLY
REQUIRES APPROVAL TO ACT
```

Assert the recommended action is visible. Assert no button exists with names matching `/restart|stop|start|execute|repair/i`.

Render with no monitoring fields and assert a safe empty state such as `No active incidents` instead of throwing.

- [ ] **Step 2: Run component test and confirm RED**

```bash
npx vitest run src/components/ActiveIncidents.test.tsx
```

Expected: FAIL because component/types do not exist.

- [ ] **Step 3: Implement `ActiveIncidents` and place it high on Overview**

Sort open incidents client-side only as a defensive presentation rule: `high` before `warning` before `info`, then newest `openedAt` first. Server ordering remains authoritative for API consumers.

In `Dashboard.tsx`, place the Active Incidents section after the FRIDAY/system-health hero and before the generic Infrastructure section so actionable failures precede informational inventory.

Change the health panel's alert row to show `overview.monitoring?.activeIncidents ?? overview.alerts.length` with label `Active incidents` when monitoring exists.

- [ ] **Step 4: Write failing Incidents workspace tests**

Tests must render:

- active high incident card for Nginx Proxy Manager;
- a resolved incident in a `Recently resolved` section;
- monitoring state (`Monitoring OK`, `Monitoring degraded`, or equivalent text);
- recent history rows from a supplied `history` prop;
- no executable remediation controls.

To avoid a second browser polling loop, `IncidentsWorkspace` accepts incidents/summary from `overview` and history fetched only when the Incidents navigation view is opened.

Add API helper:

```ts
export async function fetchMonitoringHistory(): Promise<{ events: MonitoringEvent[] }> {
  const response = await fetch('/api/monitoring/history')
  if (!response.ok) throw new Error(`Friday monitoring history ${response.status}`)
  return response.json()
}
```

- [ ] **Step 5: Implement workspace and Dashboard navigation wiring**

Replace only the generic `active === 'Incidents'` detail content. Other navigation views keep the existing `DetailView` behavior.

When Incidents is active, fetch history once per activation with an AbortController. On failure, show a non-blocking `History unavailable` message while active incident data remains visible.

No frontend call is added for POST/PUT/PATCH/DELETE incident endpoints.

- [ ] **Step 6: Add V3-compatible CSS**

Reuse existing `.v3-panel`, `.v3-kicker`, `.v3-status`, spacing and typography values. New selectors may include:

```text
.v3-incidents
.v3-incident-row
.v3-incident-severity
.v3-incident-safety
.v3-incident-evidence
.v3-incident-history
```

Each severity row must include visible text (`HIGH`, `WARNING`, `INFO`) in addition to CSS class/color.

- [ ] **Step 7: Run frontend tests and production build**

```bash
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api.ts src/components/ActiveIncidents.tsx src/components/ActiveIncidents.test.tsx src/components/IncidentsWorkspace.tsx src/components/IncidentsWorkspace.test.tsx src/pages/Dashboard.tsx src/styles.css
git commit -m "feat: add FRIDAY incident workspace"
```

---

### Task 7: Documentation, CI Safety Checks, and Current VM100 Address

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `docs/codex/API_CONTRACT.md`
- Modify: `docs/codex/BUILD_STATUS.md`
- Modify: `docs/codex/NEXT_STEPS.md`
- Modify other monitoring/observer docs only where they still identify the active VM100 address as `192.168.1.74`.

**Interfaces:**
- Consumes: completed monitoring API/config behavior from Tasks 1-6.
- Produces: accurate operator/Codex handoff and CI checks that prevent accidental mutation endpoints.

- [ ] **Step 1: Add CI monitoring/security checks**

Keep existing workflow checks and add commands equivalent to:

```bash
npm test
npm run build

grep -RniE "request\.method === '(POST|PUT|PATCH|DELETE)'.*(incidents|monitoring)" server && exit 1 || true

grep -RniE "/containers/.*/(start|stop|restart|kill|exec)|/images/create|/volumes|/networks/.*/(connect|disconnect)" \
  server/monitoring server/http.mjs && exit 1 || true

grep -RniE "VITE_.*(MONITOR|INCIDENT|TOKEN|SECRET)" src .env.example compose.yaml && exit 1 || true

docker compose config >/dev/null
docker build -t friday-controller:ci .
```

Do not weaken or remove the existing observer security-boundary checks.

- [ ] **Step 2: Update API contract**

Document exact GET shapes:

```json
GET /api/incidents
{
  "summary": {
    "active": 1,
    "high": 1,
    "warning": 0,
    "resolved": 0
  },
  "incidents": []
}
```

```json
GET /api/monitoring/history
{
  "events": []
}
```

Document that `GET /api/overview` may additionally contain `incidents` and `monitoring`, while legacy fields remain present.

Explicitly state that incident/history action methods do not exist in this milestone.

- [ ] **Step 3: Update deployment docs and source-of-truth status**

Record:

```text
VM102 controller: 192.168.1.64
VM100 infrastructure/observer host: 192.168.1.124
VM100 observer: http://192.168.1.124:3199
Proxmox: 192.168.1.211
```

Update `BUILD_STATUS.md` so the observer is described as deployed/live rather than an unmerged PR. Add monitoring/incidents under implemented capabilities only after code verification is complete.

Update `NEXT_STEPS.md` so completed observer rollout is no longer presented as pending P0 work. Preserve the safety order: authentication/RBAC/durable action audit/approval still precede infrastructure write operations.

- [ ] **Step 4: Document monitoring rollout and rollback in README**

Add safe production environment example without secrets:

```env
FRIDAY_MONITORING_ENABLED=true
FRIDAY_MONITORING_POLL_SECONDS=30
FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS=300
FRIDAY_MONITORING_STATE_PATH=/data/monitoring-state.json
FRIDAY_MONITORING_HISTORY_LIMIT=2000
```

State that normal production uses base `compose.yaml` with `FRIDAY_DOCKER_ENABLED=false` and the VM100 observer enabled.

Rollback:

```bash
# set FRIDAY_MONITORING_ENABLED=false in .env
docker compose up -d --force-recreate
```

Do not delete `/data/monitoring-state.json` during rollback.

- [ ] **Step 5: Run docs/security verification**

```bash
npm test
npm run build
sh -n scripts/*.sh
docker compose config >/dev/null
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml README.md docs/codex/API_CONTRACT.md docs/codex/BUILD_STATUS.md docs/codex/NEXT_STEPS.md docs
git commit -m "docs: document monitoring rollout and safety boundary"
```

---

### Task 8: Full Verification and VM102 Rollout Gate

**Files:**
- No application file should be changed during this task unless verification exposes a defect; defects return to the owning task with a new failing test first.

**Interfaces:**
- Consumes: complete feature branch.
- Produces: objective verification evidence suitable for PR review and a safe VM102 rollout checklist.

- [ ] **Step 1: Run full repository verification on the feature branch**

```bash
make verify
npm test
npm run build
for file in scripts/*.sh; do sh -n "$file"; done
docker compose config >/dev/null
docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
FRIDAY_OBSERVER_TOKEN=verify-token FRIDAY_OBSERVER_BIND_ADDRESS=127.0.0.1 docker compose -f observer/compose.yaml config >/dev/null
docker build -t friday-controller:monitoring-verify .
docker build -t friday-observer:monitoring-verify observer
```

Expected: every command exits 0.

- [ ] **Step 2: Run source-level mutation boundary checks**

```bash
if grep -RniE "/containers/.*/(start|stop|restart|kill|exec)|/images/create|/volumes|/networks/.*/(connect|disconnect)" server/monitoring server/http.mjs; then
  echo "FAIL: infrastructure mutation path detected"
  exit 1
fi

if grep -RniE "VITE_.*(MONITOR|INCIDENT|TOKEN|SECRET)" src .env.example compose.yaml; then
  echo "FAIL: privileged monitoring value exposed to browser"
  exit 1
fi
```

Expected: no matches and exit 0.

- [ ] **Step 3: Open a draft PR with verification status**

PR body must state:

```text
- monitoring is infrastructure read-only
- new mutation endpoints: none
- persistence path: /data/monitoring-state.json
- VM100 observer contract unchanged
- tests/build/Compose/images/security checks status
- rollout keeps FRIDAY_MONITORING_ENABLED=false until VM102 post-merge checkpoint
- rollback disables monitoring without deleting state
```

- [ ] **Step 4: Post-merge VM102 update with monitoring still disabled**

On VM102:

```bash
cd /srv/infrastructure/apps/friday
git status --short
git pull --ff-only origin main
chmod 600 .env
make preflight
docker compose up -d --build
docker compose ps
make health
```

Expected: existing Proxmox and VM100 observer integrations remain live before monitoring is enabled.

- [ ] **Step 5: Enable monitoring on VM102 only after baseline health passes**

Preserve existing credentials/settings and set:

```env
FRIDAY_MONITORING_ENABLED=true
FRIDAY_MONITORING_POLL_SECONDS=30
FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS=300
FRIDAY_MONITORING_STATE_PATH=/data/monitoring-state.json
FRIDAY_MONITORING_HISTORY_LIMIT=2000
```

Then:

```bash
chmod 600 .env
docker compose up -d --force-recreate
docker compose ps
make health
```

Do not use `make live`.

- [ ] **Step 6: Validate monitoring APIs without mutating VM100**

```bash
curl -fsS http://127.0.0.1:3010/api/overview | jq '{mode, monitoring, activeIncidents: (.incidents // [] | map(select(.status == "open")) | length)}'
curl -fsS http://127.0.0.1:3010/api/incidents | jq
curl -fsS http://127.0.0.1:3010/api/monitoring/history | jq '.events[0:10]'
```

Immediately after enablement, Nginx Proxy Manager may not yet have an incident because the 300-second grace period is intentional.

- [ ] **Step 7: Validate the real Nginx Proxy Manager incident after grace**

After at least 5 minutes of continued observed `offline` state:

```bash
curl -fsS http://127.0.0.1:3010/api/incidents \
  | jq '.incidents[] | select(.serviceName == "nginx-proxy-manager") | {type,severity,status,host,serviceName,recommendedAction}'
```

Expected:

```json
{
  "type": "service-offline",
  "severity": "high",
  "status": "open",
  "host": "VM 100",
  "serviceName": "nginx-proxy-manager",
  "recommendedAction": "...approval..."
}
```

Then compare VM100 directly through the existing observer to prove monitoring did not change its state:

```bash
# From VM102, use the existing private observer token without printing it.
curl -fsS -H "Authorization: Bearer $OBSERVER_TOKEN" \
  http://192.168.1.124:3199/api/v1/containers \
  | jq '.containers[] | select(.name == "nginx-proxy-manager") | {name,state,status}'
```

Expected: Nginx Proxy Manager remains whatever state the observer reports; FRIDAY monitoring itself performs no restart or modification.

- [ ] **Step 8: Record final verification evidence before declaring milestone complete**

Capture only non-secret outputs:

```text
FRIDAY container healthy
/api/overview monitoring.enabled=true
/api/incidents returns deterministic incident(s)
/api/monitoring/history returns bounded events
Nginx Proxy Manager incident opens after grace
VM100 observer remains healthy
No container mutation performed by monitoring
```

Do not claim completion until this evidence exists.
