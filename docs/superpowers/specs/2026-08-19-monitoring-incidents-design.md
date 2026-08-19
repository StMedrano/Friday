# FRIDAY Monitoring & Incidents Design

Date: 2026-08-19
Status: Approved design captured for implementation review
Branch: `feature/monitoring-incidents`
Base: `main` at `ba562888bc7a59b830c7722caa15e9c3a6d9442b`

## Purpose

Turn FRIDAY's current live read-only infrastructure inventory into a persistent monitoring and incident system that can detect unhealthy services, preserve health history, surface active incidents in the UI, and recommend safe next actions without executing infrastructure changes.

The first production validation case is the already-detected `nginx-proxy-manager` container on VM100, which currently reports `offline` from the read-only VM100 observer.

## Safety Boundary

This milestone remains read-only with respect to infrastructure.

FRIDAY may:

- poll existing read-only Proxmox and VM100 observer integrations;
- persist FRIDAY-owned monitoring state under `/data`;
- create, update, and resolve FRIDAY incident records;
- present deterministic diagnostic context and recommended next steps;
- expose read-only monitoring and incident APIs.

FRIDAY may not:

- restart, stop, start, remove, exec into, or modify containers;
- modify Proxmox guests, networking, firewall, DNS, storage, or credentials;
- add Docker mutation routes;
- expose the native Docker API;
- expand the VM100 observer beyond its currently approved `/health` and `/api/v1/containers` endpoints in this milestone;
- execute a recommended action.

Remote log retrieval is deliberately deferred because the approved observer contract currently exposes only health and sanitized container inventory. Adding remote logs requires a separately reviewed observer-interface change.

## Approaches Considered

### A. In-memory monitoring only

Lowest implementation cost, but incident history disappears whenever FRIDAY restarts. This does not satisfy the requirement for health history or an audit trail.

### B. File-backed durable monitoring state under `/data` — selected

Use a small, atomic JSON state file in the existing persistent `friday_data` Docker volume. This adds no native database dependency, survives container recreation, is easy to inspect and back up, and keeps this milestone focused. The storage interface will be isolated so PostgreSQL can replace it later without changing incident/rule logic.

### C. PostgreSQL now

Best long-term persistence model, but it adds database provisioning, schema migration, credentials, availability, and rollout concerns before the monitoring domain is stable. PostgreSQL remains the planned later migration target.

## Architecture

```text
Existing read-only adapters
  Proxmox API
  VM100 observer
  endpoint checks
        |
        v
buildOverview(config)
        |
        v
Monitoring Runtime (background poll)
  - captures latest overview
  - evaluates service/integration observations
  - updates incident engine
  - writes durable state atomically
        |
        +--------------------+
        |                    |
        v                    v
Incident Store          Cached live overview
/data/monitoring-       + monitoring summary
state.json                   |
                             v
                    Read-only FRIDAY APIs
                    /api/overview
                    /api/incidents
                    /api/monitoring/history
                             |
                             v
                     FRIDAY V3 dashboard
```

The runtime is the only background poller when monitoring is enabled. The UI consumes the cached live overview rather than creating a second independent monitoring loop.

If monitoring is disabled or has not completed its first poll, `/api/overview` falls back to the existing direct `buildOverview(config)` behavior.

## Components

### 1. Monitoring configuration

Add server-only settings:

- `FRIDAY_MONITORING_ENABLED=false`
- `FRIDAY_MONITORING_POLL_SECONDS=30`
- `FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS=300`
- `FRIDAY_MONITORING_STATE_PATH=/data/monitoring-state.json`
- `FRIDAY_MONITORING_HISTORY_LIMIT=2000`

Monitoring is opt-in at rollout. Enabling it grants no infrastructure mutation capability.

### 2. Monitoring runtime

A focused runtime module owns:

- immediate first poll on startup when enabled;
- recurring polling using the configured interval;
- the latest successfully collected overview;
- current monitoring summary;
- incident evaluation;
- persistence after state changes;
- controlled error handling so a failed adapter or persistence write does not terminate FRIDAY.

