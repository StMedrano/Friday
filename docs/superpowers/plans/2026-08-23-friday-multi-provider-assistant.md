# Friday Multi-Provider Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Friday UI to a real read-only assistant that sequentially fails over across OpenAI, Anthropic, Gemini, local Ollama, and deterministic local analysis while clearly showing response provenance.

**Architecture:** Keep provider-specific HTTP logic in focused adapters under `server/ai/`, put the shared read-only policy and sanitized provider failure model in provider-neutral modules, and make `server/assistant.mjs` the sequential orchestrator. The browser calls only `/api/assistant`; API keys remain server-side, Ollama stays on the private Docker network, and deterministic `previewCommand()` is the final fallback.

**Tech Stack:** Node.js 22 ESM, native `fetch`, Node test runner, React 18, TypeScript 5.7, Vitest/Testing Library, Docker Compose, Ollama 0.32.14, Qwen3 4B Q4.

**Spec:** `docs/superpowers/specs/2026-08-23-friday-multi-provider-assistant-design.md`

## Global Constraints

- Friday remains read-only/advisory. Do not add shell, Docker mutation, Proxmox mutation, firewall mutation, deployment, restart, delete, or remediation tools.
- `FRIDAY_DOCKER_ENABLED=false` remains the intended Friday-controller runtime setting.
- Provider order defaults to `openai,anthropic,gemini,ollama` and executes sequentially, never in parallel.
- API keys stay server-side and never use a `VITE_` prefix.
- OpenAI uses the Responses API; Anthropic uses the Messages API; Gemini uses `models.generateContent`; Ollama uses `/api/chat`.
- Local model starts as `qwen3:4b` with context cap `8192` and CPU-only execution.
- Ollama must have no host/LAN port mapping.
- Authentik and infrastructure write authority are outside this milestone.
- PR #9 must remain untouched and open.

---

### Task 1: Expand AI configuration into an ordered provider map

**Files:**
- Modify: `server/config.mjs`
- Modify: `server/config.test.mjs`
- Modify: `.env.example`

**Interfaces:**
- Produces: `config.ai.providerOrder: string[]`
- Produces: `config.ai.timeoutMs: number`
- Produces: `config.ai.providers.openai|anthropic|gemini|ollama`
- Consumed by: Tasks 2-6

- [ ] **Step 1: Write failing configuration tests**

Add tests to `server/config.test.mjs` that establish the exact configuration shape:

```js
test('AI config exposes ordered cloud and local providers without browser-facing secrets', () => {
  const config = getConfig({
    FRIDAY_AI_ENABLED: 'true',
    FRIDAY_AI_PROVIDER_ORDER: 'openai,anthropic,gemini,ollama',
    FRIDAY_AI_REQUEST_TIMEOUT_MS: '15000',
    OPENAI_API_KEY: 'openai-secret',
    OPENAI_MODEL: 'openai-model',
    ANTHROPIC_API_KEY: 'anthropic-secret',
    ANTHROPIC_MODEL: 'anthropic-model',
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_MODEL: 'gemini-model',
    FRIDAY_LOCAL_AI_ENABLED: 'true',
    FRIDAY_LOCAL_AI_URL: 'http://ollama:11434',
    FRIDAY_LOCAL_AI_MODEL: 'qwen3:4b',
    FRIDAY_LOCAL_AI_CONTEXT: '8192',
  })

  assert.equal(config.ai.enabled, true)
  assert.deepEqual(config.ai.providerOrder, ['openai', 'anthropic', 'gemini', 'ollama'])
  assert.equal(config.ai.timeoutMs, 15000)
  assert.deepEqual(config.ai.providers.openai, { apiKey: 'openai-secret', model: 'openai-model' })
  assert.deepEqual(config.ai.providers.anthropic, { apiKey: 'anthropic-secret', model: 'anthropic-model' })
  assert.deepEqual(config.ai.providers.gemini, { apiKey: 'gemini-secret', model: 'gemini-model' })
  assert.deepEqual(config.ai.providers.ollama, {
    enabled: true,
    baseUrl: 'http://ollama:11434',
    model: 'qwen3:4b',
    context: 8192,
  })
})

test('AI provider order drops unknown and duplicate provider ids', () => {
  const config = getConfig({ FRIDAY_AI_PROVIDER_ORDER: 'gemini,unknown,gemini,openai' })
  assert.deepEqual(config.ai.providerOrder, ['gemini', 'openai'])
})

test('new cloud providers require an explicit model while OpenAI keeps the existing default', () => {
  const config = getConfig({})
  assert.equal(config.ai.providers.openai.model, 'gpt-5.6-terra')
  assert.equal(config.ai.providers.anthropic.model, '')
  assert.equal(config.ai.providers.gemini.model, '')
  assert.equal(config.ai.providers.ollama.enabled, false)
  assert.equal(config.ai.providers.ollama.model, 'qwen3:4b')
  assert.equal(config.ai.providers.ollama.context, 8192)
})
```

