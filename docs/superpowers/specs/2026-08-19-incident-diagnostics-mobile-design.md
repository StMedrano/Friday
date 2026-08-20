# FRIDAY Incident Diagnostics + Mobile Dashboard Design

Date: 2026-08-19
Branch: `feature/incident-diagnostics-mobile`
Status: Design approved in chat; written spec awaiting final user review

## 1. Purpose

Extend the current FRIDAY Monitoring & Incidents milestone so FRIDAY can gather safe read-only diagnostic evidence for a real incident, generate deterministic findings and recommendations, and present that information in a purpose-built mobile dashboard.

The milestone preserves FRIDAY's current security posture:

- observe
- detect
- diagnose
- explain
- recommend
- await approval

It does **not** add repair, restart, shell, SSH, Docker mutation, Proxmox mutation, network mutation, or approval-execution capability.

The first production validation target remains the existing `nginx-proxy-manager` incident on VM100 (`192.168.1.124`), currently observed as `Exited (255)`.

## 2. Approved decisions

### 2.1 Diagnostics collection policy

Use the approved hybrid model:

- When a supported container incident opens, FRIDAY automatically gathers safe diagnostic metadata.
- Recent application logs are **not** gathered automatically.
- Logs are fetched only after an explicit user request from the incident UI, initially through an `Inspect Logs` control.
- Raw returned logs remain ephemeral and are not persisted into FRIDAY monitoring state.

### 2.2 Architecture

Extend the existing VM100 observer and VM102 FRIDAY controller.

Do not introduce:

- a separate diagnostics microservice
- SSH-based diagnostics
- arbitrary shell execution
- native Docker TCP exposure

The existing observer remains the only VM100 Docker boundary.

### 2.3 Mobile navigation

At phone widths, replace the fixed left navigation rail with a persistent bottom command bar:

- Home
- FRIDAY
- Infrastructure
- Incidents
- More

`More` contains lower-frequency destinations such as Applications, Agents, Tasks, Approvals, Memory, Audit, and Settings.

### 2.4 Mobile Home priority

Mobile Home is incident/system-health first:

1. active incident attention card
2. system health summary
3. compact FRIDAY command surface
4. infrastructure snapshot
5. prioritized service health

Desktop FRIDAY V3 remains authoritative and must not regress.

### 2.5 Diagnostics rollout flag

The VM102 controller diagnostics subsystem is opt-in at rollout:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

The feature is merged disabled by default. Production rollout explicitly sets it to `true` only after the expanded VM100 observer is healthy. Disabling diagnostics must leave existing monitoring and incident detection operating normally.

The mobile responsive layout does not require a feature flag.

## 3. Existing system boundary

FRIDAY currently uses:

- Proxmox read-only API integration on VM102
- token-authenticated VM100 observer at `192.168.1.124:3199`
- observer local Docker Unix socket access
- `GET /health`
- authenticated `GET /api/v1/containers`
- durable monitoring state under `/data/monitoring-state.json`
- deterministic monitoring rules for offline, degraded, integration-unavailable, and flapping incidents
- GET-only monitoring APIs

The observer currently exposes only sanitized inventory. It does not expose container inspect details or logs.

This milestone expands that observer boundary only through narrowly scoped authenticated GET endpoints.

## 4. Target architecture

```text
VM100 — 192.168.1.124
┌─────────────────────────────────────────┐
│ friday-observer                         │
│                                         │
│ GET /health                             │
│ GET /api/v1/containers                  │
│ GET /api/v1/containers/:id/inspect      │
│ GET /api/v1/containers/:id/logs?tail=N  │
│                                         │
│ Docker Unix socket only                 │
│ explicit fixed GET requests only        │
│ no generic Docker proxy                 │
└────────────────────┬────────────────────┘
                     │ bearer-auth GET only
                     ▼
VM102 — 192.168.1.64
┌─────────────────────────────────────────┐
│ FRIDAY Controller                       │
│                                         │
│ Monitoring Runtime                      │
│      │                                  │
│      └─ incident opened/backfill        │
│             │                           │
│             ▼                           │
│ Diagnostics Engine                      │
│   - automatic safe metadata             │
│   - deterministic findings              │
│   - persisted diagnostic snapshot       │
│   - manual ephemeral logs               │
│                                         │
│ GET /api/incidents/:id/diagnostics      │
│ GET /api/incidents/:id/logs             │
└────────────────────┬────────────────────┘
                     ▼
           FRIDAY V3 responsive UI
             desktop + mobile
```

