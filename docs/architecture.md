# Friday Architecture

```text
Browser
   |
   v
FRIDAY UI/API — VM102 friday-controller (192.168.1.64:3010)
   |
   +--> Proxmox read-only API — 192.168.1.211:8006
   +--> VM100 read-only observer — 192.168.1.124:3199
   +--> approved HTTP/read adapters
   +--> optional local VM102 Docker observation (disabled in normal production)
   |
   +--> durable monitoring / incidents / read-only diagnostics
   |
   +--> POST /api/assistant
          |
          +--> monitoring-aware normalized overview
          +--> Groq
          +--> Gemini
          +--> CT108 native Ollama — 192.168.1.70:11434
          |      +--> qwen3:4b-instruct on Radeon 780M / RADV Vulkan
          +--> deterministic local-analysis fallback
   |
   v
Future identity / policy / approval / action-audit layer
```

VM102 is the authoritative FRIDAY controller. VM100 is managed infrastructure and hosts the standalone read-only Docker observer. CT108 is the GPU-backed local-AI fallback. VM110 remains the media/Umbrel workload.

## Assistant provider orchestration

`POST /api/assistant` receives the monitoring-aware normalized overview used by the UI. Friday evaluates configured AI providers sequentially in `FRIDAY_AI_PROVIDER_ORDER`.

Preferred production order:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

Availability failures such as timeout, rate limit, authentication, network, or upstream failures fall through to the next configured provider. A normal model refusal is treated as the provider answer and does not trigger bypass through another provider.

OpenAI and Anthropic adapters remain available for explicit compatibility but are not part of the default provider order.

Cloud providers use a 15-second default timeout. The local Ollama provider uses a 45-second default timeout. The CT108 deployment uses `qwen3:4b-instruct`, 8192 context, and a bounded 512-token local output budget.

Provider calls remain sequential rather than parallel fanout. Responses include provenance so the operator can distinguish cloud AI, local AI, and deterministic non-AI analysis. The shared policy requires exact service IDs, VM/LXC numbers, host names, and service-name mappings from normalized state rather than inferred replacements.

## Local AI topology

Production local AI is external to the Friday controller container:

```text
VM102 Friday (192.168.1.64)
    |
    | TCP/11434
    v
CT108 friday-ollama (192.168.1.70)
    |
    v
qwen3:4b-instruct — Radeon 780M / RADV Vulkan
```

CT108 should allow TCP/11434 only from VM102. The optional Compose `local-ai` service remains a private development/recovery path with no host/LAN-published port; it is not the preferred production local provider while CT108 is available.

## Monitoring and diagnostics

Monitoring persists Friday-owned state under `/data` and creates deterministic incidents from normalized read-only observations. Incident Diagnostics shipped in PR #5 and remains environment-gated.

VM100 diagnostic access is restricted to fixed token-authenticated GET routes for inventory-derived container IDs. Inspect metadata is allowlisted. Raw logs are explicit-request only, bounded/sanitized, ephemeral, and never persisted to monitoring state/history.

There is no diagnostic remediation route.

## Safety boundaries

The controller base Compose does not mount the Docker socket. Proxmox and the VM100 observer are network read-only integrations. Local VM102 Docker observation is an explicit opt-in and is not required for normal Proxmox + VM100 operation.

The VM100 observer uses the local Unix socket but exposes only fixed, authenticated read-only routes. Docker's native TCP API is never published.

AI providers receive the normalized Friday overview and the shared read-only/state-grounded assistant policy. They receive no shell, Docker, Proxmox, Omada, firewall, network, deployment, or other mutation tool surface.

No infrastructure mutation endpoints exist in the current controller or observer. Authentication/RBAC, durable action audit, approval workflow, and a global automation kill switch must exist and be tested before controlled write actions are considered.
