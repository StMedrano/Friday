# Friday Assistant Session Design

**Date:** 2026-08-24  
**Status:** Approved design, awaiting written-spec review  
**Repository:** `StMedrano/Friday`  
**Target:** Friday controller UI/API on VM102  

## 1. Purpose

This milestone turns the existing one-shot Friday assistant interaction into a shared, session-only conversational operations workspace without expanding Friday's mutation authority.

The current application already calls `POST /api/assistant`, renders assistant provenance, and supports the production provider chain. This design builds on that existing flow rather than replacing it.

The operator should be able to ask a question from Overview, continue the same conversation in the dedicated FRIDAY workspace, use follow-up references from recent conversation context, inspect provider/fallback provenance, and clear the current UI session. Conversation state exists only in frontend memory and disappears on page refresh or application remount.

## 2. Approved product decisions

The following decisions are fixed for this milestone:

1. Conversation history is **session-only**. No browser storage, server storage, database storage, or `/data` persistence is added.
2. Overview and the dedicated FRIDAY workspace share **one in-memory conversation**.
3. Friday uses **true multi-turn context**, not visual-only history.
4. Model context is limited to the **10 most recent completed exchanges** (20 historical messages maximum).
5. Overview shows a **compact recent thread**, limited to the two most recent completed exchanges, while FRIDAY shows the full current-session transcript.
6. Provider provenance is compact by default and exposes **expandable fallback details** when relevant.
7. The assistant remains **advisory/read-only**. This milestone adds no Docker, Proxmox, shell, network, deployment, remediation, approval, or other infrastructure mutation authority.

## 3. Goals

### 3.1 User goals

- Ask Friday from Overview and continue the same thread in FRIDAY.
- Ask natural follow-up questions such as "compare it to VM102" without restating the entire prior question.
- See whether the answer came from cloud AI, local AI, or deterministic local analysis.
- See provider/model information on each completed Friday response.
- See when provider fallback occurred and expand the route to inspect provider outcomes.
- Keep Overview operationally focused while using FRIDAY as the full conversation workspace.
- Clear the assistant session without affecting monitoring, diagnostics, incidents, audit data, or infrastructure state.

### 3.2 Engineering goals

- Keep `/api/assistant` stateless with respect to conversation storage.
- Reuse the existing normalized infrastructure overview on every request.
- Introduce history at the common assistant/policy boundary so Groq, Gemini, Ollama, and compatibility providers receive the same normalized context format.
- Enforce history bounds on the server even when the frontend already trims history.
- Preserve the current sequential provider failover behavior.
- Preserve deterministic local analysis as the final safe fallback.
- Keep units small enough to test independently.

## 4. Non-goals

This milestone does not add:

- durable conversation storage;
- cross-device or cross-browser history;
- user accounts, authentication, RBAC, per-user session ownership, or authorization policy;
- server-created conversation IDs;
- semantic memory, embeddings, retrieval-augmented conversation memory, or summarization of old turns;
- autonomous actions;
- command execution;
- infrastructure writes;
- automatic retries initiated by the UI after a failed turn;
- parallel AI provider fan-out;
- changes to the production provider order;
- voice input implementation;
- audit persistence of prompts or responses.

Durable assistant history belongs after identity/RBAC because stored conversations need an owner and access policy.

## 5. Existing baseline

Friday already has the main primitives needed for this milestone:

- `src/lib/api.ts` exposes `askFridayAssistant()` and assistant response metadata including `mode`, `provider`, `model`, `fallbackUsed`, and `attempts`.
- `src/pages/Dashboard.tsx` already submits the desktop assistant composer to `/api/assistant` and shares the same query/assistant state with mobile Overview.
- `src/components/AssistantReply.tsx` already renders cloud/local/deterministic provenance labels plus provider/model metadata.
- `src/components/MobileHome.tsx` already contains a compact assistant card for phone layouts.
- `server/http.mjs` obtains a fresh normalized overview before invoking `answerAssistant()`.
- `server/assistant.mjs` performs sequential provider failover and deterministic local-analysis fallback.
- `server/ai/policy.mjs` centralizes the Friday system prompt and the user prompt that combines the operator request with normalized Friday state.

The architecture should extend these units rather than introduce a separate assistant subsystem.

## 6. Architecture

### 6.1 Recommended structure

Use a dedicated frontend hook, `useFridaySession`, as the single owner of the current-page assistant transcript and send lifecycle.

A React context provider is not required for this milestone because Overview and FRIDAY are both rendered within the existing `Dashboard` tree. `Dashboard` can create one `useFridaySession()` instance and pass its state/actions to the relevant views. If routing is split into independent page trees in the future, the same hook contract can later be wrapped in context without changing the server API.

