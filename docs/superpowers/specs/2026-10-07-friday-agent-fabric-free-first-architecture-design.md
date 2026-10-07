# Friday Agent Fabric — Free-First Multi-AI Architecture Design

Date: 2026-10-07  
Status: Proposed architecture for user review  
Branch: `design/friday-agent-fabric-free-first-20261007`  
Repository: `StMedrano/Friday`

## Purpose

Extend Friday from a single-session advisory assistant plus local-agent router into a **portable multi-AI coordination platform** where ChatGPT/OpenAI, Claude/Anthropic, Kimi, Perplexity-style research workers, NVIDIA-hosted models, and future local models can pick up one another's work through Friday-owned state.

Friday, not any model provider, is the system of record.

The architecture must let an operator:

1. start work with one AI;
2. stop at any point;
3. hand the same task to another AI without restating the project;
4. preserve decisions, artifacts, checkpoints, blockers, and verification state;
5. prefer free/local inference by default;
6. forbid paid inference unless explicitly enabled later;
7. run the same Friday application across development and homelab deployments without rewriting business logic.

This document is an **umbrella architecture**. It intentionally decomposes implementation into independently reviewable phases. Each implementation phase receives its own Superpowers spec and implementation plan before code changes begin.

## Existing Friday foundation

This design extends, rather than replaces, the current Friday architecture.

Current `main` already provides:

- React/TypeScript FRIDAY UI v3;
- unified Node server/API;
- normalized read-only infrastructure state;
- advisory multi-provider assistant;
- monitoring/incidents and diagnostics;
- no infrastructure mutation endpoints;
- server-side provider credentials;
- Dockerized deployment.

Draft PR #19, **Friday Local Agent Platform Phase 1**, adds the foundation this architecture expects:

- Git-authoritative `agents/*.json`;
- Agent Spec v1.1;
- self-hosted Supabase runtime agent registry;
- model profiles;
- deterministic/manual/local-router agent selection;
- advisory-only local Ollama execution;
- an Agents workspace;
- no tool executor;
- no durable agent task/memory system;
- `execution.performed=false` for agent answers.

PR #19 remains a prerequisite/foundation. This design does not silently rewrite its Phase 1 safety boundary.

## Core product decisions

### 1. Friday is the control plane

Providers and models are replaceable workers. They never become the authoritative home for:

- project state;
- task state;
- handoffs;
- decisions;
- memory;
- artifact metadata;
- approvals;
- execution history.

### 2. Agents request capabilities, not model names

A Friday agent definition declares what it needs, for example:

```json
{
  "capabilities": ["coding", "tool-use"],
  "reasoning": "high",
  "multimodal": false,
  "privacy": "cloud-ok",
  "costPolicy": "free-only"
}
```

The runtime selects an eligible model.

Agent policy must not hard-code a specific NVIDIA, OpenAI, Anthropic, Moonshot, or other hosted model identifier.

### 3. Free-first is an enforceable policy

The default production policy is:

```yaml
freeOnly: true
allowPaidFallback: false
maxPaidSpendPerDay: 0
preferLocal: true
preferNvidiaFree: true
```

No successful Friday workflow may require a paid inference provider.

If all free/local eligible models are unavailable, Friday pauses or fails the run safely. It does **not** silently use a paid provider.

### 4. Hosted now, local later

Friday must use the same internal provider contract for:

- NVIDIA hosted free endpoints;
- local NVIDIA NIM;
- local Ollama;
- optional future hosted providers.

NVIDIA NIM exposes OpenAI-compatible inference routes such as `/v1/chat/completions`, so the provider layer should target a common internal interface rather than duplicating orchestration logic per deployment.

### 5. External AI apps coordinate through Friday state

ChatGPT, Claude, Kimi, and other compatible clients do not need direct peer-to-peer messaging.

They connect to Friday through a provider-neutral bridge—preferably MCP where supported—and receive/write bounded Friday context, task, checkpoint, and handoff records.

### 6. Infrastructure remains advisory/read-only

This program does not authorize infrastructure mutation.

A model or external client may:

- read approved Friday context;
- claim a Friday-owned work item;
- write a checkpoint;
- write a handoff;
- attach artifact metadata;
- propose decisions;
- return analysis/code/research.

It may not gain a Docker, Proxmox, network, shell, SSH, firewall, VLAN, storage, or deployment mutation path merely because the Agent Fabric exists.

