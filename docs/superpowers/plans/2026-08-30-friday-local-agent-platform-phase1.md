# Friday Local Agent Platform Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Friday's existing local-agent prototype into a usable, read-only, local-first agent platform with Git-authoritative definitions, self-hosted Supabase runtime registry, deterministic-first routing, CT108-only inference, and a functional Agents workspace.

**Architecture:** Agent definitions remain version-controlled under `agents/` and are validated/synchronized by VM102 into Friday-owned Supabase tables. The controller reads registered agents from Supabase, routes requests using explicit override -> deterministic rules -> optional CT108 local-router classification, and invokes only CT108 Ollama through server-side model profiles. Phase 1 exposes no infrastructure tool executor or mutation authority.

**Tech Stack:** Node 22 ESM, native `fetch`, React 18, TypeScript, Vite, Vitest/JSDOM, Node `node:test`, self-hosted Supabase/PostgreSQL/PostgREST, Docker Compose, CT108 Ollama.

**Spec:** `docs/superpowers/specs/2026-08-30-friday-local-agent-platform-phase1-design.md`

## Global Constraints

- Self-hosted Supabase is the local runtime registry; cloud Supabase is not required.
- Git under `agents/` is authoritative for agent definitions and `enabled` state.
- Agent Spec Phase 1 contract is v1.1 and uses `model.profile`, not deployment-specific `model.provider`, `model.model`, or `model.baseUrl` fields.
- Phase 1 agent inference uses CT108 Ollama only; no Groq/Gemini/OpenAI/Anthropic fallback is allowed for agent requests.
- The existing general FRIDAY assistant provider chain remains unchanged.
- No infrastructure tool executor, shell execution, Docker/Proxmox/network mutation, task execution, approval workflow, or durable agent memory is introduced.
- Agent APIs must never claim an infrastructure action executed; agent responses include `execution.performed: false`.
- VM102 remains the Friday controller; CT108 remains the local Ollama host.
- Secrets remain server-side and never use `VITE_*` environment variables.
- Registry/API/provider failures must not break `/api/overview`, monitoring, incidents, diagnostics, or the general assistant.
- Follow TDD: failing test -> verify RED -> minimal implementation -> verify GREEN -> commit.

---

## File Map

### Existing files to modify

- `agents/proxmox-observer.json` — migrate prototype definition to Agent Spec v1.1 profile-based model contract and Git-authoritative `enabled` field.
- `server/config.mjs` / `server/config.test.mjs` — parse Supabase registry configuration and model profiles.
- `server/ai/agent-runtime.mjs` / `server/ai/agent-runtime.test.mjs` — validate v1.1 specs and invoke Ollama with a resolved model profile rather than model deployment fields from the agent definition.
- `server/http.mjs` / `server/http.test.mjs` — add bounded agent API routes and dependency injection.
- `server/index.mjs` — initialize registry service and startup synchronization without coupling unrelated Friday startup to registry availability.
- `src/lib/api.ts` — typed client contracts for agent registry, routing, sync, and ask operations.
- `src/pages/Dashboard.tsx` — replace generic Agents `DetailView` route with `AgentsWorkspace` on desktop/mobile.
- `src/mobile.css` and `src/index.css` or a dedicated agent stylesheet — responsive Agents workspace styling consistent with FRIDAY UI v3.
- `.env.example` / `compose.yaml` — server-only registry/model-profile configuration.
- `package.json` — include `server/agents/*.test.mjs` in Node test globs.
- `.github/workflows/ci.yml` — validate agent schema/migrations and preserve safety gates.
- `README.md`, `docs/agent-spec-v1.md`, `docs/codex/API_CONTRACT.md`, `docs/codex/BUILD_STATUS.md`, `docs/codex/NEXT_STEPS.md`, `docs/local-agent-platform.md` — authoritative handoff/docs cleanup.

### New files to create

