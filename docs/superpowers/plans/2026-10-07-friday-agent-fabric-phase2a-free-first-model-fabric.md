# Friday Agent Fabric Phase 2A — Free-First Model Fabric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Friday's internal free-first model fabric with a provider-neutral NVIDIA/NIM adapter, explicit free-model registry, deterministic capability routing, health-aware failover, and zero implicit paid fallback.

**Architecture:** Add a new internal model-fabric layer under `server/ai/` beside the existing general-assistant provider chain and PR #19 local-agent path. Phase 2A consumes explicit server-side model metadata, routes only eligible free/local model targets, and invokes NVIDIA hosted or local NIM through one provider contract; it does not add durable work orchestration, MCP, plugins, memory, tool execution, or a public model-fabric HTTP endpoint.

**Tech Stack:** Node.js 22 ESM, native `fetch`, `node:test`, existing Friday `ProviderUnavailableError`, Docker Compose, existing Friday server configuration.

**Spec:** `docs/superpowers/specs/2026-10-07-friday-agent-fabric-free-first-architecture-design.md`

## Global Constraints

- **Execution gate:** do not implement this plan until PR #19, `feat: add Friday local agent platform phase 1`, has merged and its documented live-acceptance gates have passed.
- Existing Agent Spec v1.1 remains unchanged in Phase 2A.
- Existing PR #19 agents keep their approved local Ollama profile path; Phase 2A must not silently move them to cloud inference.
- Friday infrastructure remains advisory/read-only; no shell, SSH, Docker, Proxmox, network, deployment, or other mutation path may be added.
- Successful Phase 1 agent replies continue to report `execution.performed=false`.
- Phase 2A policy is fixed to `freeOnly:true`, `allowPaidFallback:false`, `maxPaidSpendPerDay:0`, `preferLocal:true`, and `preferNvidiaFree:true`.
- Paid and `unknown` billing-class models are ineligible. Phase 2A exposes no configuration switch that disables free-only enforcement.
- Free eligibility is explicit operator configuration. Do not scrape or auto-trust NVIDIA's live catalog in Phase 2A.
- Provider credentials are server-only and must never use `VITE_*`, appear in browser-visible state, enter model descriptors, or appear in sanitized failure results.
- Hosted NVIDIA and local NVIDIA NIM use the same Friday provider contract.
- Do not hard-code a currently free NVIDIA model ID into agent policy or orchestration code.
- Add no production dependency unless the existing platform cannot implement the requirement with Node 22 primitives.
- Keep existing Friday assistant behavior compatible; do not insert NVIDIA into `defaultProviders` or `FRIDAY_AI_PROVIDER_ORDER` as part of this phase.

## File Structure

- Create `server/ai/model-registry.mjs` — parse normalized configured NVIDIA targets into secret-free descriptors plus private provider configuration.
- Create `server/ai/model-registry.test.mjs` — registry normalization, malformed configuration, billing, and secret-boundary tests.
- Create `server/ai/nvidia.mjs` — NVIDIA hosted/local NIM health and Chat Completions adapter.
- Create `server/ai/nvidia.test.mjs` — hosted/local authentication, model health, response parsing, and normalized failure tests.
- Create `server/ai/model-router.mjs` — deterministic free/local capability filtering and ordering.
- Create `server/ai/model-router.test.mjs` — capability, privacy, health, free-only, and deterministic-order tests.
- Create `server/ai/model-fabric.mjs` — internal orchestration over registry, router, provider health, and sequential failover.
- Create `server/ai/model-fabric.test.mjs` — end-to-end internal routing/failover/no-paid-fallback tests.
- Modify `server/config.mjs` and `server/config.test.mjs` — server-only model-fabric/NVIDIA configuration.
- Modify `.env.example` and `compose.yaml` — document/pass server-only model-fabric variables.
- Modify `docs/ai-providers.md` — distinguish the legacy assistant chain from the new internal model fabric.
- Create `docs/model-fabric.md` — configuration and Phase 2A operating contract.
- Modify `.github/workflows/ci.yml` — add NVIDIA/model-fabric credential and mutation-boundary checks.
- Modify `server/agents/agent-service.test.mjs` only if needed to pin PR #19 compatibility; do not modify `server/agents/agent-service.mjs` unless a failing compatibility test proves it is necessary.

