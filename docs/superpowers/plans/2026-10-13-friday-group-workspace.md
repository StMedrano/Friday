# Friday Group Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (preserved execution method) to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Show TechTactics, App Builder and HomeLab in Friday with truthful member availability, without activating new workers or infrastructure actions.
**Architecture:** Add a versioned display-only catalog and project its members against the existing read-only registry. Serve it behind the existing Access boundary and render group selection inside Agents. No task/customer/memory records are exposed until their trusted actor bindings are implemented in a later plan.
**Tech Stack:** Node 22 ESM, React 18, TypeScript, Vite, node:test and existing Vitest/Testing Library. No new dependencies.
**Spec:** ../specs/2026-10-13-friday-unified-agent-groups-design.md
**Status:** Proposed plan for operator review. Design accepted through the 2026-10-13 continuation request; plan approval remains separate.

## Global Constraints
- Preserve Agent Spec v1.1, Phase 1 local-only advisory behavior and the existing registry schema.
- Phase 2C remains dormant; no agent-assignments, policy grants, enabled plugins or fabric runtime wiring.
- Catalog/display membership never authorizes group memory, customer records or executable tools.
- Runtime credentials remain server-side; no VITE secrets, new provider or paid service.
- Proposed role files are not running workers. Registry-enabled means configured, not ready/busy/active.
- PR #29 remains independent; deploy this slice only after its reviewed security boundary is released.
- No homelab access is needed for implementation. No production/staging deployment occurs during development.
- Group workspace, HomeLab telemetry activation, Web Growth integration and controlled actions have separate plans.
- Preserve the selected subagent-driven workflow; implementer and reviewer do not share a task context.

## Review Focus
- Registry outage must retain declared groups and mark linked members unavailable, without inventing live data.
- Proposed/unbound roles must never become configured because a same-named registry entry appears.
- Invalid/duplicate catalog IDs and unknown fields must reject the catalog rather than partially load it.
- Authentication failure must occur before registry reads; public health remains unchanged.
- Navigation, request cancellation and keyboard selection must not show a previous group's stale state.

## File Map
- Create server/agents/group-catalog.json: versioned display metadata, not policy/assignment manifests.
- Create server/agents/group-workspace.mjs and .test.mjs: validation and registry projection.
- Modify server/http.mjs; create server/http.groups.test.mjs: authenticated GET-only API.
- Modify src/lib/api.ts; create src/lib/api.groups.test.ts: typed client contract.
- Modify src/components/AgentsWorkspace.tsx and its existing test: group/member navigation.
- Modify src/agents.css: reuse existing visual system with responsive group controls.
- Modify src/pages/Dashboard.tsx; create src/pages/Dashboard.agent-status.test.tsx: truthful overview/automation copy.
- Modify docs/codex/BUILD_STATUS.md and docs/codex/NEXT_STEPS.md in the feature PR at completion.

## Contract
GET /api/agent-groups returns:
```ts
type GroupMember = {
 id: string; name: string; agentId: string | null;
 implementation: 'existing' | 'planned';
 state: 'catalogued' | 'configured' | 'disabled' | 'unavailable';
 reason: string;
}
type GroupWorkspace = {
 schemaVersion: '1'; registryStatus: 'ok' | 'unavailable';
 executionEnabled: false;
 workStatus: 'not-connected';
 groups: Array<{id: string; name: string; members: GroupMember[]}>;
}
```
IDs: techtactics, app-builder, homelab. Only HomeLab's Proxmox Observer initially binds agentId=proxmox-observer. All other members have null binding and implementation=planned. Exact role names match the spec. No instruction bodies, credentials, customer data, owner/group memory or unrestricted registry records appear in this response.

### Task 1: Display catalog and honest availability
**Files:** server/agents/group-catalog.json; server/agents/group-workspace.mjs; server/agents/group-workspace.test.mjs.
**Interfaces:** validateGroupCatalog(value: unknown) returns validated catalog or throws; getGroupWorkspace({catalog, registryService}) returns Promise<GroupWorkspace>. registryService.list() uses the existing service interface.
- [ ] Write failing tests named catalog_contains_three_requested_groups, only_proxmox_has_runtime_binding, unknown_fields_or_duplicate_ids_reject, proposed_role_does_not_bind_by_name, registry_failure_marks_bound_member_unavailable, disabled_registry_member_is_disabled. Assert exactly three IDs, seven TechTactics members, five App Builder members and seven HomeLab members; executionEnabled=false and workStatus=not-connected.
- [ ] Run node --test server/agents/group-workspace.test.mjs. Confirm failures identify missing implementation.
- [ ] Implement strict schemaVersion=1 validation with exact keys; canonical lowercase/hyphen IDs of 3–64 chars; nonempty display names of at most 80 chars; at most 8 groups and 40 total members; reject duplicate member IDs, invalid binding/implementation pairs and unexpected fields. Validate the immutable JSON import; do not read browser-selected paths.
- [ ] Implement projection: null bindings remain catalogued regardless of registry names; exact registered binding maps enabled to configured and disabled to disabled; missing binding is unavailable; registry read failure is unavailable. Never report worker readiness or invoke inference/sync.
- [ ] Run focused tests, inspect the projected DTO for source/secret leakage, and commit the task.

