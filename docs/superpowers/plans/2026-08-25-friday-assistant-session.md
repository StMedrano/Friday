# Friday Assistant Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Friday's existing one-shot assistant into one shared, session-only multi-turn conversation across Overview and FRIDAY while preserving the current read-only/advisory safety boundary.

**Architecture:** A new `useFridaySession` hook owns the in-memory transcript and sends only the newest 10 completed exchanges as bounded history. `/api/assistant` remains stateless: it validates the current prompt, sanitizes history, builds fresh normalized infrastructure state on every request, then passes one shared context format through the existing sequential Groq -> Gemini -> CT108 Ollama -> deterministic fallback chain.

**Tech Stack:** React 18.3.1, TypeScript 5.7.2, Vite 5.4.14, Vitest 2.1.8, Testing Library, Node.js built-in test runner, Friday's existing Node HTTP server and AI adapters.

**Spec:** `docs/superpowers/specs/2026-08-24-friday-assistant-session-design.md`

## Global Constraints

- Conversation history is session-only: no `localStorage`, `sessionStorage`, IndexedDB, server storage, database storage, or `/data` persistence.
- Overview and FRIDAY share one in-memory conversation.
- Model context is capped at the 10 most recent completed exchanges / 20 historical messages.
- Overview displays at most the two newest completed exchanges and also displays the active trailing loading/error exchange.
- Current prompt maximum: 4,000 trimmed characters; reject longer prompts with HTTP 400 / `invalid-prompt` rather than truncating them.
- Historical message maximum: 2,000 characters each; historical content maximum: 12,000 characters total; retain newest valid content.
- History roles are exactly `user` or `assistant`; malformed and empty entries are discarded.
- Fresh normalized Friday state is authoritative for infrastructure facts on every turn; conversation history is contextual only.
- Production provider order and sequential failover remain Groq -> Gemini -> CT108 Ollama -> deterministic local analysis.
- Deterministic local analysis receives only the current prompt and does not resolve ambiguous references from history.
- Do not add Docker, Proxmox, shell, network, deployment, remediation, approval, HTTP-write, or other infrastructure mutation authority.
- The FRIDAY workspace must visibly state `Advisory only · No actions executed`.
- No automatic UI retry and no provider parallel fan-out.
- Existing timeout values, provider configuration, local model/context/token caps, Compose settings, observer boundary, monitoring boundary, and diagnostics boundary remain unchanged.

---

## File Map

### New files

- `server/assistant-input.mjs` — pure prompt/history validation and bounding.
- `server/assistant-input.test.mjs` — input-limit unit tests.
- `server/ai/groq.test.mjs` — direct Groq transport/history test.
- `src/lib/api.assistant.test.ts` — direct browser API request-shape test.
- `src/hooks/useFridaySession.ts` — in-memory transcript/request lifecycle owner.
- `src/hooks/useFridaySession.test.tsx` — session state/history selection tests.
- `src/components/FridayComposer.tsx` — shared controlled composer.
- `src/components/FridayConversation.tsx` — compact/full transcript renderer.
- `src/components/FridayConversation.test.tsx` — transcript selection tests.
- `src/components/FridayWorkspace.tsx` — dedicated FRIDAY session workspace.
- `src/components/FridayWorkspace.test.tsx` — workspace safety/clear tests.

### Existing files to modify

- `server/http.mjs`, `server/http.test.mjs`
- `server/assistant.mjs`, `server/assistant.test.mjs`
- `server/ai/policy.mjs`, `server/ai/policy.test.mjs`
- `server/ai/groq.mjs`
- `server/ai/gemini.mjs`, `server/ai/gemini.test.mjs`
- `server/ai/ollama.mjs`, `server/ai/ollama.test.mjs`
- `server/ai/openai.mjs`, `server/ai/openai.test.mjs`
- `server/ai/anthropic.mjs`, `server/ai/anthropic.test.mjs`
- `src/lib/api.ts`
- `src/components/AssistantReply.tsx`, `src/components/AssistantReply.test.tsx`
- `src/pages/Dashboard.tsx`, `src/pages/Dashboard.assistant.test.tsx`
- `src/components/MobileHome.tsx`, `src/components/MobileHome.test.tsx`
- `src/assistant.css`
- `docs/codex/API_CONTRACT.md`
- `README.md`

`src/mobile.css`, Compose files, observer code, monitoring code, diagnostics code, and deployment scripts are not feature-edit targets for this milestone.

---

### Task 1: Add Pure Assistant Input Normalization

**Files:**
- Create: `server/assistant-input.mjs`
- Create: `server/assistant-input.test.mjs`

**Interfaces:**
- Produces `validateAssistantPrompt(value)` returning either `{ ok: true, prompt }` or `{ ok: false, result }`.
- Produces `normalizeAssistantHistory(value)` returning `Array<{ role: 'user' | 'assistant', content: string }>`.
- Owns constants `MAX_PROMPT_CHARS=4000`, `MAX_HISTORY_MESSAGES=20`, `MAX_HISTORY_MESSAGE_CHARS=2000`, `MAX_HISTORY_TOTAL_CHARS=12000`.