## Review Focus

1. **Malformed or partially valid model JSON:** Friday must fail closed for invalid entries and still start with an empty eligible registry rather than infer missing billing/capability metadata. Task 1 owns this test.
2. **Hosted versus local NVIDIA authentication:** hosted targets require `NVIDIA_API_KEY`; local NIM targets must be allowed without a cloud key. Task 2 owns this test.
3. **A free model becomes unavailable or rate-limited:** Friday may try the next eligible free/local model only; it must never cross into a paid/unknown target. Task 4 owns this test.
4. **Capabilities/vision/tool requirements are incomplete:** a model missing a required declared capability, tool support, or vision support must not be selected. Task 3 owns this test.
5. **Secret exposure through config/docs/CI:** `NVIDIA_API_KEY` and future provider secrets must remain server-side and absent from `VITE_*`, public descriptors, attempts, and browser source. Tasks 1 and 5 own these tests/checks.

---

### Task 1: Add Free-First Model-Fabric Configuration and Registry

**Files:**
- Create: `server/ai/model-registry.mjs`
- Create: `server/ai/model-registry.test.mjs`
- Modify: `server/config.mjs`
- Modify: `server/config.test.mjs`
- Modify: `.env.example`
- Modify: `compose.yaml`

**Interfaces:**
- Consumes: existing `getConfig(env)` and server-only environment conventions.
- Produces: `buildModelTargets(modelFabricConfig) -> ModelTarget[]` and `publicModelDescriptor(target) -> ModelDescriptor`.
- `ModelTarget` has `descriptor` plus private `providerConfig`; only `providerConfig` may contain `apiKey`.
- `ModelDescriptor` fields: `id`, `provider`, `deployment`, `billingClass`, `capabilities`, `supportsTools`, `supportsVision`, `enabled`.
- NVIDIA model-list environment entries use JSON objects with `id`, `model`, `billingClass`, `capabilities`, `supportsTools`, `supportsVision`, optional `enabled`, and optional positive `maxTokens`.

- [ ] **Step 1: Write failing configuration tests**

Add assertions equivalent to:

```js
const config = getConfig({
  FRIDAY_MODEL_FABRIC_ENABLED: 'true',
  FRIDAY_NVIDIA_ENABLED: 'true',
  NVIDIA_API_KEY: 'server-secret',
  FRIDAY_NVIDIA_MODELS_JSON: JSON.stringify([{
    id: 'nvidia-general-free',
    model: 'vendor/model-a',
    billingClass: 'free',
    capabilities: ['general', 'reasoning'],
    supportsTools: false,
    supportsVision: false,
  }]),
})

assert.equal(config.modelFabric.enabled, true)
assert.deepEqual(config.modelFabric.policy, {
  freeOnly: true,
  allowPaidFallback: false,
  maxPaidSpendPerDay: 0,
  preferLocal: true,
  preferNvidiaFree: true,
})
assert.equal(config.modelFabric.nvidia.apiKey, 'server-secret')
```

Also assert the default hosted base URL is `https://integrate.api.nvidia.com/v1`, the default local NIM base URL is `http://nvidia-nim:8000/v1`, both NVIDIA modes are disabled by default, and malformed model JSON resolves to an empty list.

- [ ] **Step 2: Run configuration tests and verify failure**

Run:

```bash
node --test server/config.test.mjs
```

Expected: FAIL because `config.modelFabric` does not exist.

- [ ] **Step 3: Implement model-fabric configuration**