Only one poll may run at a time. If a prior poll is still running, the next interval is skipped rather than overlapped.

### 3. Incident engine

The engine is deterministic and testable independently from HTTP and timers.

Each service observation is keyed by stable FRIDAY service ID. The engine tracks:

- current status;
- first observed at;
- last observed at;
- status-change timestamp;
- consecutive observations in the current status;
- bounded recent transition timestamps.

Incident records contain:

- `id`
- `fingerprint`
- `type`
- `title`
- `detail`
- `severity`
- `status` (`open` or `resolved`)
- `source`
- `host`
- `serviceId`
- `serviceName`
- `firstSeen`
- `lastSeen`
- `openedAt`
- `resolvedAt`
- `recommendedAction`
- `evidence`

Opening the same condition again updates the existing open incident rather than creating duplicates. A resolved condition may create a new incident if it later reoccurs.

### 4. Initial rules

#### Service offline

If a service remains `offline` for the configured grace period, open a `service-offline` incident.

Default severity: `high`.

Recommended action is advisory only, for example: inspect the affected Compose project, status, recent deployment context, and logs through an approved diagnostic path; if a restart is later proposed, require the approval workflow before execution.

#### Service degraded

If a service remains `degraded` for the same grace period, open a `service-degraded` incident.

Default severity: `warning`.

#### Integration unavailable

If the live overview reports an integration-degraded alert for a configured integration such as Proxmox or VM100 observer, open an `integration-unavailable` incident immediately. This is not delayed by the service grace period because loss of observability itself is important.

Default severity: `high`.

#### Service flapping / repeated restart behavior

Track status transitions. If the same service changes between healthy and unhealthy states at least three times inside a 15-minute window, open a `service-flapping` incident.

Default severity: `warning`.

This rule uses FRIDAY-observed state transitions and does not depend on parsing vendor-specific Docker status strings.

### 5. Resolution behavior

An open service incident resolves automatically after the condition is healthy on a subsequent poll. The history records both opening and resolution.

A flapping incident resolves after the transition window expires with no further qualifying instability.

Incidents are not manually acknowledged, muted, deleted, or closed in this milestone. Those are future workflow mutations and should be added only with explicit product semantics and authorization.

### 6. Durable store

Create a storage interface with a file implementation backed by `/data/monitoring-state.json`.

Writes use temp-file + rename semantics so FRIDAY never intentionally replaces the primary state file with a partially written document.

Persist:

- schema version;
- service observation state;
- incidents;
- bounded monitoring history.

History is capped by `FRIDAY_MONITORING_HISTORY_LIMIT` with oldest entries removed first.

If the state file is absent, start empty. If it cannot be parsed, FRIDAY logs a warning, preserves the bad file as a timestamped `.corrupt-*` file when possible, and starts with empty monitoring state rather than crashing the controller.

### 7. Monitoring history / audit events

Record deterministic events for:

- `service-status-changed`
- `incident-opened`
- `incident-resolved`
- `integration-degraded`
- `integration-recovered`
- `monitoring-poll-failed`

Each event includes a timestamp, source, host/service context where applicable, and a concise detail string. No secrets or raw adapter credentials are stored.

### 8. API changes

All new monitoring endpoints are GET-only.

#### `GET /api/incidents`

Returns active incidents first, followed by recently resolved incidents, plus summary counts.

#### `GET /api/monitoring/history`

Returns the most recent bounded monitoring events. Initial implementation may use a fixed server-side maximum rather than arbitrary user-controlled pagination.

#### `GET /api/overview`

When monitoring is enabled, return the cached live overview decorated with:

- `incidents`
- `monitoring` summary
- active incident-derived alerts

Existing `services`, `integrations`, `alerts`, `resources`, and `activities` remain compatible.

No POST/PUT/PATCH/DELETE monitoring action endpoint is introduced.

### 9. UI behavior

The existing V3 visual language remains authoritative.

#### Overview

Add an Active Incidents section that prioritizes:

- severity;
- affected service and host;
- duration / first seen;
- concise evidence;
- recommended next action;
- clear `READ ONLY` / `REQUIRES APPROVAL TO ACT` labeling.

The existing system-health area uses active incident count rather than treating all alerts as equivalent.

#### Incidents navigation

Replace the generic Incidents detail view with a real incident workspace showing:

- active incidents;
- recently resolved incidents;
- current monitoring status;
- recent health-history events.

No button performs an infrastructure action. A future action affordance may visually say `Propose action` only after the approval subsystem is designed; it is not part of this milestone.

### 10. Nginx Proxy Manager validation case

With VM100 observer live and `nginx-proxy-manager` reporting `offline`, monitoring should:

1. observe the offline state;
2. retain first-seen state across polls and controller recreation;
3. after the configured grace period, create one open `service-offline` incident;
4. show VM100 and `nginx-proxy-manager` as the affected host/service;
5. recommend investigation and a future approval-gated remediation path;
6. not restart or modify the container;
7. automatically resolve the incident if the observer later reports the service `online`.

Tests use a zero/short grace period and fake time so they do not wait five real minutes.

## Error Handling

- Adapter failure: keep FRIDAY server alive, record integration incident/history, and continue future polls.
- Store write failure: keep in-memory monitoring state, record/log the failure, and retry on future changes.
- Store parse failure: preserve/quarantine the invalid file where possible and start empty.
- Overlapping poll: skip the later poll.
- Monitoring disabled: no background timer, no state-file mutation, existing overview behavior preserved.
- UI/API failure: existing safe fallback remains; no infrastructure action is attempted.

## Testing Strategy

Follow TDD. Add failing tests before each behavior.

Server tests cover:

- offline grace period;
- degraded grace period;
- automatic resolution;
- duplicate suppression;
- reoccurrence after resolution;
- integration-unavailable incident;
- integration recovery;
- flapping threshold/window;
- persistence round trip;
- corrupt-store recovery;
- bounded history;
- runtime immediate poll and no overlapping polls;
- monitoring-disabled inert behavior;
- GET-only incidents/history routes;
- overview decoration and backward compatibility.

Frontend tests cover:

- active incident rendering;
- offline Nginx Proxy Manager incident presentation;
- resolved-history rendering;
- no executable remediation button;
- graceful behavior when monitoring data is absent.

Build verification includes:

- `npm test`
- `npm run build`
- shell syntax checks;
- Compose configuration;
- controller Docker image build;
- source-level security checks that monitoring introduces no infrastructure mutation routes or Docker mutation paths.

## Rollout

1. Merge only after full branch verification.
2. Update VM102 from `main` with monitoring still disabled.
3. Confirm existing Proxmox and VM100 observer integrations remain healthy.
4. Set monitoring configuration on VM102 and enable `FRIDAY_MONITORING_ENABLED=true`.
5. Recreate only the FRIDAY controller using base `compose.yaml`; do not use the local-Docker override.
6. Confirm `/api/overview`, `/api/incidents`, and monitoring history.
7. Wait through the configured offline grace period and verify the Nginx Proxy Manager incident appears.
8. Confirm no VM100 container state changed as a consequence of monitoring.

Rollback is disabling `FRIDAY_MONITORING_ENABLED`, recreating FRIDAY, and leaving the persistent monitoring state file untouched for later inspection.

## Non-goals

This milestone does not implement:

- automatic repair;
- restart buttons;
- approval execution;
- remote log retrieval;
- SSH command execution;
- Docker mutation APIs;
- incident acknowledgement/muting;
- notification delivery outside the FRIDAY UI;
- PostgreSQL migration;
- AI-generated infrastructure actions.

## Success Criteria

The milestone is complete when FRIDAY continuously monitors the existing read-only integrations, persists health state across controller recreation, creates and resolves deterministic incidents, exposes GET-only incident/history APIs, renders those incidents in the V3 UI, identifies the existing VM100 Nginx Proxy Manager outage after the configured grace period, and performs no infrastructure mutation.