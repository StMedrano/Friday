# Friday Agent Specification v1

Friday agents are local-first definitions that separate agent behavior from the language model. Version 1 requires Ollama and is designed to work without OpenAI, Anthropic, Groq, Gemini, or other cloud AI providers.

## Required fields

- `version`: specification version.
- `id`: stable machine-readable agent identifier.
- `name`: display name.
- `model.provider`: must be `ollama` in v1.
- `model.model`: local Ollama model name.
- `tools`: allowed Friday tool names.
- `permissions`: action-to-policy map.

## Optional fields

- `description`: agent purpose.
- `model.baseUrl`: defaults to `http://127.0.0.1:11434`.
- `model.context`: defaults to 8192.
- `model.maxTokens`: defaults to 768 in the runtime.
- `scope.hosts`: host aliases the agent is allowed to target.
- `instructions`: additional operational constraints.

## Permission modes

Every declared action must use one of three modes:

- `auto`: Friday may perform the action after normal policy checks.
- `approval`: Friday must obtain explicit approval before execution.
- `forbidden`: Friday must not execute the action.

Any action that is not declared defaults to `forbidden`.

## Safety model

The model does not receive unrestricted shell access. It can reason about tools and request an action, but Friday's controller remains responsible for validating scope, permissions, approval state, and audit requirements before any tool executor runs.

The first shipped agent, `agents/proxmox-observer.json`, is intentionally diagnostic-first. Destructive operations such as VM deletion and disk formatting are forbidden.

## Runtime

`server/ai/agent-runtime.mjs` validates the agent definition, constructs a constrained system prompt, and delegates inference to Friday's existing Ollama provider. This keeps the local model provider replaceable while preserving one agent contract.

## Next implementation milestone

The next runtime layer should add a typed tool registry and executor contract. Tool execution should return structured results to the orchestrator and must enforce permission mode independently of the LLM's output.