- [ ] **Step 1: Write failing prompt-limit tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAssistantHistory, validateAssistantPrompt } from './assistant-input.mjs'

test('validateAssistantPrompt rejects whitespace-only input', () => {
  const result = validateAssistantPrompt('   ')
  assert.equal(result.ok, false)
  assert.equal(result.result.error, 'invalid-prompt')
})

test('validateAssistantPrompt accepts exactly 4000 trimmed characters', () => {
  const prompt = 'x'.repeat(4000)
  assert.deepEqual(validateAssistantPrompt(prompt), { ok: true, prompt })
})

test('validateAssistantPrompt rejects 4001 characters without truncation', () => {
  const result = validateAssistantPrompt('x'.repeat(4001))
  assert.equal(result.ok, false)
  assert.equal(result.result.error, 'invalid-prompt')
  assert.match(result.result.reason, /too long/i)
})
```

- [ ] **Step 2: Write failing history-normalization tests**

Include tests for non-array input, invalid roles, empty content, per-message truncation, newest-20 retention, 12,000-total-character retention, and order preservation.

```js
test('normalizeAssistantHistory keeps newest 20 valid messages', () => {
  const history = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index}`,
  }))
  const normalized = normalizeAssistantHistory(history)
  assert.equal(normalized.length, 20)
  assert.equal(normalized[0].content, 'message-4')
  assert.equal(normalized.at(-1).content, 'message-23')
})
```

- [ ] **Step 3: Run the new tests and verify RED**

```bash
node --test server/assistant-input.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the pure helper**

```js
export const MAX_PROMPT_CHARS = 4000
export const MAX_HISTORY_MESSAGES = 20
export const MAX_HISTORY_MESSAGE_CHARS = 2000
export const MAX_HISTORY_TOTAL_CHARS = 12000

export function validateAssistantPrompt(value) {
  const prompt = String(value ?? '').trim()
  if (!prompt) {
    return { ok: false, result: { available: false, error: 'invalid-prompt', reason: 'A prompt is required.' } }
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, result: { available: false, error: 'invalid-prompt', reason: `Prompt is too long. Maximum ${MAX_PROMPT_CHARS} characters.` } }
  }
  return { ok: true, prompt }
}

export function normalizeAssistantHistory(value) {
  if (!Array.isArray(value)) return []
  let messages = value.flatMap((entry) => {
    if (entry?.role !== 'user' && entry?.role !== 'assistant') return []
    const content = String(entry?.content ?? '').trim()
    if (!content) return []
    return [{ role: entry.role, content: content.slice(0, MAX_HISTORY_MESSAGE_CHARS) }]
  }).slice(-MAX_HISTORY_MESSAGES)

  let total = messages.reduce((sum, item) => sum + item.content.length, 0)
  while (messages.length && total > MAX_HISTORY_TOTAL_CHARS) {
    total -= messages[0].content.length
    messages = messages.slice(1)
  }
  return messages
}
```

No filesystem, environment, logging, persistence, or network imports are allowed in this module.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
node --test server/assistant-input.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit Task 1**

```bash
git add server/assistant-input.mjs server/assistant-input.test.mjs
git commit -m "feat: bound Friday assistant input"
```

---

### Task 2: Enforce the Input Contract at `/api/assistant`

**Files:**
- Modify: `server/http.mjs` imports and `/api/assistant` POST handler.
- Modify: `server/http.test.mjs` assistant-route coverage.

**Interfaces:**
- Consumes Task 1 helpers.
- Produces `answerAssistantImpl({ config, prompt, history, overview })` with validated prompt and sanitized history.

- [ ] **Step 1: Add failing HTTP tests**

Add tests proving:
- `{ prompt }` remains backward compatible and forwards `history: []`;
- valid history reaches `answerAssistantImpl` unchanged after normalization;
- invalid roles are removed before forwarding;
- 4,001-character prompt returns HTTP 400 / `invalid-prompt`;
- valid assistant requests still build fresh overview every time.

Use a captured call object:

```js
let seen
const answerAssistantImpl = async (input) => {
  seen = input
  return { available: true, mode: 'local-analysis', provider: 'deterministic', model: null, text: 'ok', fallbackUsed: false, attempts: [] }
}
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test server/http.test.mjs
```

Expected: FAIL on new history/prompt-limit assertions.

- [ ] **Step 3: Modify the route**

Add:

```js
import { normalizeAssistantHistory, validateAssistantPrompt } from './assistant-input.mjs'
```

Inside the existing `/api/assistant` handler, replace direct `body.prompt` forwarding with:

```js
const body = await readBody(request)
const promptResult = validateAssistantPrompt(body.prompt)
if (!promptResult.ok) return json(response, 400, promptResult.result)
const history = normalizeAssistantHistory(body.history)
const overview = await currentOverview({ config, monitoringRuntime, buildOverviewImpl })
const result = await answerAssistantImpl({
  config,
  prompt: promptResult.prompt,
  history,
  overview,
})
if (result.available) return json(response, 200, result)
if (result.error === 'invalid-prompt') return json(response, 400, result)
return json(response, 503, result)
```

Keep the existing route-level catch returning HTTP 502 / `assistant-failed`.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
node --test server/assistant-input.test.mjs server/http.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit Task 2**

```bash
git add server/http.mjs server/http.test.mjs
git commit -m "feat: accept bounded assistant history"
```

---

### Task 3: Carry Sanitized History Through Sequential AI Failover

**Files:**
- Modify: `server/assistant.mjs`
- Modify: `server/assistant.test.mjs`

**Interfaces:**
- Consumes sanitized `history`.
- AI providers receive `{ providerConfig, prompt, history, overview, systemPrompt, signal }`.
- Deterministic `previewImpl` continues receiving only `{ message: currentPrompt }`.

- [ ] **Step 1: Add failing orchestration tests**

Add three tests:
1. successful provider receives history;
2. first provider fails and second receives identical history while `attempts`/`fallbackUsed` remain correct;
3. deterministic fallback spy is called exactly with `{ message: 'current prompt' }` and no history property.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test server/assistant.test.mjs
```

