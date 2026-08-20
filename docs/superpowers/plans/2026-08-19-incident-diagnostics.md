# FRIDAY Incident Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe incident-scoped container diagnostics to FRIDAY so supported VM100 incidents automatically receive one sanitized metadata diagnosis while application logs remain explicit, bounded, ephemeral, and read-only.

**Architecture:** Extend the existing VM100 observer with two authenticated fixed GET routes for sanitized inspect metadata and bounded logs. Extend the VM102 monitoring runtime to persist diagnostic reports in FRIDAY-owned monitoring state, backfill already-open supported incidents once, expose incident-scoped GET APIs, and record metadata-only log-inspection audit events without adding infrastructure mutation authority.

**Tech Stack:** Node.js 22 ESM, built-in `node:http`, `node:test`, existing FRIDAY monitoring runtime/store, Docker Engine HTTP API over the local Unix socket, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-19-incident-diagnostics-mobile-design.md`

## Global Constraints

- VM100 remains `192.168.1.124`; VM102 remains `192.168.1.64`.
- VM100 observer transport remains bearer-authenticated HTTP on port `3199`; never expose Docker TCP `2375/2376`.
- Observer additions are exactly authenticated GET inspect and GET logs routes; no POST/PUT/PATCH/DELETE diagnostic routes.
- Allowed Docker API paths are only `/containers/json?all=1`, `/containers/{validated-id}/json`, and `/containers/{validated-id}/logs` with a fixed bounded query.
- `FRIDAY_DIAGNOSTICS_ENABLED=false` is the merged default. Monitoring must continue unchanged when diagnostics are disabled.
- Automatic collection is metadata-only. Logs are fetched only after an explicit `Inspect Logs` request.
- Default log tail is `100`, maximum accepted tail is `200`, and returned sanitized log text is capped at `64 KiB` with `truncated: true` when clipped.
- Raw Docker inspect JSON, environment variables, health-check output text, host bind paths, command arguments, and raw labels outside the explicit allowlist never cross the observer boundary.
- Raw logs are never persisted in `/data/monitoring-state.json` or another FRIDAY durable store.
- Diagnostic facts, findings, and recommendations are deterministic and distinct. Inference is never labeled as an observed fact.
- No automatic restart, start, stop, exec, remove, image pull, Compose deploy, SSH, shell, Proxmox write, DNS, firewall, VLAN, or network mutation capability is introduced.
- Existing monitoring and the current Nginx Proxy Manager `service-offline` incident remain valid throughout rollout.
- Use TDD: every behavior change starts with a failing test, then minimal implementation, then the focused test and full affected suite.

---

## File Structure

### Observer

- Modify `observer/docker.mjs` — fixed Docker inspect/log request primitives, container-ID resolution, inspect allowlist sanitizer, log demultiplexing/redaction/bounds.
- Create `observer/diagnostics.test.mjs` — focused diagnostic primitive/sanitizer tests.
- Modify `observer/server.mjs` — authenticate and route the two new GET endpoints only.
- Modify `observer/server.test.mjs` — route/auth/method/unknown-container tests.
- Modify `observer/README.md` — document read-only diagnostics contract and validation commands.

### Controller

- Create `server/adapters/vm100-observer-diagnostics.mjs` — GET-only VM102 client for the two observer diagnostic routes.
- Create `server/adapters/vm100-observer-diagnostics.test.mjs` — client validation/error tests.
- Create `server/diagnostics/analyze.mjs` — pure deterministic diagnostic report builder.
- Create `server/diagnostics/analyze.test.mjs` — OOM, non-zero exit, restart evidence, unhealthy, isolation tests.
- Modify `server/config.mjs` — `config.diagnostics.enabled`.
- Modify `server/config.test.mjs` if present; otherwise create diagnostics assertions in the nearest existing config test file.
- Modify `server/monitoring/state.mjs` — schema version 2 plus `diagnostics` map normalization.
- Modify `server/monitoring/state.test.mjs` — legacy v1 migration and report preservation tests.
- Modify `server/monitoring/store.mjs` and `server/monitoring/store.test.mjs` only as needed to normalize loaded legacy state without losing incidents/history.
- Modify `server/monitoring/runtime.mjs` — one-time automatic/backfill collection, diagnostic lookup, explicit log retrieval, metadata-only audit, serialized state writes.
- Modify `server/monitoring/runtime.test.mjs` — disabled behavior, one-time collection/backfill, recurrence, failure degradation, raw-log non-persistence.
- Modify `server/http.mjs` — two incident-scoped GET routes.
- Modify `server/http.test.mjs` — success/error/GET-only API behavior.
- Modify `server/index.mjs` only if runtime dependency wiring requires explicit adapter injection.

### Configuration / safety / docs

- Modify `.env.example` — add `FRIDAY_DIAGNOSTICS_ENABLED=false`.
- Modify `compose.yaml` — pass diagnostics flag to VM102 controller.
- Modify `.github/workflows/ci.yml` — diagnostics-specific source security gate.
- Modify `README.md`, `docs/codex/API_CONTRACT.md`, `docs/codex/BUILD_STATUS.md`, `docs/codex/NEXT_STEPS.md`, `docs/integrations.md`, and `docs/live-integrations.md` — document the merged-but-disabled diagnostics contract and two-phase rollout.

---

### Task 1: Diagnostics Configuration and Monitoring-State Schema v2

**Files:**
- Modify: `server/config.mjs`
- Modify: `server/monitoring/state.mjs`
- Modify: `server/monitoring/state.test.mjs`
- Modify: `server/monitoring/store.mjs`
- Modify: `server/monitoring/store.test.mjs`
- Modify: `.env.example`
- Modify: `compose.yaml`

**Interfaces:**
- Produces: `config.diagnostics.enabled: boolean`.
- Produces: `normalizeMonitoringState(value)` returning `{ schemaVersion: 2, observations, incidents, history, diagnostics }`.
- Produces: monitoring state field `diagnostics: Record<string, DiagnosticReport>` keyed by incident ID.
- Existing `incidentList`, `appendHistory`, and monitoring summary behavior remain compatible.

- [ ] **Step 1: Write failing state-migration tests**

Add tests to `server/monitoring/state.test.mjs` that exercise both a legacy v1 object and an already-v2 object:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyMonitoringState, normalizeMonitoringState } from './state.mjs'

test('monitoring state v2 includes an empty diagnostics map', () => {
  assert.deepEqual(createEmptyMonitoringState(), {
    schemaVersion: 2,
    observations: {},
    incidents: [],
    history: [],
    diagnostics: {},
  })
})

test('legacy v1 monitoring state upgrades without losing incidents or history', () => {
  const legacy = {
    schemaVersion: 1,
    observations: { svc: { status: 'offline' } },
    incidents: [{ id: 'i1', status: 'open' }],
    history: [{ id: 'h1', type: 'incident-opened' }],
  }
  const upgraded = normalizeMonitoringState(legacy)
  assert.equal(upgraded.schemaVersion, 2)
  assert.deepEqual(upgraded.observations, legacy.observations)
  assert.deepEqual(upgraded.incidents, legacy.incidents)
  assert.deepEqual(upgraded.history, legacy.history)
  assert.deepEqual(upgraded.diagnostics, {})
})

test('malformed diagnostics field is normalized without discarding monitoring data', () => {
  const upgraded = normalizeMonitoringState({
    schemaVersion: 2,
    observations: {},
    incidents: [{ id: 'i1', status: 'open' }],
    history: [{ id: 'h1', type: 'incident-opened' }],
    diagnostics: ['not-a-map'],
  })
  assert.deepEqual(upgraded.diagnostics, {})
  assert.equal(upgraded.incidents[0].id, 'i1')
  assert.equal(upgraded.history[0].id, 'h1')
})
```

