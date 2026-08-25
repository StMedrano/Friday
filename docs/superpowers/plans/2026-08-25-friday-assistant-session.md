# Friday Assistant Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Friday's existing one-shot assistant into one shared, session-only multi-turn conversation across Overview and FRIDAY while preserving the current read-only/advisory safety boundary.

**Architecture:** A new `useFridaySession` frontend hook owns the in-memory transcript and sends only the newest 10 completed exchanges as bounded history. `/api/assistant` stays stateless: the server sanitizes history, attaches fresh normalized infrastructure state on every request, and passes one shared context format through the existing Groq -> Gemini -> CT108 Ollama -> deterministic fallback chain.

**Tech Stack:** React 18.3.1, TypeScript 5.7.2, Vite 5.4.14, Vitest 2.1.8, Testing Library, Node.js built-in test runner, existing Friday Node HTTP server and AI provider adapters.

**Spec:** `docs/superpowers/specs/2026-08-24-friday-assistant-session-design.md`

## Global Constraints

- Conversation history is session-only: no `localStorage`, `sessionStorage`, server storage, database storage, or `/data` persistence.
- Overview and FRIDAY share one in-memory conversation.
- Model context is capped at the 10 most recent completed exchanges / 20 historical messages.
- Overview displays at most the two newest completed exchanges, while still showing the active loading/error exchange when one exists.
- Current prompt maximum: 4,000 trimmed characters; reject longer prompts with `400 invalid-prompt` rather than truncating them.
- Historical message maximum: 2,000 characters each; historical content maximum: 12,000 characters total; server retains newest valid content.
- History roles are exactly `user` or `assistant`; malformed/empty history entries are discarded.
- Fresh normalized Friday state is authoritative for infrastructure facts on every turn; conversation history is contextual only.
- Production provider order and sequential failover remain Groq -> Gemini -> CT108 Ollama -> deterministic local analysis.
- Deterministic local analysis evaluates only the current prompt and does not resolve ambiguous references from history.
- Do not add Docker, Proxmox, shell, network, deployment, remediation, approval, HTTP-write, or other infrastructure mutation authority.
- The FRIDAY workspace must visibly state `Advisory only · No actions executed`.
- No automatic UI retry and no provider parallel fan-out.
- Existing timeout values, provider configuration, local model/context/token caps, Compose settings, observer boundary, monitoring boundary, and diagnostics boundary remain unchanged.

---

## File Map

### New files

- `server/assistant-input.mjs` — pure prompt/history validation and bounding.
- `server/assistant-input.test.mjs` — unit tests for input normalization limits.
- `src/hooks/useFridaySession.ts` — sole owner of the in-memory assistant transcript and request lifecycle.
- `src/hooks/useFridaySession.test.tsx` — hook-level TDD for transcript lifecycle and 10-exchange context selection.
- `src/components/FridayComposer.tsx` — shared controlled composer used by Overview and FRIDAY.
- `src/components/FridayConversation.tsx` — renders compact/full transcript without owning API state.
- `src/components/FridayConversation.test.tsx` — compact/full transcript and fallback disclosure tests.
- `src/components/FridayWorkspace.tsx` — dedicated desktop/mobile FRIDAY session workspace.
- `src/components/FridayWorkspace.test.tsx` — safety copy, clear behavior, and full transcript tests.

### Existing files to modify