Expected: FAIL because providers do not yet receive history.

- [ ] **Step 3: Add the history parameter and provider field**

Change the function header to include `history = []`:

```js
export async function answerAssistant({
  config,
  prompt,
  history = [],
  overview,
  providers = defaultProviders,
  previewImpl = previewCommand,
  signalFactory = timeoutSignal,
} = {}) {
```

Add exactly one field to each AI provider invocation:

```js
history,
```

Do not pass `history` to `previewImpl`; retain `previewImpl({ message: text })`.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
node --test server/assistant.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit Task 3**

```bash
git add server/assistant.mjs server/assistant.test.mjs
git commit -m "feat: carry context through AI failover"
```

---

### Task 4: Make Conversation Context Explicitly Non-Authoritative

**Files:**
- Modify: `server/ai/policy.mjs`
- Modify: `server/ai/policy.test.mjs`

**Interfaces:**
- Produces `fridayUserPrompt(prompt, overview, history = [])`.
- Preserves existing exact infrastructure identifier rules.
- Adds history-vs-state authority rule.

- [ ] **Step 1: Write failing policy tests**

Test `fridaySystemPrompt()` for the exact sentence:

```text
Previous conversation is context, not infrastructure evidence. Resolve infrastructure facts and identifiers from the current normalized Friday state.
```

Test `fridayUserPrompt()` with deliberately stale history:

```js
const history = [
  { role: 'user', content: 'Check friday-ollama' },
  { role: 'assistant', content: 'friday-ollama is LXC 107' },
]
const overview = { services: [{ name: 'friday-ollama', host: 'LXC 108' }] }
const text = fridayUserPrompt('Compare it to VM102', overview, history)
assert.ok(text.indexOf('Recent session context:') < text.indexOf('Current operator request:'))
assert.ok(text.indexOf('Current operator request:') < text.indexOf('Authoritative normalized Friday state:'))
assert.match(text, /LXC 107/)
assert.match(text, /LXC 108/)
```

- [ ] **Step 2: Run policy tests and verify RED**

```bash
node --test server/ai/policy.test.mjs
```

Expected: FAIL on missing history/authority text.

- [ ] **Step 3: Implement shared formatting**

Add:

```js
function formatHistory(history = []) {
  if (!history.length) return 'Recent session context:\n(none)'
  return `Recent session context:\n${history.map(({ role, content }) => `[${role}] ${content}`).join('\n')}`
}
```

Change `fridayUserPrompt` to:

```js
export function fridayUserPrompt(prompt, overview, history = []) {
  return [
    formatHistory(history),
    `Current operator request:\n${String(prompt || '').trim()}`,
    `Authoritative normalized Friday state:\n${JSON.stringify(overview ?? {})}`,
  ].join('\n\n')
}
```

Add the non-authoritative-history sentence to `fridaySystemPrompt()` without removing the existing exact-ID rules.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
node --test server/ai/policy.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit Task 4**

```bash
git add server/ai/policy.mjs server/ai/policy.test.mjs
git commit -m "feat: ground conversational assistant context"
```

---

### Task 5: Feed the Shared Context Format to Every AI Adapter

**Files:**
- Modify: `server/ai/groq.mjs`
- Create: `server/ai/groq.test.mjs`
- Modify: `server/ai/gemini.mjs`, `server/ai/gemini.test.mjs`
- Modify: `server/ai/ollama.mjs`, `server/ai/ollama.test.mjs`
- Modify: `server/ai/openai.mjs`, `server/ai/openai.test.mjs`
- Modify: `server/ai/anthropic.mjs`, `server/ai/anthropic.test.mjs`