- `server/agents/model-profiles.mjs` / `server/agents/model-profiles.test.mjs` — resolve named local Ollama profiles from server configuration.
- `server/agents/supabase-client.mjs` / `server/agents/supabase-client.test.mjs` — minimal PostgREST boundary using native fetch; no browser client and no new runtime dependency.
- `server/agents/registry-sync.mjs` / `server/agents/registry-sync.test.mjs` — enumerate Git agent JSON, validate, checksum, synchronize, reject invalid updates, preserve last-known-valid rows, and write registry status.
- `server/agents/registry-service.mjs` / `server/agents/registry-service.test.mjs` — sanitized registry reads and explicit sync facade for HTTP/UI.
- `server/agents/orchestrator.mjs` / `server/agents/orchestrator.test.mjs` — explicit override, deterministic routing, optional local-router classification, safe no-match behavior.
- `server/agents/agent-service.mjs` / `server/agents/agent-service.test.mjs` — one read-only agent ask path with normalized provenance and `execution.performed: false`.
- `server/agents/input.mjs` / `server/agents/input.test.mjs` — request validation/bounds for route/ask/sync endpoints.
- `supabase/migrations/202608300001_friday_agent_registry.sql` — `friday_agents` and `friday_agent_registry_state` schema only.
- `scripts/validate-agent-registry-schema.mjs` / `scripts/validate-agent-registry-schema.test.mjs` — static safety/schema validation for CI without requiring a live Supabase instance.
- `src/components/AgentsWorkspace.tsx` / `src/components/AgentsWorkspace.test.tsx` — purpose-built registry and read-only agent chat UI.
- `src/agents.css` — dedicated Agents workspace responsive styles.

---

### Task 1: Migrate Agent Spec v1.1 and Add Server-Side Model Profiles

**Files:**
- Modify: `agents/proxmox-observer.json`
- Modify: `server/config.mjs`
- Modify: `server/config.test.mjs`
- Create: `server/agents/model-profiles.mjs`
- Create: `server/agents/model-profiles.test.mjs`
- Modify: `server/ai/agent-runtime.mjs`
- Modify: `server/ai/agent-runtime.test.mjs`
- Modify: `docs/agent-spec-v1.md`

**Interfaces:**
- Produces: `resolveModelProfile(config, profileId) -> { id, provider:'ollama', baseUrl, model, context, maxTokens } | null`
- Produces: `validateAgentSpec(agent)` accepting `version:'1.1'`, `enabled?:boolean`, and `model.profile:string`.
- Produces: `runLocalAgent({ agent, modelProfile, prompt, overview, fetchImpl, signal })`.
- Later tasks consume the resolved profile and migrated agent object.

- [ ] **Step 1: Write failing model-profile/config tests**

Add tests proving:

```js
const config = getConfig({
  FRIDAY_AGENT_REGISTRY_ENABLED: 'true',
  FRIDAY_AGENT_LOCAL_GENERAL_URL: 'http://192.168.1.70:11434',
  FRIDAY_AGENT_LOCAL_GENERAL_MODEL: 'qwen3:4b-instruct',
  FRIDAY_AGENT_LOCAL_GENERAL_CONTEXT: '8192',
  FRIDAY_AGENT_LOCAL_GENERAL_MAX_TOKENS: '768',
})

assert.equal(config.agents.enabled, true)
assert.equal(config.agents.modelProfiles['local-general'].baseUrl, 'http://192.168.1.70:11434')
assert.equal(config.agents.modelProfiles['local-general'].model, 'qwen3:4b-instruct')
```

And:

```js
assert.deepEqual(resolveModelProfile(config, 'local-general'), {
  id: 'local-general', provider: 'ollama', baseUrl: 'http://192.168.1.70:11434',
  model: 'qwen3:4b-instruct', context: 8192, maxTokens: 768,
})
assert.equal(resolveModelProfile(config, 'missing'), null)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test server/config.test.mjs server/agents/model-profiles.test.mjs
```