The existing prerequisite remains: authentication/RBAC, append-only action audit, explicit approval workflow, and global kill switch must exist and be tested before any future typed action executor.

## Terminology

### Agent

A durable Friday role and policy definition: scope, instructions, permissions, capabilities, and allowed tools.

### Provider

A service that hosts or executes models, such as NVIDIA hosted API, local NIM, local Ollama, OpenAI, Anthropic, or another provider.

### Model

A specific inference engine exposed by a provider.

### Worker run

One attempt by one selected model/provider to execute one bounded unit of work for a Friday agent.

### Work item

A durable Friday-owned task with objective, acceptance criteria, ownership/lease, status, project context, and version.

### Checkpoint

An intermediate durable state written during a work item.

### Handoff

A structured end-of-run summary that another worker can consume without replaying the entire previous chat.

## Target architecture

```text
Operator / External AI Client
        |
        v
+-----------------------------+
|           Friday            |
| UI / API / MCP Boundary     |
+--------------+--------------+
               |
               v
+-----------------------------+
|       Agent Fabric          |
|                             |
| Work Manager                |
| Context Builder             |
| Handoff Manager             |
| Agent Router                |
| Model/Capability Router     |
| Policy Engine               |
+---------+---------+---------+
          |         |
          |         +-----------------------+
          |                                 |
          v                                 v
+-------------------+              +--------------------+
| Shared Friday     |              | Provider Adapters  |
| State             |              |                    |
|                   |              | NVIDIA hosted      |
| projects          |              | NVIDIA local NIM   |
| work items        |              | Ollama             |
| checkpoints       |              | optional OpenAI     |
| handoffs          |              | optional Anthropic  |
| decisions         |              | optional Kimi       |
| agent runs        |              | optional research   |
| artifacts         |              +----------+---------+
+---------+---------+                         |
          |                                   v
          |                         Free/local eligible model
          |
          +----> Git / project files / future memory adapter
```

## Model provider contract

All inference providers implement one internal contract.

Conceptual interface:

```ts
interface ModelProvider {
  id: string
  listConfiguredModels(): ModelDescriptor[]
  health(modelId: string): Promise<ModelHealth>
  generate(request: ModelRequest): Promise<ModelResult>
}
```

A `ModelDescriptor` contains normalized routing metadata:

```ts
type ModelDescriptor = {
  id: string
  provider: string
  deployment: "hosted" | "local"
  billingClass: "free" | "paid" | "unknown"
  capabilities: string[]
  supportsTools: boolean
  supportsVision: boolean
  contextWindow?: number
  enabled: boolean
}
```

Provider-specific request/response shapes are normalized before reaching orchestration code.

## NVIDIA provider design

NVIDIA becomes the first new provider added under the free-first policy.

The NVIDIA adapter must support two endpoint modes with the same Friday contract:

### Hosted NVIDIA endpoint

Used during development and whenever an operator-approved NVIDIA model is currently available as a free endpoint.

Configuration is server-side only.

```env
FRIDAY_NVIDIA_ENABLED=false
FRIDAY_NVIDIA_BASE_URL=
FRIDAY_NVIDIA_API_KEY=
```

Exact model identifiers are stored in the model registry/configuration, not agent JSON.

### Local NVIDIA NIM

Future homelab deployment may point the same adapter family to an internal NIM endpoint.

```env
FRIDAY_NVIDIA_LOCAL_ENABLED=false
FRIDAY_NVIDIA_LOCAL_BASE_URL=http://nvidia-nim:8000/v1
```

No agent definition changes when hosted inference moves local.

### Free model eligibility

Friday must not infer that a model is permanently free from its name.

Only models explicitly approved in Friday configuration/registry with `billingClass:"free"` are eligible while `freeOnly=true`.

The current NVIDIA catalog contains models marked **Free Endpoint**, but catalog membership can change. Friday therefore treats free eligibility as operator/configuration metadata plus health state, not as a permanent hard-coded property.

A model with unknown billing status is not eligible in free-only mode.

## Capability router

The model router receives requirements, not a model name.

Example:

```json
{
  "capabilities": ["coding", "tool-use"],
  "reasoning": "high",
  "multimodal": false,
  "privacy": "cloud-ok",
  "costPolicy": "free-only"
}
```

Routing filters in this order:

1. enabled;
2. policy-allowed provider;
3. billing class allowed by cost policy;
4. required capability support;
5. privacy/deployment constraint;
6. healthy/reachable;
7. task-specific preference ordering.

Initial preference should be deterministic and inspectable. No LLM is required to choose another LLM.

Representative free-first preference:

```text
eligible local model
  -> eligible NVIDIA free endpoint
  -> other explicitly free configured provider
  -> no model available
```

Paid fallback is not a final step while `allowPaidFallback=false`.

## Agent Spec evolution

PR #19 uses Agent Spec v1.1 and requires a `model.profile` for local Ollama execution.

The Agent Fabric should not break v1.1.

A later separately reviewed Agent Spec revision may add provider-neutral capability requirements. Until that revision is approved, capability policy belongs in server-side model profiles or a backward-compatible extension rather than silently changing existing definitions.

No Phase 1 agent may acquire broader execution authority during migration.

## Shared work state

Multi-AI continuity requires structured Friday-owned state.

A future migration introduces bounded tables/collections such as:

```text
friday_projects
friday_work_items
friday_work_claims
friday_checkpoints
friday_handoffs
friday_agent_runs
friday_decisions
friday_artifacts
```

These are **not** added to PR #19's Phase 1 migration. They belong to the later shared-work phase.

### Work item

Minimum conceptual shape:

```json
{
  "id": "TT-142",
  "projectId": "techtactics",
  "title": "Add provider support",
  "objective": "...",
  "status": "ready",
  "acceptanceCriteria": [],
  "version": 7,
  "claimedBy": null,
  "leaseExpiresAt": null
}
```

Status values should remain small and deterministic, for example:

```text
ready
in_progress
blocked
review
completed
cancelled
```

### Lease-based ownership

A worker claims a work item using a lease, not a permanent lock.

The claim stores:

- worker/agent identity;
- run ID;
- claim time;
- lease expiration;
- expected work-item version.

A stale client cannot overwrite a newer work-item version.

Expired leases may be reclaimed only after Friday preserves the previous run/checkpoint history.

### Checkpoints

A checkpoint is append-oriented and records:

- work item;
- run ID;
- summary;
- completed steps;
- remaining steps;
- decisions proposed/made;
- blockers;
- artifacts;
- relevant Git branch/commit metadata;
- timestamp.

Checkpoints never replace earlier history.

### Handoffs

Every meaningful worker stop/completion produces a normalized handoff.

Conceptual packet:

```json
{
  "workItemId": "TT-142",
  "fromAgent": "coder",
  "runId": "...",
  "status": "review",
  "summary": "...",
  "completed": [],
  "remaining": [],
  "decisions": [],
  "blockers": [],
  "artifacts": [],
  "filesChanged": [],
  "verification": [],
  "recommendedNextCapability": "code-review"
}
```

The next worker receives the latest validated handoff plus current authoritative project/task state.

It does not need the previous provider's full chat transcript.

## Context Builder

The Context Builder creates one bounded provider-neutral packet for any worker.

Inputs may include:

- agent policy;
- work item;
- acceptance criteria;
- latest handoff;
- relevant decisions;
- relevant project memory;
- artifact references;
- Git/repository metadata;
- normalized Friday infrastructure state when the task requires it;
- allowed tool names;
- safety/approval policy.

The Context Builder must enforce:

- token/character bounds;
- secret exclusion;
- project/work-item scoping;
- latest-state precedence;
- deterministic ordering of authoritative material;
- separation of facts from previous-model suggestions.

Conversation history is optional context, never authoritative state.

## Friday MCP bridge

The MCP layer is the primary interoperability boundary for compatible external AI clients.

Initial conceptual tools:

```text
projects.list
projects.get
work.list
work.get
work.claim
work.release
work.checkpoint
handoffs.get_latest
handoffs.create
decisions.list
decisions.propose
artifacts.list
artifacts.attach_metadata
memory.search
agents.list
models.list_eligible
```

MCP tools are Friday-owned application operations, not infrastructure mutation tools.

### External client identity

Every external client connection must map to a Friday identity/credential before write-capable MCP tools are enabled.

Writes record:

- client identity;
- agent identity if supplied;
- work item;
- run/session ID;
- timestamp;
- request version.

Anonymous/unauthenticated remote write access is forbidden.

Authentication/RBAC implementation is a prerequisite for exposing write-capable MCP beyond a trusted development boundary.

## Automatic multi-agent orchestration