Replace the old `config.ai.apiKey` / `config.ai.model` assertions with the new provider map assertions.

- [ ] **Step 2: Run the config tests and verify RED**

Run:

```bash
node --test server/config.test.mjs
```

Expected: FAIL because `providerOrder`, `timeoutMs`, and `providers` do not exist yet.

- [ ] **Step 3: Implement provider-order parsing and provider config**

In `server/config.mjs`, add:

```js
const AI_PROVIDER_IDS = new Set(['openai', 'anthropic', 'gemini', 'ollama'])

function providerOrder(value) {
  const seen = new Set()
  const parsed = String(value || 'openai,anthropic,gemini,ollama')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => AI_PROVIDER_IDS.has(item))
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
  return parsed.length ? parsed : ['openai', 'anthropic', 'gemini', 'ollama']
}
```

Replace the existing `ai` block with:

```js
ai: {
  enabled: enabled(env.FRIDAY_AI_ENABLED),
  providerOrder: providerOrder(env.FRIDAY_AI_PROVIDER_ORDER),
  timeoutMs: positiveNumber(env.FRIDAY_AI_REQUEST_TIMEOUT_MS, 20000),
  providers: {
    openai: {
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-5.6-terra',
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.ANTHROPIC_MODEL || '',
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      model: env.GEMINI_MODEL || '',
    },
    ollama: {
      enabled: enabled(env.FRIDAY_LOCAL_AI_ENABLED),
      baseUrl: env.FRIDAY_LOCAL_AI_URL || 'http://ollama:11434',
      model: env.FRIDAY_LOCAL_AI_MODEL || 'qwen3:4b',
      context: positiveNumber(env.FRIDAY_LOCAL_AI_CONTEXT, 8192),
    },
  },
},
```

- [ ] **Step 4: Update `.env.example` with the complete server-side AI block**

Use exactly:

```dotenv
# Friday multi-provider read-only assistant. Keys are server-only; never use VITE_ prefixes.
FRIDAY_AI_ENABLED=false
FRIDAY_AI_PROVIDER_ORDER=openai,anthropic,gemini,ollama
FRIDAY_AI_REQUEST_TIMEOUT_MS=20000

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=

GEMINI_API_KEY=
GEMINI_MODEL=

FRIDAY_LOCAL_AI_ENABLED=false
FRIDAY_LOCAL_AI_URL=http://ollama:11434
FRIDAY_LOCAL_AI_MODEL=qwen3:4b
FRIDAY_LOCAL_AI_CONTEXT=8192
```

- [ ] **Step 5: Run config tests and commit**

Run:

```bash
node --test server/config.test.mjs
```

Expected: PASS.

Commit:

```bash
git add server/config.mjs server/config.test.mjs .env.example
git commit -m "feat: configure assistant provider chain"
```

---

### Task 2: Create the provider-neutral safety policy and failure model

**Files:**
- Create: `server/ai/policy.mjs`
- Create: `server/ai/policy.test.mjs`
- Create: `server/ai/errors.mjs`
- Create: `server/ai/errors.test.mjs`

**Interfaces:**
- Produces: `fridaySystemPrompt(): string`
- Produces: `ProviderUnavailableError`
- Produces: `providerFailure(provider, kind, message?)`
- Produces: `classifyHttpFailure(provider, status)`
- Consumed by: all provider adapters and the orchestrator

- [ ] **Step 1: Write failing policy tests**

Create `server/ai/policy.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { fridaySystemPrompt } from './policy.mjs'

test('shared assistant policy is explicitly read-only and state-grounded', () => {
  const prompt = fridaySystemPrompt()
  assert.match(prompt, /read-only infrastructure copilot/i)
  assert.match(prompt, /normalized infrastructure state/i)
  assert.match(prompt, /do not claim.*executed/i)
  assert.match(prompt, /do not invent/i)
})
```