- [ ] **Step 2: Run the focused state tests and verify RED**

Run:

```bash
node --test server/monitoring/state.test.mjs server/monitoring/store.test.mjs
```

Expected: FAIL because schema version 2 / `normalizeMonitoringState` do not exist yet.

- [ ] **Step 3: Implement state normalization**

In `server/monitoring/state.mjs`, make the state constructor and normalizer explicit:

```js
export function createEmptyMonitoringState() {
  return {
    schemaVersion: 2,
    observations: {},
    incidents: [],
    history: [],
    diagnostics: {},
  }
}

export function normalizeMonitoringState(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    schemaVersion: 2,
    observations: input.observations && typeof input.observations === 'object' && !Array.isArray(input.observations) ? structuredClone(input.observations) : {},
    incidents: Array.isArray(input.incidents) ? structuredClone(input.incidents) : [],
    history: Array.isArray(input.history) ? structuredClone(input.history) : [],
    diagnostics: input.diagnostics && typeof input.diagnostics === 'object' && !Array.isArray(input.diagnostics) ? structuredClone(input.diagnostics) : {},
  }
}
```

Update `server/monitoring/store.mjs` so successful JSON parsing returns `normalizeMonitoringState(JSON.parse(raw))`, while missing/corrupt files retain the existing safe behavior.

- [ ] **Step 4: Add diagnostics config tests and implementation**

Add a config assertion using the existing config-test style:

```js
const disabled = getConfig({ FRIDAY_DIAGNOSTICS_ENABLED: 'false' })
assert.equal(disabled.diagnostics.enabled, false)
const enabledConfig = getConfig({ FRIDAY_DIAGNOSTICS_ENABLED: 'true' })
assert.equal(enabledConfig.diagnostics.enabled, true)
```

Add to `getConfig()`:

```js
diagnostics: {
  enabled: enabled(env.FRIDAY_DIAGNOSTICS_ENABLED),
},
```

Add to `.env.example`:

```env
# Read-only incident diagnostics. Enable only after the expanded VM100 observer is healthy.
FRIDAY_DIAGNOSTICS_ENABLED=false
```

Add to `compose.yaml` controller environment:

```yaml
FRIDAY_DIAGNOSTICS_ENABLED: ${FRIDAY_DIAGNOSTICS_ENABLED:-false}
```

- [ ] **Step 5: Run focused and full backend tests**

Run:

```bash
node --test server/monitoring/state.test.mjs server/monitoring/store.test.mjs server/config.test.mjs
npm run test:server
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit Task 1**

```bash
git add server/config.mjs server/config.test.mjs server/monitoring/state.mjs server/monitoring/state.test.mjs server/monitoring/store.mjs server/monitoring/store.test.mjs .env.example compose.yaml
git commit -m "feat: prepare diagnostics state and configuration"
```

---

### Task 2: VM100 Fixed Docker Inspect and Log Primitives

**Files:**
- Modify: `observer/docker.mjs`
- Create: `observer/diagnostics.test.mjs`

**Interfaces:**
- Produces: `resolveKnownContainer(config, requestedId, requestContainersImpl?) -> Promise<{ fullId, inventory }>`.
- Produces: `getSanitizedContainerInspect(config, requestedId, deps?) -> Promise<SanitizedInspect>`.
- Produces: `getSanitizedContainerLogs(config, requestedId, tail, deps?) -> Promise<{ logs, tail, truncated, observedAt }>`.
- `SanitizedInspect` never contains `Env`, raw `Config`, host bind paths, command arguments, health output, or arbitrary labels.
- Docker paths are internally constructed from the resolved full container ID only.

- [ ] **Step 1: Write failing inspect-sanitizer tests**

Create `observer/diagnostics.test.mjs` with fixtures containing deliberately sensitive fields:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeContainerInspect,
  sanitizeLogText,
  normalizeLogTail,
  resolveKnownContainer,
} from './docker.mjs'

test('inspect sanitizer exposes only approved metadata', () => {
  const raw = {
    Id: 'abcdef1234567890',
    Name: '/nginx-proxy-manager',
    Image: 'sha256:image123',
    RestartCount: 0,
    Config: {
      Image: 'jc21/nginx-proxy-manager:latest',
      Env: ['DB_PASSWORD=super-secret'],
      Cmd: ['start', '--token=secret'],
      Labels: {
        'com.docker.compose.project': 'npm',
        'com.docker.compose.service': 'app',
        private: 'do-not-forward',
      },
    },
    State: {
      Status: 'exited',
      ExitCode: 255,
      OOMKilled: false,
      StartedAt: '2026-08-17T00:00:00.000Z',
      FinishedAt: '2026-08-17T00:00:02.000Z',
      Health: { Status: 'unhealthy', Log: [{ Start: 'a', End: 'b', ExitCode: 1, Output: 'password=hidden' }] },
    },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      Binds: ['/secret/host/path:/config'],
    },
    NetworkSettings: {
      Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] },
      Networks: { frontend: {}, backend: {} },
    },
  }
  const result = sanitizeContainerInspect(raw, { hostName: 'VM 100', observedAt: '2026-08-20T00:00:00.000Z' })
  assert.equal(result.id, 'abcdef123456')
  assert.equal(result.name, 'nginx-proxy-manager')
  assert.equal(result.image, 'jc21/nginx-proxy-manager:latest')
  assert.equal(result.state, 'exited')
  assert.equal(result.exitCode, 255)
  assert.equal(result.oomKilled, false)
  assert.equal(result.restartCount, 0)
  assert.equal(result.compose.project, 'npm')
  assert.equal(result.compose.service, 'app')
  assert.deepEqual(result.networks, ['backend', 'frontend'])
  assert.equal(result.health.recent[0].exitCode, 1)
  assert.equal('output' in result.health.recent[0], false)
  assert.equal(JSON.stringify(result).includes('super-secret'), false)
  assert.equal(JSON.stringify(result).includes('/secret/host/path'), false)
  assert.equal(JSON.stringify(result).includes('--token=secret'), false)
  assert.equal(JSON.stringify(result).includes('do-not-forward'), false)
})
```

