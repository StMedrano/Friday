# Friday Assistant Session Design

**Date:** 2026-08-24  
**Status:** Approved design, awaiting written-spec review  
**Repository:** `StMedrano/Friday`  
**Target:** Friday controller UI/API on VM102

## 1. Purpose

This milestone evolves Friday's existing one-shot assistant interaction into a shared, session-only conversational operations workspace without expanding Friday's mutation authority.

The application already calls `POST /api/assistant`, renders assistant provenance, and uses the production provider chain. This design extends that flow. The operator can ask from Overview, continue the same thread in FRIDAY, use bounded multi-turn context for follow-ups, inspect provider/fallback provenance, and clear the current UI session. Conversation state exists only in frontend memory and disappears on refresh/remount.

## 2. Approved decisions

1. History is **session-only**: no `localStorage`, `sessionStorage`, server storage, database storage, or `/data` persistence.
2. Overview and FRIDAY share **one in-memory conversation**.
3. Friday uses **true multi-turn context**.
4. Model context is capped at the **10 most recent completed exchanges** (20 historical messages maximum).
5. Overview shows a **compact two-exchange view**; FRIDAY shows the full current-session transcript.
6. Provenance stays compact and exposes **expandable fallback details** when fallback occurs.
7. Friday remains **advisory/read-only**. No Docker, Proxmox, shell, network, deployment, remediation, approval, or other mutation authority is added.

## 3. Goals

The operator should be able to:

- ask Friday on Overview and continue seamlessly in FRIDAY;
- ask follow-ups such as `compare it to VM102` without restating the prior question;
- see cloud AI, local AI, or deterministic local-analysis provenance for each reply;
- inspect provider/model information and failed fallback attempts;
- clear only the assistant session without affecting monitoring, incidents, diagnostics, audit information, or infrastructure state.

Engineering goals are to keep `/api/assistant` stateless for conversation storage, attach fresh normalized infrastructure state on every turn, use one common history formatter across providers, preserve sequential failover, and make the new session behavior independently testable.

## 4. Non-goals

This milestone does not add durable history, cross-device history, authentication/RBAC, server conversation IDs, semantic memory, embeddings, old-turn summarization, voice input, autonomous actions, command execution, infrastructure writes, automatic UI retries, parallel provider fan-out, provider-order changes, or prompt/response audit persistence.

Durable history belongs after identity/RBAC, when stored conversations can have an owner and access policy.

## 5. Existing baseline

Friday already provides the required foundation:

- `src/lib/api.ts` exposes `askFridayAssistant()` plus `mode`, `provider`, `model`, `fallbackUsed`, and `attempts`.
- `src/pages/Dashboard.tsx` already submits the real assistant request.
- `src/components/AssistantReply.tsx` already renders cloud/local/deterministic provenance plus provider/model metadata.
- `src/components/MobileHome.tsx` already has a compact phone assistant card.
- `server/http.mjs` obtains fresh normalized state before invoking `answerAssistant()`.
- `server/assistant.mjs` performs sequential failover and deterministic fallback.
- `server/ai/policy.mjs` centralizes the shared Friday system/user prompt policy.

The implementation should extend these boundaries rather than create a parallel assistant subsystem.

## 6. Architecture

Use a frontend hook, `useFridaySession`, as the single owner of the current-page transcript and request lifecycle. A React context provider is unnecessary now because Overview and FRIDAY live in the same `Dashboard` tree. `Dashboard` creates one hook instance and passes it to the relevant views. If routing later splits those views into independent trees, the hook contract can be wrapped in context without changing the server API.

The server remains stateless. The browser sends bounded prior history with each prompt; the server independently validates and bounds it before provider use.

```text
Operator prompt
    |
    v
useFridaySession
    |-- capture prior completed exchanges for model history
    |-- append visible user turn
    |-- append visible analyzing placeholder
    v
POST /api/assistant { prompt, history }
    |
    v
server history/prompt normalization
    |
    v
fresh currentOverview()
    |
    v
answerAssistant({ prompt, history, overview })
    |
    v
shared Friday policy formatter
    |
    v
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
    |
    v
response + provenance
    |
    v
replace analyzing placeholder with complete/error turn
```

## 7. Frontend session model

A practical hook contract is:

```ts
type FridaySession = {
  messages: FridaySessionMessage[]
  loading: boolean
  sendMessage(prompt: string): Promise<void>
  clearSession(): void
}
```

Each visible message needs role, text, lifecycle, and per-reply provenance:

```ts
type FridaySessionMessage = {
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
```