- [ ] **Step 2: Write failing provider-error tests**

Create `server/ai/errors.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderUnavailableError, classifyHttpFailure } from './errors.mjs'

test('provider errors expose only provider and sanitized category', () => {
  const error = new ProviderUnavailableError('openai', 'rate-limited')
  assert.equal(error.provider, 'openai')
  assert.equal(error.kind, 'rate-limited')
  assert.equal(error.name, 'ProviderUnavailableError')
})

test('HTTP availability failures are normalized', () => {
  assert.equal(classifyHttpFailure('openai', 401).kind, 'authentication')
  assert.equal(classifyHttpFailure('openai', 408).kind, 'timeout')
  assert.equal(classifyHttpFailure('openai', 429).kind, 'rate-limited')
  assert.equal(classifyHttpFailure('openai', 503).kind, 'upstream')
})
```

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```bash
node --test server/ai/policy.test.mjs server/ai/errors.test.mjs
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the shared policy**

Create `server/ai/policy.mjs`:

```js
export function fridaySystemPrompt() {
  return [
    'You are Friday, a read-only infrastructure copilot for a two-site homelab.',
    'Analyze only the normalized infrastructure state supplied in the request.',
    'You may explain health, summarize alerts, identify likely causes, compare sites, and propose next read-only diagnostic steps.',
    'Do not claim that you executed, restarted, changed, deleted, deployed, reconfigured, remediated, or approved anything.',
    'Do not invent hosts, credentials, metrics, routes, VLANs, services, or events that are absent from the supplied state.',
    'If the available state is insufficient, say what additional read-only signal would be useful.',
    'Keep answers concise and operational.',
  ].join(' ')
}

export function fridayUserPrompt(prompt, overview) {
  return `Operator request:\n${String(prompt || '').trim()}\n\nNormalized Friday state:\n${JSON.stringify(overview ?? {})}`
}
```

- [ ] **Step 5: Implement sanitized provider errors**

Create `server/ai/errors.mjs`:

```js
export class ProviderUnavailableError extends Error {
  constructor(provider, kind, message = `${provider} provider unavailable`) {
    super(message)
    this.name = 'ProviderUnavailableError'
    this.provider = provider
    this.kind = kind
  }
}

export function providerFailure(provider, kind, message) {
  return new ProviderUnavailableError(provider, kind, message)
}