- [ ] **Step 2: Write failing container-ID resolution tests**

Add:

```js
test('known container resolver accepts one unique sanitized prefix and rejects unknown or ambiguous ids', async () => {
  const config = { dockerSocketPath: '/sock', hostName: 'VM 100', allowedLabelKeys: [] }
  const raw = [
    { Id: 'abcdef123456000000000000', Names: ['/a'], Image: 'a', State: 'exited', Status: 'Exited' },
    { Id: '999999999999000000000000', Names: ['/b'], Image: 'b', State: 'running', Status: 'Up' },
  ]
  const resolved = await resolveKnownContainer(config, 'abcdef123456', async () => raw)
  assert.equal(resolved.fullId, raw[0].Id)
  await assert.rejects(() => resolveKnownContainer(config, '111111111111', async () => raw), /unknown container/i)
  await assert.rejects(() => resolveKnownContainer(config, '../bad', async () => raw), /invalid container id/i)
})
```

Use a strict `/^[a-f0-9]{12,64}$/i` requested-ID validation rule.

- [ ] **Step 3: Write failing log bounds/redaction tests**

Add:

```js
test('log tail defaults to 100 and caps at 200', () => {
  assert.equal(normalizeLogTail(undefined), 100)
  assert.equal(normalizeLogTail('100'), 100)
  assert.equal(normalizeLogTail('9999'), 200)
  assert.equal(normalizeLogTail('-4'), 100)
})

test('log sanitizer redacts common credentials and caps output at 64 KiB', () => {
  const source = [
    'Authorization: Bearer abc.def.ghi',
    'password=hunter2',
    'api_key=sk-example-secret',
    'Server=db;Password=database-secret;User Id=friday',
    'x'.repeat(80 * 1024),
  ].join('\n')
  const result = sanitizeLogText(source)
  assert.match(result.logs, /Bearer \[redacted\]/)
  assert.match(result.logs, /password=\[redacted\]/i)
  assert.match(result.logs, /api_key=\[redacted\]/i)
  assert.match(result.logs, /Password=\[redacted\]/i)
  assert.ok(Buffer.byteLength(result.logs, 'utf8') <= 64 * 1024)
  assert.equal(result.truncated, true)
  assert.equal(result.logs.includes('hunter2'), false)
  assert.equal(result.logs.includes('database-secret'), false)
})
```

- [ ] **Step 4: Run diagnostic primitive tests and verify RED**

Run:

```bash
node --test observer/diagnostics.test.mjs
```

Expected: FAIL because the exported diagnostics helpers do not exist.

- [ ] **Step 5: Implement fixed Docker request helpers**

In `observer/docker.mjs`, retain the existing inventory code and add dedicated request functions. Do not add a general-purpose exported Docker path function.

Use this shape:

```js
const MAX_LOG_TAIL = 200
const DEFAULT_LOG_TAIL = 100
const MAX_LOG_BYTES = 64 * 1024
const MAX_RAW_LOG_BYTES = 256 * 1024
const CONTAINER_ID = /^[a-f0-9]{12,64}$/i

export function normalizeLogTail(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LOG_TAIL
  return Math.min(parsed, MAX_LOG_TAIL)
}

export async function resolveKnownContainer(config, requestedId, requestContainersImpl = requestDockerContainers) {
  const id = String(requestedId || '')
  if (!CONTAINER_ID.test(id)) throw new Error('Invalid container id')
  const raw = await requestContainersImpl(config.dockerSocketPath)
  const matches = raw.filter((container) => String(container.Id || '').toLowerCase().startsWith(id.toLowerCase()))
  if (matches.length === 0) throw new Error('Unknown container id')
  if (matches.length !== 1) throw new Error('Ambiguous container id')
  return {
    fullId: String(matches[0].Id),
    inventory: sanitizeContainer(matches[0], {
      hostName: config.hostName,
      allowedLabelKeys: config.allowedLabelKeys,
      observedAt: new Date().toISOString(),
    }),
  }
}
```

Add dedicated local-socket calls:

```js
function requestDockerInspect(socketPath, fullId) {
  return requestDockerJson(socketPath, `/containers/${encodeURIComponent(fullId)}/json`)
}

function requestDockerLogs(socketPath, fullId, tail) {
  const path = `/containers/${encodeURIComponent(fullId)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`
  return requestDockerBuffer(socketPath, path, MAX_RAW_LOG_BYTES)
}
```

`requestDockerJson` and `requestDockerBuffer` may be private helpers, but their callers must pass only hard-coded path templates built from a previously resolved container ID. They must always use `method: 'GET'`, the local Unix socket, a 4-second timeout, and reject HTTP status `>= 400`.

- [ ] **Step 6: Implement inspect sanitizer**

Implement `sanitizeContainerInspect(raw, { hostName, observedAt })` with exactly this normalized shape:

```js
{
  id: String(raw.Id || '').slice(0, 12),
  name: String(raw.Name || raw.Id || 'unknown').replace(/^\//, ''),
  image: String(raw.Config?.Image || ''),
  imageId: String(raw.Image || ''),
  state: String(raw.State?.Status || 'unknown'),
  exitCode: Number.isFinite(Number(raw.State?.ExitCode)) ? Number(raw.State.ExitCode) : null,
  oomKilled: raw.State?.OOMKilled === true,
  restartCount: Number.isFinite(Number(raw.RestartCount)) ? Number(raw.RestartCount) : 0,
  startedAt: String(raw.State?.StartedAt || ''),
  finishedAt: String(raw.State?.FinishedAt || ''),
  health: raw.State?.Health ? {
    status: String(raw.State.Health.Status || 'unknown'),
    recent: Array.isArray(raw.State.Health.Log) ? raw.State.Health.Log.slice(-3).map((entry) => ({
      start: String(entry.Start || ''),
      end: String(entry.End || ''),
      exitCode: Number.isFinite(Number(entry.ExitCode)) ? Number(entry.ExitCode) : null,
    })) : [],
  } : null,
  restartPolicy: {
    name: String(raw.HostConfig?.RestartPolicy?.Name || ''),
    maximumRetryCount: Number.isFinite(Number(raw.HostConfig?.RestartPolicy?.MaximumRetryCount)) ? Number(raw.HostConfig.RestartPolicy.MaximumRetryCount) : 0,
  },
  ports: normalizeInspectPorts(raw.NetworkSettings?.Ports),
  compose: {
    project: String(raw.Config?.Labels?.['com.docker.compose.project'] || ''),
    service: String(raw.Config?.Labels?.['com.docker.compose.service'] || ''),
  },
  networks: Object.keys(raw.NetworkSettings?.Networks || {}).sort(),
  host: hostName,
  observedAt,
}
```

`normalizeInspectPorts` returns only container port/protocol plus host IP/port strings; it must not expose unrelated network settings.

- [ ] **Step 7: Implement Docker log stream decoding and sanitization**

Docker non-TTY logs can use 8-byte multiplexed stream headers. Implement a private `decodeDockerLogBuffer(buffer)` that iterates valid frames using bytes `4..7` as the big-endian payload length and concatenates frame payloads. If the buffer is not a valid framed stream, decode it directly as UTF-8.

Implement credential redaction before the 64 KiB final cap:

```js
export function sanitizeLogText(value) {
  let logs = String(value || '')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:password|passwd|pwd|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(Password\s*=\s*)[^;\s]+/gi, '$1[redacted]')
  const bytes = Buffer.from(logs, 'utf8')
  const truncated = bytes.length > MAX_LOG_BYTES
  if (truncated) logs = bytes.subarray(0, MAX_LOG_BYTES).toString('utf8')
  return { logs, truncated }
}
```

`getSanitizedContainerLogs()` must combine raw-read truncation with final sanitization truncation so the response marker is true if either bound was hit.

- [ ] **Step 8: Run observer diagnostic tests**

Run:

```bash
node --test observer/diagnostics.test.mjs observer/docker.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add observer/docker.mjs observer/diagnostics.test.mjs observer/docker.test.mjs
git commit -m "feat: add sanitized observer diagnostic primitives"
```

---

### Task 3: VM100 Observer Diagnostic HTTP Routes

**Files:**
- Modify: `observer/server.mjs`
- Modify: `observer/server.test.mjs`

**Interfaces:**
- Adds authenticated `GET /api/v1/containers/:id/inspect`.
- Adds authenticated `GET /api/v1/containers/:id/logs?tail=100`.
- Unknown container returns 404 with `{ error: 'container-not-found' }`.
- Invalid token returns 401 before Docker access.
- Diagnostic Docker/provider failure returns 503 with a sanitized, bounded error.
- Any non-GET method or any unmatched path returns the existing 404 response.

- [ ] **Step 1: Write failing route/auth tests**

Extend `observer/server.test.mjs` by injecting diagnostic functions:

```js
const server = createObserverServer({
  config,
  getContainers: async () => [{ id: 'abcdef123456', name: 'example' }],
  getInspect: async (_config, id) => ({ id, name: 'example', state: 'exited', exitCode: 255 }),
  getLogs: async (_config, id, tail) => ({ id, logs: 'safe log', tail, truncated: false, observedAt: '2026-08-20T00:00:00.000Z' }),
})
```

Assert:

```js
assert.equal((await request(port, '/api/v1/containers/abcdef123456/inspect')).status, 401)
assert.equal((await request(port, '/api/v1/containers/abcdef123456/inspect', 'Bearer correct')).status, 200)
assert.equal((await request(port, '/api/v1/containers/abcdef123456/logs?tail=100', 'Bearer correct')).status, 200)
assert.equal((await request(port, '/api/v1/containers/abcdef123456/inspect', 'Bearer correct', 'POST')).status, 404)
assert.equal((await request(port, '/api/v1/containers/abcdef123456/logs', 'Bearer correct', 'DELETE')).status, 404)
```

Add an injected `getInspect` rejection with message `Unknown container id` and require status 404, while a generic Docker error requires 503.

- [ ] **Step 2: Run route tests and verify RED**

Run:

```bash
node --test observer/server.test.mjs
```

Expected: FAIL because the new routes/dependencies do not exist.

- [ ] **Step 3: Implement exact route matching**

Import the new observer functions and extend the server factory signature:

```js
export function createObserverServer({
  config,
  getContainers = getSanitizedContainers,
  getInspect = getSanitizedContainerInspect,
  getLogs = getSanitizedContainerLogs,
}) {
```

After `/api/v1/containers`, match only:

```js
const inspectMatch = url.pathname.match(/^\/api\/v1\/containers\/([a-fA-F0-9]{12,64})\/inspect$/)
const logsMatch = url.pathname.match(/^\/api\/v1\/containers\/([a-fA-F0-9]{12,64})\/logs$/)
```

For each route:
- require `request.method === 'GET'`;
- require exact bearer token before invoking the injected Docker function;
- use `normalizeLogTail(url.searchParams.get('tail'))` for logs;
- map unknown/ambiguous/invalid container errors to safe 404 without leaking Docker response bodies;
- map other diagnostic provider errors to 503 with a sanitized error limited to 160 characters.

- [ ] **Step 4: Run observer tests and full server suite**

Run:

```bash
node --test observer/*.test.mjs
npm run test:server
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add observer/server.mjs observer/server.test.mjs
git commit -m "feat: expose read-only observer diagnostics"
```

---

### Task 4: VM102 Observer Diagnostics Adapter and Deterministic Analyzer

**Files:**
- Create: `server/adapters/vm100-observer-diagnostics.mjs`
- Create: `server/adapters/vm100-observer-diagnostics.test.mjs`
- Create: `server/diagnostics/analyze.mjs`
- Create: `server/diagnostics/analyze.test.mjs`
- Modify: `package.json` only if the current server-test glob does not already include `server/diagnostics/*.test.mjs`

**Interfaces:**
- Produces: `containerIdFromServiceId(serviceId) -> string | null`.
- Produces: `getVm100ContainerDiagnostic(config, containerId, requestImpl?) -> Promise<SanitizedInspect>`.
- Produces: `getVm100ContainerLogs(config, containerId, tail = 100, requestImpl?) -> Promise<{ logs, tail, truncated, observedAt }>`.
- Produces: `buildDiagnosticReport({ incident, inspect, overview, now }) -> DiagnosticReport`.

- [ ] **Step 1: Write failing adapter tests**

Create tests that prove the controller constructs only the approved observer paths and sends the bearer token:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  containerIdFromServiceId,
  getVm100ContainerDiagnostic,
  getVm100ContainerLogs,
} from './vm100-observer-diagnostics.mjs'

