# Friday Agent Fabric — Phase 2A Internal Model Fabric

The free-first model fabric is an **internal, opt-in server module**. It is not the user-facing Friday Assistant, not a public HTTP endpoint, and not an infrastructure tool executor. Deploying this branch does not enable it automatically.

## Policy

`freeOnly: true`, `allowPaidFallback: false`, and `maxPaidSpendPerDay: 0` are fixed. Targets with `billingClass: "paid"` or `"unknown"` cannot run, even if an operator passes a permissive routing policy. Only explicitly configured, enabled, free-class models may execute. Free eligibility is an **operator assertion**: verify NVIDIA endpoint tier, limits, licensing, account eligibility, and current billing details before declaring any hosted model free. A provider's free tier may have limits or change; Friday does not verify prices or billing in this phase.

If no eligible model is healthy, results return `available:false`, `error:"no-free-model-available"`, and sanitized attempts. No automatic paid fallback, shell execution, infrastructure changes, background task runner, or model-driven external tools exist here.

## Configuring hosted NVIDIA

Use server-side environment variables only. **Never** name a credential `VITE_*`, store it in frontend code, or commit a real key.

```dotenv
FRIDAY_MODEL_FABRIC_ENABLED=false
FRIDAY_NVIDIA_ENABLED=false
FRIDAY_NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEY=
FRIDAY_NVIDIA_MODELS_JSON=[{"id":"example-hosted-free","model":"vendor/model-id-from-operator","billingClass":"free","capabilities":["general","reasoning"],"supportsTools":false,"supportsVision":false,"maxTokens":768}]
```

Set both enable flags to `true` only after independently confirming that the hosted target is genuinely free **for the configured account and intended usage**. The model ID above is a placeholder, not a verified free model recommendation.

## Local NVIDIA NIM

```dotenv
FRIDAY_NVIDIA_LOCAL_ENABLED=false
FRIDAY_NVIDIA_LOCAL_BASE_URL=http://nvidia-nim:8000/v1
FRIDAY_NVIDIA_LOCAL_MODELS_JSON=[{"id":"example-local-free","model":"operator-installed-model-id","billingClass":"free","capabilities":["general"],"supportsTools":false,"supportsVision":false}]
```

Local NIM does not require `NVIDIA_API_KEY`. Enable it only once a deployed endpoint exposes `GET /v1/models` and `POST /v1/chat/completions`. A later move from NVIDIA hosted to a homelab NIM host involves changing server-side base URL, model metadata, and enable flags—not changing routing logic. Local hosting still incurs hardware/electricity and potentially licensing costs.

Each descriptor requires `id`, `model`, `billingClass` (`free`, `paid`, `unknown`), nonempty `capabilities`, boolean `supportsTools` and `supportsVision`. `enabled` (boolean) and `maxTokens` (positive integer) are optional. Metadata is explicitly declared, not inferred from model names. Malformed JSON or incomplete targets are ignored. Descriptors exposed through `listEligible` never include credentials, model URLs, or provider private configuration.

## Internal integration

Call `createModelFabric({config:getConfig(process.env)})` in server-only code, then `listEligible({capabilities:['general']})` or `generate({requirements:{capabilities:['general'],privacy:'cloud-ok'},request:{messages:[{role:'user',content:'Hi'}]}})`. `privacy:'local-only'` excludes hosted models; `multimodal:true` requires `supportsVision:true`, and `tool-use` requires `supportsTools:true`. Tool support metadata is for selection only—**no tool executor** is introduced.

Health probes `GET /models` for the exact configured model ID; generation sends OpenAI-style `POST /chat/completions`. On normalized provider unavailability, the fabric tries the next eligible free target once. Unexpected errors fail closed. The module is not invoked by existing Assistant or local Agent routes in Phase 2A.

## Deployment prerequisites

Phase 1 live acceptance must be documented and verified before exposing or deploying this phase. Tests and code review alone do not establish hosted free-tier eligibility or operational safety.