export function classifyHttpFailure(provider, status) {
  if (status === 401 || status === 403) return providerFailure(provider, 'authentication')
  if (status === 408) return providerFailure(provider, 'timeout')
  if (status === 429) return providerFailure(provider, 'rate-limited')
  if (status >= 500) return providerFailure(provider, 'upstream')
  return providerFailure(provider, 'invalid-response')
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node --test server/ai/policy.test.mjs server/ai/errors.test.mjs
```

Expected: PASS.

Commit:

```bash
git add server/ai/policy.mjs server/ai/policy.test.mjs server/ai/errors.mjs server/ai/errors.test.mjs
git commit -m "feat: share assistant safety policy"
```

---

### Task 3: Refactor the OpenAI adapter onto the shared provider contract

**Files:**
- Modify: `server/ai/openai.mjs`
- Create: `server/ai/openai.test.mjs`

**Interfaces:**
- Consumes: `fridaySystemPrompt`, `fridayUserPrompt`, `classifyHttpFailure`, `providerFailure`
- Produces: `askOpenAI({ providerConfig, prompt, overview, systemPrompt?, fetchImpl, signal })`

- [ ] **Step 1: Write failing OpenAI adapter tests**

Create `server/ai/openai.test.mjs` with a fake fetch that asserts the request uses `https://api.openai.com/v1/responses`, Bearer auth, the configured model, shared system prompt, and normalized overview. Include this success assertion:

```js
const result = await askOpenAI({
  providerConfig: { apiKey: 'secret', model: 'model-a' },
  prompt: 'Check health',
  overview: { mode: 'live', services: [] },
  fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    assert.equal(options.headers.Authorization, 'Bearer secret')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'model-a')
    assert.match(body.input[0].content, /read-only infrastructure copilot/i)
    assert.match(body.input[1].content, /Check health/)
    return new Response(JSON.stringify({ output_text: 'OpenAI answer' }), { status: 200 })
  },
})
assert.deepEqual(result, { provider: 'openai', model: 'model-a', text: 'OpenAI answer' })
```

Add a 429 test that expects `ProviderUnavailableError` with `kind === 'rate-limited'`, and a missing-key test with `kind === 'configuration'`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test server/ai/openai.test.mjs
```

Expected: FAIL because the current adapter takes `apiKey`/`model` directly and throws raw errors.

- [ ] **Step 3: Refactor OpenAI without changing its Responses API behavior**

The function signature becomes:

```js
export async function askOpenAI({
  providerConfig = {},
  prompt,
  overview,
  systemPrompt = fridaySystemPrompt(),
  fetchImpl = globalThis.fetch,
  signal,
}) {
```

Use `providerConfig.apiKey` and `providerConfig.model`, pass `signal` to `fetch`, and convert configuration, network, HTTP, and empty-output failures to sanitized `ProviderUnavailableError` categories. Keep `extractResponseText()`.

- [ ] **Step 4: Run the adapter tests and commit**

Run:

```bash
node --test server/ai/openai.test.mjs
```

Expected: PASS.

Commit:

```bash
git add server/ai/openai.mjs server/ai/openai.test.mjs
git commit -m "refactor: normalize OpenAI provider"
```

---

### Task 4: Add Anthropic and Gemini cloud adapters

**Files:**
- Create: `server/ai/anthropic.mjs`
- Create: `server/ai/anthropic.test.mjs`
- Create: `server/ai/gemini.mjs`
- Create: `server/ai/gemini.test.mjs`

**Interfaces:**
- Produces: `askAnthropic(...)`
- Produces: `askGemini(...)`
- Both use the same input/output contract as `askOpenAI`

- [ ] **Step 1: Write the Anthropic RED test**

The test must assert `POST https://api.anthropic.com/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, configured model, shared system prompt, and a user message containing the normalized overview. The fake successful payload is:

```js
{
  content: [{ type: 'text', text: 'Anthropic answer' }]
}
```

Expected return:

```js
{ provider: 'anthropic', model: 'anthropic-model', text: 'Anthropic answer' }
```

Also test 401 => `authentication` and blank model => `configuration`.

- [ ] **Step 2: Run Anthropic test and verify RED**

Run:

```bash
node --test server/ai/anthropic.test.mjs
```

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement `askAnthropic`**

Use this request shape:

```js
body: JSON.stringify({
  model: providerConfig.model,
  max_tokens: 1200,
  system: systemPrompt,
  messages: [{ role: 'user', content: fridayUserPrompt(prompt, overview) }],
})
```

Extract and join `payload.content.filter(part => part.type === 'text').map(part => part.text)` and normalize failures through `errors.mjs`.

- [ ] **Step 4: Write the Gemini RED test**

The test must assert a request to:

```text
https://generativelanguage.googleapis.com/v1beta/models/gemini-model:generateContent
```

with header `x-goog-api-key: gemini-secret` and body containing:

```js
{
  systemInstruction: { parts: [{ text: systemPrompt }] },
  contents: [{ role: 'user', parts: [{ text: fridayUserPrompt(prompt, overview) }] }],
  generationConfig: { maxOutputTokens: 1200 }
}
```

Fake payload:

```js
{ candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }] }
```

Expected return:

```js
{ provider: 'gemini', model: 'gemini-model', text: 'Gemini answer' }
```

- [ ] **Step 5: Run Gemini test and verify RED**

Run:

```bash
node --test server/ai/gemini.test.mjs
```

Expected: FAIL because the adapter is missing.

- [ ] **Step 6: Implement `askGemini` and normalize failures**

Encode the model path with `encodeURIComponent(providerConfig.model)`, pass `signal`, use the shared policy/user prompt, and treat missing text as `invalid-response`.

- [ ] **Step 7: Run both cloud adapter suites and commit**

Run:

```bash
node --test server/ai/anthropic.test.mjs server/ai/gemini.test.mjs
```

Expected: PASS.

Commit:

```bash
git add server/ai/anthropic.mjs server/ai/anthropic.test.mjs server/ai/gemini.mjs server/ai/gemini.test.mjs
git commit -m "feat: add Anthropic and Gemini providers"
```

---

### Task 5: Add the private Ollama local provider

**Files:**
- Create: `server/ai/ollama.mjs`
- Create: `server/ai/ollama.test.mjs`

**Interfaces:**
- Produces: `askOllama(...)`
- Uses: `providerConfig.enabled`, `baseUrl`, `model`, `context`

- [ ] **Step 1: Write failing Ollama tests**

Assert the adapter posts to `http://ollama:11434/api/chat`, does not add cloud authorization headers, sends `stream: false`, includes shared system/user messages, and sets `options.num_ctx` to 8192.

Fake success:

```js
{
  message: { role: 'assistant', content: 'Local answer' },
  done: true
}
```

Expected:

```js
{ provider: 'ollama', model: 'qwen3:4b', text: 'Local answer' }
```

Also test `enabled: false` => `configuration`, network exception => `network`, and empty message content => `invalid-response`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --test server/ai/ollama.test.mjs
```

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement `askOllama`**

Use this body:

```js
{
  model: providerConfig.model,
  stream: false,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: fridayUserPrompt(prompt, overview) },
  ],
  options: { num_ctx: providerConfig.context },
}
```

Normalize all failures through `errors.mjs`.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test server/ai/ollama.test.mjs
```