**Interfaces:**
- Every adapter accepts `history = []`.
- Every adapter calls `fridayUserPrompt(prompt, overview, history)`.
- Provider endpoints, auth headers, model fields, token limits, timeout signals, and error classification stay unchanged.

- [ ] **Step 1: Add failing adapter tests**

For each adapter, pass:

```js
history: [
  { role: 'user', content: 'Check friday-ollama' },
  { role: 'assistant', content: 'friday-ollama is LXC 108' },
]
```

Inspect the mocked outbound JSON and assert the provider-facing user content contains all four markers:
- `Recent session context:`
- `Check friday-ollama`
- `Current operator request:`
- `Authoritative normalized Friday state:`

For Groq, place this direct transport test in new `server/ai/groq.test.mjs`; keep `groq-failover.test.mjs` focused on orchestration/failover.

- [ ] **Step 2: Run adapter tests and verify RED**

```bash
node --test server/ai/groq.test.mjs server/ai/gemini.test.mjs server/ai/ollama.test.mjs server/ai/openai.test.mjs server/ai/anthropic.test.mjs
```

Expected: FAIL because adapters do not forward history to the shared formatter.

- [ ] **Step 3: Update adapter signatures**

In each of these five functions—`askGroq`, `askGemini`, `askOllama`, `askOpenAI`, `askAnthropic`—add `history = []` next to `prompt` and `overview` in the destructured input object.

In each adapter's provider-facing request body, change only the formatter call from:

```js
fridayUserPrompt(prompt, overview)
```

to:

```js
fridayUserPrompt(prompt, overview, history)
```

No other transport field changes in this task.

- [ ] **Step 4: Run adapter + policy + orchestration tests and verify GREEN**

```bash
node --test server/assistant.test.mjs server/ai/policy.test.mjs server/ai/groq.test.mjs server/ai/groq-failover.test.mjs server/ai/gemini.test.mjs server/ai/ollama.test.mjs server/ai/openai.test.mjs server/ai/anthropic.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit Task 5**

```bash
git add server/ai
git commit -m "feat: share conversational context across AI providers"
```

---

### Task 6: Extend the Browser API Request Contract

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/lib/api.assistant.test.ts`

**Interfaces:**
- Produces `FridayAssistantHistoryMessage`.
- Produces `FridayAssistantRequestOptions`.
- Produces `askFridayAssistant(prompt, options?)` sending `{ prompt, history }`.

- [ ] **Step 1: Write a failing direct API test**

Stub `globalThis.fetch`, call the API helper, and inspect the request body:

```ts
it('posts prompt and bounded history payload shape', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    available: true,
    mode: 'cloud-ai',
    provider: 'groq',
    model: 'test-model',
    text: 'ok',
    fallbackUsed: false,
    attempts: [],
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)

  await askFridayAssistant('Compare it to VM102', {
    history: [{ role: 'user', content: 'Check friday-ollama' }],
  })

  const [, init] = fetchMock.mock.calls[0]
  expect(JSON.parse(String(init.body))).toEqual({
    prompt: 'Compare it to VM102',
    history: [{ role: 'user', content: 'Check friday-ollama' }],
  })
})
```

Also test that omitting options sends `history: []` and preserves one-shot compatibility.

- [ ] **Step 2: Run the API test and verify RED**

```bash
npx vitest run src/lib/api.assistant.test.ts
```

Expected: FAIL because the helper does not accept/send history.

- [ ] **Step 3: Implement the typed options contract**

Add:

```ts
export type FridayAssistantHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type FridayAssistantRequestOptions = {
  history?: FridayAssistantHistoryMessage[]
  signal?: AbortSignal
}
```

Change the helper signature/body to:

```ts
export async function askFridayAssistant(
  prompt: string,
  { history = [], signal }: FridayAssistantRequestOptions = {},
): Promise<FridayAssistantResponse> {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, history }),
    signal,
  })
  const body = await response.json() as FridayAssistantResponse
  if (!response.ok) throw new Error(body.reason || 'Friday assistant unavailable')
  return body
}
```

- [ ] **Step 4: Run API test and production build; verify GREEN**

```bash
npx vitest run src/lib/api.assistant.test.ts
npm run build
```

Expected: test PASS and build exit 0. Existing calls with only `prompt` remain valid because the options argument is optional.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/lib/api.ts src/lib/api.assistant.test.ts
git commit -m "feat: send Friday assistant history"
```

---

### Task 7: Add the In-Memory `useFridaySession` State Machine

**Files:**
- Create: `src/hooks/useFridaySession.ts`
- Create: `src/hooks/useFridaySession.test.tsx`

**Interfaces:**
- Consumes `askFridayAssistant(prompt, { history })` from Task 6.
- Produces `FridaySessionMessage` and `FridaySession`.

```ts
export type FridaySessionMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: 'complete' | 'loading' | 'error'
  mode?: FridayAssistantMode
  provider?: string
  model?: string | null
  fallbackUsed?: boolean
  attempts?: FridayAssistantAttempt[]
}