- `server/http.mjs` — normalize `/api/assistant` input before `answerAssistant()` and forward sanitized history.
- `server/http.test.mjs` — HTTP compatibility, prompt-size, history forwarding, and fresh-overview regression tests.
- `server/assistant.mjs` — accept sanitized history and pass it only to AI providers.
- `server/assistant.test.mjs` — history-through-failover and deterministic-current-prompt-only tests.
- `server/ai/policy.mjs` — format recent context/current request/authoritative state and add non-authoritative-history rule.
- `server/ai/policy.test.mjs` — grounding and formatter tests.
- `server/ai/groq.mjs`, `server/ai/gemini.mjs`, `server/ai/ollama.mjs`, `server/ai/openai.mjs`, `server/ai/anthropic.mjs` — accept `history` and feed the shared formatter.
- Matching provider tests under `server/ai/*.test.mjs` — assert history reaches provider payload without altering transport semantics.
- `src/lib/api.ts` — add history request type and send `{ prompt, history }`.
- `src/components/AssistantReply.tsx` — retain existing provenance and add `fallbackUsed`/`attempts` expandable disclosure.
- `src/components/AssistantReply.test.tsx` — fallback disclosure accessibility and ordering.
- `src/pages/Dashboard.tsx` — replace one-shot assistant state with one `useFridaySession()` instance; separate Overview from FRIDAY workspace.
- `src/pages/Dashboard.assistant.test.tsx` — shared session/navigation integration tests.
- `src/components/MobileHome.tsx` — consume shared session/composer and compact transcript instead of one reply state.
- `src/components/MobileHome.test.tsx` — compact mobile conversation regression tests.
- `src/assistant.css` — transcript/workspace/fallback/composer styles and responsive rules.
- `src/mobile.css` only if the new workspace requires phone-shell-specific layout not expressible in `assistant.css`.
- `docs/codex/API_CONTRACT.md` — document optional assistant `history`, limits, response provenance, and statelessness.
- `README.md` — document session-only conversational behavior and read-only safety copy.

---

### Task 1: Add Pure Assistant Input Normalization

**Files:**
- Create: `server/assistant-input.mjs`
- Create: `server/assistant-input.test.mjs`

**Interfaces:**
- Produces: `validateAssistantPrompt(value) -> { ok: true, prompt: string } | { ok: false, result: { available: false, error: 'invalid-prompt', reason: string } }`
- Produces: `normalizeAssistantHistory(value) -> Array<{ role: 'user' | 'assistant', content: string }>`
- Constants owned by this module: `MAX_PROMPT_CHARS = 4000`, `MAX_HISTORY_MESSAGES = 20`, `MAX_HISTORY_MESSAGE_CHARS = 2000`, `MAX_HISTORY_TOTAL_CHARS = 12000`.

- [ ] **Step 1: Write failing unit tests for prompt validation**

Add tests that assert whitespace-only prompt is invalid, a 4,000-character trimmed prompt is accepted unchanged, and a 4,001-character prompt is rejected rather than truncated.

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAssistantPrompt } from './assistant-input.mjs'

test('validateAssistantPrompt rejects prompt longer than 4000 chars', () => {
  const result = validateAssistantPrompt('x'.repeat(4001))
  assert.equal(result.ok, false)
  assert.equal(result.result.error, 'invalid-prompt')
  assert.match(result.result.reason, /too long/i)
})
```

- [ ] **Step 2: Write failing unit tests for history sanitization**

Cover non-array input, invalid roles, empty content, per-message truncation, newest-20 retention, 12,000-total-character retention, and preserved order.

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

Run:
```bash
node --test server/assistant-input.test.mjs
```
Expected: FAIL because `server/assistant-input.mjs` or its exports do not exist yet.

- [ ] **Step 4: Implement minimal pure normalization**

Use no filesystem, environment, logging, persistence, or network access. Build the newest-first bounding by sanitizing entries, slicing to the newest 20, then dropping oldest entries until total content length is `<= 12000`.

```js
export function normalizeAssistantHistory(value) {
  if (!Array.isArray(value)) return []
  let messages = value.flatMap((entry) => {
    if (entry?.role !== 'user' && entry?.role !== 'assistant') return []
    const content = String(entry?.content ?? '').trim()
    if (!content) return []
    return [{ role: entry.role, content: content.slice(0, MAX_HISTORY_MESSAGE_CHARS) }]
  }).slice(-MAX_HISTORY_MESSAGES)

  while (messages.reduce((sum, item) => sum + item.content.length, 0) > MAX_HISTORY_TOTAL_CHARS) {
    messages = messages.slice(1)
  }
  return messages
}
```

- [ ] **Step 5: Run the unit tests and verify GREEN**

Run:
```bash
node --test server/assistant-input.test.mjs
```
Expected: PASS, zero failures.

- [ ] **Step 6: Commit Task 1**

```bash
git add server/assistant-input.mjs server/assistant-input.test.mjs
git commit -m "feat: bound Friday assistant input"
```

---

### Task 2: Enforce the Contract at `/api/assistant`

**Files:**
- Modify: `server/http.mjs` in the `/api/assistant` POST handler and imports.
- Modify: `server/http.test.mjs` assistant-route tests.

**Interfaces:**
- Consumes: `validateAssistantPrompt()` and `normalizeAssistantHistory()` from Task 1.
- Produces: `answerAssistantImpl({ config, prompt, history, overview })` receives a validated prompt and sanitized history.

- [ ] **Step 1: Add failing HTTP tests for request compatibility and history forwarding**

Add one test proving `{ prompt }` still forwards `history: []`, and one proving valid history reaches the injected `answerAssistantImpl` exactly as sanitized.

```js
assert.deepEqual(seen.history, [
  { role: 'user', content: 'Check friday-ollama' },
  { role: 'assistant', content: 'friday-ollama is LXC 108' },
])
```

- [ ] **Step 2: Add failing HTTP tests for overlong prompt and fresh overview**

Assert a 4,001-character prompt returns HTTP 400 with `error: 'invalid-prompt'`. Preserve or add a counter-based test showing `buildOverviewImpl` is invoked for every valid assistant request, including requests containing history.

- [ ] **Step 3: Run focused HTTP tests and verify RED**

Run:
```bash
node --test server/http.test.mjs
```
Expected: FAIL on the new history/length assertions.

- [ ] **Step 4: Modify the assistant route**

Normalize immediately after `readBody(request)`:

```js
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
```

Do not add any history storage, cookies, session IDs, file writes, or new endpoints.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:
```bash
node --test server/assistant-input.test.mjs server/http.test.mjs
```
Expected: PASS, zero failures.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/http.mjs server/http.test.mjs
git commit -m "feat: accept bounded assistant history"
```

