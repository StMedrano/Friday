# Friday AI provider chain

Friday's preferred read-only assistant path is sequential:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

Friday never fans requests out to multiple providers in parallel. A provider is tried only when it is configured, and Friday moves to the next provider only after a normalized availability failure such as a timeout, rate limit, authentication failure, network failure, or upstream failure. A normal model refusal is returned immediately and does not trigger failover.

## Server-side configuration

Provider credentials are server-only. Never put them in `VITE_*` variables.

```env
FRIDAY_AI_ENABLED=true
FRIDAY_AI_PROVIDER_ORDER=groq,gemini,ollama
FRIDAY_CLOUD_AI_TIMEOUT_MS=15000
FRIDAY_LOCAL_AI_TIMEOUT_MS=45000

GROQ_API_KEY=
GROQ_MODEL=

GEMINI_API_KEY=
GEMINI_MODEL=

FRIDAY_LOCAL_AI_ENABLED=true
FRIDAY_LOCAL_AI_URL=http://192.168.1.70:11434
FRIDAY_LOCAL_AI_MODEL=qwen3:4b-instruct
FRIDAY_LOCAL_AI_CONTEXT=8192
FRIDAY_LOCAL_AI_MAX_TOKENS=512
```

`FRIDAY_AI_REQUEST_TIMEOUT_MS` remains supported as a backward-compatible single timeout. Leave it blank when using the separate cloud and local timeout budgets.

OpenAI and Anthropic adapters remain available for compatibility, but they are not in the default provider order. Add them explicitly to `FRIDAY_AI_PROVIDER_ORDER` only if they are intentionally re-enabled.

## Groq

Friday uses Groq's OpenAI-compatible Chat Completions endpoint:

```text
POST https://api.groq.com/openai/v1/chat/completions
```

The adapter sends only the shared Friday read-only system policy, the operator request, and the normalized Friday overview. It receives no Docker, Proxmox, shell, network, or infrastructure mutation tools.

Set `GROQ_MODEL` explicitly so model changes remain an operator decision instead of being silently coupled to a hard-coded provider default.

## Gemini

Gemini remains the second cloud provider and uses the existing server-side `generateContent` adapter. `GEMINI_MODEL` must be set explicitly.

## CT108 GPU Ollama

The current local fallback is the native Ollama service on CT108:

```text
Proxmox host
  -> AMD Radeon 780M / RADV Vulkan
  -> CT108 friday-ollama (192.168.1.70:11434)
  -> qwen3:4b-instruct
  -> VM102 Friday (192.168.1.64)
```

The CT108 firewall should allow TCP/11434 only from VM102 (`192.168.1.64`). The model is expected to report `100% GPU` in `ollama ps` during inference.

Friday uses an 8192-token context by default and bounds local output with `FRIDAY_LOCAL_AI_MAX_TOKENS` (default `512`). The instruct variant is preferred for routine operational summaries because it avoids the long reasoning behavior observed with the base `qwen3:4b` model. The default local provider timeout is 45 seconds, leaving practical headroom for the measured CT108 Friday workload while cloud providers retain a 15-second default budget.

The Compose `local-ai` Ollama service remains available as an optional private development/recovery path and publishes no host/LAN port. Production VM102 should point `FRIDAY_LOCAL_AI_URL` at CT108 when using the GPU service.

## Safety boundary

AI remains advisory and read-only. All providers receive normalized Friday state only. The shared AI policy requires providers to preserve exact service IDs, VM/LXC numbers, host names, and service-name mappings from normalized state rather than infer, renumber, merge, or substitute identifiers. This change does not add infrastructure execution tools, mutation routes, Docker socket access, Proxmox write access, remediation actions, or approval bypasses.