## 5. Observer diagnostics boundary

### 5.1 New routes

Add exactly these authenticated GET routes:

```text
GET /api/v1/containers/:id/inspect
GET /api/v1/containers/:id/logs?tail=100
```

The existing routes remain unchanged.

### 5.2 Container identity validation

The observer must not act as a generic Docker API proxy.

Before inspect or log retrieval:

1. validate the supplied ID format
2. obtain the current local sanitized container inventory
3. confirm the requested ID uniquely corresponds to a currently known container
4. reject unknown or ambiguous IDs
5. issue only the fixed Docker GET request required for that operation

The user cannot supply arbitrary Docker paths.

### 5.3 Fixed Docker operations

Allowed Docker API operations in this milestone are limited to:

```text
GET /containers/json?all=1
GET /containers/{validated-id}/json
GET /containers/{validated-id}/logs?...bounded-fixed-query...
```

No other Docker endpoint is introduced.

Forbidden examples include:

- `/start`
- `/stop`
- `/restart`
- `/kill`
- `/exec`
- `/archive`
- image creation/removal
- volume operations
- network connect/disconnect
- daemon configuration

### 5.4 Inspect sanitization

The observer must convert raw Docker inspect output into an explicit allowlisted object. It must not forward raw inspect JSON to VM102.

Allowed fields initially include:

- container ID, truncated/current normalized ID
- name
- image name and image ID where safe
- runtime state
- exit code
- OOM-killed boolean
- restart count
- started timestamp
- finished timestamp
- health status
- at most the three most recent health-check entries containing timestamp and exit code only; health-check output text is excluded from automatic metadata
- restart policy name and bounded retry count
- published ports
- Compose project label
- Compose service label
- selected non-secret network names
- observer host name
- diagnostic collection timestamp

Excluded by default:

- environment variables
- full `Config.Env`
- health-check output text
- mounted secret contents
- Docker auth data
- registry credentials
- raw labels outside the existing allowlist
- arbitrary host bind paths
- container filesystem content
- command-line arguments when they may contain credentials
- raw container inspect JSON

If a future diagnostic needs a currently excluded field, it requires a separate reviewed design change.

## 6. Manual logs boundary

### 6.1 Explicit request only

FRIDAY must not automatically fetch logs when an incident opens.

Log retrieval occurs only after the user explicitly requests `Inspect Logs` for an existing supported incident.

### 6.2 Bounds

Initial log request behavior:

- default tail: 100 lines
- maximum allowed tail: 200 lines
- maximum observer response payload for log text: 64 KiB after sanitization; larger output is truncated with an explicit `truncated: true` marker
- no arbitrary `since`, `until`, timestamps, file paths, Docker query parameters, or shell expressions supplied by the client

The controller may request only the fixed bounded tail count. Arbitrary Docker query pass-through is prohibited.

### 6.3 Sanitization

Sanitize returned log text before it reaches the UI.

At minimum redact common patterns for:

- bearer tokens
- API keys
- passwords
- secrets
- authorization headers
- common connection-string password fragments

Sanitization is best-effort and not a substitute for limiting collection scope.

### 6.4 Persistence

Raw log contents are not written to `/data/monitoring-state.json` or another durable FRIDAY store in this milestone.

FRIDAY may persist a small audit metadata event such as:

- incident ID
- service ID/name
- timestamp
- requested tail count
- success/failure

Do not persist raw log text.

## 7. Diagnostic report model

Each supported incident may reference one FRIDAY-owned diagnostic report.

Normalized model:

```text
DiagnosticReport
  id
  incidentId
  source
  host
  serviceId
  serviceName
  collectedAt
  status
  metadata
  facts[]
  findings[]
  likelyCauses[]
  recommendations[]
  logsAvailable
  lastLogInspectionAt
  error
```

### 7.1 Status values

Use these states:

- `pending`
- `available`
- `degraded`
- `unavailable`
- `not-supported`

A diagnostic failure must never close or modify the underlying incident state.

### 7.2 Facts vs findings vs recommendations

FRIDAY must distinguish observed evidence from inference.

**Facts** are direct observations, for example:

- exit code is 255
- OOM killed is false
- restart count is 0
- state is exited

**Findings** are deterministic interpretations, for example:

- failure appears isolated to this service
- process is running but health check is failing
- the container has restarted multiple times

**Recommendations** are non-executing next steps, for example:

- inspect recent application logs
- review recent configuration/deployment changes
- verify memory pressure on the host

The UI must label these categories clearly.

## 8. Automatic diagnostic trigger

When diagnostics are enabled and the monitoring engine opens a supported container incident, FRIDAY queues a single safe metadata collection attempt.

Supported initial incident types:

- `service-offline`
- `service-degraded`
- `service-flapping` where the service maps to VM100 observer inventory

Integration-unavailable incidents do not attempt container diagnostics because the observer itself may be unavailable.

### 8.1 Deduplication

For a given incident occurrence:

- do not repeatedly fetch inspect metadata on every 30-second monitoring poll
- collect on initial incident open
- no manual metadata-refresh endpoint is part of this milestone

### 8.2 Recurrence

If an incident resolves and a later recurrence creates a new incident ID, the new occurrence gets a new diagnostic snapshot.

### 8.3 Existing incident backfill

At diagnostics startup, detect existing open supported incidents that lack a diagnostic report and perform one safe metadata collection attempt for each. Once a report exists, normal polling must not repeatedly backfill it.

This requirement allows the already-open Nginx Proxy Manager incident to be the production validation case without closing or recreating it.

## 9. Initial deterministic diagnostic rules

Keep first-generation diagnosis small and explainable.

### 9.1 OOM termination

Condition:

```text
OOMKilled = true
```

Finding:

```text
The container was terminated by the kernel due to memory pressure.
```

Recommendation:

```text
Inspect host/container memory pressure and recent workload changes before considering remediation.
```

### 9.2 Non-zero exit without OOM

Condition:

```text
state = exited
exitCode != 0
OOMKilled = false
```

Finding:

```text
The container exited with an application/startup failure rather than an OOM termination.
```

Recommendation:

```text
Inspect recent sanitized application logs and recent configuration/deployment changes.
```

### 9.3 Restart evidence and flapping

If `restartCount >= 3`, FRIDAY may state as a fact/finding that the container has restarted multiple times. It must not label this alone as a timed crash loop because Docker's historical restart count does not establish when those restarts occurred.

A stronger `repeatedly restarting/changing state` finding requires the existing `service-flapping` incident or equivalent recent FRIDAY transition evidence.

Recommendation:

```text
Inspect recent logs and dependency/configuration health before any restart action.
```

### 9.4 Running but unhealthy

Condition:

```text
state = running
health = unhealthy
```

Finding:

```text
The container process is running, but its configured health check is failing.
```

Recommendation:

```text
Inspect health-check status, service dependencies, and recent logs.
```

### 9.5 Isolated service failure

Condition:

- affected service is unhealthy
- observer integration is available
- at least two other VM100 services are online in the same normalized overview

Finding:

```text
The failure appears isolated to this service rather than a host-wide Docker outage.
```

This must be phrased as an inference, not an observed fact.

## 10. Controller API

Add read-only incident-scoped controller routes:

```text
GET /api/incidents/:incidentId/diagnostics
GET /api/incidents/:incidentId/logs
```

### 10.1 Diagnostics response

Returns the persisted safe diagnostic report for that incident.

If automatic collection is still pending, return a normalized pending response rather than 404.

If the incident exists but diagnostics are unsupported, return `not-supported`.

If collection failed, return `unavailable` or `degraded` with a sanitized error.

When `FRIDAY_DIAGNOSTICS_ENABLED=false`, return a normalized disabled/not-supported response without calling the observer.

### 10.2 Logs response

The controller must:

1. verify diagnostics are enabled
2. verify the incident exists
3. verify it maps to a supported VM100 container
4. call the observer log endpoint using the fixed default tail of 100 lines
5. return sanitized ephemeral logs plus `truncated` metadata
6. record only log-inspection audit metadata

Unknown incident IDs return 404.

Unsupported incidents return a clear non-success response without provider calls.

### 10.3 No diagnostic mutation endpoints

Do not add POST/PUT/PATCH/DELETE diagnostics routes in this milestone.

No endpoint may trigger restart, repair, start, stop, exec, image pull, Compose deployment, Proxmox action, or network change.