In `server/config.mjs`, add private JSON-list parsing that returns `[]` for invalid JSON/non-array input and add:

```js
config.modelFabric = {
  enabled,
  policy: {
    freeOnly: true,
    allowPaidFallback: false,
    maxPaidSpendPerDay: 0,
    preferLocal: true,
    preferNvidiaFree: true,
  },
  nvidia: {
    enabled,
    baseUrl,
    apiKey,
    models,
    localEnabled,
    localBaseUrl,
    localModels,
  },
}
```

Use these exact environment names:

```text
FRIDAY_MODEL_FABRIC_ENABLED
FRIDAY_NVIDIA_ENABLED
FRIDAY_NVIDIA_BASE_URL
NVIDIA_API_KEY
FRIDAY_NVIDIA_MODELS_JSON
FRIDAY_NVIDIA_LOCAL_ENABLED
FRIDAY_NVIDIA_LOCAL_BASE_URL
FRIDAY_NVIDIA_LOCAL_MODELS_JSON
```

Do not add a paid-fallback environment switch in Phase 2A.

- [ ] **Step 4: Write failing registry tests**

Cover:
- hosted and local entries normalize to `provider:'nvidia'`;
- hosted entries receive `deployment:'hosted'`;
- local entries receive `deployment:'local'`;
- `billingClass:'unknown'` is preserved for later rejection rather than guessed;
- missing/blank `id`, `model`, or capabilities array causes that entry to be omitted;
- `publicModelDescriptor(target)` contains no `apiKey`, `baseUrl`, or private provider configuration;
- malformed JSON from Step 3 results in zero targets rather than inferred defaults.

Representative assertions:

```js
const [target] = buildModelTargets(config.modelFabric)
assert.equal(target.descriptor.provider, 'nvidia')
assert.equal(target.descriptor.billingClass, 'free')
assert.equal(target.providerConfig.apiKey, 'server-secret')
assert.equal('apiKey' in publicModelDescriptor(target), false)
```

- [ ] **Step 5: Run registry tests and verify failure**

Run:

```bash
node --test server/ai/model-registry.test.mjs
```

Expected: FAIL because the registry module does not exist.

- [ ] **Step 6: Implement `buildModelTargets` and `publicModelDescriptor`**

Create `server/ai/model-registry.mjs`. Preserve configured order. Do not infer capabilities, billing class, tool support, vision support, or free status from a model name.

- [ ] **Step 7: Update Compose and environment examples**

Add the eight server-only variables from Step 3 to `.env.example` and `compose.yaml`. Keep model JSON defaults as `[]`; document an example descriptor in comments/docs rather than checking in a live model ID as a permanent default.

- [ ] **Step 8: Run focused tests**

Run:

```bash
node --test server/config.test.mjs server/ai/model-registry.test.mjs
docker compose config >/dev/null
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/config.mjs server/config.test.mjs server/ai/model-registry.mjs server/ai/model-registry.test.mjs .env.example compose.yaml
git commit -m "feat: add free-first model registry"
```

---

### Task 2: Add the NVIDIA Hosted and Local NIM Provider Adapter

**Files:**
- Create: `server/ai/nvidia.mjs`
- Create: `server/ai/nvidia.test.mjs`
- Modify: `server/ai/errors.test.mjs` only if a new sanitized provider-failure kind needs coverage.

**Interfaces:**
- Consumes: a `ModelTarget.providerConfig` from Task 1 and existing `ProviderUnavailableError` helpers.
- Produces: `createNvidiaProvider({ fetchImpl = globalThis.fetch } = {}) -> { id, health, generate }`.
- `health({ providerConfig, signal }) -> Promise<{ healthy: true }>` or throws a sanitized `ProviderUnavailableError`.
- `generate({ providerConfig, request, signal }) -> Promise<{ provider:'nvidia', model:string, text:string }>`.
- `request` shape for Phase 2A: `{ messages: Array<{role:string, content:string}>, maxTokens?: number }`.