Expected: FAIL because `config.agents` and `resolveModelProfile` do not exist.

- [ ] **Step 3: Implement agent config and model profile resolver**

Add `config.agents` with these server-side settings:

```text
FRIDAY_AGENT_REGISTRY_ENABLED=false
FRIDAY_AGENT_LOCAL_ROUTER_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_ROUTER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_GENERAL_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_GENERAL_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_LOCAL_CODER_URL=http://192.168.1.70:11434
FRIDAY_AGENT_LOCAL_CODER_MODEL=qwen3:4b-instruct
FRIDAY_AGENT_MODEL_CONTEXT=8192
FRIDAY_AGENT_MODEL_MAX_TOKENS=768
```

Keep all three profiles provider=`ollama`; do not reference cloud provider config.

- [ ] **Step 4: Write failing Agent Spec v1.1/runtime tests**

Change the fixture to:

```js
const agent = {
  version: '1.1',
  id: 'proxmox-observer',
  name: 'Proxmox Observer',
  enabled: true,
  model: { profile: 'local-general' },
  scope: { hosts: ['proxmox'] },
  tools: ['proxmox_read'],
  permissions: { inspect: 'auto', restart_vm: 'approval' },
}
```

Assert old deployment-specific model fields are rejected for v1.1 and that `runLocalAgent` uses only the supplied resolved `modelProfile`.

- [ ] **Step 5: Run runtime tests and verify RED**

```bash
node --test server/ai/agent-runtime.test.mjs
```

Expected: FAIL because runtime still requires `model.provider/model.model`.

- [ ] **Step 6: Implement minimal v1.1 validation/runtime migration**

Validation rules:

```text
version must equal 1.1
id/name required
enabled defaults true when omitted
model.profile required
tools array required
permissions object required
permission modes limited to auto|approval|forbidden
```

`runLocalAgent` must call `askOllama` with the resolved profile and never read `baseUrl/model` from the agent JSON.

- [ ] **Step 7: Migrate Proxmox Observer definition**

Use:

```json
"version": "1.1",
"enabled": true,
"model": { "profile": "local-general" }
```

Remove `provider`, `model`, `baseUrl`, `context`, and `maxTokens` deployment fields from the agent definition.

- [ ] **Step 8: Run Task 1 tests and full server regression**

```bash
node --test server/config.test.mjs server/agents/model-profiles.test.mjs server/ai/agent-runtime.test.mjs
npm run test:server
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add agents/proxmox-observer.json server/config.mjs server/config.test.mjs server/agents/model-profiles.mjs server/agents/model-profiles.test.mjs server/ai/agent-runtime.mjs server/ai/agent-runtime.test.mjs docs/agent-spec-v1.md
git commit -m "feat: add profile-based local agent spec"
```

---

### Task 2: Add Self-Hosted Supabase Registry Schema and Minimal Server Client

**Files:**
- Create: `supabase/migrations/202608300001_friday_agent_registry.sql`
- Create: `server/agents/supabase-client.mjs`
- Create: `server/agents/supabase-client.test.mjs`
- Modify: `server/config.mjs`
- Modify: `server/config.test.mjs`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `package.json`

**Interfaces:**
- Produces: `createSupabaseRegistryClient({ baseUrl, serviceKey, fetchImpl })` with methods `listAgents()`, `getAgent(id)`, `upsertAgent(row)`, `getRegistryState()`, `upsertRegistryState(row)`.
- Produces: `config.agents.registry = { enabled, supabaseUrl, supabaseServiceKey }`.
- Registry client returns plain sanitized server-side data objects; it does not expose the service key.

- [ ] **Step 1: Write migration file with exactly two tables**

Create SQL defining:

```sql
create table if not exists public.friday_agents (
  id text primary key,
  name text not null,
  description text not null default '',
  spec_version text not null,
  source_path text not null,
  source_checksum text not null,
  enabled boolean not null default true,
  model_profile text not null,
  scope_json jsonb not null default '{}'::jsonb,
  tools_json jsonb not null default '[]'::jsonb,
  permissions_json jsonb not null default '{}'::jsonb,
  instructions_json jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

and singleton-state table `friday_agent_registry_state` with ID text primary key and the fields from the spec. Do not add memory/tasks/approvals/action tables.

- [ ] **Step 2: Write failing client/config tests**

Test exact PostgREST URL/header behavior, including:

```js
assert.equal(request.headers.apikey, 'secret')
assert.equal(request.headers.authorization, 'Bearer secret')
assert.equal(request.headers['content-type'], 'application/json')
```

and config parsing for `FRIDAY_SUPABASE_URL` / `FRIDAY_SUPABASE_SERVICE_KEY`.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test server/config.test.mjs server/agents/supabase-client.test.mjs
```

Expected: FAIL because the Supabase registry boundary does not exist.

- [ ] **Step 4: Implement minimal native-fetch PostgREST client**

Use only `/rest/v1/friday_agents` and `/rest/v1/friday_agent_registry_state`. Encode agent IDs with `encodeURIComponent`; request `Accept: application/json`; normalize non-2xx responses into `FRIDAY_AGENT_REGISTRY_UNAVAILABLE` without logging credentials/body secrets.

- [ ] **Step 5: Add configuration and Compose pass-through**

Add server-only variables:

```text
FRIDAY_SUPABASE_URL=
FRIDAY_SUPABASE_SERVICE_KEY=
```

Never add either under `VITE_*`.

- [ ] **Step 6: Run tests and Compose validation**

```bash
node --test server/config.test.mjs server/agents/supabase-client.test.mjs
docker compose config >/dev/null
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202608300001_friday_agent_registry.sql server/agents/supabase-client.mjs server/agents/supabase-client.test.mjs server/config.mjs server/config.test.mjs .env.example compose.yaml package.json
git commit -m "feat: add local Supabase agent registry boundary"
```

---

### Task 3: Implement Git-Authoritative Registry Synchronization

**Files:**
- Create: `server/agents/registry-sync.mjs`
- Create: `server/agents/registry-sync.test.mjs`
- Create: `server/agents/registry-service.mjs`
- Create: `server/agents/registry-service.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `syncAgentRegistry({ agentsDir, sourceCommit, registryClient, modelProfiles, now }) -> { status, agentsSeen, agentsSynced, agentsRejected, errors }`.
- Produces: `createAgentRegistryService({ registryClient, syncImpl, syncContext })` with `list()`, `get(id)`, `status()`, `sync()`.
- Consumers: HTTP and orchestrator tasks.

- [ ] **Step 1: Write failing sync tests with temporary agent files and fake registry client**

Cover:

```text
valid JSON -> validated/upserted
stable SHA-256 checksum from source bytes
invalid JSON/spec -> rejected and status count incremented
invalid changed definition -> existing valid row is not overwritten
missing source file -> existing row is not automatically deleted
enabled comes from Git definition only
sync status contains sanitized error summaries
```

Use `mkdtemp` and injected fake client methods; do not require live Supabase.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test server/agents/registry-sync.test.mjs server/agents/registry-service.test.mjs
```

Expected: FAIL because sync/service modules do not exist.

- [ ] **Step 3: Implement file enumeration, validation, checksum and upsert**

Use `node:fs/promises`, `node:path`, and `node:crypto.createHash('sha256')`. Only accept top-level `*.json` files from configured `agentsDir`; do not recursively execute/read arbitrary paths supplied by HTTP clients.

- [ ] **Step 4: Implement last-known-valid preservation**

Before replacing an existing ID, validate the new definition completely. On any parse/spec/profile failure, skip the agent upsert and record rejection; never write the invalid row.

- [ ] **Step 5: Implement registry read facade and sanitization**