export type FridaySession = {
  messages: FridaySessionMessage[]
  loading: boolean
  sendMessage(prompt: string): Promise<void>
  clearSession(): void
}
```

- [ ] **Step 1: Write failing immediate-turn and lifecycle tests**

Use a hook harness. With a pending mocked assistant request, assert `sendMessage('Check service health')` immediately appends:
- a complete user turn;
- a loading assistant placeholder.

Then resolve the mock and assert the placeholder becomes a complete assistant turn carrying `mode`, `provider`, `model`, `fallbackUsed`, and `attempts`.

Add a rejection case: placeholder becomes `status: 'error'`, submitted user turn remains, and the mocked API is called exactly once.

- [ ] **Step 2: Write failing bounded-history tests**

Drive 11 completed exchanges followed by a new prompt. Assert the new API call receives exactly 20 historical messages from the newest 10 completed exchanges. Assert:
- current prompt is not duplicated in history;
- failed assistant exchanges are excluded;
- loading placeholders are excluded.

- [ ] **Step 3: Write failing clear/remount tests**

Assert:
- `clearSession()` empties messages while idle;
- `clearSession()` is a no-op while `loading === true`;
- unmount/remount starts empty because there is no persistence.

- [ ] **Step 4: Run hook tests and verify RED**

```bash
npx vitest run src/hooks/useFridaySession.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 5: Implement completed-history selection**

Use this pure helper inside the hook file:

```ts
function completedHistory(messages: FridaySessionMessage[]): FridayAssistantHistoryMessage[] {
  const pairs: FridayAssistantHistoryMessage[][] = []
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index]
    const assistant = messages[index + 1]
    if (
      user.role === 'user' && user.status === 'complete' &&
      assistant.role === 'assistant' && assistant.status === 'complete'
    ) {
      pairs.push([
        { role: 'user', content: user.text },
        { role: 'assistant', content: assistant.text },
      ])
      index += 1
    }
  }
  return pairs.slice(-10).flat()
}
```

- [ ] **Step 6: Implement request lifecycle with React state only**

Before adding the current prompt, capture `const history = completedHistory(messages)`. Append user + loading turns, call `askFridayAssistant(text, { history })`, then replace the loading turn by ID on success/error. `clearSession()` returns immediately when loading and otherwise sets messages to `[]`.

Use a `useRef` counter for frontend-only message IDs so tests remain deterministic. Do not use browser or server persistence APIs.

- [ ] **Step 7: Run hook tests and build; verify GREEN**

```bash
npx vitest run src/hooks/useFridaySession.test.tsx src/lib/api.assistant.test.ts
npm run build
```

Expected: tests PASS and build exit 0.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/hooks/useFridaySession.ts src/hooks/useFridaySession.test.tsx
git commit -m "feat: add in-memory Friday assistant session"
```

---

### Task 8: Build Transcript, Composer, and Fallback Provenance Presentation

**Files:**
- Create: `src/components/FridayComposer.tsx`
- Create: `src/components/FridayConversation.tsx`
- Create: `src/components/FridayConversation.test.tsx`
- Modify: `src/components/AssistantReply.tsx`
- Modify: `src/components/AssistantReply.test.tsx`
- Modify: `src/assistant.css`

**Interfaces:**
- `FridayComposer` consumes `{ value, loading, placeholder, onChange, onSubmit }` and owns no assistant state.
- `FridayConversation` consumes `{ messages, compact?: boolean }` and owns no API state.
- `AssistantReplyState` adds optional `fallbackUsed` and `attempts`.

- [ ] **Step 1: Write failing fallback disclosure tests**

Assert:
- no fallback control for false/undefined;
- `fallbackUsed: true` renders a button with `aria-expanded="false"`;
- clicking expands returned attempts in original order;
- only `attempts` are listed—no fabricated successful provider attempt.

- [ ] **Step 2: Write failing compact/full transcript tests**

Build three completed exchanges plus a trailing current user/loading pair. Assert full mode renders every message. Assert compact mode renders the newest two completed exchanges plus the trailing current pair.

Build a second compact case ending in user/error and assert the error pair remains visible.

- [ ] **Step 3: Run component tests and verify RED**

```bash
npx vitest run src/components/AssistantReply.test.tsx src/components/FridayConversation.test.tsx
```

Expected: FAIL on missing fallback/transcript behavior.

- [ ] **Step 4: Extend `AssistantReplyState` and disclosure**

Add:

```ts
fallbackUsed?: boolean
attempts?: FridayAssistantAttempt[]
```

Use component-local `expanded` state and a real button:

```tsx
<button
  type="button"
  className="v3-assistant-fallback-toggle"
  aria-expanded={expanded}
  onClick={() => setExpanded((value) => !value)}
>
  Fallback used · Details