## 11. Monitoring-state persistence changes

Extend FRIDAY-owned monitoring state to store diagnostic reports or an incident-to-report map.

The state remains versioned and atomic-file persisted.

Requirements:

- preserve existing incident/history data during schema upgrade
- add explicit normalization/migration behavior for pre-diagnostics state
- persist only sanitized metadata/findings/recommendations
- do not persist raw logs
- preserve existing bounded monitoring history behavior

If the schema version changes, startup must normalize prior state rather than discard it.

## 12. Error handling

Diagnostics are subordinate to monitoring.

### Observer inspect failure

- incident remains open
- report becomes `unavailable` or `degraded`
- store sanitized error only
- monitoring polling continues
- controller remains healthy

### Log fetch failure

- no incident-state mutation
- UI displays a read-only diagnostic error
- record optional metadata-only log-inspection failure event

### Observer unavailable

- existing integration incident behavior remains authoritative
- do not fabricate diagnostics
- affected diagnostic report may be unavailable

### Corrupt/legacy diagnostic persistence

Use the same safe-state philosophy as monitoring:

- controller must continue running
- preserve unrelated incident/history state
- normalize missing diagnostics fields to an empty diagnostics structure
- never discard the whole monitoring state merely because diagnostics fields are absent or malformed

## 13. Mobile dashboard goals

Create a purpose-built mobile operations experience inspired by the user-provided reference while retaining FRIDAY's existing dark futuristic visual identity.

This is a responsive presentation of the existing FRIDAY app, not a second frontend application.

### 13.1 Phone layout

At phone widths, remove the fixed left rail completely.

Use:

- compact sticky top header
- single-column content
- persistent bottom command bar
- safe-area padding
- touch-friendly controls

Target common phone widths around 360–430 px during validation.

### 13.2 Bottom command bar

Primary destinations:

```text
Home | FRIDAY | Infrastructure | Incidents | More
```

Requirements:

- active state visible through icon + text/state, not color alone
- minimum practical touch target approximately 44 px
- incident badge when active incidents exist
- respect iOS/Android bottom safe areas
- remain reachable without horizontal scrolling

### 13.3 More menu

Expose lower-frequency areas:

- Applications
- Agents
- Tasks
- Approvals
- Memory
- Audit
- Settings

The More experience may be a sheet, drawer, or dedicated menu screen, but it must be phone-friendly and keyboard/accessibility compatible. The implementation plan may choose among those presentation forms without changing the information architecture.

## 14. Mobile Home information hierarchy

### 14.1 Active incident first

If active incidents exist, the first major operational card after the header shows the highest-priority incident.

Example:

```text
ATTENTION REQUIRED
1 HIGH INCIDENT
nginx-proxy-manager
VM 100 · Offline
[View Diagnosis]
```

If no incidents exist, show a concise nominal system-health state instead of an empty alert container.

### 14.2 System health summary

Show compact, scannable operational metrics such as:

- health percentage
- online/total services
- active incidents
- site count

### 14.3 FRIDAY command surface

The current large animated desktop FRIDAY core must be reduced on phones.

Phone treatment:

- compact FRIDAY identity/core indicator
- command input or launch surface
- current read-only/live mode context
- enough visual identity to feel like FRIDAY without consuming most of the first viewport

### 14.4 Infrastructure snapshot

Show a short prioritized list/cards for important infrastructure such as:

- Proxmox
- VM100
- VM102
- other key hosts/services when represented in current normalized overview

Do not invent provider data the API does not expose.

### 14.5 Service health

Prioritize unhealthy/degraded services first.

Do not dump the complete service inventory onto the first phone viewport.

Provide `View all` navigation to the full Applications/Infrastructure area.

## 15. Mobile incident detail

Tapping `View Diagnosis` or an incident card opens a mobile-optimized incident detail view.

Required order:

1. incident title/severity/status
2. host/service and duration
3. diagnostic facts
4. deterministic FRIDAY findings
5. recommendations
6. `Inspect Logs` read-only control
7. safety authority label

Example:

```text
NGINX PROXY MANAGER
HIGH · OFFLINE
VM100

Diagnosis
Exit code      255
OOM killed     No
Restart count  0
Finished       2 days ago
Health         unavailable

FRIDAY FINDING
The failure appears isolated to this container.

RECOMMENDED NEXT STEP
Inspect recent application logs.

[ Inspect Logs ]

READ ONLY
No remediation was executed.
```