Automated chaining is a later phase built on durable work state.

A workflow may look like:

```text
Planner capability
   -> implementation capability
   -> reviewer capability
   -> research/current-info capability
   -> verification
   -> operator-ready result
```

The workflow engine owns state transitions.

A model may recommend the next capability, but it cannot unilaterally grant itself another agent identity, bypass policy, or mark verification successful without the workflow's required evidence.

Parallel fan-out is out of scope for the first multi-agent release. Initial orchestration should remain sequential and deterministic.

## Artifacts and Git

Friday stores artifact **metadata and references** in shared state.

Source code remains in Git.

For repository work, a handoff should reference:

- repository;
- branch;
- base;
- commit SHA where available;
- changed paths;
- tests/CI evidence.

Friday must not treat a model-generated statement like "tests passed" as proof. Verification evidence must come from the tool/run that actually executed the check.

Binary/generated artifacts may use a configured artifact store later, but the Agent Fabric must not assume a specific object-storage vendor.

## Persistence and portability

Application/domain code depends on interfaces rather than Supabase-specific calls.

Conceptual repository interfaces:

```ts
ProjectRepository
WorkItemRepository
HandoffRepository
AgentRunRepository
DecisionRepository
ArtifactRepository
```

Initial implementation may use self-hosted Supabase/Postgres where appropriate, but orchestration code must not import database-provider-specific behavior directly.

Deployment-specific values remain environment/configuration only.

No business logic may depend on:

- a fixed IP address;
- a fixed hostname;
- a specific VM number;
- a specific cloud provider;
- Supabase's hosted service;
- NVIDIA hosted service;
- a specific model ID.

## Homelab migration contract

The same Friday application images must support development and homelab deployment.

Expected deployment overlays:

```text
compose.yaml
compose.dev.yaml
compose.homelab.yaml
```

The homelab overlay may replace:

- database URL;
- artifact/storage endpoint;
- memory endpoint;
- NVIDIA hosted endpoint with local NIM;
- public/private ingress settings.

It must not require changing agent definitions or orchestration business logic.

## Security boundaries

### Secrets

Provider/API/database credentials:

- server-side only;
- never in `VITE_*`;
- never in context packets;
- never persisted in handoffs/checkpoints;
- never returned by MCP tools.

### Prompt injection and untrusted artifacts

External model output and imported documents are untrusted data.

They cannot:

- expand the current agent's permissions;
- add a paid provider;
- change free-only policy;
- change a work-item owner outside the work API;
- introduce a new executable tool;
- override Friday system policy.

### State integrity

All write operations validate:

- identity;
- authorization;
- object scope;
- expected version where applicable;
- bounded text/array lengths;
- valid state transition.

### Execution boundary

The Agent Fabric can coordinate **knowledge work** before an infrastructure action executor exists.

No component in this design grants LLMs unrestricted shell access.

## Failure behavior

### NVIDIA/free provider unavailable

Try the next eligible **free/local** provider.

If none remain, return `no-free-model-available` and keep the work item recoverable.

Never silently invoke a paid model.

### Provider quota/rate limit

Record a normalized failed agent-run attempt and try the next eligible free/local model if policy permits.

Do not expose raw credentials or upstream error bodies to browser/MCP clients.

### Work lease expires

Preserve all prior run/checkpoint records.

Allow a new claim only after the lease is expired and version/ownership rules pass.

### Stale external client write

Reject with a version/conflict response. Do not merge task state heuristically.

### Invalid handoff

Reject the handoff; preserve the previous valid handoff.

### Database unavailable

Fail write operations closed.

Read-only Friday infrastructure monitoring/diagnostics should continue independently when possible.

### MCP unavailable

Hosted/local autonomous Friday workers may continue using internal service calls. External clients cannot claim/write work until the bridge is restored.

## Observability

Every worker run records normalized metadata:

- run ID;
- work item;
- Friday agent;
- selected provider;
- selected model;
- deployment type;
- billing class;
- routing reason;
- started/finished timestamps;
- status;
- fallback attempts;
- token/usage metadata when available;
- sanitized error code.

The UI should eventually expose:

- active agents/work items;
- current owner/lease;
- recent handoffs;
- provider/model provenance;
- free/local policy state;
- unavailable/rate-limited models;
- blocked work.

## Program decomposition

### Phase 0 — Finish/merge Local Agent Platform Phase 1

