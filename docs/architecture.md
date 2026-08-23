# Friday Architecture

```text
Browser
   |
   v
FRIDAY UI/API — VM 102 (192.168.1.64:3010)
   |
   +--> Proxmox read-only API — 192.168.1.211:8006
   +--> VM100 observer — 192.168.1.124:3199
   +--> HTTP endpoint checks
   +--> optional local VM102 Docker adapter
   |
   +--> POST /api/assistant
          |
          +--> monitoring-aware normalized overview
          +--> OpenAI
          +--> Anthropic
          +--> Gemini
          +--> private Ollama / qwen3:4b
          +--> deterministic previewCommand fallback
   |
   v
Future policy / approval / audit layer
```

VM 102 is the authoritative FRIDAY controller. VM 100 is managed infrastructure and hosts the standalone read-only Docker observer; VM 110 remains the media/Umbrel workload.

## Assistant provider orchestration

`POST /api/assistant` receives the same monitoring-aware normalized overview used by the UI. Friday evaluates configured AI providers sequentially in `FRIDAY_AI_PROVIDER_ORDER`. The default order is OpenAI, Anthropic, Gemini, then the private Ollama service. Availability failures fall through to the next configured provider. If no AI provider can answer, Friday uses the existing deterministic `previewCommand` analysis when the request maps to a supported read-only command family.

The configured order can change, but provider calls remain sequential rather than parallel fanout. UI responses include provenance so the operator can distinguish cloud AI, local AI, and deterministic non-AI analysis.

Ollama is an optional Compose profile service on `friday_frontend`. It has no host-published port. The Friday server reaches it by the Docker service name `ollama` only when local AI is explicitly enabled.

## Safety boundaries

The controller base Compose does not mount the Docker socket. Proxmox and the VM100 observer are network read-only integrations. Local VM102 Docker observation is an explicit opt-in through the live override.

The VM100 observer uses the local Unix socket but exposes only fixed, authenticated read-only routes. Docker's native TCP API is never published.

AI providers receive the normalized Friday overview and the shared read-only/state-grounded assistant policy. They receive no shell, Docker, Proxmox, Omada, firewall, or other mutation tool surface.

No infrastructure mutation endpoints exist in the current controller or observer.