Sanitized agent output includes policy/model metadata but never Supabase credentials or resolved secret config.

- [ ] **Step 6: Wire non-fatal startup sync in `server/index.mjs`**

When registry is enabled, initialize the client/service and attempt startup sync. Catch registry sync failure, record/report it through service state/logging, and continue starting unrelated Friday APIs.

- [ ] **Step 7: Run Task 3 tests and server suite**

```bash
node --test server/agents/registry-sync.test.mjs server/agents/registry-service.test.mjs
npm run test:server
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/agents/registry-sync.mjs server/agents/registry-sync.test.mjs server/agents/registry-service.mjs server/agents/registry-service.test.mjs server/index.mjs
git commit -m "feat: sync Git agents into local registry"
```

---

### Task 4: Add Deterministic-First Orchestrator and Local Router

**Files:**
- Create: `server/agents/orchestrator.mjs`
- Create: `server/agents/orchestrator.test.mjs`

**Interfaces:**
- Produces: `routeAgent({ prompt, requestedAgentId, agents, localRouter }) -> { matched, agentId?, agentName?, routing, confidence, reason }`.
- `localRouter({ prompt, candidateAgents })` returns an agent ID only; its result must be revalidated against enabled candidates.
- No inference response is produced by this module.

- [ ] **Step 1: Write failing routing tests**

Required cases:

```js
requestedAgentId === 'proxmox-observer' -> routing:'manual'
'check LXC 108 on Proxmox' -> proxmox-observer, routing:'deterministic'
disabled agent -> ineligible
ambiguous prompt -> localRouter called with enabled agent IDs only
localRouter returns unknown ID -> matched:false
localRouter throws/unavailable -> deterministic result if one exists, otherwise safe no-match
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test server/agents/orchestrator.test.mjs
```

Expected: FAIL because orchestrator does not exist.

- [ ] **Step 3: Implement deterministic routing rules as pure functions**

Initial Proxmox signals include word-boundary matches for `proxmox`, `lxc`, `ct`, `vm`, `qemu`, and numeric infrastructure identifier phrases. Do not route generic words like `server` to Proxmox automatically.

- [ ] **Step 4: Implement bounded local-router fallback**

Build candidate metadata from sanitized registry entries only. Local router system prompt must say: return exactly one candidate agent ID or `NO_MATCH`; do not answer the operator question. Use `local-router` model profile via existing Ollama adapter, not the general assistant provider chain.

- [ ] **Step 5: Validate local-router output against registry**

Unknown/disabled IDs become safe no-match; never trust arbitrary model output as a registry identifier.

- [ ] **Step 6: Run tests**

```bash
node --test server/agents/orchestrator.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/agents/orchestrator.mjs server/agents/orchestrator.test.mjs
git commit -m "feat: add read-only local agent routing"
```

---

### Task 5: Add Agent Ask Service and Bounded HTTP APIs

**Files:**
- Create: `server/agents/input.mjs`
- Create: `server/agents/input.test.mjs`
- Create: `server/agents/agent-service.mjs`
- Create: `server/agents/agent-service.test.mjs`
- Modify: `server/http.mjs`
- Modify: `server/http.test.mjs`

**Interfaces:**
- Produces: `validateAgentPrompt(value)` with trimmed maximum 4000 characters.
- Produces: `validateRouteRequest(body)` supporting `{ prompt, agentId? }`, same prompt bound.
- Produces: `createAgentService({ registryService, config, runLocalAgentImpl, routeAgentImpl })` with `route(body)` and `ask(agentId, body)`.
- HTTP adds the six spec routes.

- [ ] **Step 1: Write failing input/service tests**

Test empty prompt, 4000 accepted, 4001 rejected, unsafe/unknown agent ID rejected, missing registry returns normalized unavailable, and successful ask returns:

```js
{
  available: true,
  agentId: 'proxmox-observer',
  provider: 'ollama',
  modelProfile: 'local-general',
  model: 'qwen3:4b-instruct',
  mode: 'local-agent',
  routing: 'manual',
  response: '...',
  execution: { performed: false, reason: 'Phase 1 agents are advisory only.' }
}
```

- [ ] **Step 2: Run service/input tests and verify RED**

```bash
node --test server/agents/input.test.mjs server/agents/agent-service.test.mjs
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement minimal service with CT108-only profile resolution**

`ask()` loads the enabled agent from registry, resolves its model profile from `config.agents.modelProfiles`, builds current normalized overview via injected caller/context, and invokes `runLocalAgent`. It must never inspect `config.ai.providerOrder` or call general `answerAssistant`.

- [ ] **Step 4: Write failing HTTP route tests**

Cover exact routes/statuses:

```text
GET  /api/agents -> 200 or registry-unavailable
GET  /api/agents/:id -> 200/404
GET  /api/agents/registry/status -> 200/503
POST /api/agents/route -> 200/400/503
POST /api/agents/:id/ask -> 200/400/404/503
POST /api/agents/registry/sync -> 200/503
```

Also assert no `PUT/PATCH/DELETE` agent endpoint exists and no `/execute`, `/tools/run`, `/restart`, `/shell`, or arbitrary action route is introduced.

- [ ] **Step 5: Run HTTP tests and verify RED**

```bash
node --test server/http.test.mjs
```

Expected: FAIL because routes/dependency injection are absent.

- [ ] **Step 6: Implement routes in `server/http.mjs`**

Inject `agentService` and `agentRegistryService` into `createFridayServer`. Use existing `readBody` size ceiling plus agent-specific validation. Ensure `/api/overview` and `/api/assistant` code paths remain unchanged.

- [ ] **Step 7: Run focused + full server tests**

```bash
node --test server/agents/input.test.mjs server/agents/agent-service.test.mjs server/http.test.mjs
npm run test:server
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/agents/input.mjs server/agents/input.test.mjs server/agents/agent-service.mjs server/agents/agent-service.test.mjs server/http.mjs server/http.test.mjs
git commit -m "feat: expose advisory local agent APIs"
```

---

### Task 6: Build the Functional Agents Workspace

**Files:**
- Create: `src/components/AgentsWorkspace.tsx`
- Create: `src/components/AgentsWorkspace.test.tsx`
- Create: `src/agents.css`
- Modify: `src/lib/api.ts`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/mobile.css`

**Interfaces:**
- Produces frontend types `FridayAgent`, `FridayAgentRegistryStatus`, `FridayAgentResponse`, `FridayAgentRouteResponse`.
- Produces API helpers `fetchFridayAgents`, `fetchFridayAgentRegistryStatus`, `syncFridayAgentRegistry`, `askFridayAgent`, `routeFridayAgent`.
- `AgentsWorkspace` receives no infrastructure mutation callbacks.

- [ ] **Step 1: Write failing API client tests or component fetch mocks**

Prove request methods/paths and typed response handling for the six endpoints. Reject non-OK response bodies without exposing raw server secrets.

- [ ] **Step 2: Write failing Agents workspace component tests**

With mocked agents/status, assert visible:

```text
LOCAL AGENT REGISTRY
Advisory only · No actions executed
Proxmox Observer
local-general
qwen3:4b-instruct
proxmox
proxmox_read
Last sync
Ask this agent
```

Also assert absence of `Restart`, `Execute`, `Delete`, `Approve`, `Shell`, `Edit agent`, and `Create agent` controls.

- [ ] **Step 3: Run Vitest and verify RED**

```bash
npx vitest run src/components/AgentsWorkspace.test.tsx
```

Expected: FAIL because component/API helpers are absent.

- [ ] **Step 4: Implement frontend API contracts**