test('container id is derived only from VM100 observer service ids', () => {
  assert.equal(containerIdFromServiceId('vm100-observer-abcdef123456'), 'abcdef123456')
  assert.equal(containerIdFromServiceId('docker-abcdef123456'), null)
  assert.equal(containerIdFromServiceId('vm100-observer-../bad'), null)
})

test('diagnostic adapter uses the fixed authenticated inspect route', async () => {
  let seen
  const body = { id: 'abcdef123456', state: 'exited', exitCode: 255 }
  const result = await getVm100ContainerDiagnostic(
    { enabled: true, baseUrl: 'http://192.168.1.124:3199', token: 'secret', hostName: 'VM 100' },
    'abcdef123456',
    async (request) => { seen = request; return body },
  )
  assert.equal(seen.path, '/api/v1/containers/abcdef123456/inspect')
  assert.equal(seen.authorization, 'Bearer secret')
  assert.deepEqual(result, body)
})

test('log adapter always requests the fixed default bounded tail', async () => {
  let seen
  await getVm100ContainerLogs(
    { enabled: true, baseUrl: 'http://192.168.1.124:3199', token: 'secret', hostName: 'VM 100' },
    'abcdef123456',
    100,
    async (request) => { seen = request; return { logs: 'safe', tail: 100, truncated: false } },
  )
  assert.equal(seen.path, '/api/v1/containers/abcdef123456/logs?tail=100')
})
```

- [ ] **Step 2: Write failing analyzer tests**

Use an incident fixture with `serviceId: 'vm100-observer-abcdef123456'` and an overview containing the affected offline service plus at least two other online VM100 services.

Assert exact categories:

```js
const report = buildDiagnosticReport({ incident, inspect, overview, now: '2026-08-20T01:00:00.000Z' })
assert.equal(report.status, 'available')
assert.equal(report.metadata.exitCode, 255)
assert.ok(report.facts.some((fact) => fact.id === 'exit-code' && fact.value === '255'))
assert.ok(report.findings.includes('The container exited with an application/startup failure rather than an OOM termination.'))
assert.ok(report.findings.includes('The failure appears isolated to this service rather than a host-wide Docker outage.'))
assert.ok(report.recommendations.includes('Inspect recent sanitized application logs and recent configuration/deployment changes.'))
```

Add separate fixtures for:
- `oomKilled: true`;
- `restartCount: 3` without flapping, which may state multiple restarts but not a timed crash loop;
- `state: 'running', health.status: 'unhealthy'`;
- `type: 'service-flapping'` plus restart evidence, which may state repeated recent instability;
- only one healthy neighboring service, which must not produce the isolation finding.

- [ ] **Step 3: Run adapter/analyzer tests and verify RED**

Run:

```bash
node --test server/adapters/vm100-observer-diagnostics.test.mjs server/diagnostics/analyze.test.mjs
```

Expected: FAIL because the files/functions do not exist.

- [ ] **Step 4: Implement the GET-only observer diagnostics adapter**

The adapter must validate `containerId` using `/^[a-f0-9]{12,64}$/i`, use a 4-second timeout, parse JSON, and reject non-2xx with sanitized errors that do not include response bodies or tokens.

Use an internal request descriptor for dependency-injected tests:

```js
{
  baseUrl: config.baseUrl,
  path: `/api/v1/containers/${containerId}/inspect`,
  authorization: `Bearer ${config.token}`,
}
```

The production request implementation translates that descriptor to `http.request` / `https.request` with `method: 'GET'`.

`containerIdFromServiceId` must return a value only for `vm100-observer-<12-to-64-hex>` IDs.

- [ ] **Step 5: Implement the deterministic report builder**

Use this report shape:

```js
{
  id: `diagnostic-${incident.id}`,
  incidentId: incident.id,
  source: 'vm100-observer',
  host: incident.host || inspect.host || 'VM 100',
  serviceId: incident.serviceId,
  serviceName: incident.serviceName || inspect.name,
  collectedAt: now,
  status: 'available',
  metadata: structuredClone(inspect),
  facts: [
    { id: 'state', label: 'State', value: String(inspect.state || 'unknown') },
    { id: 'exit-code', label: 'Exit code', value: inspect.exitCode == null ? 'unavailable' : String(inspect.exitCode) },
    { id: 'oom-killed', label: 'OOM killed', value: inspect.oomKilled ? 'Yes' : 'No' },
    { id: 'restart-count', label: 'Restart count', value: String(inspect.restartCount ?? 0) },
    { id: 'health', label: 'Health', value: String(inspect.health?.status || 'unavailable') },
  ],
  findings,
  likelyCauses,
  recommendations,
  logsAvailable: true,
  lastLogInspectionAt: null,
  error: null,
}
```

Rule strings must match the approved spec exactly enough for tests to distinguish facts from inference. Do not add AI calls.

- [ ] **Step 6: Ensure server test glob includes analyzer tests**

If `package.json` remains:

```json
"test:server": "node --test server/*.test.mjs server/adapters/*.test.mjs server/monitoring/*.test.mjs observer/*.test.mjs"
```

change both `test` and `test:server` scripts to include:

```text
server/diagnostics/*.test.mjs
```

- [ ] **Step 7: Run focused and full backend tests**

Run:

```bash
node --test server/adapters/vm100-observer-diagnostics.test.mjs server/diagnostics/analyze.test.mjs
npm run test:server
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add server/adapters/vm100-observer-diagnostics.mjs server/adapters/vm100-observer-diagnostics.test.mjs server/diagnostics/analyze.mjs server/diagnostics/analyze.test.mjs package.json
git commit -m "feat: add controller diagnostic analysis"
```

---

### Task 5: Monitoring Runtime Automatic Collection, Backfill, and Durable Reports

**Files:**
- Modify: `server/monitoring/runtime.mjs`
- Modify: `server/monitoring/runtime.test.mjs`
- Modify: `server/index.mjs` if explicit dependency wiring is needed

**Interfaces:**
- `createMonitoringRuntime()` accepts optional injected `collectDiagnosticImpl` and `fetchLogsImpl` dependencies.
- Runtime returns new methods:
  - `getDiagnostic(incidentId) -> { statusCode, body }`
  - `getIncidentLogs(incidentId) -> Promise<{ statusCode, body }>`
- Diagnostics map is keyed by incident ID and survives incident resolution.
- An open supported incident with no report is collected exactly once; this covers both newly opened incidents and startup backfill.

- [ ] **Step 1: Write failing disabled/backfill/dedup tests**

Extend `server/monitoring/runtime.test.mjs` with a loaded state containing the existing NPM-style open incident:

```js
const openIncident = {
  id: 'npm-offline-1',
  type: 'service-offline',
  status: 'open',
  source: 'monitoring',
  host: 'VM 100',
  serviceId: 'vm100-observer-abcdef123456',
  serviceName: 'nginx-proxy-manager',
  firstSeen: '2026-08-20T00:00:00.000Z',
  openedAt: '2026-08-20T00:05:00.000Z',
}
```

Required tests:

```js
test('diagnostics disabled never calls observer diagnostics', async () => {
  let calls = 0
  const runtime = createMonitoringRuntime({
    config: { monitoring: { enabled: true, pollSeconds: 30, historyLimit: 2000 }, diagnostics: { enabled: false } },
    collectOverview: async () => overview,
    collectDiagnosticImpl: async () => { calls += 1 },
    store,
  })
  await runtime.start()
  assert.equal(calls, 0)
})

test('startup backfills one diagnostic for an existing supported open incident and does not repeat every poll', async () => {
  let calls = 0
  store.load = async () => ({ schemaVersion: 2, observations: {}, incidents: [openIncident], history: [], diagnostics: {} })
  const runtime = createMonitoringRuntime({
    config,
    collectOverview: async () => overview,
    collectDiagnosticImpl: async ({ incident }) => {
      calls += 1
      return { id: `diagnostic-${incident.id}`, incidentId: incident.id, status: 'available', facts: [], findings: [], recommendations: [], logsAvailable: true }
    },
    store,
  })
  await runtime.start()
  await runtime.poll()
  assert.equal(calls, 1)
  assert.equal(runtime.getDiagnostic(openIncident.id).body.status, 'available')
})
```

Add tests for:
- new recurrence with a new incident ID causes a new report;
- unsupported/integration incident never calls observer inspect and returns `not-supported`;
- inspect failure stores `unavailable` with sanitized error while runtime summary remains operational/degraded only as appropriate;
- legacy v1 state backfill works after normalization.

- [ ] **Step 2: Run focused runtime tests and verify RED**

Run:

```bash
node --test server/monitoring/runtime.test.mjs
```

Expected: FAIL because diagnostics dependencies/methods do not exist.

- [ ] **Step 3: Add supported-incident mapping and collection helpers**

Inside `runtime.mjs`, add a small helper that recognizes only VM100 observer-backed container incidents:

```js
function supportedDiagnosticTarget(incident) {
  if (!['service-offline', 'service-degraded', 'service-flapping'].includes(incident?.type)) return null
  const containerId = containerIdFromServiceId(incident?.serviceId)
  return containerId ? { containerId } : null
}
```

When diagnostics are enabled, after `evaluateMonitoring()` and before state persistence, iterate open incidents. For each incident lacking `monitoringState.diagnostics[incident.id]`:

1. set a `pending` report immediately in memory;
2. call `collectDiagnosticImpl({ config: config.vm100Observer, incident, overview, containerId, now: timestamp })`;
3. replace pending with the returned available report;
4. on error, replace pending with an `unavailable` report containing only a sanitized bounded error;
5. never remove or resolve the incident because diagnostics failed.

Unsupported incidents may be represented lazily by `getDiagnostic()` as `not-supported`; do not persist a fake provider report unless needed for deduplication.

- [ ] **Step 4: Serialize monitoring-state writes**

Replace direct concurrent `store.save(monitoringState)` calls with a runtime-private write queue:

```js
let saveQueue = Promise.resolve()

function persistState() {
  const snapshot = structuredClone(monitoringState)
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => store.save(snapshot))
  return saveQueue
}
```

Use this for poll persistence and later log-inspection audit persistence so a GET logs request cannot overwrite a newer monitoring poll state.

Preserve the existing behavior that store-write errors do not crash the controller.

- [ ] **Step 5: Implement `getDiagnostic()`**

Return normalized HTTP-ready results:

```js
getDiagnostic(incidentId) {
  const incident = monitoringState.incidents.find((item) => item.id === incidentId)
  if (!incident) return { statusCode: 404, body: { error: 'incident-not-found' } }
  if (!config.diagnostics?.enabled) {
    return { statusCode: 200, body: { incidentId, status: 'not-supported', reason: 'diagnostics-disabled' } }
  }
  if (!supportedDiagnosticTarget(incident)) {
    return { statusCode: 200, body: { incidentId, status: 'not-supported', reason: 'incident-not-supported' } }
  }
  return {
    statusCode: 200,
    body: monitoringState.diagnostics[incidentId] || { incidentId, status: 'pending' },
  }
}
```

- [ ] **Step 6: Run runtime tests and full backend suite**

Run:

```bash
node --test server/monitoring/runtime.test.mjs server/monitoring/state.test.mjs server/monitoring/store.test.mjs
npm run test:server
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add server/monitoring/runtime.mjs server/monitoring/runtime.test.mjs server/index.mjs
git commit -m "feat: persist automatic incident diagnostics"
```

---

### Task 6: Explicit Incident Log Retrieval and Incident-Scoped Controller APIs

**Files:**
- Modify: `server/monitoring/runtime.mjs`
- Modify: `server/monitoring/runtime.test.mjs`
- Modify: `server/http.mjs`
- Modify: `server/http.test.mjs`

**Interfaces:**
- `GET /api/incidents/:incidentId/diagnostics` delegates to `monitoringRuntime.getDiagnostic(incidentId)`.
- `GET /api/incidents/:incidentId/logs` delegates to async `monitoringRuntime.getIncidentLogs(incidentId)`.
- `getIncidentLogs()` returns only ephemeral log text in its HTTP response; monitoring-state persistence receives metadata only.

- [ ] **Step 1: Write failing runtime log tests**

Add tests proving explicit retrieval is the only path that calls the observer log adapter:

```js
test('explicit incident logs fetch returns sanitized ephemeral output and persists metadata only', async () => {
  let calls = 0
  const runtime = createMonitoringRuntime({
    config,
    collectOverview: async () => overview,
    collectDiagnosticImpl: async ({ incident }) => ({ id: `diagnostic-${incident.id}`, incidentId: incident.id, status: 'available', facts: [], findings: [], recommendations: [], logsAvailable: true, lastLogInspectionAt: null }),
    fetchLogsImpl: async () => {
      calls += 1
      return { logs: 'sanitized application log', tail: 100, truncated: false, observedAt: '2026-08-20T01:00:00.000Z' }
    },
    store,
  })
  await runtime.start()
  assert.equal(calls, 0)
  const result = await runtime.getIncidentLogs('npm-offline-1')
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.logs, 'sanitized application log')
  assert.equal(calls, 1)
  const persisted = store.saved.at(-1)
  assert.equal(JSON.stringify(persisted).includes('sanitized application log'), false)
  assert.ok(persisted.history.some((event) => event.type === 'diagnostic-logs-inspected'))
})
```

Add tests for:
- unknown incident -> 404 and zero provider calls;
- diagnostics disabled -> 409 `{ error: 'diagnostics-disabled' }`;
- unsupported incident -> 409 `{ error: 'diagnostics-not-supported' }`;
- observer log failure -> 502, metadata-only `diagnostic-logs-failed` history event, no incident status change;
- successful retrieval updates only `lastLogInspectionAt` in the persisted diagnostic report.

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```bash
node --test server/monitoring/runtime.test.mjs
```

Expected: FAIL because `getIncidentLogs()` is absent.

- [ ] **Step 3: Implement explicit log retrieval**

Add `fetchLogsImpl = getVm100ContainerLogs` as a runtime dependency. Implement:

```js
async function getIncidentLogs(incidentId) {
  const incident = monitoringState.incidents.find((item) => item.id === incidentId)
  if (!incident) return { statusCode: 404, body: { error: 'incident-not-found' } }
  if (!config.diagnostics?.enabled) return { statusCode: 409, body: { error: 'diagnostics-disabled' } }
  const target = supportedDiagnosticTarget(incident)
  if (!target) return { statusCode: 409, body: { error: 'diagnostics-not-supported' } }
  const inspectedAt = now().toISOString()
  try {
    const payload = await fetchLogsImpl(config.vm100Observer, target.containerId, 100)
    const report = monitoringState.diagnostics[incident.id]
    if (report) report.lastLogInspectionAt = inspectedAt
    appendHistory(monitoringState, {
      id: `diagnostic-logs-inspected-${incident.id}-${inspectedAt.replace(/[^0-9A-Za-z_.-]+/g, '-')}`,
      type: 'diagnostic-logs-inspected',
      at: inspectedAt,
      source: 'diagnostics',
      host: incident.host,
      serviceId: incident.serviceId,
      serviceName: incident.serviceName,
      detail: 'Read-only diagnostic logs inspected (100-line maximum request)',
    }, monitoringConfig.historyLimit || 2000)
    await persistState().catch(() => {})
    return { statusCode: 200, body: { incidentId, serviceName: incident.serviceName, host: incident.host, tail: 100, logs: payload.logs, truncated: payload.truncated === true, observedAt: payload.observedAt || inspectedAt } }
  } catch (error) {
    appendHistory(monitoringState, {
      id: `diagnostic-logs-failed-${incident.id}-${inspectedAt.replace(/[^0-9A-Za-z_.-]+/g, '-')}`,
      type: 'diagnostic-logs-failed',
      at: inspectedAt,
      source: 'diagnostics',
      host: incident.host,
      serviceId: incident.serviceId,
      serviceName: incident.serviceName,
      detail: `Read-only diagnostic log inspection failed: ${sanitizeError(error)}`,
    }, monitoringConfig.historyLimit || 2000)
    await persistState().catch(() => {})
    return { statusCode: 502, body: { error: 'diagnostic-logs-unavailable' } }
  }
}
```

Do not put `payload.logs` into the report, history event, error, or persistence snapshot.

- [ ] **Step 4: Write failing HTTP route tests**

Extend the runtime fixture in `server/http.test.mjs` with:

```js
getDiagnostic: (id) => ({ statusCode: id === 'i1' ? 200 : 404, body: id === 'i1' ? { incidentId: 'i1', status: 'available' } : { error: 'incident-not-found' } }),
getIncidentLogs: async (id) => ({ statusCode: id === 'i1' ? 200 : 404, body: id === 'i1' ? { incidentId: 'i1', logs: 'safe', tail: 100, truncated: false } : { error: 'incident-not-found' } }),
```

Assert:

```js
const diagnostics = await fetch(`${base}/api/incidents/i1/diagnostics`)
assert.equal(diagnostics.status, 200)
assert.equal((await diagnostics.json()).status, 'available')

const logs = await fetch(`${base}/api/incidents/i1/logs`)
assert.equal(logs.status, 200)
assert.equal((await logs.json()).logs, 'safe')

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  assert.equal((await fetch(`${base}/api/incidents/i1/diagnostics`, { method })).status, 404)
  assert.equal((await fetch(`${base}/api/incidents/i1/logs`, { method })).status, 404)
}
```

- [ ] **Step 5: Implement exact incident-scoped GET route matching**

Before the generic POST routes in `server/http.mjs`, match:

```js
const diagnosticMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/diagnostics$/)
const logsMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/logs$/)
```

Accept only `GET`, reject incident IDs longer than 256 characters, decode safely, delegate to runtime, and send the returned `statusCode/body`. If the runtime lacks diagnostics methods, return a safe `503 { error: 'diagnostics-unavailable' }` rather than throwing.

- [ ] **Step 6: Run HTTP/runtime tests and full backend suite**

Run:

```bash
node --test server/http.test.mjs server/monitoring/runtime.test.mjs
npm run test:server
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add server/monitoring/runtime.mjs server/monitoring/runtime.test.mjs server/http.mjs server/http.test.mjs
git commit -m "feat: add incident diagnostic APIs"
```

---

### Task 7: Diagnostics Security Gate, Documentation, and Deployment Contract

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `observer/README.md`
- Modify: `README.md`
- Modify: `docs/codex/API_CONTRACT.md`
- Modify: `docs/codex/BUILD_STATUS.md`
- Modify: `docs/codex/NEXT_STEPS.md`
- Modify: `docs/integrations.md`
- Modify: `docs/live-integrations.md`

**Interfaces:**
- CI rejects diagnostic mutation paths, generic Docker proxy construction, shell/SSH execution, and frontend observer secrets.
- Docs describe observer-first/controller-second rollout and diagnostics disabled by default.

- [ ] **Step 1: Add diagnostics CI safety assertions**

Add a new workflow step after the existing observer/monitoring security checks:

```yaml
      - name: Verify diagnostics safety boundary
        run: |
          if grep -RniE '/containers/.*/(start|stop|restart|kill|exec)|/images/create|/volumes|/networks/.*/(connect|disconnect)|/archive' observer server/diagnostics server/adapters/vm100-observer-diagnostics.mjs; then
            echo 'Diagnostics mutation API path detected.' >&2
            exit 1
          fi
          if grep -RniE "request\.method === '(POST|PUT|PATCH|DELETE)'.*diagnostic|request\.method === '(POST|PUT|PATCH|DELETE)'.*/api/incidents/.*/logs" server observer; then
            echo 'Diagnostics write route detected.' >&2
            exit 1
          fi
          if grep -RniE 'child_process|execFile\(|spawn\(|ssh ' server/diagnostics server/adapters/vm100-observer-diagnostics.mjs observer; then
            echo 'Shell or SSH diagnostics path detected.' >&2
            exit 1
          fi
          if grep -RniE 'VITE_.*(TOKEN|SECRET|OBSERVER|DIAGNOSTIC)' src server observer compose.yaml .env.example; then
            echo 'Browser-visible diagnostics secret variable detected.' >&2
            exit 1
          fi