`id` is only a frontend rendering key; it is not persisted and has no authorization meaning.

### 7.1 Sending a turn

On submit:

1. Ignore empty input and prevent duplicate sends while a request is active.
2. Build the API history from the transcript as it existed **before** the current prompt.
3. Append the current user message immediately.
4. Append an assistant loading placeholder immediately.
5. Send the current prompt separately from bounded prior history.
6. On success, replace the placeholder with response text/provenance.
7. On failure, replace it with an error turn; do not auto-retry.
8. Re-enable the composer.

The current prompt appears only in `prompt`; it is not duplicated in `history`.

### 7.2 Model-history eligibility

Only prior **completed exchanges** are eligible for model context. A completed exchange is a user message paired with a following assistant message whose status is `complete`, including cloud AI, local AI, or successful deterministic local analysis.

Failed assistant turns and loading placeholders remain visible but are excluded from later model history. The frontend sends at most the newest 10 completed exchanges.

### 7.3 Clear session

`clearSession()` resets only the frontend transcript and assistant presentation. It must not clear overview data, incidents, monitoring history, diagnostics, audit information, or any server/infrastructure state, and it must not call a server delete endpoint.

Clear Session is disabled while a request is in flight so a late response cannot be appended into a newly cleared session. Cancellation is not required in this milestone.

## 8. UI behavior

### 8.1 Overview

Overview remains the operational command center. Its Friday area keeps the existing visual treatment and shared composer, but shows only the **two most recent exchange groups**.

An exchange group means a user turn plus its corresponding Friday state, which may currently be `loading`, `complete`, or `error`. This guarantees that the operator sees the prompt they just sent and its current result even before the exchange is eligible for future model history.

When any session history exists, a `Continue conversation` control navigates to FRIDAY without resetting the hook instance.

Overview must not become an unlimited chat transcript; infrastructure health and incidents remain dominant.

### 8.2 FRIDAY workspace

The FRIDAY destination becomes the full conversational operations workspace and contains:

- `FRIDAY / SESSION` header;
- persistent `Advisory only · No actions executed` text;
- `Context: up to 10 recent exchanges` indicator;
- `Clear session`;
- full in-memory transcript;
- shared composer at the bottom/sticky edge as appropriate;
- responsive phone behavior using the existing phone shell.

The full transcript is visual history. Only the bounded context window is sent to providers.

The existing global `Automation` UI, if still visible outside this workspace, must not be interpreted or wired as permission for the assistant to execute actions. This milestone gives the assistant no action authority regardless of that presentation state.

### 8.3 Provenance and fallback disclosure

Each completed assistant reply preserves its own provenance:

- `FRIDAY CLOUD AI`;
- `FRIDAY LOCAL AI`;
- `LOCAL ANALYSIS · NO AI`;
- final provider/model when available.

When `fallbackUsed !== true`, no fallback control appears.

When `fallbackUsed === true`, show `Fallback used` and an expandable `Details` button. Details render only the failed attempts actually returned by the server, in original order. Example:

```text
Groq   — timeout
Gemini — upstream
```

If Ollama then succeeds, its success is represented by the normal final provenance line (`FRIDAY LOCAL AI · ollama · qwen3:4b-instruct`), not by fabricating `Ollama — success` inside `attempts`.

If deterministic local analysis is the final result, failed AI attempts remain expandable and the deterministic provenance badge represents the final outcome.

## 9. API contract

`POST /api/assistant` accepts optional history while preserving prompt-only backward compatibility:

```json
{
  "prompt": "Compare it to VM102",
  "history": [
    { "role": "user", "content": "Check friday-ollama" },
    { "role": "assistant", "content": "friday-ollama is LXC 108 ..." }
  ]
}
```

No conversation/session ID is returned.

### 9.1 Current prompt validation

- Trim using existing prompt semantics.
- Empty prompt: existing `400` / `invalid-prompt` behavior.
- More than 4,000 characters after trimming: `400` / `invalid-prompt` with a clear too-long reason.
- Never silently truncate the current operator request because truncation could change operational meaning.

### 9.2 History normalization

History is untrusted contextual input. Server rules, in order:

1. Non-array history becomes `[]`.
2. Keep only entries with role exactly `user` or `assistant` and non-empty trimmed content.
3. Truncate each historical content value to 2,000 characters.
4. If combined historical content exceeds 12,000 characters, remove oldest entries until within the limit.
5. Keep no more than the newest 20 valid messages.
6. Preserve remaining order.