Use `fetch` only. `syncFridayAgentRegistry()` may POST without a body. `askFridayAgent(id,prompt)` posts `{ prompt }`; manual workspace asks always target the selected agent directly.

- [ ] **Step 5: Implement purpose-built workspace**

Layout:

```text
Registry status header + explicit safe Sync registry button
Agent list/cards
Selected agent detail (description, model profile, scope, tools, permissions, source checksum/sync)
Read-only advisory conversation/composer for selected agent
Provenance on each response
```

The Sync button changes only Friday-owned registry state and must be labeled accordingly; do not reuse the existing top-level Automation toggle as an agent action control.

- [ ] **Step 6: Wire desktop/mobile Agents routing**

In `Dashboard.tsx`, handle `active === 'Agents'` before generic `DetailView` on both phone and desktop. Preserve existing Overview/FRIDAY/Incidents behavior.

- [ ] **Step 7: Add responsive styling**

At phone widths, use one column, horizontal-safe metadata wrapping, 44px minimum primary touch targets, and contained response text. Do not add a separate phone data model.

- [ ] **Step 8: Run UI tests and production build**

```bash
npx vitest run src/components/AgentsWorkspace.test.tsx
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/AgentsWorkspace.tsx src/components/AgentsWorkspace.test.tsx src/agents.css src/lib/api.ts src/pages/Dashboard.tsx src/mobile.css
git commit -m "feat: add Friday agents workspace"
```

---

### Task 7: Add Offline/Safety Regression and Supabase Schema CI Gate

**Files:**
- Create: `scripts/validate-agent-registry-schema.mjs`
- Create: `scripts/validate-agent-registry-schema.test.mjs`
- Create or modify: `server/agents/agent-service.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateAgentRegistryMigration(sql) -> { ok, errors }` for static CI checks.
- No live Supabase or CT108 is required in CI.

- [ ] **Step 1: Write failing static schema safety tests**

Assert the migration contains exactly the two Phase 1 tables and required columns, and rejects/flags forbidden table names/patterns such as `actions`, `approvals`, `tasks`, `memory`, `shell`, or mutation executor schema additions.

- [ ] **Step 2: Write cloud-offline agent regression**

Create `getConfig` with all cloud keys blank and general cloud providers unavailable. Inject a mocked Ollama fetch into the agent path. Assert the agent request succeeds and no Groq/Gemini/OpenAI/Anthropic adapter/fetch endpoint is called.

- [ ] **Step 3: Write explicit no-execution regression**

Assert all successful agent-service responses contain `execution.performed === false` even when the prompt says `restart VM 100 now`, and the runtime output is treated as advisory text only.

- [ ] **Step 4: Run tests and verify RED where validator is absent**

```bash
node --test scripts/validate-agent-registry-schema.test.mjs server/agents/agent-service.test.mjs
```

Expected: schema validator tests FAIL until implementation exists; agent safety additions may fail until service normalization is complete.

- [ ] **Step 5: Implement schema validator**

Read SQL as text; validate required CREATE TABLE/column markers and forbidden Phase 1 schema markers. Keep it deterministic and credential-free.

- [ ] **Step 6: Add CI steps**

Add after normal tests/build:

```bash
node scripts/validate-agent-registry-schema.mjs supabase/migrations/202608300001_friday_agent_registry.sql
```

Keep existing observer/monitoring/diagnostics/Compose/container security gates unchanged.

- [ ] **Step 7: Run full local verification**

```bash
npm test
npm run build
node scripts/validate-agent-registry-schema.mjs supabase/migrations/202608300001_friday_agent_registry.sql
docker compose config >/dev/null
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/validate-agent-registry-schema.mjs scripts/validate-agent-registry-schema.test.mjs server/agents/agent-service.test.mjs .github/workflows/ci.yml package.json
git commit -m "test: enforce local agent registry safety"
```

---