```

Do not add a grep that rejects the approved fixed inspect/log GET strings themselves.

- [ ] **Step 2: Update observer documentation with exact validation commands**

Document:

```bash
# Inventory remains unchanged
curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://192.168.1.124:3199/api/v1/containers | jq

# Read-only inspect for the known 12-char container id
curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://192.168.1.124:3199/api/v1/containers/CONTAINER_ID/inspect | jq

# Explicit bounded logs
curl -fsS -H "Authorization: Bearer $TOKEN" \
  'http://192.168.1.124:3199/api/v1/containers/CONTAINER_ID/logs?tail=100' | jq
```

The docs must explicitly state that `CONTAINER_ID` is obtained from sanitized inventory and must not be replaced by arbitrary Docker paths.

- [ ] **Step 3: Update controller/API docs**

Document:

```text
GET /api/incidents/:incidentId/diagnostics
GET /api/incidents/:incidentId/logs
```

Also document:
- diagnostics merged disabled by default;
- observer must be upgraded first;
- raw logs are ephemeral;
- NPM remains a read-only validation target;
- no remediation endpoint exists.

- [ ] **Step 4: Run CI-equivalent repository checks locally**

Run:

```bash
npm test
npm run build
for file in scripts/*.sh; do sh -n "$file"; done
docker compose config >/dev/null
docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
FRIDAY_OBSERVER_TOKEN=ci-test FRIDAY_OBSERVER_BIND_ADDRESS=127.0.0.1 docker compose -f observer/compose.yaml config >/dev/null
```

Expected: all commands exit 0. If Docker is unavailable in the execution environment, do not claim those Docker validations pass; use the GitHub Actions PR run as the evidence source.

- [ ] **Step 5: Commit Task 7**

```bash
git add .github/workflows/ci.yml observer/README.md README.md docs/codex/API_CONTRACT.md docs/codex/BUILD_STATUS.md docs/codex/NEXT_STEPS.md docs/integrations.md docs/live-integrations.md
git commit -m "docs: define diagnostics safety and rollout"
```

---

### Task 8: Exact-Head Verification and PR Readiness

**Files:**
- No production source changes unless verification finds a defect.
- Update the PR body with verification evidence after the final candidate is fixed.

**Interfaces:**
- Produces a reviewable diagnostics candidate on `feature/incident-diagnostics-mobile`.
- Does not merge or deploy without explicit user approval.

- [ ] **Step 1: Run the complete test/build suite on the final branch head**

Run:

```bash
npm test
npm run build
```

Expected: zero test failures and successful TypeScript/Vite build.

- [ ] **Step 2: Run source-level security checks**

Run the exact observer, monitoring, and diagnostics grep commands from `.github/workflows/ci.yml` against the final head.

Expected: no prohibited paths or browser-visible secrets.

- [ ] **Step 3: Validate Compose and images**

Run:

```bash
docker compose config >/dev/null
docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
FRIDAY_OBSERVER_TOKEN=ci-test FRIDAY_OBSERVER_BIND_ADDRESS=127.0.0.1 docker compose -f observer/compose.yaml config >/dev/null
docker build -t friday-diagnostics-verify .
docker build -t friday-observer-diagnostics-verify observer
```

Expected: all commands exit 0.

- [ ] **Step 4: Verify GitHub Actions on the exact PR head**

Open/update a draft PR from `feature/incident-diagnostics-mobile` to `main`. Confirm the final `Friday CI` workflow reports success for the exact head SHA. Do not treat an older green run as evidence for a newer commit.

- [ ] **Step 5: Record the post-merge production validation commands in the PR body**

Phase 1 on VM100, after merge and explicit rollout approval:

```bash
cd /srv/infrastructure/friday-observer
git checkout main
git pull --ff-only origin main
cd observer
docker compose config >/dev/null
docker compose up -d --build --force-recreate
curl -fsS http://192.168.1.124:3199/health | jq
```

Then obtain the existing NPM ID through authenticated inventory and prove inspect/log endpoints work without changing the container state:

```bash
CONTAINER_ID=$(curl -fsS -H "Authorization: Bearer $TOKEN" http://192.168.1.124:3199/api/v1/containers | jq -r '.containers[] | select(.name=="nginx-proxy-manager") | .id')
curl -fsS -H "Authorization: Bearer $TOKEN" "http://192.168.1.124:3199/api/v1/containers/$CONTAINER_ID/inspect" | jq
curl -fsS -H "Authorization: Bearer $TOKEN" "http://192.168.1.124:3199/api/v1/containers/$CONTAINER_ID/logs?tail=100" | jq

docker ps -a --filter name=nginx-proxy-manager --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

Phase 2 on VM102, only after Phase 1 is healthy:

```bash
cd /srv/infrastructure/apps/friday
git checkout main
git pull --ff-only origin main
make preflight
docker compose up -d --build --force-recreate
make health
```

First keep:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
FRIDAY_DOCKER_ENABLED=false
```

Confirm monitoring still sees the existing incident. Then set only:

```env
FRIDAY_DIAGNOSTICS_ENABLED=true
```

Recreate FRIDAY with base Compose and validate:

```bash
curl -fsS http://127.0.0.1:3010/api/incidents | jq
curl -fsS http://127.0.0.1:3010/api/incidents/INCIDENT_ID/diagnostics | jq
curl -fsS http://127.0.0.1:3010/api/incidents/INCIDENT_ID/logs | jq
```

Finally re-run the VM100 `docker ps -a` command and require Nginx Proxy Manager to remain in its pre-validation `Exited (255)` state.

- [ ] **Step 6: Stop at the merge gate**

Report the exact PR head SHA, CI run number, test/build status, and any remaining rollout caveats. Do not merge until the user explicitly chooses to merge.
