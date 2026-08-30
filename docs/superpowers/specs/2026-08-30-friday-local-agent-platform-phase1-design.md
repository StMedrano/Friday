# Friday Local Agent Platform Phase 1 Design

Date: 2026-08-30
Status: Approved design
Branch: `feature/friday-local-agent-platform-phase1-20260830`

## Purpose

Phase 1 turns Friday's existing Agent Specification v1 and local Ollama runtime into a usable, local-first, read-only agent platform. It adds a runtime agent registry, deterministic-first orchestration with manual override, model profiles, self-hosted Supabase-backed discovery/status, and a functional Agents workspace.

Phase 1 is advisory only. It does not add infrastructure mutation, tool execution, approvals, task execution, durable agent memory, shell access, Docker mutation, Proxmox mutation, network changes, or configuration writes.

## Approved product decisions

1. Self-hosted Supabase in the homelab is the local runtime registry store.
2. Git is authoritative for agent definitions. Supabase is not an editing source of truth.
3. Friday synchronizes approved Git agent definitions into Supabase from the controller.
4. The Agents workspace becomes a functional read-only workspace in Phase 1.
5. Friday routes automatically by default but always supports explicit/manual agent override.
6. Agent inference is local Ollama only. Phase 1 agents do not fall back to Groq, Gemini, OpenAI, Anthropic, or another cloud AI provider.
7. Agent definitions use model profiles instead of embedding deployment-specific Ollama host/model values.
8. Existing Friday assistant behavior remains separate: the general FRIDAY assistant may continue using the existing Groq -> Gemini -> CT108 Ollama -> deterministic fallback chain.

## Existing foundation

The repository already contains:

- Agent Specification v1 documentation;
- `server/ai/agent-runtime.mjs` with Agent Spec validation, permission resolution, constrained system-prompt construction, and Ollama-backed inference;
- `agents/proxmox-observer.json` as the first local agent definition;
- the existing Friday Ollama adapter and normalized read-only overview state;
- the FRIDAY UI v3 shell and current placeholder Agents navigation surface.

Phase 1 extends these components rather than replacing them.

## Architecture

```text
Git / Local checkout
agents/*.json
     |
     v
Agent Registry Sync
- load definitions
- validate Agent Spec v1
- resolve model profile references
- compute checksum
- reject invalid definitions
- synchronize approved definitions
     |
     v
Self-hosted Supabase
- runtime agent registry
- source path/checksum/version
- enabled/runtime status
- registry sync status
     |
     +---------------------------+
     |                           |
     v                           v
Friday Orchestrator         Agents Workspace
- explicit override         - registry health
- deterministic routing     - agent cards/list
- optional local router     - model profile
     |                      - scope/tools/permissions
     |                      - last sync/checksum
     v                      - Ask this agent
Selected Agent                   |
     +-------------+-------------+
                   v
            Local Agent Runtime
                   |
                   v
           Model Profile Resolver
                   |
                   v
             CT108 Ollama
         192.168.1.70:11434
                   |
                   v
          Advisory response only
          No tool execution
```

## Source-of-truth model

### Git

Git owns agent behavior and policy. Agent definitions remain under `agents/` and are changed through normal repository review/version-control workflows.

Supabase must never silently rewrite, extend, or override the policy represented by a Git agent definition.

### Supabase

Supabase is the controller's local runtime registry/cache for approved definitions and operational metadata. Runtime APIs read from the synchronized registry so the UI can discover agents without parsing repository files on every request.

A registry synchronization never grants an agent more permissions than declared in Git.

## Supabase schema

Phase 1 uses only two agent-platform tables.

### `friday_agents`

Required fields:

- `id` — stable agent ID; primary key.
- `name`
- `description`
- `spec_version`
- `source_path`
- `source_checksum`
- `enabled`
- `model_profile`
- `scope_json`
- `tools_json`
- `permissions_json`
- `instructions_json`
- `synced_at`
- `created_at`
- `updated_at`

The synchronized row must preserve the validated policy surface from Git. Runtime-only state may be added later in separate fields/tables, but Phase 1 must not make Supabase an agent-authoring surface.

### `friday_agent_registry_state`

Required fields:

- `id`
- `last_sync_at`
- `last_sync_status`
- `source_commit`
- `agents_seen`
- `agents_synced`
- `agents_rejected`
- `error_summary`

Only registry synchronization state belongs here. Agent memory, tasks, approvals, and action audit events are explicitly out of scope for this phase.

## Registry synchronization

The controller manages Git -> Supabase synchronization.

Synchronization must:

1. enumerate approved agent definition files under `agents/`;
2. parse each definition;
3. validate Agent Spec v1 before any database write;
4. resolve/validate the referenced model profile;
5. compute a stable source checksum;
6. upsert valid definitions into `friday_agents`;
7. reject invalid definitions without making them active;
8. update `friday_agent_registry_state` with counts and sanitized failure summaries;
9. expose the resulting state through the registry status API.

Startup synchronization is permitted. An explicit operator-triggered resync is also permitted because it writes only Friday-owned registry state from Git-authoritative definitions; it does not mutate managed infrastructure.

When a newly changed Git definition is invalid, the sync must not replace a previously valid active row with invalid policy. The registry reports the rejection and preserves the last known valid entry until an explicitly defined retirement/deletion behavior is implemented.

Phase 1 does not automatically delete registry entries merely because a source file disappears. Safe retirement semantics require a separate design decision.

## Model profiles

Agent definitions must not hard-code CT108 deployment details.

Agent Spec v1 is extended for Phase 1 to reference a profile, for example:

```json
{
  "model": {
    "profile": "local-general"
  }
}
```

The controller resolves the profile from server-side configuration.

Initial profiles:

- `local-router` — lightweight routing/classification.
- `local-general` — routine homelab reasoning, diagnostics, and summaries.
- `local-coder` — code/configuration analysis when a future development agent needs it.

Production `local-general` should resolve to the deployed CT108 Ollama service and the currently approved local model, initially:

```text
provider: ollama
base URL: http://192.168.1.70:11434
model: qwen3:4b-instruct
```

No client-facing API or agent definition exposes credentials. Ollama profile configuration remains server-side.

## Orchestrator

Phase 1 orchestration selects one agent. It does not coordinate multi-agent tool workflows yet.

Routing precedence:

1. **Explicit override.** A manually selected agent or explicit operator request such as "ask the Proxmox agent" wins if that agent exists and is enabled.
2. **Deterministic scope routing.** Strong identifiers/keywords and owned scopes map directly to a registered agent.
3. **Local-router classification.** If deterministic routing is ambiguous, the orchestrator may call the CT108 `local-router` profile. The router may return only a registered agent ID plus bounded routing metadata; it does not answer the operator's infrastructure question.
4. **No safe match.** If no enabled agent safely owns the request, return `no-agent-match`. Phase 1 must not invent a destination.

Initial deterministic examples:

- Proxmox, VM IDs, CT/LXC IDs -> Proxmox Observer.
- Omada/VLAN/routing/DHCP/DNS network questions -> future Network Agent when installed.
- Authentik identity questions -> future Identity Agent when installed.
- Emby/SABnzbd/media storage questions -> future Media Agent when installed.

Only registered and enabled agents are eligible.

## Agent runtime

The selected agent is loaded from the runtime registry and executed through the existing constrained local-agent runtime pattern.

Every agent response must include provenance sufficient for the UI/operator to identify:

- agent ID/name;
- model profile;
- provider (`ollama`);
- resolved model;
- mode (`local-agent`);
- routing mode (`manual`, `deterministic`, or `local-router`) when routing was involved;
- explicit execution status showing that no infrastructure action ran.

Phase 1 agents may describe declared tool names for reasoning/context but cannot invoke any tool. The LLM must not receive a tool executor, shell, Docker write path, Proxmox write path, SSH write path, network write path, or infrastructure mutation capability.

## API contract

### Read APIs

```text
GET /api/agents
GET /api/agents/:agentId
GET /api/agents/registry/status
```

`GET /api/agents` returns sanitized runtime registry entries. It must not expose secrets or raw server configuration.

`GET /api/agents/:agentId` returns one sanitized registered agent or `404`.

`GET /api/agents/registry/status` returns the latest registry synchronization state.

### Advisory/operator-safe POST APIs