---

### Task 3: Pass History Through Sequential AI Failover Only

**Files:**
- Modify: `server/assistant.mjs` `answerAssistant()` arguments/provider invocation.
- Modify: `server/assistant.test.mjs`.

**Interfaces:**
- Consumes: sanitized `history` from Task 2.
- Produces: each configured AI provider receives `{ providerConfig, prompt, history, overview, systemPrompt, signal }`.
- Preserves: `previewImpl({ message: text })` receives only the current prompt.

- [ ] **Step 1: Write a failing successful-provider history test**

Inject a fake provider, capture its arguments, and assert `history` is forwarded unchanged.

- [ ] **Step 2: Write a failing failover history test**

Configure two fake providers: first throws `ProviderUnavailableError`, second succeeds. Assert the second provider receives the same history and the result retains `fallbackUsed: true` plus the first provider's failed attempt.

- [ ] **Step 3: Write/retain deterministic fallback test**

Inject `previewImpl` and assert its only semantic input is `{ message: currentPrompt }`; it must not receive or resolve history.

- [ ] **Step 4: Run focused orchestration tests and verify RED**

Run:
```bash
node --test server/assistant.test.mjs
```
Expected: FAIL because history is not currently passed to providers.

- [ ] **Step 5: Add `history = []` to `answerAssistant()` and provider calls**

```js
export async function answerAssistant({ config, prompt, history = [], overview, ...rest } = {}) {
  // existing prompt validation and provider loop
  const result = await provider({
    providerConfig,
    prompt: text,
    history,
    overview,
    systemPrompt,
    signal: signalFactory(providerTimeoutMs(ai, providerId)),
  })
}
```

Do not change provider order, timeout selection, attempt classification, deterministic fallback text, or output schema.

- [ ] **Step 6: Run focused orchestration tests and verify GREEN**

Run:
```bash
node --test server/assistant.test.mjs
```
Expected: PASS, zero failures.

- [ ] **Step 7: Commit Task 3**

```bash
git add server/assistant.mjs server/assistant.test.mjs
git commit -m "feat: carry context through AI failover"
```

---

### Task 4: Make Conversation Context Non-Authoritative in the Shared AI Policy

**Files:**
- Modify: `server/ai/policy.mjs`.
- Modify: `server/ai/policy.test.mjs`.

**Interfaces:**
- Produces: `fridayUserPrompt(prompt, overview, history = [])`.
- Preserves: `fridaySystemPrompt()` exact identifier rules.
- Adds: explicit rule that previous conversation is context, not infrastructure evidence.

- [ ] **Step 1: Write failing policy tests**

Assert `fridaySystemPrompt()` contains the non-authoritative-history rule and still contains exact identifier preservation language.

Assert `fridayUserPrompt('Compare it to VM102', overview, history)` contains sections in this order:

```text
Recent session context:
[user] Check friday-ollama
[assistant] friday-ollama is LXC 107

Current operator request:
Compare it to VM102

Authoritative normalized Friday state:
..."friday-ollama"...108...
```

The test intentionally puts a wrong historical ID (`107`) next to correct current state (`108`) and verifies both are serialized distinctly; the state is labeled authoritative.

- [ ] **Step 2: Run policy tests and verify RED**

Run:
```bash
node --test server/ai/policy.test.mjs
```
Expected: FAIL on missing history sections/authority rule.

- [ ] **Step 3: Implement the shared formatter**

Keep history serialization simple and deterministic:

```js
function formatHistory(history = []) {
  if (!history.length) return 'Recent session context:\n(none)'
  return `Recent session context:\n${history.map(({ role, content }) => `[${role}] ${content}`).join('\n')}`
}

export function fridayUserPrompt(prompt, overview, history = []) {
  return [
    formatHistory(history),
    `Current operator request:\n${String(prompt || '').trim()}`,
    `Authoritative normalized Friday state:\n${JSON.stringify(overview ?? {})}`,
  ].join('\n\n')
}
```

Add to the system prompt: `Previous conversation is context, not infrastructure evidence. Resolve infrastructure facts and identifiers from the current normalized Friday state.`

- [ ] **Step 4: Run policy tests and verify GREEN**

Run:
```bash
node --test server/ai/policy.test.mjs
```
Expected: PASS, zero failures.

- [ ] **Step 5: Commit Task 4**

```bash
git add server/ai/policy.mjs server/ai/policy.test.mjs
git commit -m "feat: ground conversational assistant context"
```

---

### Task 5: Feed the Same History Format to Every AI Adapter

**Files:**
- Modify: `server/ai/groq.mjs`, `server/ai/groq-failover.test.mjs` or existing Groq adapter coverage.
- Modify: `server/ai/gemini.mjs`, `server/ai/gemini.test.mjs`.
- Modify: `server/ai/ollama.mjs`, `server/ai/ollama.test.mjs`.
- Modify: `server/ai/openai.mjs`, `server/ai/openai.test.mjs`.
- Modify: `server/ai/anthropic.mjs`, `server/ai/anthropic.test.mjs`.

**Interfaces:**
- Consumes: provider argument `history = []` from Task 3.
- Consumes: `fridayUserPrompt(prompt, overview, history)` from Task 4.
- Produces: provider transport payload containing one shared, identically structured Friday context string.

- [ ] **Step 1: Add failing adapter assertions for preferred providers**

For Groq, Gemini, and Ollama, provide history to the adapter and inspect the mocked outbound JSON. Assert it contains `Recent session context`, the historical messages, `Current operator request`, and `Authoritative normalized Friday state`.

Do not snapshot entire provider payloads; assert only the shared Friday content plus provider-specific fields already covered by existing tests.

- [ ] **Step 2: Add failing compatibility-adapter assertions**

Repeat the shared-context assertion for OpenAI and Anthropic so explicit compatibility provider behavior cannot silently diverge.

- [ ] **Step 3: Run all AI adapter tests and verify RED**

Run:
```bash
node --test server/ai/groq-failover.test.mjs server/ai/gemini.test.mjs server/ai/ollama.test.mjs server/ai/openai.test.mjs server/ai/anthropic.test.mjs
```
Expected: FAIL because adapters do not yet forward history to `fridayUserPrompt()`.

- [ ] **Step 4: Update all adapter signatures minimally**

Use the same pattern in each adapter:

```js
export async function askGroq({ providerConfig = {}, prompt, history = [], overview, systemPrompt = fridaySystemPrompt(), fetchImpl = globalThis.fetch, signal } = {}) {
  // existing transport
  { role: 'user', content: fridayUserPrompt(prompt, overview, history) }
}
```

Apply the equivalent shared formatter call to Gemini, Ollama, OpenAI, and Anthropic without changing endpoint URLs, model fields, token limits, headers, or error classification.

- [ ] **Step 5: Run adapter and policy/orchestration tests and verify GREEN**

Run:
```bash
node --test server/assistant.test.mjs server/ai/policy.test.mjs server/ai/groq-failover.test.mjs server/ai/gemini.test.mjs server/ai/ollama.test.mjs server/ai/openai.test.mjs server/ai/anthropic.test.mjs
```
Expected: PASS, zero failures.