The server remains stateless. The browser sends a bounded history array with each new prompt. The server validates and re-bounds that history before it is allowed into provider prompts.

### 6.2 High-level flow

```text
Operator enters current prompt
        |
        v
useFridaySession
        |
        |-- append visible user turn immediately
        |-- create visible analyzing placeholder
        |-- build history from prior completed exchanges only
        v
POST /api/assistant
{
  prompt,
  history
}
        |
        v
HTTP validation and normalization
        |
        |-- prompt <= 4,000 chars
        |-- valid roles only
        |-- historical message <= 2,000 chars
        |-- history <= 12,000 chars total
        |-- newest 20 valid historical messages max
        v
currentOverview()
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
assistant response + provenance
        |
        v
replace analyzing placeholder with completed/error turn
```

## 7. Frontend session model

### 7.1 Transcript ownership

`useFridaySession` owns the full current-page transcript in React memory.

It should expose an interface equivalent to:

```ts
type FridaySession = {
  messages: FridaySessionMessage[]
  loading: boolean
  sendMessage(prompt: string): Promise<void>
  clearSession(): void
}
```

The exact internal shape may vary, but each visible message needs enough information to render role, text, lifecycle, and assistant provenance without consulting global dashboard state.

A practical message shape is:

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

`id` is a frontend rendering key only. It is not a durable conversation identifier and is never used as authorization or server state.

### 7.2 Sending a turn

When the operator submits a valid prompt:

1. Prevent duplicate submission while a request is already in flight.
2. Capture the prior transcript used for context before adding the current prompt to the model-history payload.
3. Append the current user message to the visible transcript immediately.
4. Append an assistant `loading` placeholder immediately after it.
5. Send the current prompt plus bounded prior completed exchanges to `/api/assistant`.
6. On success, replace the loading placeholder with the returned text and provenance.
7. On failure, replace the placeholder with an error turn. Do not automatically resubmit.
8. Re-enable the composer.

The current prompt is sent in `prompt`; it must not also be duplicated inside `history`.

### 7.3 What counts as model history

Only **prior completed exchanges** are eligible for the next model request.

A completed exchange is a user message paired with a following assistant message whose status is `complete`. This includes cloud AI, local AI, or successful deterministic local-analysis responses.

Failed assistant turns remain visible in the current-session transcript but are excluded from model history. Loading placeholders are also excluded. This prevents transient provider errors from becoming conversational evidence.

The frontend sends at most the 10 newest completed exchanges.

### 7.4 Session clearing

`clearSession()` removes only the frontend transcript and resets assistant loading/error presentation.

It must not:

- change `/api/overview` state;
- clear incidents;
- clear monitoring history;
- remove diagnostics;
- clear audit information;
- modify infrastructure;
- call a server-side delete endpoint.

Refreshing/remounting naturally starts with an empty session because no persistence mechanism is added.

## 8. UI design

### 8.1 Overview

Overview remains the operational command center. The assistant section should show:

- the existing Friday visual/core treatment;
- the shared composer;
- at most the two most recent completed exchanges;
- compact provenance on assistant replies;
- a `Continue conversation` control when conversation history exists.

Selecting `Continue conversation` navigates to the existing FRIDAY navigation destination while preserving the same hook instance and transcript.

The Overview assistant should not expand into an unlimited scrolling transcript. Infrastructure health, incidents, and service state remain the dominant content on Overview.

### 8.2 Dedicated FRIDAY workspace

The FRIDAY destination becomes a dedicated conversation workspace instead of rendering the same Overview composition unchanged.

It should contain:

- session header: `FRIDAY / SESSION`;
- persistent safety text: `Advisory only · No actions executed`;
- context indicator: `Context: up to 10 recent exchanges`;
- `Clear session` control;
- full current-session transcript;
- sticky or bottom-positioned shared composer;
- responsive behavior suitable for the existing phone shell.

The full session is visual history only; the provider request still receives only the bounded 10-exchange context window.

### 8.3 Message presentation

User messages and Friday messages should be visually distinguishable without introducing a separate design language.

Friday replies reuse and extend the existing assistant provenance treatment:

- `FRIDAY CLOUD AI` for cloud providers;
- `FRIDAY LOCAL AI` for Ollama;
- `LOCAL ANALYSIS · NO AI` for deterministic analysis;
- provider and model metadata when present.

Each completed assistant response stores its own provenance so earlier messages do not change appearance when later provider fallback occurs.

### 8.4 Fallback details

When `fallbackUsed !== true`, no fallback label is shown.