### Task 2: Protected read API and typed client
**Files:** server/http.mjs; server/http.groups.test.mjs; src/lib/api.ts; src/lib/api.groups.test.ts.
**Interfaces:** GET /api/agent-groups returns the contract; fetchFridayAgentGroups(signal?: AbortSignal): Promise<GroupWorkspace>.
- [ ] Write failing HTTP tests for anonymous 401 with zero registry calls, unconfigured live Access 503, signed viewer 200 with display metadata only, POST denied/unsupported without side effects, and malformed URL rejection remaining intact. Mock mode may expose synthetic/nonprivate display metadata; live mode must use the established signed Access boundary.
- [ ] Write client tests for 200 contract, 401/503 rejection, malformed response rejection and AbortSignal propagation. No fallback that pretends a failed live request succeeded.
- [ ] Run node --test server/http.groups.test.mjs and npx vitest run src/lib/api.groups.test.ts; confirm RED.
- [ ] Add the fixed GET route after authentication. Reuse the registry dependency and JSON no-store response helper. Do not add a write, sync, task/memory or worker endpoint; do not broaden health exceptions.
- [ ] Add TypeScript types and client response validation for schema version, exact group IDs, members and executionEnabled=false. Handle errors as unavailable with bounded user-facing messages.
- [ ] Run focused tests plus all server/security tests and commit.

### Task 3: Groups inside the existing Agents workspace
**Files:** src/components/AgentsWorkspace.tsx; src/components/AgentsWorkspace.test.tsx; src/agents.css.
**Interfaces:** consume fetchFridayAgentGroups and existing registry/ask functions. Existing registered-agent detail and advisory ask remain accessible.
- [ ] Write failing UI tests for all three group labels/role counts, HomeLab Proxmox binding, planned-role disabled ask, unavailable registry message, keyboard group selection, request cancellation and no stale selected detail when switching groups. Assert no execution/approval/send controls are added.
- [ ] Run npx vitest run src/components/AgentsWorkspace.test.tsx; confirm RED.
- [ ] Add accessible group controls and member cards. Distinguish Planned, Configured, Disabled and Unavailable. Show grouped member detail plus existing advisory agent detail only for an exact valid binding. Keep ungrouped registered agents accessible in an All registered agents view without inventing policy membership.
- [ ] Display Work integration not connected for this slice; no fake task/artifact summaries. Use the existing spacing/type/colors and responsive layouts, including full-width mobile controls and visible focus.
- [ ] Preserve existing ask/sync denial semantics; switching group clears the prior selected answer. Clean up aborted effects without post-unmount state changes.
- [ ] Run focused tests plus npm run build; commit.

### Task 4: Truthful overview and release evidence
**Files:** src/pages/Dashboard.tsx; src/pages/Dashboard.agent-status.test.tsx; docs/codex/BUILD_STATUS.md; docs/codex/NEXT_STEPS.md.
**Interfaces:** reuse GroupWorkspace through the typed client; do not add an automation endpoint.
- [ ] Write failing tests that the overview does not label Monitoring/Infrastructure/Security as active workers from hardcoded rows, does not imply the local Automation checkbox controls a server policy, and links to Agents for real configuration status. Test unavailable API and phone navigation.
- [ ] Run npx vitest run src/pages/Dashboard.agent-status.test.tsx; confirm RED.
- [ ] Replace hardcoded agent readiness with registry-backed configured counts and a link to the group workspace. Replace the simulated automation switch with truthful Actions not enabled status. Do not claim configured agents are executing jobs.
- [ ] Run npm test, npm run build, npm run validate:fabric-catalog, npm run verify:fabric-dormant, both schema validators, disposable shared-work PostgreSQL checks and fixture Compose validation. Run FRIDAY_DOCKER_SOCKET_GID=999 make verify with synthetic validation values only; production secrets are not needed.
- [ ] Update handoff docs with exact implementation/test evidence and explicit remaining activation steps. Commit and publish to a separate feature PR stacked on the verified PR #29 candidate until that candidate merges.
- [ ] Obtain separate task/whole-branch reviews and passing exact-head CI. Preview built mock UI without live credentials; authenticated live acceptance waits for authorized access.
- [ ] Stop before production merge/deployment. Record release prerequisites, immutable rollback target and follow-on plan boundaries.

## Follow-on plans
1. HomeLab read-only activation: verify live Proxmox/observer/local inference state and add missing adapters individually.
2. Private Web Growth read integration: authenticate/project the existing backend, preserve leads and send state; no data move or customer outreach.
3. Authorized group work: establish trusted actor/project/group bindings before exposing Phase 2B records.
4. Controlled HomeLab actions: roles, durable audit/approvals, narrow worker/tools, idempotency, cancellation and before/after verification; first separately approved disposable staging restart.
No task in this plan substitutes for these subsystems.

## Self-review
This plan implements only the spec's first workspace slice; later telemetry, business records and execution remain explicit follow-ons. Contracts use the same names and states throughout. Each review-focus condition has a task-owned test. No live VM, model, credential, new database grant or network mutation is required.