- [ ] **Step 6: Commit Task 5**

```bash
git add server/ai
git commit -m "feat: share conversational context across AI providers"
```

---

### Task 6: Extend the Frontend API Contract

**Files:**
- Modify: `src/lib/api.ts`.
- Add test coverage in: `src/hooks/useFridaySession.test.tsx` during Task 7 rather than creating a fetch-only test file.

**Interfaces:**
- Produces: `FridayAssistantHistoryMessage = { role: 'user' | 'assistant'; content: string }`.
- Produces: `FridayAssistantRequestOptions = { history?: FridayAssistantHistoryMessage[]; signal?: AbortSignal }`.
- Produces: `askFridayAssistant(prompt: string, options?: FridayAssistantRequestOptions): Promise<FridayAssistantResponse>`.

- [ ] **Step 1: Change the TypeScript API shape only after Task 7's first failing hook test exists**

Use an options object to avoid an ambiguous second positional parameter:

```ts
export type FridayAssistantHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type FridayAssistantRequestOptions = {
  history?: FridayAssistantHistoryMessage[]
  signal?: AbortSignal
}

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
  // existing response handling
}
```

- [ ] **Step 2: Run TypeScript build to expose every call site needing migration**

Run:
```bash
npm run build
```
Expected at this intermediate point: FAIL only at old `askFridayAssistant(prompt)` mocks/signatures if TypeScript detects mismatches; record exact call sites for Task 7/Task 9. Do not repair unrelated errors.

- [ ] **Step 3: Commit the API contract together with the first green hook implementation in Task 7**

Do not create a standalone commit if the changed API has no consuming green behavior yet.

---

### Task 7: Add the In-Memory `useFridaySession` State Machine

**Files:**
- Create: `src/hooks/useFridaySession.ts`.
- Create: `src/hooks/useFridaySession.test.tsx`.
- Modify: `src/lib/api.ts` as defined in Task 6.

**Interfaces:**
- Consumes: `askFridayAssistant(prompt, { history })`.
- Produces:

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

- [ ] **Step 1: Write failing hook test for immediate user/loading turns**

Mock `askFridayAssistant` with a pending promise. Render a tiny harness using the hook; call `sendMessage('Check service health')`; assert one complete user message and one loading assistant message appear before the promise resolves.

- [ ] **Step 2: Write failing hook test for success/error replacement**

On success, assert the loading placeholder becomes a complete assistant message carrying `mode`, `provider`, `model`, `fallbackUsed`, and `attempts`. On rejection, assert it becomes `status: 'error'`, the user message remains, and no retry occurs.

- [ ] **Step 3: Write failing history-selection tests**

Seed/drive more than 10 completed exchanges, then submit one more prompt. Assert the API receives exactly 20 historical messages representing the newest 10 completed exchanges, excludes the current prompt, and excludes any failed/loading exchange.

- [ ] **Step 4: Write failing clear/remount tests**

Assert `clearSession()` empties messages while idle; a new hook remount starts empty; clearing is ignored or disabled by consumers while `loading === true` so no pending response can reappear into a cleared transcript.

- [ ] **Step 5: Run hook tests and verify RED**

Run:
```bash
npx vitest run src/hooks/useFridaySession.test.tsx
```
Expected: FAIL because the hook does not exist.

- [ ] **Step 6: Implement the minimal hook and API options contract**

Use React state only. Do not touch `localStorage`, `sessionStorage`, IndexedDB, server storage, or `/data`.

History construction must pair each completed user message with the following completed assistant message, then flatten the newest 10 pairs:

```ts
function completedHistory(messages: FridaySessionMessage[]): FridayAssistantHistoryMessage[] {
  const pairs: FridayAssistantHistoryMessage[][] = []
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index]
    const assistant = messages[index + 1]
    if (user.role === 'user' && user.status === 'complete' && assistant.role === 'assistant' && assistant.status === 'complete') {
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

Generate frontend-only IDs with a deterministic increment/ref or `crypto.randomUUID()`; IDs are never sent as authorization/session state.

- [ ] **Step 7: Run hook tests and build; verify GREEN**

Run:
```bash
npx vitest run src/hooks/useFridaySession.test.tsx
npm run build
```
Expected: hook tests PASS; build may still reveal Dashboard integration work required by Task 9 only if an existing call signature was not yet migrated. If so, keep Task 7 focused and note the exact compiler errors for Task 9.

- [ ] **Step 8: Commit Task 6 + Task 7**

```bash
git add src/lib/api.ts src/hooks/useFridaySession.ts src/hooks/useFridaySession.test.tsx
git commit -m "feat: add in-memory Friday assistant session"
```

---

### Task 8: Build Transcript, Composer, and Fallback Provenance Components

**Files:**
- Create: `src/components/FridayComposer.tsx`.
- Create: `src/components/FridayConversation.tsx`.
- Create: `src/components/FridayConversation.test.tsx`.
- Modify: `src/components/AssistantReply.tsx`.
- Modify: `src/components/AssistantReply.test.tsx`.
- Modify: `src/assistant.css`.

**Interfaces:**
- `FridayComposer` consumes `{ value, loading, placeholder, onChange, onSubmit }` and owns no session state.
- `FridayConversation` consumes `{ messages, compact?: boolean }` and owns no API state.
- `AssistantReplyState` expands with optional `fallbackUsed?: boolean` and `attempts?: FridayAssistantAttempt[]`.

- [ ] **Step 1: Write failing `AssistantReply` fallback tests**

Assert no `Fallback used` control when false/undefined. When true, assert a button with `aria-expanded="false"`; click it and assert returned attempts appear in original order. Do not render a fabricated successful attempt.

- [ ] **Step 2: Write failing conversation compact/full tests**

Build a transcript with three completed exchanges plus a current loading or error exchange. Assert `compact` renders only the newest two completed exchanges plus the current active exchange; full mode renders the entire transcript.

- [ ] **Step 3: Run component tests and verify RED**

Run:
```bash
npx vitest run src/components/AssistantReply.test.tsx src/components/FridayConversation.test.tsx
```
Expected: FAIL on missing fallback and conversation components.

- [ ] **Step 4: Extend `AssistantReply` minimally**

Keep existing cloud/local/deterministic badge behavior. Add a real button for fallback details:

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

Render only `state.attempts` entries; provider/model above the details remains the successful source.

- [ ] **Step 5: Implement stateless conversation/composer components**

`FridayConversation` maps user messages to user bubbles and assistant messages through `AssistantReply`. It must not call `askFridayAssistant` directly.

`FridayComposer` should use the existing command icon/chevron visual language, disable input/send when loading, trim emptiness at submission, and let the parent retain the controlled input value.

- [ ] **Step 6: Add focused styles**

Add only assistant-session classes to `src/assistant.css`: transcript spacing, user/assistant distinction, compact mode, fallback details, composer, full workspace scrolling, and responsive sizing. Do not restyle unrelated dashboard panels.

- [ ] **Step 7: Run component tests and build; verify GREEN**

Run:
```bash
npx vitest run src/components/AssistantReply.test.tsx src/components/FridayConversation.test.tsx
npm run build
```
Expected: PASS / build exit 0 except any known Task 9 Dashboard signature migration, which must be resolved in Task 9 before its commit.

- [ ] **Step 8: Commit Task 8**

```bash
git add src/components/AssistantReply.tsx src/components/AssistantReply.test.tsx src/components/FridayComposer.tsx src/components/FridayConversation.tsx src/components/FridayConversation.test.tsx src/assistant.css
git commit -m "feat: render Friday conversation provenance"
```

---

### Task 9: Add the Dedicated FRIDAY Workspace and Share It with Overview/Mobile

**Files:**
- Create: `src/components/FridayWorkspace.tsx`.
- Create: `src/components/FridayWorkspace.test.tsx`.
- Modify: `src/pages/Dashboard.tsx`.
- Modify: `src/pages/Dashboard.assistant.test.tsx`.
- Modify: `src/components/MobileHome.tsx`.
- Modify: `src/components/MobileHome.test.tsx`.
- Modify: `src/assistant.css` and, only if necessary, `src/mobile.css`.

**Interfaces:**
- `Dashboard` owns exactly one `useFridaySession()` instance.
- `FridayWorkspace` consumes `session`, controlled composer value/callbacks, and renders full transcript.
- `MobileHome` consumes shared session data and renders compact transcript.

- [ ] **Step 1: Write failing workspace tests**

Assert the workspace renders `FRIDAY / SESSION`, `Advisory only · No actions executed`, `Context: up to 10 recent exchanges`, the full supplied transcript, and `Clear session`. Assert Clear invokes the callback only while not loading and is disabled while loading.

- [ ] **Step 2: Rewrite/add Dashboard assistant integration tests before production code**

Use the real hook with a mocked `askFridayAssistant`. Test this sequence:

1. Start on Overview.
2. Submit `Check friday-ollama`.
3. Resolve response `friday-ollama is LXC 108` with Groq provenance.
4. Navigate to FRIDAY.
5. Assert both user and assistant turns remain visible.
6. Submit `Compare it to VM102` from FRIDAY.
7. Assert mock API receives the first completed exchange in `history`.
8. Navigate back to Overview and assert compact conversation remains.

Also assert a fresh unmount/remount starts with no transcript.

- [ ] **Step 3: Add/update MobileHome failing test**

Assert the mobile Overview card renders the compact shared transcript and uses the shared composer callbacks; it must not own a separate assistant reply state.

- [ ] **Step 4: Run focused UI integration tests and verify RED**

Run:
```bash
npx vitest run src/components/FridayWorkspace.test.tsx src/pages/Dashboard.assistant.test.tsx src/components/MobileHome.test.tsx
```
Expected: FAIL on missing workspace/shared-session wiring.

- [ ] **Step 5: Implement `FridayWorkspace`**

Use `FridayConversation` in full mode and `FridayComposer` at the bottom. Keep safety/context copy visible at the top. `Clear session` must call only `session.clearSession()` and never invoke a server endpoint.

- [ ] **Step 6: Replace Dashboard one-shot assistant state**

Remove `assistant: AssistantReplyState`, old `askFriday()` one-shot orchestration, and duplicated Overview/FRIDAY hero behavior. Add:

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

Render:
- `active === 'Overview'`: existing operational overview plus compact `FridayConversation` and `FridayComposer`, with `Continue conversation` navigating to `FRIDAY` when messages exist.
- `active === 'FRIDAY'`: only the dedicated `FridayWorkspace` content for the assistant area, not the duplicated Overview infrastructure sections.
- Other destinations unchanged.

Keep the existing `Automation` toggle presentation unchanged; do not interpret it as permission to execute actions.

- [ ] **Step 7: Migrate MobileHome props**

Replace `assistant: AssistantReplyState` with the shared session/messages/loading contract needed for compact rendering. Reuse `FridayComposer` where practical; if mobile-specific markup is required, keep it controlled by the same parent state and session callbacks.

- [ ] **Step 8: Run focused UI tests and build; verify GREEN**

Run:
```bash
npx vitest run src/components/FridayWorkspace.test.tsx src/pages/Dashboard.assistant.test.tsx src/components/MobileHome.test.tsx src/components/FridayConversation.test.tsx src/components/AssistantReply.test.tsx src/hooks/useFridaySession.test.tsx
npm run build
```
Expected: all selected tests PASS and build exits 0.

- [ ] **Step 9: Commit Task 9**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.assistant.test.tsx src/components/FridayWorkspace.tsx src/components/FridayWorkspace.test.tsx src/components/MobileHome.tsx src/components/MobileHome.test.tsx src/assistant.css src/mobile.css
git commit -m "feat: add shared Friday conversation workspace"
```