When `fallbackUsed === true`, the reply shows a compact `Fallback used` indicator plus an expandable `Details` control.

The expanded details render the returned `attempts` in their original order, for example:

```text
Groq   — timeout
Gemini — upstream
Ollama — success
```

The current server records failed attempts before the successful provider. The UI must not invent a successful attempt that is absent from the response. The final provider/model displayed in the normal provenance line remains the authoritative successful source.

If deterministic local analysis is the final result, the failed AI attempts may be shown in the details followed by the normal deterministic provenance label; no fabricated `deterministic — success` attempt is required.

### 8.5 Errors

A failed request remains in the visual transcript as:

- the submitted user message;
- an assistant error message for that turn.

The UI does not automatically retry or silently switch the user's prompt. The operator may edit or submit another request after the composer becomes available.

## 9. API contract

### 9.1 Request

`POST /api/assistant`

```json
{
  "prompt": "Compare it to VM102",
  "history": [
    { "role": "user", "content": "Check friday-ollama" },
    { "role": "assistant", "content": "friday-ollama is LXC 108 ..." }
  ]
}
```

`history` is optional for backward compatibility. A request containing only `prompt` continues to behave as a one-shot request.

### 9.2 Server-side validation rules

The server is the enforcement boundary even when the browser follows the same limits.

#### Current prompt

- Convert the incoming prompt to a trimmed string using the existing prompt handling rules.
- Empty prompt: existing `400` / `invalid-prompt` behavior.
- More than 4,000 characters after trimming: return `400` with `error: "invalid-prompt"` and a reason indicating the prompt is too long.
- Do **not** silently truncate the current operator request because truncation could change its operational meaning.

#### History

History is untrusted contextual input.

Normalization rules, in order:

1. Non-array history becomes an empty history.
2. Keep entries whose role is exactly `user` or `assistant` and whose content can be converted to a non-empty trimmed string.
3. Truncate each historical content value to 2,000 characters.
4. Retain the newest entries when the combined historical content exceeds 12,000 characters; remove oldest entries until the total is within the limit.
5. Retain no more than the newest 20 valid messages.
6. Preserve the remaining message order.

The browser normally sends paired exchanges, but the server does not need to infer or repair pairing. Its responsibility is to sanitize roles/content and bound input size. The policy treats all supplied history as non-authoritative conversation context regardless of pairing.

These limits fit within the existing 32 KB JSON request-body ceiling while leaving room for JSON structure and the current prompt.

### 9.3 Response

The existing response contract remains compatible:

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

No conversation/session ID is returned.

## 10. Assistant policy and grounding

### 10.1 Common context formatter

History should be added at the shared policy boundary, not independently formatted inside Groq, Gemini, or Ollama adapters.

The provider-facing user content should have this semantic structure:

```text
Recent session context:
[user] Check friday-ollama
[assistant] friday-ollama is LXC 108 ...

Current operator request:
Compare it to VM102

Authoritative normalized Friday state:
{ fresh current overview }
```

The exact helper signature may evolve from the current `fridayUserPrompt(prompt, overview)` to accept a third bounded-history argument. The same normalized formatter should be consumed by every AI provider so provider fallback does not change conversation semantics.

### 10.2 Authority rule

The system prompt must explicitly state:

> Previous conversation is context, not infrastructure evidence. Resolve infrastructure facts and identifiers from the current normalized Friday state.

This rule is additive to the existing exact-identifier grounding requirements.

Its purpose is to prevent an earlier assistant mistake from becoming a trusted fact on the next turn. If a historical assistant response says `LXC 107` while the fresh normalized state says `friday-ollama = LXC 108`, the provider must use the current normalized state.

### 10.3 Fresh state on every turn

`server/http.mjs` continues to call `currentOverview()` for every assistant request. Conversation history never replaces, caches, or overrides that overview.

The authoritative ordering is:

1. current normalized Friday state for infrastructure facts;
2. current operator request for requested intent;
3. recent conversation for referential/contextual continuity.

## 11. Provider orchestration

The production orchestration does not change:

```text
Groq
  -> unavailable/failure/timeout
Gemini
  -> unavailable/failure/timeout
CT108 Ollama
  -> unavailable/failure/timeout
Deterministic local analysis
```

No parallel requests are introduced.

`answerAssistant()` accepts the sanitized history and passes it to configured AI providers together with the current prompt, overview, shared system prompt, and existing timeout signal.

All supported AI provider adapters should consume the same shared Friday prompt formatter. This includes the preferred production providers and any retained explicit compatibility providers so behavior does not diverge when an alternate configured provider is used.