Expected: PASS.

Commit:

```bash
git add server/ai/ollama.mjs server/ai/ollama.test.mjs
git commit -m "feat: add private Ollama provider"
```

---

### Task 6: Implement sequential failover and deterministic final fallback

**Files:**
- Create: `server/ai/providers.mjs`
- Create: `server/ai/providers.test.mjs`
- Modify: `server/assistant.mjs`
- Modify: `server/assistant.test.mjs`
- Modify: `server/http.mjs`
- Modify: `server/http.test.mjs`

**Interfaces:**
- Produces: `defaultProviders = { openai, anthropic, gemini, ollama }`
- Produces: `answerAssistant({ config, prompt, overview, providers?, previewImpl? })`
- API response includes `available`, `mode`, `provider`, `model`, `text`, `fallbackUsed`, `attempts`

- [ ] **Step 1: Write provider registry test**

Create `server/ai/providers.test.mjs` asserting the exported map contains exactly the four first-class AI provider IDs.

- [ ] **Step 2: Replace assistant tests with failover-oriented RED tests**

Cover all of these behaviors in `server/assistant.test.mjs`:

```js
// first provider succeeds -> cloud-ai, fallbackUsed false
// first fails ProviderUnavailableError, second succeeds -> attempts contains only sanitized provider/outcome
// ollama success -> mode local-ai
// all AI unavailable + preview accepted -> deterministic local-analysis
// all AI unavailable + preview unsupported -> available false
// provider returns a normal refusal string -> return it immediately; do not call next provider
// blank prompt -> invalid-prompt and no providers called
// FRIDAY_AI_ENABLED=false -> skip AI and still allow deterministic preview
```

Use injected provider functions only; no live network calls.

A failover assertion must look like:

```js
assert.deepEqual(result.attempts, [
  { provider: 'openai', outcome: 'rate-limited' },
])
assert.equal(result.provider, 'anthropic')
assert.equal(result.fallbackUsed, true)
```

- [ ] **Step 3: Run assistant tests and verify RED**

Run:

```bash
node --test server/ai/providers.test.mjs server/assistant.test.mjs
```

Expected: FAIL against the current OpenAI-only assistant wrapper.

- [ ] **Step 4: Implement the registry**

Create `server/ai/providers.mjs`:

```js
import { askOpenAI } from './openai.mjs'
import { askAnthropic } from './anthropic.mjs'
import { askGemini } from './gemini.mjs'
import { askOllama } from './ollama.mjs'

export const defaultProviders = Object.freeze({
  openai: askOpenAI,
  anthropic: askAnthropic,
  gemini: askGemini,
  ollama: askOllama,
})
```

- [ ] **Step 5: Implement sequential orchestration in `server/assistant.mjs`**

Use `AbortSignal.timeout(config.ai.timeoutMs)` for each provider attempt. Iterate `config.ai.providerOrder`, skip missing provider functions, and call with `config.ai.providers[id]`. Catch only `ProviderUnavailableError` for normal failover. Re-throw unexpected programming errors.

The final deterministic branch must call:

```js
const preview = previewImpl({ message: prompt })
if (preview.accepted) {
  return {
    available: true,
    mode: 'local-analysis',
    provider: 'deterministic',
    model: null,
    text: preview.message,
    fallbackUsed: attempts.length > 0 || config.ai.enabled,
    attempts,
  }
}
```

Blank prompt returns:

```js
{ available: false, error: 'invalid-prompt', reason: 'A prompt is required.' }
```

Exhaustion returns:

```js
{
  available: false,
  mode: 'local-analysis',
  provider: 'deterministic',
  model: null,
  reason: 'No configured AI provider was available and the request did not map to a supported local analysis command.',
  fallbackUsed: true,
  attempts,
}
```

- [ ] **Step 6: Add HTTP status tests before changing the route**

Extend `server/http.test.mjs` to assert:

```text
available=true                      -> 200
error=invalid-prompt               -> 400
available=false exhaustion         -> 503
unexpected thrown orchestration    -> 502
```

Keep the existing test that confirms the assistant receives the same monitoring-aware overview as the UI.

- [ ] **Step 7: Implement the route status mapping**

In the `/api/assistant` branch:

```js
if (result.available) return json(response, 200, result)
if (result.error === 'invalid-prompt') return json(response, 400, result)
return json(response, 503, result)
```

Do not put provider keys or raw upstream errors in HTTP responses.

- [ ] **Step 8: Run server AI tests and commit**

Run:

```bash
node --test server/ai/*.test.mjs server/assistant.test.mjs server/http.test.mjs
```

Expected: PASS.

Commit:

```bash
git add server/ai/providers.mjs server/ai/providers.test.mjs server/assistant.mjs server/assistant.test.mjs server/http.mjs server/http.test.mjs
git commit -m "feat: add assistant provider failover"
```

---

### Task 7: Connect desktop and mobile UI to `/api/assistant` with provenance

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/components/AssistantReply.tsx`
- Create: `src/components/AssistantReply.test.tsx`
- Modify: `src/components/MobileHome.tsx`
- Modify: `src/components/MobileHome.test.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Create: `src/pages/Dashboard.assistant.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/mobile.css`

**Interfaces:**
- Produces: `askFridayAssistant(prompt, signal?)`
- Produces: `FridayAssistantResponse`
- Produces: reusable `AssistantReply` component

- [ ] **Step 1: Add failing typed API-client tests through a small fetch seam**

Add these types to the planned test expectations in `src/lib/api.ts`:

```ts
export type FridayAssistantMode = 'cloud-ai' | 'local-ai' | 'local-analysis'
export type FridayAssistantAttempt = { provider: string; outcome: string }
export type FridayAssistantResponse = {
  available: boolean
  mode?: FridayAssistantMode
  provider?: string
  model?: string | null
  text?: string
  reason?: string
  fallbackUsed?: boolean
  attempts?: FridayAssistantAttempt[]
}
```

Implement and test this signature:

```ts
export async function askFridayAssistant(prompt: string, signal?: AbortSignal): Promise<FridayAssistantResponse>
```

It must POST JSON `{ prompt }` to `/api/assistant`, return the parsed response for `200`, and throw `Error(body.reason || 'Friday assistant unavailable')` for non-2xx responses.

- [ ] **Step 2: Create `AssistantReply` RED tests**

Test exact provenance labels:

```text
cloud-ai      -> FRIDAY CLOUD AI
local-ai      -> FRIDAY LOCAL AI
local-analysis -> LOCAL ANALYSIS · NO AI
```

Also test provider/model secondary text, loading text `FRIDAY is analyzing…`, and an error message without any mutation claim.

- [ ] **Step 3: Implement the shared `AssistantReply` component**

Use props:

```ts
export type AssistantReplyState = {
  text: string
  mode?: FridayAssistantMode
  provider?: string
  model?: string | null
  loading: boolean
  error: string | null
}
```

Render a semantic status container with `aria-live="polite"`, provenance badge, optional provider/model metadata, and text.

- [ ] **Step 4: Update `MobileHome` to consume the shared state**

Replace `reply: string` with `assistant: AssistantReplyState` and render:

```tsx
<AssistantReply state={assistant} compact />
```

Update `MobileHome.test.tsx` fixtures accordingly and add one assertion for `FRIDAY LOCAL AI`.

- [ ] **Step 5: Write Dashboard integration RED test**