If `src/mobile.css` was not changed, omit it from `git add`.

---

### Task 10: Document the Contract and Run Full Safety/Regression Gates

**Files:**
- Modify: `docs/codex/API_CONTRACT.md`.
- Modify: `README.md`.
- No runtime configuration, Compose, observer, or infrastructure files should change in this task.

**Interfaces:**
- Documents request `{ prompt, history? }`, history limits, stateless session semantics, response provenance, and read-only behavior.

- [ ] **Step 1: Update API contract documentation**

Document:

```json
{
  "prompt": "Compare it to VM102",
  "history": [
    { "role": "user", "content": "Check friday-ollama" },
    { "role": "assistant", "content": "friday-ollama is LXC 108" }
  ]
}
```

State exact limits: 4,000 current prompt; 2,000 per historical message; 12,000 total history characters; 20 historical messages / 10 completed exchanges at the UI context layer. State that history is optional and no server conversation is persisted.

- [ ] **Step 2: Update README operator behavior**

Document Overview compact conversation, dedicated FRIDAY full current-session transcript, refresh/remount clearing, provider/fallback provenance, and `Advisory only · No actions executed`.

- [ ] **Step 3: Run the full application test suite**

Run:
```bash
npm test
```
Expected: Vitest and all Node test groups PASS with zero failures.