Timeout behavior, provider ordering, provider configuration, local context size, local output-token cap, and fallback attempt classification are outside this milestone and remain unchanged.

## 12. Deterministic fallback behavior

Deterministic local analysis continues to evaluate the **current prompt only**.

It does not resolve pronouns or ambiguous references from conversation history. This avoids silently teaching the deterministic command parser conversational semantics that it does not currently support.

Example:

- Current prompt: `check service health` -> deterministic preview may answer if supported.
- Current prompt: `check that one again` after all AI providers fail -> deterministic preview should not guess what `that one` means.

If no AI provider succeeds and the current prompt does not independently map to supported deterministic analysis, Friday returns the existing unavailable response rather than inferring from history.

## 13. Safety boundary

This milestone must preserve Friday's current read-only/advisory boundary.

Conversation context may help Friday explain, compare, summarize, diagnose, and propose read-only next steps. It does not grant any execution permission.

The implementation must not add or enable:

- Docker socket access;
- Proxmox writes;
- shell command execution;
- network configuration changes;
- deployment actions;
- restart/stop/start controls;
- remediation execution;
- approval execution;
- arbitrary HTTP write adapters;
- hidden action endpoints.

The FRIDAY workspace must visibly state `Advisory only · No actions executed`.

The existing policy that Friday must not claim it executed/restarted/changed/deployed/remediated anything remains active.

## 14. Component boundaries

The implementation plan should prefer the following responsibility boundaries.

### `useFridaySession`

Owns transcript state, context selection, request lifecycle, loading/error turn replacement, and session clearing.

Depends on the API client, not directly on `fetch`.

### API client (`src/lib/api.ts`)

Defines request/response types and sends `{ prompt, history }` to `/api/assistant`.

It does not own transcript state.

### Conversation presentation

A focused conversation component renders a supplied message list in either compact or full mode. It does not call the assistant API.

### Composer

A focused shared composer owns only input presentation/submission wiring. It receives loading state and submit/change callbacks from the session owner.

Existing composer markup may be extracted only where that reduces duplicate desktop/mobile behavior needed by this milestone. Unrelated dashboard refactoring is out of scope.

### Assistant provenance/reply presentation

The existing `AssistantReply` behavior should be evolved or composed into the new conversation rendering so its cloud/local/deterministic labels remain consistent. Fallback disclosure belongs with the individual assistant message.

### Server history normalization

A small pure helper should normalize/bound incoming history before `answerAssistant()` receives it. This helper should be independently unit-testable and must not persist the result.

### Shared AI policy formatter

Owns formatting of sanitized history, current request, and normalized state into provider-facing text. Provider adapters should not implement independent history serialization.

## 15. Testing strategy

Implementation uses TDD. Tests are added before behavior changes and must demonstrate red/green progression for the new requirements.

### 15.1 Server HTTP/contract tests

Cover:

- request with prompt only remains compatible;
- request with valid history forwards sanitized history to `answerAssistantImpl`;
- empty prompt remains `400 invalid-prompt`;
- prompt over 4,000 characters returns `400 invalid-prompt` rather than being silently truncated;
- non-array history becomes empty;
- invalid roles are discarded;
- empty history messages are discarded;
- historical messages are truncated to 2,000 characters;
- history is reduced to newest messages when total content exceeds 12,000 characters;
- history is capped at newest 20 valid messages;
- fresh overview is still built for every assistant request;
- no persistence API or write side effect is introduced.

### 15.2 Assistant orchestration/policy tests

Cover:

- sanitized history is passed to the successful AI provider;
- the same history survives provider failover to the next provider;
- deterministic fallback receives only the current prompt through `previewImpl`;
- provider attempts/fallback metadata remain unchanged;
- policy text declares prior conversation non-authoritative for infrastructure facts;
- provider-facing prompt separates recent context, current request, and authoritative normalized state;
- exact infrastructure-identifier grounding remains present;
- a stale/wrong identifier in assistant history does not alter the current normalized state serialized to the provider prompt.

### 15.3 Provider adapter tests

For Groq, Gemini, Ollama, and retained compatibility adapters:

- history reaches the shared formatter/provider request;
- normalized state remains present;
- provider-specific transport details remain otherwise unchanged.

### 15.4 Frontend session tests

Cover:

- a submitted user turn appears immediately;
- an analyzing assistant placeholder appears while the request is pending;
- success replaces the placeholder with the completed response;
- failure replaces the placeholder with an error and does not auto-retry;
- Overview and FRIDAY share the same transcript;
- navigation between Overview and FRIDAY does not clear the transcript;
- remount starts with an empty transcript;
- Overview renders at most the two newest completed exchanges;
- FRIDAY renders the full current-session transcript;
- only 10 newest completed exchanges are sent in history;
- the current prompt is not duplicated inside history;
- failed/loading exchanges are excluded from later model history;
- `Clear session` empties only session messages;
- provider/mode/model are stored per assistant turn;
- `Fallback used` appears only when true;
- expandable details preserve returned provider-attempt order and outcomes;
- the FRIDAY workspace displays the advisory/read-only statement.

### 15.5 Regression gates

The existing Friday CI suite must remain green, including:

- application tests;
- production build;
- shell validation;
- observer security boundary tests;
- monitoring safety boundary tests;
- diagnostics safety boundary tests;
- controller Compose validation;
- local Docker override Compose validation;
- VM100 observer Compose validation;
- controller image build;
- observer image build.

## 16. Error handling details

- Invalid current prompt: HTTP `400`, displayed as an assistant error turn if reached from the UI.
- AI provider failure with later provider success: normal assistant reply plus `fallbackUsed: true` and failed attempt details.
- All AI providers fail but deterministic analysis succeeds: normal local-analysis reply plus fallback provenance.
- All AI providers fail and deterministic analysis cannot map the current prompt: existing `503` assistant-unavailable semantics; visual error remains in transcript.
- Network/API failure in the browser: visible error turn; no automatic retry.
- Clearing while idle: immediate local reset.
- The UI should disable Clear Session while a request is actively in flight, avoiding orphaning a pending response into a newly cleared transcript. No request-cancellation feature is required for this milestone.

## 17. Data privacy and lifecycle

Conversation contents exist in:

1. React memory while the page is mounted;
2. the request body for the current `/api/assistant` call;
3. provider requests according to the currently selected provider/fallback sequence.

Friday itself does not intentionally write the transcript to disk, local storage, session storage, monitoring history, incident history, or an audit database in this milestone.

Provider-side data handling is governed by the configured external/local provider and is not changed by this design.

## 18. Accessibility and responsive behavior

- Transcript messages remain keyboard-readable in natural DOM order.
- Loading/error updates use appropriate live-region behavior without making the entire historical transcript repeatedly announce.
- Expand/collapse fallback details uses a real button with `aria-expanded`.
- Clear Session is a real button with an explicit accessible name.
- The composer remains keyboard-submittable.
- Disabled/loading controls expose standard disabled state.
- Mobile FRIDAY uses the existing phone shell and bottom navigation; no separate mobile application architecture is introduced.

## 19. Rollout and verification

This change should be delivered as a focused feature PR from `main` after the written spec and implementation plan are approved.

Before merge:

1. run the complete automated test suite;
2. run the production build;
3. run all existing safety/Compose/container CI gates;
4. review the final diff for accidental persistence or mutation authority;
5. validate desktop and phone conversation behavior at representative sizes;
6. validate Groq primary success and provenance;
7. validate a controlled provider fallback path without changing production provider order permanently;
8. validate CT108 Ollama receives conversational context under the existing local timeout;
9. regression-check exact infrastructure identifier grounding with conversation history present.

Production deployment remains a separate explicit step after merge. This design does not authorize deployment or infrastructure mutation by Friday itself.

## 20. Acceptance criteria

The milestone is complete only when all of the following are true:

- Overview and FRIDAY share one in-memory transcript.
- Refresh/remount clears the transcript.
- No conversation persistence mechanism has been added.
- Friday can use up to the previous 10 completed exchanges as context.
- Server-side validation independently enforces context limits.
- Fresh normalized infrastructure state is attached on every request and is explicitly more authoritative than conversation history.
- Overview shows no more than the two latest completed exchanges.
- FRIDAY shows the full current-session transcript.
- Each completed assistant reply retains its own mode/provider/model provenance.
- Fallback disclosure is compact and expandable.
- Failed provider attempts are shown only from returned attempt data.
- Deterministic fallback continues to evaluate the current prompt only.
- No autonomous or infrastructure-write authority is added.
- FRIDAY visibly states `Advisory only · No actions executed`.
- All new tests and existing CI gates pass on the exact feature head before merge.

## 21. Follow-on work

After this milestone, the roadmap remains:

1. expand read-only visibility and adapters such as Omada, AdGuard, and explicitly approved HTTP endpoint checks;
2. add authentication, identity/RBAC, durable action audit, approval semantics, and kill-switch controls;
3. only then design separately approved, tightly allowlisted controlled actions.

Durable assistant history may be reconsidered during the identity/RBAC stage, when conversation ownership and access controls can be specified safely.