</button>
```

Render each attempt as `provider — outcome`. Keep existing mode/provider/model provenance above it.

- [ ] **Step 5: Implement `FridayConversation`**

Create a pure selector for compact mode: collect completed user+assistant pairs, keep the newest two pairs, then append trailing messages after the last completed assistant so current loading/error state is visible. Render user messages as user rows. Render assistant messages by converting each `FridaySessionMessage` into an `AssistantReplyState`; set `error` to `message.text` only for `status === 'error'` and set `loading` for `status === 'loading'`.

- [ ] **Step 6: Implement `FridayComposer`**

Keep it controlled. The component renders the existing command/chevron visual language, calls the supplied form `onSubmit`, calls `onChange` with input text, and disables input/send when `loading` is true. It does not call the assistant API.

- [ ] **Step 7: Add assistant-session CSS only**

Add classes to `src/assistant.css` for transcript rows, user/assistant distinction, compact mode, fallback detail panel, shared composer, full workspace scrolling, and `@media(max-width:700px)` responsive behavior. Do not edit unrelated dashboard/mobile layout files.

- [ ] **Step 8: Run tests and build; verify GREEN**

```bash
npx vitest run src/components/AssistantReply.test.tsx src/components/FridayConversation.test.tsx
npm run build
```

Expected: tests PASS and build exit 0.

- [ ] **Step 9: Commit Task 8**

```bash
git add src/components/AssistantReply.tsx src/components/AssistantReply.test.tsx src/components/FridayComposer.tsx src/components/FridayConversation.tsx src/components/FridayConversation.test.tsx src/assistant.css
git commit -m "feat: render Friday conversation provenance"
```

---

### Task 9: Share One Session Across Overview, FRIDAY, and Mobile

**Files:**
- Create: `src/components/FridayWorkspace.tsx`
- Create: `src/components/FridayWorkspace.test.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Dashboard.assistant.test.tsx`
- Modify: `src/components/MobileHome.tsx`
- Modify: `src/components/MobileHome.test.tsx`
- Modify: `src/assistant.css`

**Interfaces:**
- `Dashboard` owns exactly one `useFridaySession()` instance.
- `FridayWorkspace` consumes the same session, controlled input state, and submit/change callbacks used by Overview.
- `MobileHome` consumes the same session and compact renderer; it does not create another session.

- [ ] **Step 1: Write failing `FridayWorkspace` tests**

Assert the workspace renders:
- `FRIDAY / SESSION`;
- `Advisory only · No actions executed`;
- `Context: up to 10 recent exchanges`;
- full supplied transcript;
- `Clear session` button.

Assert Clear calls `session.clearSession()` when idle and is disabled while `session.loading`.

- [ ] **Step 2: Rewrite Dashboard assistant integration tests before production changes**

Use the real `useFridaySession` and mock only `askFridayAssistant`. Test this full sequence:
1. Overview submits `Check friday-ollama`.
2. Mock resolves `friday-ollama is LXC 108` with Groq provenance.
3. Navigate to FRIDAY.
4. Both turns are still visible.
5. Submit `Compare it to VM102`.
6. Mock receives `{ history: [{role:'user',...},{role:'assistant',...}] }` containing the first completed exchange.
7. Navigate back to Overview.
8. Compact transcript remains visible.
9. Unmount/remount starts with no transcript.

- [ ] **Step 3: Update MobileHome tests before production changes**

Assert mobile Overview receives shared `messages`/`loading`, renders `FridayConversation compact`, and submits through parent callbacks rather than maintaining a local assistant reply object.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
npx vitest run src/components/FridayWorkspace.test.tsx src/pages/Dashboard.assistant.test.tsx src/components/MobileHome.test.tsx
```

Expected: FAIL on missing workspace/shared-session wiring.

- [ ] **Step 5: Implement `FridayWorkspace`**

Render a header with the exact safety/context copy, `FridayConversation` in full mode, `FridayComposer`, and a clear button bound only to `session.clearSession()`. No server clear/delete request is allowed.

- [ ] **Step 6: Replace Dashboard's one-shot assistant state**

Remove the existing single `AssistantReplyState` and direct `askFridayAssistant` submit function. Add one hook instance:

```tsx
const friday = useFridaySession()
const [query, setQuery] = useState('')

async function submitFriday(event: React.FormEvent) {
  event.preventDefault()
  const text = query.trim()
  if (!text || friday.loading) return
  setQuery('')
  await friday.sendMessage(text)
}
```

Routing/render rules:
- `Overview`: retain current operational health/incidents/infrastructure sections; replace one-shot reply with `FridayConversation compact` + `FridayComposer`; show `Continue conversation` when `friday.messages.length > 0`, navigating to `FRIDAY`.
- `FRIDAY`: render `FridayWorkspace` instead of repeating Overview infrastructure sections.
- `Incidents` and all other destinations remain unchanged.
- Keep the existing Automation toggle presentation unchanged and do not attach execution behavior to it.

- [ ] **Step 7: Migrate MobileHome to the shared session contract**

Replace `assistant: AssistantReplyState` with props for shared messages/loading plus the existing controlled query callbacks. Render the same compact conversation component in the mobile FRIDAY card. Keep mobile health/incidents/infrastructure/service sections unchanged.