- [ ] **Step 1: Write failing hosted generation tests**

Assert:
- request URL is `${baseUrl}/chat/completions`;
- hosted requests send `Authorization: Bearer <NVIDIA_API_KEY>`;
- `model`, `messages`, and bounded `max_tokens` are sent;
- text is read from `choices[0].message.content`;
- returned result contains provider/model/text only.

- [ ] **Step 2: Write failing local NIM tests**

Assert:
- a `deployment:'local'` provider config can generate without `apiKey`;
- local base URL such as `http://nvidia-nim:8000/v1` produces `http://nvidia-nim:8000/v1/chat/completions`;
- local requests do not emit an empty/placeholder Authorization header.

- [ ] **Step 3: Write failing health tests**

Use `GET ${baseUrl}/models` and assert the configured model ID must appear in the returned `data[].id`. Missing model returns a sanitized `ProviderUnavailableError('nvidia','model-unavailable')`.

NVIDIA NIM currently exposes OpenAI-compatible `/v1/models` and `/v1/chat/completions`; keep the adapter at the configured `/v1` base URL so hosted and local endpoints share the same code path.

- [ ] **Step 4: Write failure-normalization tests**

Cover timeout/network, 401/403 authentication, 429 rate limit, 5xx upstream failure, and empty/invalid success response. Assert raw upstream bodies and thrown transport details are not copied into the public error message/result.

- [ ] **Step 5: Run tests and verify failure**

Run:

```bash
node --test server/ai/nvidia.test.mjs
```

Expected: FAIL because `server/ai/nvidia.mjs` does not exist.

- [ ] **Step 6: Implement `createNvidiaProvider`**

Use native `fetch`, existing `classifyHttpFailure`/`providerFailure`, and no new SDK dependency. Hosted mode requires a non-empty API key; local mode does not.

- [ ] **Step 7: Run focused NVIDIA tests**

Run:

```bash
node --test server/ai/nvidia.test.mjs server/ai/errors.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/ai/nvidia.mjs server/ai/nvidia.test.mjs server/ai/errors.test.mjs
git commit -m "feat: add nvidia model provider"
```

---

### Task 3: Add Deterministic Capability and Free-Only Routing

**Files:**
- Create: `server/ai/model-router.mjs`
- Create: `server/ai/model-router.test.mjs`

**Interfaces:**
- Consumes: `ModelTarget[]` from Task 1.
- Produces: `rankEligibleModelTargets({ targets, requirements, policy, healthById = {} }) -> ModelTarget[]`.
- `requirements` shape: `{ capabilities:string[], multimodal?:boolean, privacy?:'cloud-ok'|'local-only' }`.
- `healthById[target.descriptor.id]` may be `'healthy'`, `'unhealthy'`, or absent.
- Special requirement `'tool-use'` requires `supportsTools:true`; `multimodal:true` requires `supportsVision:true`.

- [ ] **Step 1: Write failing eligibility tests**

Cover:
- disabled targets rejected;
- `paid` rejected;
- `unknown` rejected;
- missing required capabilities rejected;
- `tool-use` requires `supportsTools:true`;
- multimodal requires `supportsVision:true`;
- `privacy:'local-only'` rejects hosted targets;
- `healthById[id] === 'unhealthy'` rejects a target.

- [ ] **Step 2: Write failing deterministic-order tests**

With equal capability matches, assert:
1. local free target precedes hosted free target when `preferLocal:true`;
2. NVIDIA free target ranks according to configured order after local preference;
3. repeated calls return the same order;
4. source array order is the tie-breaker rather than an LLM/random chooser.

- [ ] **Step 3: Run router tests and verify failure**

Run:

```bash
node --test server/ai/model-router.test.mjs
```

Expected: FAIL because the router module does not exist.

- [ ] **Step 4: Implement `rankEligibleModelTargets`**

The router is pure/deterministic. It does not call a model, perform network I/O, mutate targets, or change billing metadata.