Create `src/pages/Dashboard.assistant.test.tsx`. Mock `useFridayOverview`, `usePhoneLayout`, and `askFridayAssistant`. Submit `Check service health`, resolve:

```ts
{
  available: true,
  mode: 'cloud-ai',
  provider: 'openai',
  model: 'test-model',
  text: 'All observed services are healthy.',
  fallbackUsed: false,
  attempts: [],
}
```

Assert the real prompt reached `askFridayAssistant`, the answer is rendered, and the badge says `FRIDAY CLOUD AI`.

Add a second test where the promise remains pending long enough to assert the input/send control is disabled and `FRIDAY is analyzing…` is visible.

- [ ] **Step 6: Replace the placeholder `askFriday()` implementation**

Make it async:

```ts
async function askFriday(e: React.FormEvent) {
  e.preventDefault()
  const text = query.trim()
  if (!text || assistant.loading) return

  setAssistant((current) => ({ ...current, loading: true, error: null }))
  try {
    const result = await askFridayAssistant(text)
    setAssistant({
      text: result.text || result.reason || 'Friday returned no response text.',
      mode: result.mode,
      provider: result.provider,
      model: result.model,
      loading: false,
      error: null,
    })
    setQuery('')
  } catch (error) {
    setAssistant((current) => ({
      ...current,
      loading: false,
      error: error instanceof Error ? error.message : 'Friday assistant unavailable',
    }))
  }
}
```

Use `AssistantReply` in desktop and pass the same state to mobile.

- [ ] **Step 7: Add desktop/mobile provenance styling**

Add focused classes for the shared component rather than duplicating label logic. Preserve the existing dark Friday UI. The CSS must visibly distinguish the badge text, but must not imply execution authority.

- [ ] **Step 8: Run UI tests/build and commit**

Run:

```bash
npm test -- --run src/components/AssistantReply.test.tsx src/components/MobileHome.test.tsx src/pages/Dashboard.assistant.test.tsx
npm run build
```

If the package script does not accept file arguments cleanly, use:

```bash
npx vitest run src/components/AssistantReply.test.tsx src/components/MobileHome.test.tsx src/pages/Dashboard.assistant.test.tsx
npm run build
```

Expected: PASS.

Commit:

```bash
git add src/lib/api.ts src/components/AssistantReply.tsx src/components/AssistantReply.test.tsx src/components/MobileHome.tsx src/components/MobileHome.test.tsx src/pages/Dashboard.tsx src/pages/Dashboard.assistant.test.tsx src/styles.css src/mobile.css
git commit -m "feat: connect Friday assistant UI"
```

---

### Task 8: Add private Ollama sidecar and reproducible local-model bootstrap

**Files:**
- Modify: `compose.yaml`
- Create: `scripts/pull-local-model.sh`
- Create: `scripts/pull-local-model.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Produces private Docker service name `ollama`
- Produces volume `friday_ollama`
- Produces bootstrap command `scripts/pull-local-model.sh`

- [ ] **Step 1: Add a RED script test**

Create `scripts/pull-local-model.test.mjs` that reads the shell script and asserts it:

```js
assert.match(source, /FRIDAY_LOCAL_AI_MODEL/)
assert.match(source, /qwen3:4b/)
assert.match(source, /docker compose.*ollama.*pull/)
```

Run:

```bash
node --test scripts/pull-local-model.test.mjs
```

Expected: FAIL because the script is missing.

- [ ] **Step 2: Add the Ollama Compose service with no published ports**

Add to `compose.yaml`:

```yaml
  ollama:
    image: ollama/ollama:0.32.14
    container_name: friday-ollama
    restart: unless-stopped
    profiles: ["local-ai"]
    volumes:
      - friday_ollama:/root/.ollama
    networks:
      - friday_frontend
    security_opt:
      - no-new-privileges:true
