# Friday Local Agent Platform

## Goal

Friday's core agent capability must work inside the homelab without requiring OpenAI, Anthropic, Groq, Gemini, Azure AI, or another third-party AI service. Phase 1 provides **local-only advisory agents** backed by CT108 Ollama while preserving Friday's existing multi-provider general assistant for requests that do not match a local agent.

`local-first` means cloud-independent. It does not mean protocol-free: Friday may use private LAN interfaces to self-hosted services, but every integration must remain within the repository's safety policy.

## Phase 1 implemented architecture

```text
Operator
  -> Friday UI / shared Friday session
      -> local agent route
           -> explicit/manual override
           -> deterministic registered-agent match
           -> CT108 local-router when ambiguous
      -> matched agent
           -> Git-authoritative agent definition
           -> Supabase runtime registry row
           -> server-side Ollama model profile
           -> fresh normalized Friday state
           -> CT108 Ollama inference
      -> no match
           -> existing Friday assistant path
```

A matched local agent **never** falls back to Groq, Gemini, OpenAI, Anthropic, or the general assistant chain after local inference failure. No-match is different: no-match means no agent took ownership, so the normal Friday assistant path remains available.

## Agent authority and registry

Git is authoritative for Phase 1 agent definitions:

```text
agents/*.json
```

Definitions use Agent Spec v1.1 and contain portable behavior/scope/tool-policy metadata. They do not contain deployment URLs, credentials, or cloud-provider selection.

Self-hosted Supabase/Postgres is the runtime registry/cache. Phase 1 permits exactly two registry tables:

```text
friday_agents
friday_agent_registry_state
```

No action, approval, task, memory, executor, credential, or tool-run table is part of Phase 1. Schema enforcement is automated by `scripts/validate-agent-registry-schema.mjs` and CI.

Registry sync is explicit. Valid Git definitions can update runtime registry rows; invalid changed definitions fail closed and cannot overwrite the last known valid row. Missing Git definitions are not silently converted into runtime deletion during Phase 1.

## Agent Specification v1.1

Agent definitions separate portable policy from deployment model configuration. Typical shape:

```json
{
  "version": "1.1",
  "id": "proxmox-observer",
  "name": "Proxmox Observer",
  "model": { "profile": "local-general" },
  "scope": { "platforms": ["proxmox"], "hosts": ["VM 100", "LXC 108"] },
  "tools": ["proxmox_read", "inventory_read"],
  "permissions": { "read": ["proxmox.inventory"], "write": [] }
}
```

See `docs/agent-spec-v1.md` for the authoritative contract.

## Local model profiles

VM102 resolves profile IDs server-side. Phase 1 profiles are Ollama-only:

- `local-router` — bounded intent classification/agent selection;
- `local-general` — routine diagnostics, inventory reasoning, and summaries;
- `local-coder` — local code/configuration analysis for future development agents.

The initial deployment uses CT108 at `http://192.168.1.70:11434` with `qwen3:4b-instruct`. Keep TCP/11434 restricted to VM102.

Model profiles make agents portable: changing a local model or Ollama endpoint does not require rewriting each agent definition.

## Routing

Routing is bounded to enabled registered agents:

1. An explicit agent ID wins only if that agent exists and is enabled.
2. Strong registered platform/scope language can route deterministically.
3. Ambiguous requests may use the `local-router` profile.
4. Local-router output must be an exact enabled candidate ID or no-match.
5. Router failure returns a safe unavailable/no-match result rather than inventing an agent.

The shared Friday session calls this routing layer before the general assistant. Manual direct ask is also available from the Agents workspace.

## Phase 1 API

```text
GET  /api/agents
GET  /api/agents/:agentId
GET  /api/agents/registry/status
POST /api/agents/route
POST /api/agents/:agentId/ask
POST /api/agents/registry/sync
```

`registry/sync` accepts only an empty JSON object and updates Friday-owned registry state from Git. `route` and `ask` validate bounded prompts. Agent IDs are constrained machine IDs rather than arbitrary paths.

There is no create/edit/delete agent API and no execute/restart/shell/tool endpoint.

## Shared session behavior