- [ ] **Step 5: Run focused router tests**

Run:

```bash
node --test server/ai/model-router.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/ai/model-router.mjs server/ai/model-router.test.mjs
git commit -m "feat: add free-first model router"
```

---

### Task 4: Add Health-Aware Sequential Model Fabric and Safe Failover

**Files:**
- Create: `server/ai/model-fabric.mjs`
- Create: `server/ai/model-fabric.test.mjs`

**Interfaces:**
- Consumes: `buildModelTargets`, `rankEligibleModelTargets`, `createNvidiaProvider`, existing cloud/local timeout budgets from `config.ai`.
- Produces: `createModelFabric({ config, providers, fetchImpl, signalFactory } = {}) -> { listEligible, generate }`.
- `listEligible(requirements) -> ModelDescriptor[]` returns only public secret-free descriptors.
- `generate({ requirements, request })` returns either:
  - success: `{ available:true, provider, modelId, model, text, attempts }`;
  - safe exhaustion: `{ available:false, error:'no-free-model-available', attempts }`.
- Each attempt is secret-free: `{ modelId, provider, outcome }`.

- [ ] **Step 1: Write failing no-eligible-model test**

With only `paid`, `unknown`, disabled, or capability-mismatched targets:

```js
assert.deepEqual(await fabric.generate(input), {
  available: false,
  error: 'no-free-model-available',
  attempts: [],
})
```

- [ ] **Step 2: Write failing free-model failover test**

Configure two free NVIDIA targets. Make target 1 health/generation fail with normalized `rate-limited`; target 2 succeeds. Assert target 2 is returned and attempts contain only sanitized target/provider/outcome metadata.

- [ ] **Step 3: Write the paid-boundary regression test**

Configure target order as:
1. free hosted target — fails;
2. paid hosted target — would succeed if called;
3. second free hosted target — succeeds.

Assert the paid target's provider method is never called and the second free target is used.

- [ ] **Step 4: Write health-filter regression tests**

Assert a target reported unhealthy by `provider.health` is skipped before generation, and that health failure cannot expose raw upstream response bodies.

- [ ] **Step 5: Write timeout-budget tests**

Assert hosted targets use `config.ai.cloudTimeoutMs` and local NIM targets use `config.ai.localTimeoutMs` through the injected `signalFactory(timeoutMs)`.

- [ ] **Step 6: Run fabric tests and verify failure**

Run:

```bash
node --test server/ai/model-fabric.test.mjs
```

Expected: FAIL because the model-fabric module does not exist.

- [ ] **Step 7: Implement `createModelFabric`**

Build targets from config, rank deterministically, check provider health, then attempt generation sequentially.

Only normalized provider-availability failures trigger a move to the next already-eligible target. Unexpected programming errors fail closed with a sanitized fabric error rather than being mistaken for a provider quota event.

Do not add automatic retries against the same target in Phase 2A.

- [ ] **Step 8: Run the full model-fabric unit set**

Run:

```bash
node --test server/ai/model-registry.test.mjs server/ai/nvidia.test.mjs server/ai/model-router.test.mjs server/ai/model-fabric.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/ai/model-fabric.mjs server/ai/model-fabric.test.mjs
git commit -m "feat: add free-first model fabric"
```

---

### Task 5: Pin Phase 1 Compatibility, Security Boundaries, and Operator Documentation

**Files:**
- Modify: `server/agents/agent-service.test.mjs` if necessary
- Modify: `server/ai/providers.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/ai-providers.md`
- Create: `docs/model-fabric.md`

**Interfaces:**
- Consumes: completed Phase 2A internal modules.
- Produces: documented operational configuration, CI safety checks, and regression proof that the legacy assistant/provider chain plus PR #19 local agents remain unchanged.

- [ ] **Step 1: Add compatibility tests**

