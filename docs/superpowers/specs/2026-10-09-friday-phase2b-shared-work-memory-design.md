# Friday Agent Fabric — Phase 2B Shared Work and Scoped Memory Design

Date: 2026-10-09
Status: **Design and implementation plan approved by operator; implementation isolated from production**
Repository: `StMedrano/Friday`
Branch: `design/friday-phase2b-shared-work-memory-20261009`
Parent architecture: `docs/superpowers/specs/2026-10-07-friday-agent-fabric-free-first-architecture-design.md` (PR #22)
Prerequisites: Phase 1 local-agent platform (#19, merged), Phase 2A model fabric (#23, draft; no production deployment).

## Intent and scope

**Goal:** Let one Friday-owned work item survive between AI workers and model providers. A worker can leave an authoritative checkpoint, release its lease, and provide a structured handoff. Another *authorized* worker can recover the latest validated state without receiving a full previous chat. Memory is retrieved only from approved scopes. Friday, not the LLM, owns all state.

This phase implements a **headless internal domain layer** and database schema. It does *not* expose public task/memory write routes, MCP operations, arbitrary tool execution, shell/SSH/Docker/Proxmox mutations, a browser-facing management UI, autonomous agent chaining, or an inference-provider migration. It does not modify Agent Spec v1.1 or redirect Phase 1 agents away from local Ollama. The Phase 2A free-only policy stays fixed. Phase 2C introduces group skills, plugin permissions, and Context Builder; Phase 2D introduces separately authenticated MCP access.

## Design alternatives and decision

1. **Recommended: Postgres authoritative records + in-memory ephemeral session memory.** Reuse the self-hosted Supabase/Postgres already deployed, introduce additive `friday_*` tables and atomic SQL functions for leases/versioned transitions, and wrap persistence behind narrow JavaScript repositories. This supports recovery across processes without trusting a model transcript.
2. File-based JSON checkpoints. Lower setup cost but unsafe cross-worker claims and weaker atomic versioning; not selected.
3. Hosted workflow vendor / agent framework state. Faster integrations but harms offline portability and control of authorization; deferred.

Only option 1 is in scope. Database deployment and production migration require a separate reviewed rollout gate. Use no new paid services and no new Node dependencies unless existing native APIs demonstrably cannot satisfy a requirement.

## Trust boundaries

- **Authoritative:** validated Friday project/work-item state, accepted decisions, append-only checkpoints and handoffs, observed verification records, and database-transaction results.
- **Advisory:** model prose, recovered memory, provider chat transcripts, suggested decisions, suggested next agent, and unverified claims that code/tests ran.
- **Credential policy:** Provider, database, plugin, OAuth, and host secrets never enter work-item fields, memory, handoff packets, returned public descriptors, model-visible text, or Git. Reject obviously sensitive fields/strings at write boundaries; do not mistake this filter for perfect secret detection. Caller-provided text is always treated as untrusted data.
- **Authorization:** No public write endpoint exists this phase. Internal services accept a trusted `ActorContext` supplied by Friday server code, not a model's self-declared name. Default deny if actor, project membership, scope grants, or lease identity are missing. Future HTTP/MCP identity binding is an independent reviewed phase.
- **Infrastructure:** No action executor or elevated device access; checkpointing does not grant ability to run a command. Any future tool/result verification belongs to an audited, separately approved execution boundary.
- **Retention:** Preserve append history for recovery and audit; destructive deletion/retention policies are deferred rather than implied by UI controls. User-accessible erasure/compliance policy must be designed before storing real sensitive end-user data.

## Phase 2B API (internal modules only)

Use small provider-neutral interfaces; do not import Supabase-specific APIs from business logic.

```ts
type ActorContext = {
  principalId: string;          // provided by Friday trusted runtime
  allowedProjectIds: string[];  // enforced server-side
  allowedMemoryScopes: Array<{ scope: MemoryScope; ownerId: string }>;
}
type MemoryScope = 'global'|'organization'|'project'|'group'|'agent'|'task'|'session'

interface WorkService {
  create({ actor, projectId, title, objective, acceptanceCriteria, requestId }): Promise<WorkItem>
  get({ actor, workItemId }): Promise<WorkItem>
  list({ actor, projectId, cursor, limit }): Promise<WorkItem[]>
  claim({ actor, workItemId, agentId, runId, expectedVersion, leaseSeconds }): Promise<ClaimResult>
  renew({ actor, claimId, runId, expectedVersion, leaseSeconds }): Promise<ClaimResult>
  checkpoint({ actor, claimId, runId, expectedVersion, packet }): Promise<Checkpoint>
  handoff({ actor, claimId, runId, expectedVersion, packet }): Promise<Handoff>
  release({ actor, claimId, runId, expectedVersion, nextStatus }): Promise<WorkItem>
  getLatestHandoff({ actor, workItemId }): Promise<Handoff|null>
}
interface MemoryService {
  put({ actor, scope, ownerId, content, provenance, requestId }): Promise<MemoryRecord>
  search({ actor, scopes, query, limit }): Promise<MemoryRecord[]>
  get({ actor, memoryId }): Promise<MemoryRecord>
}
```

Work services do not invoke models or tools. Responses return sanitized typed errors (`not-authorized`, `not-found`, `invalid-input`, `version-conflict`, `lease-conflict`, `lease-expired`, `storage-unavailable`), never raw SQL, credentials, stack traces, or request headers. Not-found and unauthorized may intentionally share the same external response to avoid project enumeration. Implementations use bounded structured validation and stable IDs, not arbitrary JSON-to-SQL pass-through.

## Persistence and invariants

Introduce **additive** SQL migration(s), not edits to the already-deployed Phase 1 registry migration. Keep database table access server-only through the existing service role; revoke unauthenticated and ordinary role access to new tables/functions until an independently reviewed RBAC model is implemented. Prefer security-invoker SQL functions with restricted EXECUTE privileges and explicit `search_path`; no wildcard remote RPC permissions.

- `friday_projects`: stable project ID, name, created/updated timestamps. Initial project rows are explicitly provisioned by authorized server setup, not model-created.
- `friday_work_items`: UUID, project FK, title, objective, acceptance criteria JSON array, status, positive integer `version`, active claim ID, timestamps. Status enum: `ready | in_progress | blocked | review | completed | cancelled`.
- `friday_work_claims`: immutable claim UUID, work item and run/agent/principal identity, acquisition time, expiration time, optional release time. Preserve expired claims as history. One current lease is the item’s `active_claim_id`; an expired claim is superseded only by an atomic reclaim transaction.
- `friday_agent_runs`: append-oriented identity, start/finish status and sanitized provenance. A run links work/claim; there is no shell or inference tool executor in this phase.
- `friday_checkpoints`: append-only JSON schema-validated summary, completed/remaining, blockers, decisions proposed, artifact references, and accepted verification records. Each row references the work item, claim and run.
- `friday_handoffs`: append-only normalized payload: `fromAgent`, `runId`, `summary`, `status`, `completed`, `remaining`, `blockers`, `decisions`, `artifactRefs`, `gitRefs`, `verification`, `recommendedNextCapability`. No raw chat copies, env vars or tokens.
- `friday_decisions`: append-only proposals and an explicitly accepted/rejected status with actor/provenance. LLM-generated proposed decisions are **not** automatically accepted.
- `friday_artifacts`: metadata and immutable external references only, never executable blobs or arbitrary server file paths.
- `friday_memories`: durable `global | organization | project | group | agent | task` records with `owner_id`, `project_id` where applicable, bounded content, provenance, timestamps and TTL metadata if configured. `session` memory must **never** be stored in this table.

**Claim transaction:** `SELECT ... FOR UPDATE` work-item row; reject mismatched `expectedVersion`; allow claim only when unclaimed or prior lease genuinely expired per **database clock**; atomically insert new claim, set `active_claim_id`, status `in_progress`, increment version, and return new version. Distinct actor/run cannot renew, checkpoint, handoff, or release another actor’s active claim. Reclaim preserves previous history. Checkpoint/handoff writes verify current claim and version in the same DB transaction that appends the record. Release clears the pointer and increments version. A version cannot move backward, and rejected writes change no rows.

**Expiry:** Clamp lease lengths to 60–900 seconds; reject zero, negative, NaN, huge, and non-integer leases. The database clock, not client clock, determines expiry. No scheduled sweeper or background autonomic task is needed in 2B. An expired claim's old worker cannot append or renew.

**Idempotency:** `requestId` identifies retried create/checkpoint/handoff/memory writes scoped to a principal and operation; repeated matching input returns the same result, mismatched payload fails. Dedupe before version mutation as part of the same transaction; no duplicate handoff rows after network timeout.

## Memory access contract

Seven conceptual scopes remain representable. Exactly six scopes are durable in Postgres; `session` memory is bounded, in-process, TTL-limited, and is never promoted to durable storage implicitly.

- Every persistent record has an explicit `scope + ownerId` pair and provenance. A project/task memory additionally carries a project/work binding; operations enforce both project membership and exact scope grants.
- Search receives **effective scopes computed by trusted Friday code**. Caller/model-provided scope strings cannot broaden the authorized `ActorContext`; intersection is mandatory. Empty grants return zero records.
- Use bounded text search or Postgres full-text indexing first; embeddings/vector search is an optional future adapter, not a requirement.
- Enforce content-size, query-length, result-count and total context-character limits; rank deterministically with provenance and timestamps. No unrelated project, group, agent, or task content can be returned.
- A durable memory write requires explicit server authorization. Model output can propose a record but cannot persist by itself. Sanitize obvious credential patterns, disallow raw request headers and environment dumps, and fail closed for unrecognized object fields.
- An authoritative work-item version and explicitly accepted decision outweigh memory results, including when memory text contains imperative instructions. Memory is data, not policy or privileged instruction.
- Session memory uses an explicit `sessionId`, maximum TTL and per-session byte bound and must be discarded when expired. Cross-session access and cross-principal promotion are forbidden.

## Context and handoff boundary

Phase 2B produces a **`WorkContinuationPacket`** via a read-only internal projection only:

```ts
type WorkContinuationPacket = {
  workItem: { id: string; projectId: string; objective: string;
              acceptanceCriteria: string[]; status: string; version: number };
  latestHandoff: Handoff|null;
  acceptedDecisions: Decision[];
  memory: Array<{ id:string; scope:MemoryScope; ownerId:string;
                  excerpt:string; provenance:string }>;
}
```

It is not the final Phase 2C Context Builder. The packet MUST be authorization-filtered, bounded, secret-screened, deterministic, and distinguish authoritative state from advisory memory. No effective skill/plugin grants are computed in Phase 2B, and no model consumes the packet automatically. Only Phase 2C may add approved group/skills/plugin context.

## Data flow

1. A trusted Friday caller obtains authorized `ActorContext`, creates a work item and passes its acceptance criteria.
2. A worker claims the item with `expectedVersion`; DB atomically leases it.
3. Friday records sanitized append-only checkpoints. Actual test/CI evidence is accepted only when a trusted tool result or verified reference exists, not solely from model prose.
4. The current lease holder appends a validated handoff and releases the item into `review`, `blocked`, or `ready`.
5. A different authorized worker claims the new version; `WorkContinuationPacket` reconstructs authoritative state + newest validated handoff + permitted bounded memory. Older provenance is preserved.
6. On conflict/expiration, the write fails safely and the client rereads the newest state. No implicit retry can steal a lease or bypass version checks.

## Design tests and acceptance

Use Node 22 `node:test` with pure fake repositories/clock for contract tests, then isolated temporary Postgres transactional concurrency tests in CI. SQLite or in-memory mocks alone cannot prove row-lock semantics.

1. Two simultaneous claims with identical `expectedVersion`: precisely one succeeds; the other reports conflict.
2. Expired claim reclaimed after database-clock expiry: history persists; stale worker cannot renew/checkpoint/release.
3. Stale `expectedVersion`, wrong `runId`, wrong actor, wrong project, invalid lease and duplicate request IDs fail closed without writing.
4. Checkpoints/handoffs append; retries with same ID do not duplicate; malformed, oversized or credential-bearing packets are rejected.
5. All seven scopes can be identified; durable search filters by exact scope/owner and project; session memory remains ephemeral and expires.
6. Effective empty/unauthorized memory grants return no results, including when a model asks for broader scopes.
7. Authority ordering prevents previous-model memory instructions from replacing work status or accepted decisions.
8. Errors are sanitized; secrets excluded from persisted payload, context packet, and web/browser sources.
9. Existing Phase 1 agent registry and direct/shared local Ollama advisory behavior remain unchanged; Phase 2A policy remains free-only.
10. SQL migration is additive and reversible by a documented **data-preserving** rollback strategy (disable code path, do not drop user records). No public task/memory HTTP route or MCP bridge appears.
11. Repository-wide tests, frontend build, security checks, and Compose validations stay green.

## Release gates

1. Approve this **written Phase 2B design**; then draft and approve a separate task-by-task Superpowers implementation plan, preserving the previously selected **subagent-driven** method.
2. Implement in an isolated feature branch with failing tests first and task-by-task review. Keep main deployable.
3. Run local/CI tests and isolated Postgres concurrency checks before any production migration.
4. Apply additive migration to a disposable/staging DB first; verify credentials, grants and rollback.
5. **Explicit production deployment approval** is required before touching the live Supabase schema or VM102 controller.
6. Wait for explicit review before merging. New external API, auth/RBAC, MCP or agent-execution authority always requires a separately approved spec.

## Out of scope

No Phase 2C group inheritance, skill/plugin registry or capability intersection; no Phase 2D external client/MCP bridge; no Phase 2E autonomous workflow orchestrator; no Phase 2F NIM deployment; no self-directed durable memory writing; no arbitrary binary artifact storage; no paid-model routing; no infrastructure mutation; no implicit production migration.