- [ ] **Step 8: Run focused UI tests and build; verify GREEN**

```bash
npx vitest run src/components/FridayWorkspace.test.tsx src/pages/Dashboard.assistant.test.tsx src/components/MobileHome.test.tsx src/components/FridayConversation.test.tsx src/components/AssistantReply.test.tsx src/hooks/useFridaySession.test.tsx src/lib/api.assistant.test.ts
npm run build
```

Expected: all selected tests PASS and build exit 0.

- [ ] **Step 9: Commit Task 9**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.assistant.test.tsx src/components/FridayWorkspace.tsx src/components/FridayWorkspace.test.tsx src/components/MobileHome.tsx src/components/MobileHome.test.tsx src/assistant.css
git commit -m "feat: add shared Friday conversation workspace"
```

---

### Task 10: Document the Contract and Run Complete Regression/Safety Gates

**Files:**
- Modify: `docs/codex/API_CONTRACT.md`
- Modify: `README.md`

No runtime configuration, Compose, observer, monitoring, diagnostics, or deployment files are changed in this task.

- [ ] **Step 1: Update API contract documentation**

Document this optional-history request:

```json
{
  "prompt": "Compare it to VM102",
  "history": [
    { "role": "user", "content": "Check friday-ollama" },
    { "role": "assistant", "content": "friday-ollama is LXC 108" }
  ]
}
```

Document exact limits: 4,000 current prompt; 2,000 per historical message; 12,000 total history characters; 20 historical messages server-side; frontend context from newest 10 completed exchanges. State that `history` is optional and Friday persists no server conversation/session ID.

- [ ] **Step 2: Update README operator behavior**

Document Overview compact conversation, dedicated FRIDAY full current-session transcript, refresh/remount clearing, provider/fallback provenance, and exact safety copy `Advisory only · No actions executed`.

- [ ] **Step 3: Run full tests and production build**

```bash
npm test
npm run build
```

Expected: both commands exit 0 with zero test failures.

- [ ] **Step 4: Run exact Friday CI shell/security gates**

```bash
for file in scripts/*.sh; do
  echo "checking $file"
  sh -n "$file"
done

grep -qx '.env' observer/.dockerignore
if grep -RniE '/containers/.*/(start|stop|restart|kill|exec)|/images/create|/volumes|/networks/.*/(connect|disconnect)' observer/config.mjs observer/docker.mjs observer/server.mjs; then
  echo 'Observer mutation API path detected.' >&2
  exit 1
fi
if grep -Rni 'FRIDAY_VM100_OBSERVER_TOKEN' src; then
  echo 'Observer token reference detected in frontend source.' >&2
  exit 1
fi
if grep -RniE 'VITE_.*OBSERVER' src server observer compose.yaml .env.example; then
  echo 'Browser-visible observer secret variable detected.' >&2
  exit 1
fi

if grep -RniE "request\.method === '(POST|PUT|PATCH|DELETE)' && url\.pathname === '/api/(incidents|monitoring)" server; then
  echo 'Monitoring mutation route detected.' >&2
  exit 1
fi
if grep -RniE '/containers/.*/(start|stop|restart|kill|exec)|/images/create|/volumes|/networks/.*/(connect|disconnect)' server/monitoring server/http.mjs; then
  echo 'Monitoring Docker mutation API path detected.' >&2
  exit 1
fi
if grep -RniE 'VITE_.*(MONITOR|INCIDENT|OBSERVER)' src server observer compose.yaml .env.example; then
  echo 'Browser-visible monitoring/observer secret variable detected.' >&2
  exit 1
fi

if grep -RniE '/containers/.*/(start|stop|restart|kill|exec)|/images/create|/volumes|/networks/.*/(connect|disconnect)|/archive' observer/config.mjs observer/docker.mjs observer/server.mjs server/diagnostics server/adapters/vm100-observer-diagnostics.mjs server/monitoring/runtime.mjs; then
  echo 'Diagnostics mutation API path detected.' >&2
  exit 1
fi
controller_diagnostic_writes="$(grep -niE "request\.method === '(POST|PUT|PATCH|DELETE)'.*(diagnostic|/api/incidents/.*/logs)" server/http.mjs || true)"
unexpected_controller_writes="$(printf '%s\n' "$controller_diagnostic_writes" | grep -vF "request.method === 'POST' && diagnosticRerunRoute" || true)"
if [ -n "$unexpected_controller_writes" ]; then
  printf '%s\n' "$unexpected_controller_writes" >&2
  echo 'Unexpected diagnostics write route detected.' >&2
  exit 1
fi
if ! printf '%s\n' "$controller_diagnostic_writes" | grep -qF "request.method === 'POST' && diagnosticRerunRoute"; then
  echo 'Expected read-only diagnostic rerun route boundary is missing.' >&2
  exit 1
