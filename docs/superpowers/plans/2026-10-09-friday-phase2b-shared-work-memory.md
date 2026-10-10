# Friday Phase 2B — Shared Work and Scoped Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a secure, provider-neutral, internal shared-work state and scoped-memory foundation so one authorized Friday worker can checkpoint and hand off a task to another without replaying chat history.

**Architecture:** Introduce additive self-hosted Postgres tables and atomic, service-role-only operations behind small JavaScript repository interfaces. Business services enforce authorization and validation; a bounded read-only continuation projection combines authoritative work/accepted decisions with advisory handoffs and permitted scoped memory. Phase 2B does not invoke models, expose HTTP/MCP task endpoints, or change existing agent behavior.

**Tech Stack:** Node.js 22 ESM, native fetch, node:test, Postgres 16+ for isolated database tests, existing self-hosted Supabase/PostgREST, Docker Compose/GitHub Actions, existing Friday test/build tooling. No new production runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-09-friday-phase2b-shared-work-memory-design.md`

**Execution method:** Subagent-driven (previous operator preference). This plan itself must be reviewed/approved before running implementation tasks.

## Global Constraints

- Branch from the latest reviewed main in an isolated worktree, not from the unmerged Phase 2A feature branch. Confirm main baseline tests before changes. Do not merge PR #23 or #24 as an implementation shortcut.
- Preserve Phase 1 Agent Spec v1.1, the Proxmox Observer's matched local-Ollama-only path, and all existing HTTP routes. Phase 2A free-only/no-paid-fallback policy remains untouched.
- Do **not** deploy VM102, modify live Supabase schema/data, expose write-capable HTTP/MCP, create an agent action executor, or grant Docker/Proxmox/SSH/shell access.
- Friday server owns trusted actor identity. A model or incoming request cannot supply its own ActorContext. For an agent claim, require a trusted agent-identity binding or deny by default; never authorize on the unverified agentId alone.
- Work records, memory, checkpoints and handoffs are untrusted input until validated and secret-screened. Reject unexpected object keys, oversized text, embedded env/header dumps, and recognizable credentials. Scrubbing is a defense-in-depth filter, not permission to store secrets.
- Use server-only service-role configuration. Restrict table/RPC grants; do not publish service credentials or allow public anonymous access. Prefer SQL SECURITY INVOKER functions, explicit search_path and tightly scoped EXECUTE grants.
- All work-item mutations are optimistic-concurrency checked and transactional in Postgres. The **database** determines lease time; a caller-supplied clock cannot extend a lease.
- Every checkpoint and handoff is append-only, and same-request retries must not duplicate writes. Preserve prior claims and runs on lease expiry/reclaim.
- No persistent session memory: six durable scopes plus ephemeral session scope. Memory cannot override authoritative task or accepted-decision state.
- Do not add libraries unless a test demonstrates a Node 22 primitive/psql limitation. Do not invent a production database URI or model/provider ID.
- Test on disposable Postgres only. Production migration requires a *separate* explicit rollout approval.

## Proposed File Structure

- Create `server/work/validation.mjs` and `validation.test.mjs`: bounded schemas, packet and credential screening, sanitized errors.
- Create `supabase/migrations/202610090001_friday_shared_work.sql`: nine additive work/memory tables, indexes, constraints, grants and SQL transactions/functions.
- Create `scripts/validate-shared-work-schema.mjs` + test: static expected-schema, security-grant and migration-boundary checks. Leave Phase 1 validator/migration unchanged.
- Create `scripts/test-shared-work-postgres.sh` and `tests/sql/shared-work.sql` / `tests/sql/shared-work-concurrency.sh`: disposable Postgres DDL/RPC, constraints and two-session contention evidence.
- Create `server/work/supabase-repository.mjs` + test: native-fetch PostgREST repositories, RPC calls, strict timeout, sanitized error mapping, no public APIs.
- Create `server/work/work-service.mjs` + test: trusted actor/project and agent binding, claim/renew/checkpoint/handoff/release, versioned results.
- Create `server/work/memory-service.mjs` + test: scoped grants, durable repository adapter, TTL-limited in-memory session store.
- Create `server/work/continuation.mjs` + test: authorized, bounded continuation projection.
- Create `server/work/decisions.mjs` + test: proposal/acceptance and artifact metadata with provenance and trusted acceptance.
- Modify `package.json`, `.github/workflows/ci.yml`, and `docs/codex/API_CONTRACT.md`; create `docs/shared-work-phase2b.md`: scoped verification, CI, operator runbook, no public route.
- Modify `server/http.agents.test.mjs` or `server/http.test.mjs` **only** to pin no added HTTP task/memory endpoints; do not change `server/http.mjs` absent a failing existing-compatibility regression.

## Review Focus — Five Failure Modes That Must Be Tested

1. Two workers claim the same work item concurrently with the same expected version: exactly one wins; losing transaction leaves no orphan claim. Task 3 integration tests.
2. A crashed worker retries a successful append after the version advanced: identical requestId/payload returns the original result; altered payload conflicts; no duplicate checkpoint/handoff. Task 4.
3. A valid but unauthorized actor asks for another project's task/memory, or supplies the name of a privileged agent: reject without leaking whether the target exists; no DB writes. Tasks 5–6.
4. A memory or handoff contains plausible instructions plus leaked token/env/header material: reject sensitive data; never elevate advisory content into policy or accepted decision. Tasks 1, 7–8.
5. Old/expired lease holder sends a renew/release/append while a successor has reclaimed: reject by claim/run/version even if a stale client believes the lease was valid. Task 3 and Task 4.

---

### Task 1: Define Bounded Validation and Error Contract

**Files:** Create `server/work/validation.mjs`, `server/work/validation.test.mjs`.

**Interfaces:** Export `validateWorkCreate(input)`, `validateClaim(input)`, `validateCheckpoint(packet)`, `validateHandoff(packet)`, `validateMemoryWrite(input)`, `normalizeActor(actor)`, `safeWorkError(kind)`. All return validated **new copies** or throw sanitized tagged errors. Enforce title ≤160, objective ≤4,000, summary ≤2,000, content ≤4,000, array length ≤50, each list string ≤500, requestId bounded UUID/string pattern; allow only declared keys. A trusted actor has principalId, allowedProjectIds, allowedMemoryScopes and a separately supplied, trusted allowedAgentIds binding (absence means no agent claims).

- [ ] **Step 1: Write RED tests:** malformed/nonobject inputs, unknown keys, excessively long fields, wrong types, empty IDs/arrays where required, obvious PEM/API-token/env/header dumps, and model-supplied `ActorContext` keys are rejected. Assert e.g. `validateHandoff({summary:'ok',Authorization:'Bearer private'})` throws sanitized `invalid-input`; serializing error must not contain `private`.
- [ ] **Step 2: Run:** `node --test server/work/validation.test.mjs` → expected FAIL (module missing).
- [ ] **Step 3: Implement:** `validation.mjs` schema guards, safe fixed error vocabulary, frozen/copied arrays, no raw stack/message forwarding to callers; produce plain JSON-safe data only. Provenance/verification metadata requires stable structured identifiers, not arbitrary URLs with query credentials.
- [ ] **Step 4: Run:** `node --test server/work/validation.test.mjs` → PASS; `git diff --check` → clean.
- [ ] **Step 5: Commit:** `git add server/work/validation.* && git commit -m "feat: validate shared-work records and actor bounds"`.

### Task 2: Add Explicit Additive Database Schema and Security Grants

**Files:** Create `supabase/migrations/202610090001_friday_shared_work.sql`, `scripts/validate-shared-work-schema.mjs`, `scripts/validate-shared-work-schema.test.mjs`, `tests/sql/shared-work.sql`.

**Interfaces:** Public schema tables `friday_projects`, `friday_work_items`, `friday_work_claims`, `friday_agent_runs`, `friday_checkpoints`, `friday_handoffs`, `friday_decisions`, `friday_artifacts`, `friday_memories`. Foreign keys and `CHECK`s constrain IDs, status, version ≥1, lease expiry, JSON shapes, and scope. Work item contains nullable active claim pointer (add the circular FK after both tables exist). Session scope forbidden in `friday_memories`. Index by project/work and scope/owner. Work/append tables contain requestId + input fingerprint uniqueness for idempotency; schema grants only service_role write/read; no anon/authenticated grants.

- [ ] **Step 1: Write RED schema tests:** validator rejects missing table, missing constraints, absent service-role-only grants, unprotected function grants, Phase 1 table alterations, and durable `session` scope. Define expected nine table names, bounded SQL checks and privilege checks explicitly.
- [ ] **Step 2: Run:** `node --test scripts/validate-shared-work-schema.test.mjs` → expected FAIL.
- [ ] **Step 3: Implement schema:** additive migration; create timestamps, primary/unique/FK and JSON type checks; revokes from PUBLIC/anon/authenticated plus ENABLE RLS with server-only service-role policy as appropriate to Supabase roles; avoid SECURITY DEFINER. Keep one migration for schema and transaction functions only if their privileges can be verified together.
- [ ] **Step 4: SQL smoke test:** apply to **disposable** Postgres 16 via `psql -v ON_ERROR_STOP=1`; query catalog columns/constraints/grants and verify no modification to Phase 1 tables. New SQL tests belong in `tests/sql/shared-work.sql`; runner is introduced in Task 3, so an equivalent one-off disposable psql invocation is sufficient here.
- [ ] **Step 5: Run:** `node --test scripts/validate-shared-work-schema.test.mjs && npm run validate:agent-registry-schema` → PASS; no overlap with Phase 1 migration.
- [ ] **Step 6: Commit:** `git add supabase/migrations/202610090001_friday_shared_work.sql scripts/validate-shared-work-schema* tests/sql/shared-work.sql && git commit -m "feat: add private shared-work schema"`.

### Task 3: Transactional Claims, Versioning and Lease Ownership

**Files:** Extend `supabase/migrations/202610090001_friday_shared_work.sql`; create `scripts/test-shared-work-postgres.sh`, `tests/sql/shared-work-concurrency.sh`; extend `tests/sql/shared-work.sql`.

**Interfaces:** Transactional SQL functions `friday_claim_work(work_id, expected_version, principal_id, agent_id, run_id, lease_seconds, request_id)`, `friday_renew_claim(claim_id, run_id, expected_version, lease_seconds)`, `friday_release_claim(claim_id, run_id, expected_version, next_status)`. Return work version, claim ID/lease expiry or fixed structured failure. Service layer binds principal and agent authorization **before** invoking DB functions; database additionally checks same principal/run/current claim on renew/release. Only a 60–900 second integer lease accepted. All operations use `SELECT ... FOR UPDATE`, database `now()`, atomic new claim insert + item update, and version increment.

- [ ] **Step 1: Write RED DB tests:** simultaneous `claim` calls with expectedVersion 1 → one success and one `version-conflict`; expired claim can be reclaimed; stale claim cannot renew/release after reclaim; two run IDs cannot renew each other; invalid lease values rejected; item version monotonically increases. Use two independent psql sessions and a synchronization barrier, not timing-dependent sleep.
- [ ] **Step 2: Run:** `sh scripts/test-shared-work-postgres.sh` → expected FAIL (functions/runner missing); runner must start/use only disposable Postgres, refuse recognized production host settings and clean up safely.
- [ ] **Step 3: Implement SQL:** transactional functions and restrictive EXECUTE grants; owner and version checks happen inside locked transaction. Insert immutable claim history, preserve prior run records on reclaim. Returned failures are fixed enums, not SQL exceptions with secret-bearing parameters.
- [ ] **Step 4: Run:** disposable Postgres SQL tests → PASS in serial and contention modes; verify exactly one active claim, earlier records still present, and no orphan claim after rejected writes.
- [ ] **Step 5: Commit:** `git add supabase/migrations/202610090001_friday_shared_work.sql scripts/test-shared-work-postgres.sh tests/sql && git commit -m "feat: add atomic work claims and leases"`.

### Task 4: Append-Only Checkpoints, Handoffs, and Idempotency

**Files:** Extend SQL migration and `tests/sql/shared-work.sql`, `tests/sql/shared-work-concurrency.sh`.

**Interfaces:** SQL functions `friday_append_checkpoint(claim_id, run_id, expected_version, request_id, payload_json)`, `friday_append_handoff(claim_id, run_id, expected_version, request_id, payload_json)` returning `{recordId,workVersion}`; and read-only latest-handoff selector ordered by accepted append sequence/time + ID. Use caller-bound actor authorization in service, current claim and DB lease/version checks in SQL. For successful append, increment item version. Operation/principal-scoped idempotency record and payload fingerprint are checked before stale-version rejection.

- [ ] **Step 1: Write RED tests:** append two checkpoints + two handoffs, audit history remains; same requestId/same fingerprint returns original record after version changed; same requestId/changed payload returns `idempotency-conflict`; different run/old claim/expired lease/stale version fails with no side effects; oversized and credentials rejected at service boundary (Task 1 validation).
- [ ] **Step 2: Run:** `sh scripts/test-shared-work-postgres.sh` → expected FAIL on missing append functions.
- [ ] **Step 3: Implement:** immutable inserts under locked work item, unique idempotency keys and canonical hash of validated payload, transaction rollback on rejected input. Never overwrite previous handoff; preserve claim and run provenance.
- [ ] **Step 4: Run:** disposable Postgres suite → PASS; rerun twice to verify migration/test repeatability in isolated DBs.
- [ ] **Step 5: Commit:** `git add supabase/migrations/202610090001_friday_shared_work.sql tests/sql && git commit -m "feat: append idempotent checkpoints and handoffs"`.

### Task 5: Implement Provider-Neutral Work Repository and Work Service

**Files:** Create `server/work/supabase-repository.mjs`, `supabase-repository.test.mjs`, `server/work/work-service.mjs`, `work-service.test.mjs`.

**Interfaces:** `createSupabaseWorkRepository({baseUrl,serviceKey,fetchImpl,timeoutMs=10000})` exposes `create,get,list,claim,renew,checkpoint,handoff,release,getLatestHandoff` and wraps POST /rest/v1/rpc/friday_* for transactional changes. `createWorkService({repository,agentAuthorizer})` exposes the **exact** spec WorkService signatures including `{actor,...}`. `agentAuthorizer(actor, agentId)` is trusted and defaults to deny. `actor.allowedProjectIds` constrains get/list/mutations. Use project ID checks even on lookup by work ID; return a uniform public `not-found` for unauthorized/nonexistent cross-project lookups.

- [ ] **Step 1: Write RED mocked-fetch tests:** RPC URL/method/schema, service key only in server-side headers, timeout, 401/403, 404, 409, rate limits, malformed JSON, network failure; raw request/SQL error text never enters public errors. Work service tests cover wrong project, principal, version, agent binding and missing actor; expected fixed denial and zero repository calls.
- [ ] **Step 2: Run:** `node --test server/work/supabase-repository.test.mjs server/work/work-service.test.mjs` → FAIL.
- [ ] **Step 3: Implement:** native-fetch adapter consistent with existing `server/agents/supabase-client.mjs`; narrow data methods and sanitized errors, with domain service validating actor/object, applying project/agent allowlists and mapping DB conflicts.
- [ ] **Step 4: Run:** focused node tests PASS; run Phase 1 registry/client tests to confirm unchanged interfaces.
- [ ] **Step 5: Commit:** `git add server/work/supabase-repository* server/work/work-service* && git commit -m "feat: add authorized shared-work service"`.

### Task 6: Scoped Durable Memory and Ephemeral Session Memory

**Files:** Create `server/work/memory-service.mjs`, `memory-service.test.mjs`; extend `server/work/supabase-repository.mjs` and its test; extend SQL migration and SQL tests where needed.

**Interfaces:** `createMemoryService({repository,sessionStore,now})` supplies `put({actor,scope,ownerId,content,provenance,requestId})`, `get({actor,memoryId})`, `search({actor,scopes,query,limit})`. `createSessionMemoryStore({now,maxTtlMs=3600000,maxChars=16000})` stores only scoped {principalId,sessionId} entries in memory. Durable scopes: global, organization, project, group, agent, task. Search takes the intersection of requested (scope, ownerId) and trusted ActorContext.allowedMemoryScopes; project/task scope also requires matching project authorization. A session scope may only use in-memory store and a bound sessionId.

- [ ] **Step 1: Write RED tests:** every scope is representable; six are durable; session never calls DB; empty grants search returns []; actor from project A cannot retrieve project B even if scope string supplied; task/agent/group owner IDs are exact-matched; unauthorized get is `not-found`; session TTL/cross-principal/cross-session isolation enforced; query result limit and aggregate excerpt chars capped; obvious credentials rejected.
- [ ] **Step 2: Run:** `node --test server/work/memory-service.test.mjs server/work/supabase-repository.test.mjs` → FAIL.
- [ ] **Step 3: Implement:** immutable records, bounded PostgREST filtered GET queries or a restricted read RPC, deterministic sort and truncated excerpts, explicit no-implicit-promotion invariant. Memory adapter is injected; no embedding dependency or direct model API.
- [ ] **Step 4: Run:** focused node tests PASS; disposable Postgres verifies scope/owner constraints and public role cannot access tables.
- [ ] **Step 5: Commit:** `git add server/work/memory-service* server/work/supabase-repository* supabase/migrations/202610090001_friday_shared_work.sql tests/sql && git commit -m "feat: enforce scoped Friday memory"`.

### Task 7: Decision and Artifact Provenance plus Safe Continuation Packets

**Files:** Create `server/work/decisions.mjs`, `decisions.test.mjs`, `server/work/continuation.mjs`, `continuation.test.mjs`; extend repository tests and SQL migration as needed.

**Interfaces:** `createDecisionService({repository,reviewAuthorizer})` exports `propose({actor,workItemId,summary,provenance,requestId})`, `review({actor,decisionId,verdict,expectedVersion})` where verdict is accepted/rejected only when trusted review authorization passes, plus `attachArtifactMetadata({actor,workItemId,gitRef,artifactRef,requestId})` for refs only. `buildWorkContinuation({actor,workService,decisionService,memoryService,workItemId,scopes,maxChars=12000})` produces `{workItem,latestHandoff,acceptedDecisions,memory}` in deterministic authoritative-first order. Never treat a model's `verification: passed` text as proof: only trusted verification references may be marked verified.

- [ ] **Step 1: Write RED tests:** proposed decisions cannot become accepted without authorized reviewer; artifact metadata rejects filesystem traversal/query secrets or full blob content; duplicate artifact/decision requests are idempotent; packet excludes other project memory and all unaccepted decisions; long memory/handoffs truncated or omitted under cap; prior-model instructions cannot modify authoritative status/version or accepted decisions; provenance retained.
- [ ] **Step 2: Run:** `node --test server/work/decisions.test.mjs server/work/continuation.test.mjs` → FAIL.
- [ ] **Step 3: Implement:** separate validated decisions/metadata from display projection; use only injected repositories; authorize project and reviewer before writes, and fail closed on malformed history. Model text is copied only as quoted/advisory data, never as system instruction.
- [ ] **Step 4: Run:** focused node/isolated DB tests PASS, deterministic packet byte-for-byte comparison on repeated reads.
- [ ] **Step 5: Commit:** `git add server/work/decisions* server/work/continuation* server/work/supabase-repository* supabase/migrations/202610090001_friday_shared_work.sql tests/sql && git commit -m "feat: prepare bounded Friday work handoffs"`.

### Task 8: CI, Operator Runbook, Regression and Final Verification

**Files:** Modify `package.json`, `.github/workflows/ci.yml`, `docs/codex/API_CONTRACT.md`, `server/http.agents.test.mjs`; create `docs/shared-work-phase2b.md`. Modify `server/agents/agent-service.test.mjs` only if existing coverage is insufficient; never change agent runtime to activate Phase 2B.

**Interfaces:** New scripts `npm run validate:shared-work-schema` and `npm run test:shared-work-db` (disposable DB only). New CI Postgres service and dedicated migration/schema/concurrency tests. Source docs explain design boundaries and staging-only migration/rollback.

- [ ] **Step 1: Write RED compatibility/security tests:** existing agent ask remains `provider:'ollama'` and `execution.performed:false`; `/api/assistant` route unchanged; no new HTTP/MCP routes for work/memory/decisions; no child_process/shell/SSH in `server/work/`; credentials never appear in `src/`, continuation tests, or rendered client code; new SQL tables deny anon/authenticated access by default.
- [ ] **Step 2: Run:** targeted tests/checks → expected FAIL before CI script/schema checks exist.
- [ ] **Step 3: Implement CI/runbook:** GitHub Actions service `postgres:16-alpine` with ephemeral credentials, healthchecks, `psql -v ON_ERROR_STOP=1`, no production Supabase URLs; README-style runbook for migration staging, privilege review, disabled deployment, backup, restore and data-preserving rollback (disable Phase 2B entrypoints; **never DROP existing shared-work tables**). Preserve Phase 1 schema validator separately.
- [ ] **Step 4: Run focused:** `node --test server/work/*.test.mjs && npm run validate:shared-work-schema && npm run test:shared-work-db && node --test server/http.agents.test.mjs server/agents/agent-service.test.mjs` → PASS.
- [ ] **Step 5: Run full:** `npm test && npm run build && npm run validate:agent-registry-schema && npm run validate:shared-work-schema && npm run test:shared-work-db && docker compose config >/dev/null && docker compose -f compose.yaml -f compose.live.yaml config >/dev/null && FRIDAY_OBSERVER_TOKEN=ci-test FRIDAY_OBSERVER_BIND_ADDRESS=127.0.0.1 docker compose -f observer/compose.yaml config >/dev/null` → PASS.
- [ ] **Step 6: Inspect diff:** verify only additive migrations, no new public mutation endpoints, no service key in frontend, no expanded agent privileges, no production database or VM102 writes. Review CI exact head and container builds before moving PR out of draft.
- [ ] **Step 7: Commit:** `git add package.json .github/workflows/ci.yml docs/shared-work-phase2b.md docs/codex/API_CONTRACT.md server/http.agents.test.mjs && git commit -m "docs: verify phase 2b shared-work boundaries"`.

## Final Acceptance Matrix

- [ ] The written spec and this plan are explicitly approved; implementation uses subagent-driven fresh reviewer gates per task.
- [ ] Postgres contention test proves one winner for simultaneous claim; lost/stale writes and expired leases are rejected.
- [ ] All write paths check trusted actor/project and agent binding; no model-supplied identity grants.
- [ ] History is append-only and retries are idempotent under optimistic versioning.
- [ ] Six durable memory scopes and one ephemeral session scope work without cross-scope leakage.
- [ ] Work item/current accepted decisions always outrank remembered or model-proposed content.
- [ ] Credentials excluded from durable data, public results and model-visible continuation packets.
- [ ] Phase 1 registry and local Ollama agent contract remains unchanged; Phase 2A remains free-only.
- [ ] No HTTP/MCP work/memory write endpoints or tool/infrastructure mutation surfaces are added.
- [ ] Full node, isolated Postgres, build, Compose, safety checks and exact-head CI pass.
- [ ] Main is not changed; no live schema migration/deployment/merge without separate operator approval.

## Handoff

After plan approval, create an isolated implementation branch from reviewed main; **do not execute Task 1 on this design branch**. Use subagent-driven development with TDD (RED → GREEN → reviewer → commit) per task, then request independent whole-branch review. Keep PR #24 design-only. The Phase 2A draft PR #23 is a parallel dependency for subsequent integration, not permission to deploy or merge it. If a Postgres locking test cannot be executed safely in an isolated environment, stop at that verification blocker rather than weakening the release gate.