```

Do not add a `ports:` block.

Pass the new AI environment variables into the `friday` service:

```yaml
      FRIDAY_AI_PROVIDER_ORDER: ${FRIDAY_AI_PROVIDER_ORDER:-openai,anthropic,gemini,ollama}
      FRIDAY_AI_REQUEST_TIMEOUT_MS: ${FRIDAY_AI_REQUEST_TIMEOUT_MS:-20000}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      ANTHROPIC_MODEL: ${ANTHROPIC_MODEL:-}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      GEMINI_MODEL: ${GEMINI_MODEL:-}
      FRIDAY_LOCAL_AI_ENABLED: ${FRIDAY_LOCAL_AI_ENABLED:-false}
      FRIDAY_LOCAL_AI_URL: ${FRIDAY_LOCAL_AI_URL:-http://ollama:11434}
      FRIDAY_LOCAL_AI_MODEL: ${FRIDAY_LOCAL_AI_MODEL:-qwen3:4b}
      FRIDAY_LOCAL_AI_CONTEXT: ${FRIDAY_LOCAL_AI_CONTEXT:-8192}
```

Declare:

```yaml
  friday_ollama:
    name: friday_ollama
```

under `volumes:`.

- [ ] **Step 3: Create the model bootstrap script**

Create `scripts/pull-local-model.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
MODEL="${FRIDAY_LOCAL_AI_MODEL:-qwen3:4b}"
docker compose --profile local-ai up -d ollama
docker compose exec -T ollama ollama pull "$MODEL"
docker compose exec -T ollama ollama list
```

- [ ] **Step 4: Document deployment and privacy behavior**

In `README.md`, document:

```bash
cp .env.example .env
# configure one or more cloud provider keys/models
# set FRIDAY_LOCAL_AI_ENABLED=true when local fallback is desired
docker compose --profile local-ai up -d
./scripts/pull-local-model.sh
```

Explicitly state Ollama has no LAN-published port and local API traffic stays on `friday_frontend`.

- [ ] **Step 5: Validate Compose/script and commit**

Run:

```bash
docker compose config >/tmp/friday-compose-config.txt
node --test scripts/pull-local-model.test.mjs
```

Expected: both commands succeed.

Commit:

```bash
git add compose.yaml scripts/pull-local-model.sh scripts/pull-local-model.test.mjs README.md
git commit -m "feat: add private Friday local AI runtime"
```

---

### Task 9: Full regression, security verification, and operator documentation

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/security-model.md`
- Modify: `CODEX.md`
- Modify: `AGENTS.md` only if its existing workflow section needs the new plan/spec links

**Interfaces:**
- Produces: documented final architecture and Codex handoff

- [ ] **Step 1: Update architecture documentation**

Add the exact flow:

```text
POST /api/assistant
  -> monitoring-aware normalized overview
  -> OpenAI
  -> Anthropic
  -> Gemini
  -> Ollama qwen3:4b
  -> deterministic previewCommand
```

State that configured order can change and that providers are sequential.

- [ ] **Step 2: Update the security model**

Document these invariants verbatim:

```text
AI providers receive no infrastructure mutation tools.
API keys remain server-side.
Ollama has no host-published port.
Provider failover is sequential, not parallel fanout.
Assistant output is advisory and cannot authorize or execute infrastructure changes.
```

- [ ] **Step 3: Update Codex execution guidance**

Point Codex to:

```text
docs/superpowers/specs/2026-08-23-friday-multi-provider-assistant-design.md
docs/superpowers/plans/2026-08-23-friday-multi-provider-assistant.md
```

Keep the explicit rule that PR #9 is separate and must not be merged or modified by this work.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
npm test
npm run build
docker compose config >/tmp/friday-compose-config.txt
```

Expected: all tests pass, TypeScript/Vite build succeeds, Compose config validates.

- [ ] **Step 5: Run static safety checks**

Run:

```bash
grep -RniE 'docker (restart|rm|stop)|qm (set|stop|shutdown|destroy)|pct (set|stop|destroy)|iptables|nft ' server/ai server/assistant.mjs || true
grep -RniE 'VITE_.*(API_KEY|TOKEN|SECRET)' .env.example compose.yaml src server || true
grep -nA12 '^  ollama:' compose.yaml
```

Expected:

- first grep returns no AI execution implementation,
- second grep returns no browser-facing secrets,
- Ollama service contains no `ports:` mapping.

- [ ] **Step 6: Commit docs and verification handoff**

```bash
git add docs/architecture.md docs/security-model.md CODEX.md AGENTS.md
git commit -m "docs: document Friday assistant provider stack"
```

- [ ] **Step 7: Review branch diff before opening a PR**

Run:

```bash
git status --short
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
git diff --stat main...HEAD
```

Expected: clean working tree, no whitespace errors, changes limited to the assistant/provider/UI/local-runtime/documentation milestone.

Do not merge PR #9 and do not fold PR #9 changes into this branch.