fi
if grep -niE "request\.method === '(POST|PUT|PATCH|DELETE)'.*(diagnostic|/api/incidents/.*/logs)" observer/server.mjs; then
  echo 'Observer diagnostics write route detected.' >&2
  exit 1
fi
if grep -RniE 'child_process|execFile\(|spawn\(|ssh ' server/diagnostics server/adapters/vm100-observer-diagnostics.mjs server/monitoring/runtime.mjs observer/config.mjs observer/docker.mjs observer/server.mjs; then
  echo 'Shell or SSH diagnostics path detected.' >&2
  exit 1
fi
if grep -RniE 'VITE_.*(TOKEN|SECRET|OBSERVER|DIAGNOSTIC)' src server observer compose.yaml .env.example; then
  echo 'Browser-visible diagnostics secret variable detected.' >&2
  exit 1
fi
if grep -RniE 'Config\.Env|\.Env\b' observer/docker.mjs observer/server.mjs; then
  echo 'Raw Docker environment forwarding detected in diagnostics source.' >&2
  exit 1
fi
```

Expected: entire block exits 0.

- [ ] **Step 5: Run exact Friday CI Compose/container gates**

```bash
docker compose config >/dev/null
docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
FRIDAY_OBSERVER_TOKEN=ci-test FRIDAY_OBSERVER_BIND_ADDRESS=127.0.0.1 docker compose -f observer/compose.yaml config >/dev/null
docker build -t friday-ci .
docker build -t friday-observer-ci observer
```

Expected: all five commands exit 0.

- [ ] **Step 6: Run persistence/mutation diff review**

```bash
git diff --name-only main...HEAD
git diff main...HEAD -- src server compose.yaml observer scripts
```

Review the output and verify no assistant persistence, Docker socket enablement, Proxmox/network/shell write path, provider-order/timeout/model-token configuration change, Compose mutation, or observer mutation has been introduced. If any appears, stop and remove it before continuing.

- [ ] **Step 7: Perform representative UI acceptance**

Using the local/dev app, verify desktop plus 360px, 390px, and 430px phone widths:
- Overview shows newest two completed exchanges plus active loading/error exchange.
- Continue conversation opens FRIDAY with identical session state.
- FRIDAY shows the full session, safety copy, context copy, Clear Session, and composer.
- Fallback details expand/collapse with keyboard-accessible button state.
- Clear while idle removes only transcript.
- Clear is disabled while a request is in flight.
- Refresh/remount clears transcript.

Record each check as pass/fail in the PR notes. Do not add screenshot infrastructure solely for this milestone.

- [ ] **Step 8: Perform controlled live provider regression after automated gates**

In the approved Friday validation environment, without permanently changing production provider order:
1. Groq primary answers a follow-up using supplied session history.
2. A controlled cloud-provider failure produces a later successful provider response with `fallbackUsed: true` and returned failed-attempt details.
3. CT108 Ollama receives multi-turn context and responds under the existing 45-second local timeout.
4. Supply stale history claiming `friday-ollama = LXC 107`; fresh normalized state must still ground the answer to `friday-ollama = LXC 108`.

This step is validation only. It does not authorize Friday to execute infrastructure changes and does not authorize production deployment.

- [ ] **Step 9: Commit documentation**

```bash
git add docs/codex/API_CONTRACT.md README.md
git commit -m "docs: document Friday assistant sessions"
```

- [ ] **Step 10: Fresh final verification on the exact feature head**

```bash
npm test
npm run build
git status --short
git rev-parse HEAD
```

Expected: tests PASS; build exit 0; `git status --short` prints nothing; record the exact HEAD SHA. After opening the PR, wait for Friday CI on that exact SHA and record the run number/conclusion before requesting merge approval.

---

## Implementation Sequence and Review Gates

Execute strictly in this order:

1. Pure input normalization.
2. HTTP contract enforcement.
3. Orchestration history propagation.
4. Shared grounding/policy format.
5. Provider adapter history plumbing.
6. Browser API contract.
7. In-memory session state machine.
8. Transcript/composer/provenance presentation.
9. Shared Overview/FRIDAY/mobile integration.
10. Documentation and full regression/safety verification.

Every task ends in a green focused test/build state and its own commit. Review that task's diff before starting the next task. If implementation reveals a need for persistence, authentication, server-side sessions, action execution, provider-order changes, or another subsystem outside the approved design, stop and return to design instead of expanding scope.

## Definition of Done

Implementation is ready for PR review only when:

- every acceptance criterion in `docs/superpowers/specs/2026-08-24-friday-assistant-session-design.md` is implemented;
- `npm test` passes on the exact feature head;
- `npm run build` passes on the exact feature head;
- all embedded Friday CI shell/security/Compose/container gates pass;
- desktop and 360/390/430px session behavior is checked;
- approved live Groq/fallback/CT108/identifier-grounding regression checks are recorded when the validation environment is available;
- final diff contains no assistant persistence and no new infrastructure mutation authority;
- the feature PR remains unmerged until explicit user approval.
