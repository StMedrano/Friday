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
- `enabled`: Git-authoritative boolean; defaults to enabled when omitted by future loaders.
- `scope.hosts`: host aliases the agent is allowed to target.
- `instructions`: additional operational constraints.

Agent Spec v1.1 must not include deployment-specific `model.provider`, `model.model`, `model.baseUrl`, `model.context`, or `model.maxTokens` fields. Those values belong to server-side model profiles so an agent definition remains portable between local Ollama deployments.

## Model profiles

The Friday controller resolves profile IDs such as:

- `local-router` — bounded routing/classification.
- `local-general` — routine homelab reasoning, diagnostics, and summaries.
- `local-coder` — code/configuration analysis for future development agents.

Profiles remain server-side and resolve to Ollama only in Phase 1. The production `local-general` profile initially targets CT108 at `http://192.168.1.70:11434` with `qwen3:4b-instruct`.

## Permission modes

Every declared action must use one of three modes:

- `auto`: policy metadata for an action that may eventually be eligible for automatic execution after the required executor/audit safety architecture exists.
- `approval`: policy metadata for an action that would require explicit operator approval in a future controlled-action phase.
- `forbidden`: Friday must not execute the action.

Any action that is not declared defaults to `forbidden`.

**Phase 1 does not implement a tool executor.** All permission values are descriptive policy metadata only and no agent action is executed.

## Safety model

The model receives no unrestricted shell access and no infrastructure mutation tools. It can reason about declared tools and suggest actions, but it cannot invoke them in Phase 1. Friday must never claim an infrastructure action ran unless a future separately designed executor actually returns a verified result.

The first shipped agent, `agents/proxmox-observer.json`, is intentionally diagnostic-first. Destructive operations such as VM deletion and disk formatting remain forbidden.

## Runtime

`server/ai/agent-runtime.mjs` validates the v1.1 definition, constructs a constrained system prompt, and delegates inference to Friday's existing Ollama provider using a separately resolved model profile. Agent JSON never selects a cloud provider and never embeds CT108 credentials or deployment-specific model endpoints.

## Next implementation milestone

Phase 1 builds the registry, routing, API, and read-only Agents workspace around this contract. A typed tool registry/executor remains a later milestone and must not be introduced until authentication, RBAC, durable action audit, approval infrastructure, and the global automation kill switch are implemented and tested.