The browser normally sends paired completed exchanges. The server sanitizes and bounds messages but does not invent/repair missing pairs. History is non-authoritative regardless of role ordering.

These limits remain comfortably inside the existing 32 KB request-body ceiling while leaving room for JSON structure and the current prompt.

### 9.3 Response compatibility

The existing response remains authoritative:

```ts
type FridayAssistantResponse = {
  available: boolean
  mode?: 'cloud-ai' | 'local-ai' | 'local-analysis'
  provider?: string
  model?: string | null
  text?: string
  reason?: string
  fallbackUsed?: boolean
  attempts?: Array<{ provider: string; outcome: string }>
}
```

## 10. Shared AI policy and grounding

History must be formatted at the common policy boundary, not independently inside provider adapters.

Provider-facing user content has this semantic structure:

```text
Recent session context:
[user] Check friday-ollama
[assistant] friday-ollama is LXC 108 ...

Current operator request:
Compare it to VM102

Authoritative normalized Friday state:
{ fresh current overview }
```

The common helper may evolve from `fridayUserPrompt(prompt, overview)` to accept bounded history. All AI providers, including retained compatibility providers, should use the same formatter so fallback does not change conversation semantics.

The system policy gains this explicit rule:

> Previous conversation is context, not infrastructure evidence. Resolve infrastructure facts and identifiers from the current normalized Friday state.

This is additive to the existing exact-identifier policy. If an old assistant turn says `friday-ollama = LXC 107` while fresh normalized state says `friday-ollama = LXC 108`, the provider must use LXC 108.

Every assistant request continues to call `currentOverview()`. Authority order is:

1. fresh normalized state for infrastructure facts;
2. current operator request for intent;
3. recent conversation for referential continuity.

## 11. Provider orchestration and deterministic fallback

Production orchestration does not change:

```text
Groq
  -> failure/unavailable/timeout
Gemini
  -> failure/unavailable/timeout
CT108 Ollama
  -> failure/unavailable/timeout
Deterministic local analysis
```

No parallel fan-out is introduced. Timeout values, provider order/configuration, local context size, local output-token cap, and failure classification remain unchanged.

`answerAssistant()` accepts sanitized history and passes it to AI providers with the current prompt, overview, shared system policy, and existing timeout signal.

Deterministic local analysis continues to evaluate the **current prompt only**. It does not resolve pronouns from history. If all AI providers fail and `check that one again` does not independently map to a deterministic command, Friday returns the existing unavailable result instead of guessing the referent.

## 12. Safety boundary

Conversation context may help Friday explain health, summarize alerts, compare systems, identify likely causes, and propose read-only diagnostics. It grants no execution permission.

The implementation must not add or enable Docker socket access, Proxmox writes, shell execution, network changes, deployment actions, restart/stop/start controls, remediation, approval execution, arbitrary write adapters, or hidden action endpoints.

The existing policy prohibiting Friday from claiming it executed/restarted/changed/deployed/remediated anything remains active.

## 13. Component boundaries

The implementation plan should keep these responsibilities isolated:

- **`useFridaySession`**: transcript state, context selection, request lifecycle, loading/error replacement, clearing.
- **`src/lib/api.ts`**: typed `{ prompt, history }` request/response transport only.
- **Conversation presentation**: compact/full rendering only; no network call.
- **Composer**: input/submission presentation; receives callbacks/loading state.
- **Assistant provenance**: evolve/compose existing `AssistantReply`; provenance belongs to each reply.
- **Server history normalizer**: pure independently tested sanitizer/bounder; no persistence.
- **Shared AI policy formatter**: serializes history, current prompt, and fresh normalized state consistently for every AI provider.

Extract existing composer markup only where it eliminates duplication needed by this milestone. Unrelated dashboard refactors are out of scope.

## 14. Error handling

- Invalid/too-long current prompt: HTTP `400`, shown as an error turn when submitted from the UI.
- Earlier provider fails and later provider succeeds: normal reply, `fallbackUsed: true`, failed-attempt details.
- All AI providers fail but deterministic analysis succeeds: normal local-analysis reply plus failed-attempt provenance.
- All AI providers fail and deterministic analysis cannot map the current prompt: existing `503` unavailable semantics and a visible transcript error.
- Browser/network failure: visible error turn; no auto-retry.
- While loading: composer and Clear Session are disabled.

## 15. TDD and verification

Implementation uses TDD with red/green evidence for new behavior.

### 15.1 HTTP/contract tests

Verify:

- prompt-only requests remain compatible;
- valid history reaches `answerAssistantImpl` after sanitization;
- empty prompt remains `400 invalid-prompt`;
- prompt over 4,000 characters is rejected, not truncated;
- non-array history becomes empty;
- invalid roles/empty messages are discarded;
- historical messages truncate to 2,000 characters;
- total history retains newest content under 12,000 characters;
- history caps at newest 20 valid messages;
- fresh overview is built every request;
- no persistence/write side effect is introduced.

### 15.2 AI policy/orchestration/provider tests

Verify:

- history reaches a successful provider;
- identical sanitized history survives provider failover;
- deterministic `previewImpl` receives only the current prompt;
- attempts/fallback metadata remain unchanged;
- policy marks conversation as non-authoritative;
- provider prompt clearly separates history, current request, and authoritative state;
- exact identifier grounding remains present;
- stale/wrong identifiers in history cannot replace the fresh state serialized in the prompt;
- Groq, Gemini, Ollama, and retained compatibility adapters use the common history formatter without transport regressions.

### 15.3 Frontend tests

Verify:

- submitted user turn appears immediately;
- analyzing placeholder appears while pending;
- success/error replaces that placeholder;
- failure does not auto-retry;
- Overview and FRIDAY share one transcript across navigation;
- remount starts empty;
- Overview shows at most two latest exchange groups, including current loading/error state;
- FRIDAY shows the full in-memory transcript;
- only the 10 newest completed exchanges are sent as history;
- current prompt is not duplicated in history;
- failed/loading exchanges are excluded from later model history;
- Clear Session only clears assistant session data and is disabled while loading;
- each reply retains mode/provider/model/fallback metadata;
- fallback details show only returned failed attempts in original order;
- FRIDAY displays `Advisory only · No actions executed`.

### 15.4 Existing CI gates

The exact feature head must also pass the existing Friday suite: application tests, production build, shell validation, observer/monitoring/diagnostics safety boundaries, controller Compose, local Docker override Compose, VM100 observer Compose, controller image build, and observer image build.

## 16. Data lifecycle, accessibility, and responsive behavior

Conversation content exists only in React memory, the current `/api/assistant` request, and whichever configured provider is attempted by the existing failover sequence. Friday itself does not intentionally persist transcript contents in browser storage, `/data`, monitoring/incident history, or an audit database.

Transcript DOM order remains natural. Loading/error announcements should use focused live-region behavior rather than re-announcing the entire transcript. Fallback Details uses a real button with `aria-expanded`; Clear Session is a real accessible button; the composer stays keyboard-submittable; disabled controls expose normal disabled state. Mobile FRIDAY reuses the existing phone shell/navigation.

## 17. Rollout

Deliver this as a focused feature PR from `main` after this written spec and the implementation plan are approved.

Before merge:

1. run the complete automated suite and production build;
2. pass all existing safety/Compose/container gates;
3. review the final diff for accidental persistence or mutation authority;
4. validate desktop and phone conversation behavior;
5. validate Groq primary provenance;
6. validate a controlled fallback route without permanently changing production provider order;
7. validate CT108 Ollama receives bounded conversation context under the existing local timeout;
8. regression-check exact infrastructure identifier grounding with history present.

Production deployment remains a separate explicit step after merge. Nothing in this design authorizes Friday to deploy or mutate infrastructure.

## 18. Acceptance criteria

The milestone is complete only when:

- Overview and FRIDAY share one in-memory transcript;
- refresh/remount clears it and no persistence mechanism exists;
- Friday can use up to the previous 10 completed exchanges as context;
- the server independently enforces prompt/history limits;
- fresh normalized state is attached every turn and explicitly outranks history for infrastructure facts;
- Overview shows no more than two latest exchange groups, including loading/error state;
- FRIDAY shows the full current-session transcript;
- each assistant reply retains its own provenance;
- fallback disclosure is compact/expandable and does not invent successful attempts;
- deterministic fallback uses only the current prompt;
- the assistant receives no new mutation authority;
- FRIDAY visibly states `Advisory only · No actions executed`;
- all new tests and existing CI gates pass on the exact feature head before merge.

## 19. Follow-on roadmap

After this milestone:

1. expand approved read-only visibility/adapters such as Omada, AdGuard, and HTTP endpoint checks;
2. add authentication, identity/RBAC, durable action audit, approval semantics, and kill-switch controls;
3. only then design separately approved, tightly allowlisted controlled actions.

Durable assistant history can be reconsidered during identity/RBAC design, when conversation ownership and access controls can be specified safely.
