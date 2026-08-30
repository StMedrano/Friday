# Friday Agent Specification v1

Friday agents are local-first definitions that separate agent behavior from deployment-specific model configuration. Phase 1 uses **Agent Spec v1.1** and requires local Ollama model profiles resolved by the Friday controller. Agent definitions must work without OpenAI, Anthropic, Groq, Gemini, or another cloud AI provider.

## Required fields

- `version`: must be `1.1` for Phase 1.
- `id`: stable machine-readable agent identifier.
- `name`: display name.
- `model.profile`: server-resolved local Ollama model profile ID.
- `tools`: declared Friday tool names used as policy metadata in Phase 1.
- `permissions`: action-to-policy map.

## Optional fields

- `description`: agent purpose.
- `enabled`: Git-authoritative boolean.
- `scope.hosts`: host aliases the agent is allowed to target.
- `scope.platforms`: platform families used for deterministic routing.
- `instructions`: additional operational constraints.

Agent Spec v1.1 must not include deployment-specific `model.provider`, `model.model`, `model.baseUrl`, `model.context`, or `model.maxTokens` fields. Those values belong to server-side model profiles so an agent definition remains portable between local Ollama deployments.

## Source of truth

Git under `agents/` is authoritative for definitions and enabled state. Self-hosted Supabase is a runtime registry/cache, not an authoring surface. The Phase 1 sync process validates Git definitions before updating registry rows; invalid changed definitions cannot replace the last known valid registry row, and a missing Git file does not silently delete a runtime row.

## Model profiles

The Friday controller resolves profile IDs such as:

- `local-router` — bounded routing/classification.
- `local-general` — routine homelab reasoning, diagnostics, and summaries.
- `local-coder` — code/configuration analysis for future development agents.

Profiles resolve to **Ollama only** in Phase 1. The initial VM102 configuration points the local profiles to CT108 (`192.168.1.70:11434`) and `qwen3:4b-instruct`.

## Routing

Agent selection supports three paths:

1. explicit/manual agent override;
2. deterministic routing for strong registered scope/platform language;
3. the bounded `local-router` Ollama profile for ambiguous requests.

The router may select only an enabled registered agent ID or return no match. Unknown router output is rejected. A matched agent is then run only through its resolved local Ollama model profile; it does **not** fall back to Friday's cloud assistant providers.

## Permission modes

Every declared action must use one of three modes:

- `auto`: future policy metadata only;
- `approval`: future policy metadata for an action that would require operator approval;
- `forbidden`: Friday must not execute the action.

Any undeclared action defaults to `forbidden`.

**Phase 1 does not implement a tool executor.** Permission values are descriptive policy metadata only.

## Safety model

The model receives no unrestricted shell access and no infrastructure mutation tools. It can reason about declared tools and suggest actions, but it cannot invoke them in Phase 1. Every successful local-agent response carries `execution.performed=false`; Friday must never claim an infrastructure action ran unless a future separately designed executor returns a verified result.

The first shipped definition, `agents/proxmox-observer.json`, is intentionally diagnostic/read-only. Destructive operations remain forbidden.

## Runtime

`server/ai/agent-runtime.mjs` validates the v1.1 definition, constructs a constrained system prompt, and delegates inference to Friday's existing Ollama transport using a resolved model profile. Agent JSON never selects a cloud provider and never embeds CT108 credentials or deployment-specific model endpoints.

Phase 1 registry, routing, API, shared-session auto-routing, manual override, and the read-only Agents workspace are implemented in PR #19. Live VM102/Supabase/UI acceptance remains a separate rollout gate before the PR is ready to merge.

## Future executor prerequisite

A typed tool registry/executor remains a later milestone. Do not add it until authentication/RBAC, durable append-only action audit, explicit approval infrastructure, and a global automation kill switch are implemented and tested.