- [ ] **Step 4: Run the production build**

Run:
```bash
npm run build
```
Expected: exit 0.

- [ ] **Step 5: Run CI-equivalent validation commands from the repository workflow**

Before execution, read `.github/workflows/*` on the implementation branch and run the same shell validation, observer security boundary, monitoring safety boundary, diagnostics safety boundary, controller Compose, local Docker override Compose, VM100 observer Compose, controller image build, and observer image build commands that Friday CI currently uses. Do not invent replacement commands; copy the exact workflow commands into the execution notes and run them unchanged.

Expected: every CI-equivalent gate exits 0.

- [ ] **Step 6: Run a persistence/mutation diff review**

Run:
```bash
git diff --name-only main...HEAD
git diff main...HEAD -- src server compose.yaml observer scripts
```

Verify:
- no `localStorage`, `sessionStorage`, IndexedDB, database, `/data` assistant-history persistence;
- no Docker socket enablement;
- no Proxmox/network/shell write action;
- no provider-order/timeout/model-token configuration change;
- no unexpected Compose/observer mutation.

If any such change exists, stop and remove it before proceeding.

- [ ] **Step 7: Perform representative UI acceptance checks**

On a local/dev build, verify desktop and phone widths already used by Friday's mobile acceptance process, including 360px, 390px, and 430px where available:

- Overview shows compact two-exchange history plus active loading/error turn.
- Continue conversation opens FRIDAY with the same transcript.
- FRIDAY displays full session, safety copy, context copy, clear control, and composer.
- Fallback details expand/collapse accessibly.
- Clear while idle removes only transcript.
- Refresh/remount clears transcript.

Capture screenshots only if the existing project acceptance workflow expects them; do not add screenshot infrastructure solely for this feature.

- [ ] **Step 8: Perform controlled live provider regression after automated gates**

Against the approved Friday test/deployment environment, verify without permanently changing production provider order:

1. Groq primary response with session history.
2. A controlled cloud fallback showing returned failed-attempt provenance.
3. CT108 Ollama response receives multi-turn context under the existing 45-second local timeout.
4. Exact identifier grounding still resolves `friday-ollama = LXC 108` even if stale/wrong history is supplied.

This is validation only. Do not authorize Friday to make infrastructure changes and do not deploy to production until separately approved.

- [ ] **Step 9: Commit documentation after all local code gates are green**

```bash
git add docs/codex/API_CONTRACT.md README.md
git commit -m "docs: document Friday assistant sessions"
```

- [ ] **Step 10: Fresh final verification before PR creation**

Run again on the exact final head:
```bash
npm test
npm run build
```
Then confirm `git status --short` is empty and record the exact `git rev-parse HEAD` SHA. The PR body must cite the exact-head CI run after GitHub CI completes; do not claim CI success from an earlier commit.

---

## Implementation Sequence and Review Gates

Execute tasks strictly in order because later interfaces depend on earlier ones:

1. Assistant input normalization.
2. HTTP contract enforcement.
3. Orchestration history propagation.
4. Shared grounding/policy format.
5. Provider adapter history plumbing.
6-7. Frontend API + session state machine as one green deliverable.
8. Presentation components and fallback disclosure.
9. Dashboard/mobile shared workspace integration.
10. Documentation and complete regression/safety verification.

After every task commit, review only that task's diff before continuing. If a task reveals architectural complexity outside the approved spec—especially persistence, authentication, action execution, provider orchestration changes, or server-side sessions—stop and return to design rather than expanding scope inside implementation.

## Definition of Done

Implementation is ready for PR review only when:

- all acceptance criteria in `docs/superpowers/specs/2026-08-24-friday-assistant-session-design.md` are implemented;
- `npm test` passes on the exact feature head;
- `npm run build` passes on the exact feature head;
- all Friday CI safety/Compose/container gates pass on the exact feature head;
- desktop and phone session behavior is manually checked;
- live Groq/fallback/CT108/identifier-grounding regression checks are recorded when the approved test environment is available;
- final diff contains no assistant persistence or new infrastructure mutation authority;
- the feature PR remains unmerged until explicit user approval.