The existing merged Friday Assistant session remains browser-memory-only. For each new user message:

- a matched local agent can answer first;
- local-agent provenance is stored on the same session message surface;
- no-match continues to the existing assistant request;
- fresh normalized Friday infrastructure state is authoritative;
- session history remains context rather than infrastructure evidence.

Local-agent replies expose `mode:"local-agent"`, `provider:"ollama"`, selected agent/profile/model, and `execution.performed=false`.

## Agents workspace

The responsive Agents workspace provides:

- registry health/status;
- Git source path/checksum/sync metadata;
- enabled agent list/details;
- scope, tools, and model profile visibility;
- explicit registry sync;
- manual agent selection and direct ask;
- local Ollama model/provenance display;
- clear advisory-only copy.

It intentionally provides no Restart, Execute, Delete, Approve, Shell, Edit agent, or Create agent controls.

## Phase 1 safety boundary

Phase 1 has **no tool executor**. Declared agent tools and permissions are policy metadata only.

Non-negotiable Phase 1 rules:

- no unrestricted LLM-to-root-shell path;
- no SSH/shell execution from `server/agents`;
- no Docker/Proxmox/network mutation endpoint;
- no browser-visible Supabase service credential;
- no cloud fallback after a local agent has matched;
- no durable agent memory/task/approval/action tables;
- no successful action claim: agent responses remain `execution.performed=false`;
- Git remains the authoring authority.

CI enforces the registry schema and key source boundaries in addition to runtime tests.

## Self-hosted Supabase deployment handoff

Apply the checked-in migration to the intended local Supabase/Postgres database before enabling the registry:

```text
supabase/migrations/202608300001_friday_agent_registry.sql
```

Use the local Supabase SQL editor or a trusted local `psql` connection. The migration must result in exactly the two Phase 1 registry tables listed above.

On VM102, preserve the existing production `.env` before editing it. Add only the server-side variables already documented in `.env.example`:

```env
FRIDAY_AGENT_REGISTRY_ENABLED=true
FRIDAY_SUPABASE_URL=
FRIDAY_SUPABASE_SERVICE_KEY=
FRIDAY_AGENT_LOCAL_ROUTER_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_ROUTER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_GENERAL_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_GENERAL_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_CODER_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_CODER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_MODEL_CONTEXT=8192
FRIDAY_AGENT_MODEL_MAX_TOKENS=768
```

Do not place the Supabase service key or local infrastructure secrets in browser variables or Git.

## Live acceptance checklist

After deployment, verify in this order:

1. `GET /api/agents` returns the expected registered definition(s).
2. `GET /api/agents/registry/status` reports a healthy local registry state.
3. `POST /api/agents/registry/sync` with `{}` succeeds and does not mutate infrastructure.
4. `POST /api/agents/route` with a Proxmox-specific prompt selects `proxmox-observer`.
5. `POST /api/agents/proxmox-observer/ask` returns `provider:"ollama"`, `mode:"local-agent"`, expected local profile/model, and `execution.performed:false`.
6. The normal Friday composer automatically routes a Proxmox prompt to the local agent and shows local provenance.
7. Desktop and phone Agents workspace layouts remain usable and show no action controls.
8. Existing `/healthz`, `/api/health`, `/api/overview`, monitoring, diagnostics, and assistant paths remain healthy.

## Future phases

### Phase 2 — safety prerequisites and controlled-action design

Before any action executor exists, implement authentication/RBAC, durable append-only action audit, explicit approval workflow, and a global automation kill switch. Only then design a typed allowlisted executor.

### Phase 3 — approved configuration workflows

Prefer versioned Git/Ansible/config plans, explicit diff/plan preview, approval, rollback metadata, and verification.

### Phase 4 — restricted destructive workflows

Only explicitly justified operations with stronger approval and backup/snapshot preconditions may be considered. High-risk actions may remain forbidden permanently.

## Definition of Phase 1 success

Friday Phase 1 is successful when a registered agent can be synced from Git, routed automatically or selected manually, reason over fresh normalized homelab state using CT108 Ollama with cloud AI unavailable, return useful advisory output with local provenance, and remain incapable of executing infrastructure changes.