### Task 8: Reconcile Documentation and Prepare Deployment Validation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/agent-spec-v1.md`
- Modify: `docs/codex/API_CONTRACT.md`
- Modify: `docs/codex/BUILD_STATUS.md`
- Modify: `docs/codex/NEXT_STEPS.md`
- Modify: `docs/local-agent-platform.md`
- Modify: `docs/integrations.md`

**Interfaces:**
- Documentation becomes the authoritative handoff for Codex/operator deployment.

- [ ] **Step 1: Update stale assistant milestone state**

`BUILD_STATUS.md` and `NEXT_STEPS.md` must state the shared Friday Assistant session UX is completed/merged and remove it from the not-implemented/next-feature sections.

- [ ] **Step 2: Document Agent Platform Phase 1 implemented behavior**

Include Git-authoritative definitions, Supabase runtime registry, v1.1 model profiles, routing precedence, local-only CT108 inference, six agent endpoints, Agents workspace, and advisory-only boundary.

- [ ] **Step 3: Document self-hosted Supabase setup**

Provide exact operator order:

```bash
# apply supabase/migrations/202608300001_friday_agent_registry.sql to local Supabase
# set FRIDAY_SUPABASE_URL and FRIDAY_SUPABASE_SERVICE_KEY only in VM102 .env
# configure FRIDAY_AGENT_* profile values for CT108
make preflight
make update
make health
```

Do not commit actual secrets.

- [ ] **Step 4: Document production acceptance checks**

Required read-only checks:

```text
GET /api/agents
GET /api/agents/registry/status
POST /api/agents/registry/sync
POST /api/agents/route with a Proxmox prompt
POST /api/agents/proxmox-observer/ask
```

Acceptance requires provenance showing `provider=ollama`, `mode=local-agent`, the expected profile/model, and `execution.performed=false`.

- [ ] **Step 5: Run doc/safety grep**

```bash
! grep -R "VITE_.*SUPABASE\|VITE_.*SERVICE_KEY" -n .env.example compose.yaml src server docs
! grep -R "api/agents.*execute\|api/agents.*restart\|api/agents.*shell" -n server src
```

Expected: both commands exit 0.

- [ ] **Step 6: Run final feature verification**

```bash
npm test
npm run build
npm run test:server
node scripts/validate-agent-registry-schema.mjs supabase/migrations/202608300001_friday_agent_registry.sql
docker compose config >/dev/null
```

Expected: all PASS.

- [ ] **Step 7: Commit documentation**

```bash
git add README.md .env.example docs/agent-spec-v1.md docs/codex/API_CONTRACT.md docs/codex/BUILD_STATUS.md docs/codex/NEXT_STEPS.md docs/local-agent-platform.md docs/integrations.md
git commit -m "docs: document Friday local agent platform phase 1"
```

---

## Final Review / PR Gate

- [ ] Confirm branch diff contains no infrastructure mutation endpoint, unrestricted shell path, Docker TCP exposure, action executor, task execution, approval implementation, or durable memory implementation.
- [ ] Confirm agent code never invokes the general cloud assistant provider chain.
- [ ] Confirm every agent response reports `execution.performed=false`.
- [ ] Confirm invalid Git agent definitions cannot replace the last known valid runtime row.
- [ ] Confirm deleted source files are not automatically deleted from Supabase in Phase 1.
- [ ] Confirm Supabase credentials appear only in server-side environment/configuration.
- [ ] Confirm VM102 normal Docker observation remains disabled unless separately enabled by existing operator configuration.
- [ ] Run GitHub CI on the exact feature head and require success before runtime deployment validation.
- [ ] Deploy only the Friday controller changes to VM102 after preserving `.env`; apply the Supabase migration to the self-hosted local Supabase instance separately.
- [ ] Validate live CT108 agent inference with all cloud agent fallback paths absent by design.
- [ ] Perform desktop and phone Agents workspace acceptance.
- [ ] Keep the PR draft/unmerged until runtime + UI acceptance and explicit user approval.