```text
POST /api/agents/route
POST /api/agents/:agentId/ask
POST /api/agents/registry/sync
```

`POST /api/agents/route` performs classification only and returns a selected agent ID or a safe no-match result.

Representative response:

```json
{
  "agentId": "proxmox-observer",
  "agentName": "Proxmox Observer",
  "routing": "deterministic",
  "confidence": 0.98,
  "reason": "Request references a Proxmox LXC identifier."
}
```

`POST /api/agents/:agentId/ask` performs local Ollama inference only. It never executes infrastructure actions.

Representative response:

```json
{
  "available": true,
  "agentId": "proxmox-observer",
  "provider": "ollama",
  "modelProfile": "local-general",
  "model": "qwen3:4b-instruct",
  "mode": "local-agent",
  "response": "...",
  "execution": {
    "performed": false,
    "reason": "Phase 1 agents are advisory only."
  }
}
```

`POST /api/agents/registry/sync` may update only Friday-owned registry tables from the current Git-authoritative definitions. It cannot change infrastructure, execute tools, or edit Git.

All request bodies must have explicit bounds comparable to existing `/api/assistant` safeguards.

## Agents workspace

The current generic Agents placeholder becomes a purpose-built workspace.

Phase 1 UI includes:

- registry status/health;
- registered agent list/cards;
- enabled/available state;
- agent name/description;
- model profile and resolved local model metadata where safe;
- host scope;
- declared tool names;
- permission summary;
- source path/checksum/last sync metadata;
- routing examples/status where useful;
- read-only `Ask this agent` conversation surface;
- visible `Local Ollama` and `Advisory only · No actions executed` messaging.

Phase 1 UI excludes:

- create/edit/delete agent controls;
- Supabase-authored agent policy changes;
- enable/disable mutation controls unless separately designed;
- run-tool buttons;
- restart/start/stop/delete controls;
- approval controls;
- task execution;
- shell access;
- network/configuration mutation.

Manual selection in the Agents workspace directly calls the selected agent and bypasses automatic routing.

## Relationship to the general FRIDAY assistant

The existing FRIDAY assistant and the new agent subsystem remain separate runtime paths in Phase 1.

### General FRIDAY assistant

May retain the configured provider sequence:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

It remains advisory/read-only.

### Friday Agents

Use:

```text
CT108 Ollama only
```

If CT108 is unavailable, Phase 1 agents fail cleanly. They do not use a cloud fallback.

## Failure behavior

### Supabase unavailable

- Agent registry APIs report the registry unavailable.
- Friday must not invent agent records.
- Existing non-agent Friday features should continue operating when possible.

### Invalid Git definition

- Reject the invalid definition.
- Record a sanitized rejection in registry status.
- Do not activate invalid policy.
- Preserve the last known valid runtime entry when one exists.

### CT108/Ollama unavailable

- Return `local-agent-unavailable` or equivalent normalized failure.
- Do not silently fall back to Groq/Gemini/OpenAI/Anthropic.

### Local-router unavailable

- Continue deterministic matching.
- If deterministic routing is insufficient, return `no-agent-match` or `router-unavailable` rather than guessing.

### Agent disabled/not found

- Explicit requests return a normalized unavailable/not-found result.
- Automatic routing excludes that agent.

All provider/registry failures must remain non-fatal to unrelated `/api/overview`, monitoring, incident, and general assistant operation.

## Security and safety boundaries

Phase 1 preserves the repository's current read-only infrastructure boundary.

Non-negotiable requirements:

- no unrestricted LLM-to-shell path;
- no infrastructure tool executor;
- no Docker mutation API;
- no Proxmox mutation API;
- no SSH write execution;
- no network/firewall/DNS/DHCP/VLAN changes;
- no secrets in agent definitions, prompts, browser variables, or API responses;
- no cloud fallback for Agent Spec v1 runtime;
- no action may be represented as executed;
- permission declarations remain policy metadata only until a separately designed executor enforces them;
- destructive/undeclared actions remain forbidden by default.

Authentication/RBAC, durable action audit, approvals, global automation kill switch, and controlled mutation remain prerequisites for any future action executor.

## Testing strategy

### Agent Spec/model profile tests

Prove:

- required fields/profile references validate;
- invalid profiles fail closed;
- undeclared actions resolve to forbidden;
- server-side profile resolution does not leak sensitive configuration;
- existing prototype definitions are migrated to the profile-based contract.

### Registry synchronization tests

Use a fake/in-memory Supabase client boundary or equivalent isolated data adapter to prove:

- valid Git definitions are synchronized;
- checksums and source metadata are stable;
- invalid definitions are rejected;
- invalid updates do not overwrite the last known valid row;
- status counts/errors are normalized;
- sync never mutates managed infrastructure.

### Routing tests

Prove:

- explicit override wins;
- deterministic routing selects strong matches;
- only enabled/registered agents are eligible;
- ambiguous requests may use the local router;
- local-router output must resolve to an actual registered agent;
- unavailable router does not trigger cloud fallback;
- no safe match returns a safe no-match response.

### Runtime/API tests

Prove:

- agent inference uses only resolved Ollama profiles;
- response provenance is preserved;
- `execution.performed` is always false in Phase 1;
- no agent endpoint exposes mutation operations;
- failures are normalized and do not crash unrelated Friday APIs;
- request bodies/history are bounded.

### Offline regression

Run a test configuration with Groq, Gemini, OpenAI, and Anthropic credentials absent/disabled and prove the local agent path still operates through a mocked or controlled Ollama endpoint.

This test is a Phase 1 acceptance requirement because cloud independence is a primary product goal.

### UI tests

Prove:

- Agents navigation renders the purpose-built workspace;
- registry unavailable/empty/healthy states render safely;
- manual agent selection targets the selected agent;
- provenance and advisory-only messaging are visible;
- no create/edit/delete/action/approval/remediation controls exist;
- desktop/mobile layouts remain usable under the existing Friday responsive contracts.

## Deployment/configuration

Phase 1 adds server-side configuration for:

- self-hosted Supabase URL;
- server-only Supabase credential appropriate to the limited Friday-owned registry schema;
- model profile definitions/resolution;
- agent registry enablement/sync behavior.

No Supabase secret may use a `VITE_*` environment variable.

The self-hosted Supabase service is an external local dependency of Friday. The Friday repository should contain schema/migration/setup documentation needed to reproduce the registry tables, but Phase 1 must not make cloud Supabase a requirement.

VM102 remains the authoritative Friday controller. CT108 remains the local Ollama host.

## Documentation updates required during implementation

Implementation must reconcile the existing stale handoff documentation:

- `docs/codex/BUILD_STATUS.md` must mark the Friday Assistant session UX as completed and describe the new agent-platform state accurately;
- `docs/codex/NEXT_STEPS.md` must retire the completed assistant milestone and make Local Agent Platform Phase 1/current follow-up work authoritative;
- `README.md`, `.env.example`, Agent Spec docs, and API contract docs must reflect the final implemented agent registry/model-profile/API behavior.

## Explicitly out of scope

Phase 1 does not include:

- durable assistant/agent memory;
- pgvector;
- task/workflow execution;
- action request lifecycle;
- human approvals;
- action audit log;
- global automation kill switch implementation;
- controlled tool executor;
- safe-action execution;
- configuration mutation;
- destructive operations;
- multi-agent execution workflows;
- cloud fallback for agents;
- agent creation/editing from the UI;
- bidirectional Git/Supabase synchronization.

These require later designs.

## Definition of done

Phase 1 is complete when all of the following are true:

1. Git remains authoritative for Agent Spec definitions.
2. Self-hosted Supabase contains a synchronized validated runtime registry and registry status.
3. Invalid definitions fail closed and cannot overwrite valid runtime policy.
4. Model profiles resolve agent inference to CT108 without deployment-specific model URLs in agent definitions.
5. Friday can route a request automatically or honor explicit manual selection.
6. The Proxmox Observer can be discovered and queried through the new agent APIs using local Ollama only.
7. The Agents navigation renders a functional registry-backed read-only workspace and `Ask this agent` experience.
8. Cloud credentials can be absent and the agent path still works through Ollama.
9. No Phase 1 endpoint, UI, model, or agent has infrastructure mutation/tool-execution authority.
10. CI/tests enforce the above safety and offline requirements.
11. Source-of-truth documentation is updated to match the shipped state.