Foundation: PR #19.

No Agent Fabric implementation should bypass its live-acceptance and review gates.

### Phase 2A — Free-First Model Fabric

Deliver:

- provider-neutral model contract;
- NVIDIA hosted adapter;
- future-compatible local NIM endpoint mode;
- model registry;
- capability router;
- free-only policy enforcement;
- deterministic health/failover among free/local models;
- no durable multi-agent task orchestration yet.

This is the **first implementation subproject** after the architecture is approved.

### Phase 2B — Shared Work + Handoff State

Deliver:

- work items;
- claims/leases;
- checkpoints;
- handoffs;
- decisions;
- run history;
- optimistic concurrency/versioning;
- context builder.

### Phase 2C — Friday MCP Interoperability

Deliver:

- scoped MCP server;
- read operations;
- authenticated write operations;
- external client identity/audit;
- ChatGPT/Claude/Kimi-compatible handoff workflow where their client products support the required MCP operations.

No infrastructure tool execution.

### Phase 2D — Sequential Multi-Agent Orchestrator

Deliver:

- deterministic workflow stages;
- capability-based worker selection;
- reviewer handoffs;
- failure/retry policy;
- pause/resume;
- operator approval for workflow-level decisions where needed.

Parallel autonomous swarms remain out of scope.

### Phase 2E — Homelab Portability + Local NIM

Deliver:

- environment overlays;
- backup/restore;
- deployment health checks;
- optional local NIM provider;
- hosted-to-local migration acceptance.

Local NIM is optional; Friday remains functional with free hosted NVIDIA endpoints when local hardware cannot serve the selected model.

### Phase 3+ — Controlled actions

Separate security program.

Authentication/RBAC, append-only action audit, explicit approval workflow, and global kill switch are mandatory before a typed allowlisted executor is designed.

## Phase 2A acceptance boundary

The first subproject is complete only when:

1. existing Friday behavior remains compatible;
2. PR #19-style agents can continue using their approved local profile path;
3. at least one configured NVIDIA free endpoint can be represented by the normalized model registry;
4. hosted NVIDIA and future local NIM use the same provider-facing Friday contract;
5. capability routing selects only eligible models;
6. `freeOnly=true` excludes paid and unknown-billing models;
7. provider failure can fail over only to another eligible free/local model;
8. no eligible model returns a safe `no-free-model-available` result;
9. no provider credentials reach browser-visible state;
10. no tool/infrastructure mutation path is introduced;
11. existing tests/build/CI remain green.

## Testing strategy

Each implementation phase follows TDD.

### Provider contract tests

- normalized success;
- timeout;
- rate limit;
- invalid model;
- sanitized upstream failure;
- streaming/non-streaming behavior only when explicitly implemented.

### Model registry/router tests

- capability filtering;
- free-only filtering;
- unknown billing rejected;
- disabled provider rejected;
- unhealthy model rejected;
- deterministic preference;
- no eligible model;
- no paid fallback.

### Compatibility tests

- existing advisory assistant unaffected unless intentionally routed;
- existing local agent path remains advisory;
- monitoring/diagnostics APIs unchanged;
- `execution.performed=false` retained where Phase 1 requires it.

### Security tests

- credentials never serialized to API response;
- browser-visible config cannot contain provider keys;
- model output cannot alter model policy;
- invalid registry metadata fails closed.

## Explicit non-goals for this architecture stage

Not included:

- unrestricted autonomous shell access;
- infrastructure mutation;
- Docker/Proxmox write tools;
- automatic purchasing or paid-provider activation;
- automatic billing-plan changes;
- parallel agent swarms;
- provider-to-provider direct messaging;
- copying complete private chat histories among providers;
- making Supabase an agent-authoring source of truth;
- forcing all inference onto the current homelab GPU;
- hard-coding today's NVIDIA free catalog forever.

## Design invariants

1. **Friday owns state.**
2. **Git owns agent policy.**
3. **Models are replaceable workers.**
4. **Agents request capabilities, not model names.**
5. **Free/local models win by default.**
6. **Paid fallback is off by default and cannot occur implicitly.**
7. **A provider failure never expands permissions.**
8. **A model response is not verification evidence.**
9. **Handoffs are structured state, not full-chat replication.**
10. **Deployment location is configuration, not architecture.**
11. **No Agent Fabric feature weakens Friday's current read-only infrastructure boundary.**