Assert:
- `defaultProviders` remains exactly the existing legacy assistant provider registry and Phase 2A does not silently add NVIDIA to the general assistant chain;
- PR #19 local agent ask still resolves its local Ollama model profile and never invokes the new model fabric;
- local-agent response still exposes `execution.performed=false`.

If existing PR #19 tests already prove the last two assertions after merge, do not duplicate them; reference/run them in verification instead.

- [ ] **Step 2: Run compatibility tests**

Run:

```bash
node --test server/ai/providers.test.mjs server/agents/agent-service.test.mjs
```

Expected: PASS without modifying production agent-service behavior.

- [ ] **Step 3: Add CI secret and safety checks**

Extend the existing safety job so CI fails if:
- `NVIDIA_API_KEY` or `VITE_.*NVIDIA` appears in `src/`;
- a `VITE_*` model/provider secret is introduced;
- `server/ai/model-*.mjs` or `server/ai/nvidia.mjs` introduces shell/SSH/child-process execution;
- the new phase adds an infrastructure mutation route.

Keep checks scoped enough not to flag documentation examples under `docs/superpowers`.

- [ ] **Step 4: Document operator configuration**

Create `docs/model-fabric.md` covering:
- Phase 2A is internal and has no new public execution endpoint;
- fixed free-only policy;
- hosted NVIDIA configuration;
- local NIM configuration;
- model JSON descriptor schema;
- no hard-coded live model IDs;
- how to mark a model explicitly `billingClass:'free'`;
- safe behavior when no free model is available;
- the future homelab swap from hosted base URL to local NIM without changing routing logic.

Update `docs/ai-providers.md` to clearly distinguish:
- existing general assistant chain;
- PR #19 local-agent Ollama path;
- new Phase 2A internal model fabric.

- [ ] **Step 5: Run focused security/compatibility verification**

Run:

```bash
npm run test:server
npm run build
docker compose config >/dev/null
```

Expected: all PASS.

- [ ] **Step 6: Run repository-wide CI-equivalent verification**

Run:

```bash
npm test
npm run build
docker compose config >/dev/null
docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
FRIDAY_OBSERVER_TOKEN=ci-test FRIDAY_OBSERVER_BIND_ADDRESS=127.0.0.1 docker compose -f observer/compose.yaml config >/dev/null
```

Expected: all PASS. Existing monitoring, diagnostics, registry schema, and local-agent safety checks remain green.

- [ ] **Step 7: Confirm no public/mutation surface was added**

Inspect the branch diff and assert:
- no new POST/PUT/PATCH/DELETE infrastructure route;
- no `child_process`, `execFile`, `spawn`, or SSH path in model-fabric files;
- no API response contains NVIDIA credentials;
- no Agent Spec v1.1 file requires a cloud provider/model ID.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/ci.yml docs/ai-providers.md docs/model-fabric.md server/ai/providers.test.mjs server/agents/agent-service.test.mjs
git commit -m "docs: finalize phase 2a model fabric safeguards"
```

---

## Final Phase 2A Acceptance

Before the implementation PR can leave draft:

- [ ] PR #19 foundation is merged and its live acceptance is documented as passing.
- [ ] At least one test/config fixture represents a configured NVIDIA hosted free endpoint through the normalized registry.
- [ ] The same NVIDIA provider code accepts a local NIM target at a different base URL.
- [ ] Capability routing selects only configured eligible free/local models.
- [ ] Paid and unknown billing targets are never selected in Phase 2A.
- [ ] A failed free target can fall through only to another eligible free/local target.
- [ ] Exhausted eligibility returns `no-free-model-available`.
- [ ] Provider/API credentials stay server-side and out of public descriptors/results/browser source.
- [ ] Existing general assistant behavior remains compatible.
- [ ] Existing PR #19 local-agent behavior remains Ollama-only and advisory.
- [ ] No infrastructure mutation/tool execution path is introduced.
- [ ] Full test/build/Compose/CI-equivalent verification passes.