The user must never mistake `Inspect Logs` for a repair action.

## 16. Desktop/tablet behavior

Desktop FRIDAY V3 remains authoritative.

Requirements:

- preserve existing left rail and desktop command-center layout at desktop widths
- preserve current Incidents workspace concepts
- extend incident details with diagnostics without redesigning unrelated screens
- avoid desktop regressions while introducing mobile-specific navigation

Tablet behavior may retain the desktop rail until the phone breakpoint if that produces the cleanest layout.

The implementation plan should choose and test one explicit phone breakpoint based on the current CSS structure rather than introducing many overlapping breakpoints.

## 17. Accessibility and interaction requirements

- no horizontal scrolling at tested phone widths
- severity communicated with text/icon/state, not color alone
- useful visible focus states
- semantic buttons for interactive controls
- bottom bar controls have accessible names
- `More` can be operated by keyboard where applicable
- log output uses readable monospaced formatting and wraps/scrolls internally without breaking page width
- reduced-motion preference disables or reduces decorative FRIDAY core rotation/pulsing

## 18. Security requirements

This milestone must preserve all existing protections and add diagnostics-specific CI checks.

CI/source checks should fail if diagnostics code introduces:

- Docker mutation endpoint strings
- generic Docker proxy path construction from user input
- POST/PUT/PATCH/DELETE diagnostic action routes
- `docker exec` / shell execution paths
- SSH diagnostic execution
- raw environment-variable forwarding
- browser-visible observer credentials

The existing observer bearer token remains server-side only.

## 19. Testing strategy

Use TDD for implementation.

### 19.1 Observer tests

Cover:

- authenticated inspect success
- authenticated logs success
- missing/invalid token -> 401
- unknown container -> safe 404
- non-GET methods -> 404
- inspect allowlist excludes env/raw sensitive fields
- automatic health metadata excludes health output text
- bounded ports/network output
- tail defaults and maximum enforcement
- 64 KiB log-response cap and explicit truncation flag
- log secret redaction
- no arbitrary Docker query pass-through
- source-level absence of Docker mutation API paths

### 19.2 Controller diagnostics tests

Cover:

- diagnostics disabled is inert and does not call the observer
- automatic diagnostic collection when supported incident opens
- one-time backfill of supported existing open incidents
- no repeated inspect fetch on every monitoring poll
- new diagnostic snapshot for later incident recurrence
- unsupported incident behavior
- observer failure -> diagnostic unavailable while monitoring remains healthy
- deterministic rules for OOM, non-zero exit, restart evidence, unhealthy health check, and supported isolation inference
- fact/finding/recommendation separation
- diagnostic state migration/persistence/reload
- raw logs never appear in persisted monitoring state
- unknown incident logs request -> 404
- log observer failure remains non-mutating

### 19.3 API tests

Cover GET-only behavior for:

```text
/api/incidents/:id/diagnostics
/api/incidents/:id/logs
```

Explicitly prove POST/PUT/PATCH/DELETE variants do not exist.

### 19.4 Frontend tests

Cover:

- active incident appears before FRIDAY command surface on mobile Home
- bottom nav contains Home, FRIDAY, Infrastructure, Incidents, More
- left rail hidden at phone layout
- incident badge behavior
- More exposes lower-frequency destinations
- mobile diagnosis renders facts, findings, recommendations
- `Inspect Logs` fetches and displays read-only log result
- logs failure displays safely
- no restart/repair/execute control is rendered
- nominal Home when no active incidents
- desktop navigation/layout remains present at desktop behavior

Use component-level tests and layout-class/state assertions suitable for JSDOM. Use browser/e2e or screenshot validation if available in the repository/tooling for true responsive overflow checks.

## 20. CI verification

Final branch verification must include:

- full `npm test`
- production TypeScript/Vite build
- shell syntax validation
- observer security boundary checks
- monitoring security boundary checks
- new diagnostics security boundary checks
- base controller Compose validation
- local-Docker override Compose validation
- VM100 observer Compose validation
- controller image build
- observer image build

Do not claim completion without fresh evidence from the exact PR head.

## 21. Production rollout

Roll out in two controlled phases.

### Phase 1 — observer capability

On VM100:

1. pull merged observer changes only after PR merge
2. preserve current observer `.env` and token
3. validate Compose
4. rebuild/recreate only `friday-observer`
5. verify `/health`
6. verify existing `/api/v1/containers` still works
7. test inspect/log endpoints read-only against the existing NPM container
8. verify NPM remains exited and untouched

### Phase 2 — VM102 controller/UI

On VM102:

1. pull merged `main`
2. preserve current live `.env`
3. run preflight
4. rebuild/recreate only FRIDAY with base Compose while `FRIDAY_DIAGNOSTICS_ENABLED=false`
5. keep `FRIDAY_DOCKER_ENABLED=false`
6. keep monitoring enabled
7. verify Proxmox + observer integrations and existing monitoring incident remain healthy
8. set `FRIDAY_DIAGNOSTICS_ENABLED=true`
9. recreate only FRIDAY with base Compose
10. verify the existing open NPM incident receives its one-time backfilled diagnostic report
11. verify manual logs display
12. verify NPM remains exited and untouched
13. verify mobile dashboard at phone width/device

Do not restart Nginx Proxy Manager during validation.

## 22. Rollback

Controller rollback:

```env
FRIDAY_DIAGNOSTICS_ENABLED=false
```

Then recreate only FRIDAY with base Compose. Existing monitoring, incidents, and monitoring state remain intact. Persisted sanitized diagnostic reports may remain in state for inspection.

Observer rollback:

- redeploy the previous known-good observer revision if necessary
- preserve observer `.env` and bearer token
- the inventory endpoint remains the minimum production contract
- controller diagnostics must degrade safely if inspect/log routes are unavailable

Rollback never requires changing the NPM container or other managed infrastructure.

## 23. Non-goals

Not part of this milestone:

- automatic restart/repair
- approval execution
- manual diagnostic metadata refresh endpoint
- arbitrary shell access
- SSH diagnostics
- Docker exec
- generic Docker API proxy
- Proxmox write actions
- firewall/DNS/VLAN changes
- automatic continuous log ingestion
- persistent raw log storage
- log search across historical archives
- AI-generated infrastructure execution
- full root-cause certainty claims
- notification delivery
- authentication/RBAC redesign
- desktop-wide visual redesign unrelated to incident diagnostics/mobile behavior

## 24. Success criteria

The milestone is successful when all of the following are true:

1. VM100 observer exposes only the approved additional authenticated GET inspect/log routes.
2. Raw Docker inspect payloads are never forwarded to VM102.
3. Automatic safe metadata collection occurs once for a newly opened supported incident.
4. Existing open supported incidents receive one safe diagnostic backfill after diagnostics is enabled.
5. FRIDAY persists sanitized diagnostic facts/findings/recommendations tied to the incident.
6. Manual `Inspect Logs` returns at most 100 requested lines and no more than 64 KiB of sanitized log text, with truncation indicated when needed.
7. Raw log text is never persisted.
8. The existing NPM incident receives a real diagnostic report without changing its `Exited (255)` container state.
9. FRIDAY clearly separates observed facts from deterministic findings and recommendations.
10. No diagnostic path can start, stop, restart, exec, remove, deploy, or otherwise mutate infrastructure.
11. Phone Home is incident/system-health first.
12. Phone navigation uses the approved bottom command bar and removes the fixed left rail.
13. Mobile incident detail exposes diagnosis and manual log inspection cleanly at 360–430 px widths without horizontal page overflow.
14. Desktop V3 behavior remains intact.
15. Full CI verification passes on the exact PR head before merge.

## 25. Desired operational result

For the current production incident, the target experience is:

```text
VM100 nginx-proxy-manager remains Exited (255)
        │
        ▼
FRIDAY incident already open
        │
        ▼
automatic one-time safe inspect backfill
        │
        ▼
Facts
- state: exited
- exit code: 255
- OOM killed: false
- restart count: observed value
        │
        ▼
Deterministic finding
- application/startup failure likely
- failure appears isolated if neighboring services are healthy
        │
        ▼
Recommendation
- inspect recent application logs
        │
        ▼
User taps Inspect Logs
        │
        ▼
bounded sanitized ephemeral logs
        │
        ▼
READ ONLY — NO REMEDIATION EXECUTED
```

On a phone, this incident and its diagnosis are the highest-priority content on the FRIDAY Home/Incidents experience.
