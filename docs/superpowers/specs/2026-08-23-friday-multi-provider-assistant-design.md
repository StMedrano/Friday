# Friday Multi-Provider Assistant Design

## Goal

Finish the Friday Assistant experience as a read-only infrastructure copilot that can use multiple cloud AI APIs in a configurable sequence, fall back to a private local model on VM102, and finally fall back to Friday's deterministic local command preview when no AI provider is available.

The assistant must remain advisory only. No provider receives shell, Docker, Proxmox, firewall, deployment, restart, delete, network mutation, or approval tools.

## Current Baseline

Friday already has:

- `POST /api/assistant` in `server/http.mjs`.
- `answerAssistant()` in `server/assistant.mjs`.
- an OpenAI Responses API adapter in `server/ai/openai.mjs`.
- normalized infrastructure state from the same overview used by the UI.
- deterministic read-only command preview at `POST /api/commands/preview` through `previewCommand()` in `server/core.mjs`.
- a Dashboard command composer that currently returns a local placeholder instead of calling `/api/assistant`.
- VM102 sized at 4 vCPU / 8 GB fixed RAM with Ryzen 7 7840HS CPU features exposed, leaving enough memory for a small local Q4 model.

## Provider Architecture

Friday will use a provider registry with a single provider contract. Initial first-class providers are:

1. OpenAI cloud API using the Responses API.
2. Anthropic cloud API using the Messages API.
3. Google Gemini cloud API using `models.generateContent`.
4. Ollama local API on VM102 using `/api/chat`.
5. Deterministic local analysis using Friday's existing `previewCommand()`; this is not an AI provider and is always the final fallback.

The registry must make adding another provider later a small adapter-only change. Examples that may be added later include xAI, OpenRouter, Groq, or another OpenAI-compatible service, but they are outside this milestone.

### Provider Contract

Every AI adapter accepts the same normalized input shape:

```js
{
  providerConfig,
  prompt,
  overview,
  systemPrompt,
  fetchImpl,
  signal,
}
```

Every successful provider returns:

```js
{
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama',
  model: 'provider-model-id',
  text: 'assistant response',
}
```

Provider adapters must not receive infrastructure mutation functions or credentials unrelated to that provider.

## Provider Order and Failover

Provider selection is sequential, never parallel. Friday must not fan the same infrastructure prompt out to multiple cloud providers simultaneously because that increases cost and unnecessary data exposure.

Default order:

```text
openai -> anthropic -> gemini -> ollama -> deterministic
```

The cloud order is configurable with:

```text
FRIDAY_AI_PROVIDER_ORDER=openai,anthropic,gemini,ollama
```

A provider is skipped when it is disabled or lacks the configuration required to call it. Ollama is skipped unless local AI is explicitly enabled.

Friday attempts the next provider for availability failures such as:

- connection errors,
- request timeout,
- HTTP 408,
- HTTP 429,
- provider HTTP 5xx,
- missing/invalid provider configuration,
- invalid or empty upstream response.

Authentication failures such as HTTP 401/403 also permit failover so Friday can remain useful, but the sanitized attempt metadata must record a configuration/authentication failure so the operator can fix it.

A successful provider response is terminal, including a normal model refusal. Friday must not use another provider to bypass a provider's safety refusal.

Prompt validation failures are terminal and do not trigger provider failover.

## Configuration

`FRIDAY_AI_ENABLED` remains the master switch.

Global settings:

```text
FRIDAY_AI_ENABLED=true
FRIDAY_AI_PROVIDER_ORDER=openai,anthropic,gemini,ollama
FRIDAY_AI_REQUEST_TIMEOUT_MS=20000
```

OpenAI:

```text
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
```

Anthropic:

```text
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
```

Gemini:

```text
GEMINI_API_KEY=
GEMINI_MODEL=
```

Ollama:

```text
FRIDAY_LOCAL_AI_ENABLED=false
FRIDAY_LOCAL_AI_URL=http://ollama:11434
FRIDAY_LOCAL_AI_MODEL=qwen3:4b
FRIDAY_LOCAL_AI_CONTEXT=8192
```

Anthropic and Gemini model IDs intentionally have no repository default. Friday skips those providers until a model is explicitly configured, avoiding silent dependence on a model name that may change over time.

All API keys remain server-side and must never use a `VITE_` prefix.

## Shared Safety Prompt

The read-only system policy must move to a provider-neutral module so every cloud and local provider receives the same safety boundary.

Required policy meaning:

- Friday is a read-only infrastructure copilot.
- Analyze only normalized infrastructure state supplied by Friday.
- Explain health, alerts, incidents, likely causes, comparisons, and read-only diagnostic next steps.
- Never claim to have executed, restarted, changed, deleted, deployed, reconfigured, approved, or remediated anything.
- Never invent hosts, credentials, metrics, routes, VLANs, services, or events that are absent from the normalized state.
- Ask for additional read-only signals when state is insufficient.
- Keep answers operational and concise.

No provider request in this milestone includes function tools, code execution tools, MCP tools, shell tools, Docker tools, or Proxmox tools.

## Assistant Orchestrator

`server/assistant.mjs` becomes the orchestration layer rather than an OpenAI-specific wrapper.

It will:

1. reject an empty prompt before provider work,
2. respect `FRIDAY_AI_ENABLED`,
3. build the enabled provider chain from config,
4. call providers sequentially,
5. collect only sanitized attempt metadata,
6. return immediately on the first valid AI response,
7. invoke deterministic fallback if every AI provider is unavailable,
8. return unavailable only when AI providers are exhausted and deterministic preview cannot classify the request.

The orchestrator must support dependency injection of provider functions so unit tests never call real AI APIs.

## Response Contract

Successful cloud response:

```json
{
  "available": true,
  "mode": "cloud-ai",
  "provider": "openai",
  "model": "configured-model",
  "text": "...",
  "fallbackUsed": false,
  "attempts": []
}
```

Successful cloud response after failover:

```json
{
  "available": true,
  "mode": "cloud-ai",
  "provider": "gemini",
  "model": "configured-model",
  "text": "...",
  "fallbackUsed": true,
  "attempts": [
    { "provider": "openai", "outcome": "rate-limited" },
    { "provider": "anthropic", "outcome": "timeout" }
  ]
}
```

Successful local response:

```json
{
  "available": true,
  "mode": "local-ai",
  "provider": "ollama",
  "model": "qwen3:4b",
  "text": "...",
  "fallbackUsed": true,
  "attempts": []
}
```

Successful deterministic response:

```json
{
  "available": true,
  "mode": "local-analysis",
  "provider": "deterministic",
  "model": null,
  "text": "Preview only: service-status would run read-only checks.",
  "fallbackUsed": true,
  "attempts": []
}
```

Attempt metadata may expose provider ID and a sanitized outcome category only. It must never include API keys, raw Authorization headers, full upstream payloads, stack traces, or provider response bodies.

## HTTP Behavior

`POST /api/assistant` continues using the same monitoring-aware normalized overview as `/api/overview`.

Status behavior:

- `200` when any AI provider or deterministic fallback returns an answer.
- `400` for invalid input such as a blank prompt or malformed JSON.
- `503` when no provider can answer and deterministic preview does not support the request.
- `502` only for an unexpected Friday orchestration/server failure.

`GET /api/health` keeps its existing fields for compatibility and may add sanitized AI readiness metadata, but it must not expose credentials.

## UI Experience

The Dashboard and mobile home command composer must call `POST /api/assistant` through a typed client function in `src/lib/api.ts`.

The UI tracks:

- current prompt,
- loading state,
- returned text,
- response mode,
- provider,
- model,
- fallback-used state,
- friendly error state.

Provider provenance is always visible beside the response:

- `FRIDAY CLOUD AI` for OpenAI, Anthropic, or Gemini.
- `FRIDAY LOCAL AI` for Ollama.
- `LOCAL ANALYSIS · NO AI` for deterministic fallback.

The provider/model can appear as secondary metadata, for example `OPENAI · <model>` or `OLLAMA · qwen3:4b`.

The send button and input must prevent accidental duplicate submissions while one request is active. Failure text must not claim any infrastructure mutation occurred.

Desktop and mobile should share the same response presentation contract rather than independently inventing provider-label logic.

## Local Ollama Deployment

Ollama runs as a private Compose sidecar on VM102.

```text
friday container -> http://ollama:11434 -> Ollama
```

Requirements:

- no host port mapping for Ollama,
- same private Friday Docker network,
- persistent model volume,
- local AI disabled by default,
- initial model `qwen3:4b`,
- initial context cap 8192,
- one interactive Friday request at a time for the first benchmark,
- CPU-only first; Radeon 780M passthrough is not part of this milestone.

The model may be pulled during deployment/bootstrap, not during ordinary Friday request handling.

## Privacy and Cost Rules

- Provider order is operator-controlled.
- Only providers explicitly configured may receive Friday infrastructure state.
- Sequential failover prevents multi-provider fanout costs.
- Local Ollama is preferred only according to configured order; the default keeps OpenAI first as previously approved.
- Provider errors are sanitized before they reach the browser.
- API keys are server-only.

## Authentication Boundary

Authentik is planned separately with distinct normal and administrator identities. It is not implemented in this assistant milestone.

Future authorization must exist before Friday gains any controlled infrastructure action capability. The assistant delivered by this milestone stays read-only regardless of user identity.

## Non-Goals

This milestone does not:

- merge or modify PR #9,
- grant Friday infrastructure write authority,
- add Docker/Proxmox execution tools to an LLM,
- implement Authentik,
- implement approval workflows,
- implement automatic remediation,
- passthrough the Radeon 780M GPU,
- send one prompt to several providers in parallel,
- add every possible cloud provider.

## Acceptance Criteria

1. OpenAI, Anthropic, Gemini, and Ollama adapters share one provider contract.
2. Provider order is configurable and tested.
3. Missing/unavailable providers are skipped or failed over safely.
4. A model refusal is returned as a successful provider response and is not bypassed.
5. Deterministic command preview is the final fallback.
6. The same provider-neutral read-only system policy is used by all AI adapters.
7. `/api/assistant` uses monitoring-aware normalized state and returns provider provenance.
8. Desktop and mobile command composers call the real assistant API.
9. UI displays cloud/local/deterministic provenance clearly.
10. Ollama has no LAN host port and persists model data privately on VM102.
11. Unit/integration/UI tests cover provider success, failover, exhaustion, validation, provenance, and loading/error states.
12. Existing read-only monitoring/diagnostics behavior continues to pass the full test suite.
