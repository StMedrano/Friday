# Friday Local Agent Platform Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Friday's local-agent prototype into a usable, read-only, local-first agent platform with Git-authoritative definitions, self-hosted Supabase runtime registry, automatic routing with manual override, CT108-only agent inference, and a functional Agents workspace.

**Architecture:** VM102 validates agent files under `agents/` and synchronizes approved definitions into Friday-owned Supabase tables. The shared FRIDAY session first asks the local agent router whether a registered agent owns the request; a matched request goes to that CT108-only agent, while a safe no-match falls through to the existing general `/api/assistant` path unchanged. Manual selection in the Agents workspace bypasses routing and targets the chosen agent directly. Phase 1 exposes no infrastructure tool executor or mutation authority.

**Tech Stack:** Node 22 ESM, native `fetch`, React 18, TypeScript, Vite, Vitest/JSDOM, Node `node:test`, self-hosted Supabase/PostgreSQL/PostgREST, Docker Compose, CT108 Ollama.

**Spec:** `docs/superpowers/specs/2026-08-30-friday-local-agent-platform-phase1-design.md`

## Global Constraints

- Self-hosted Supabase is the local runtime registry; cloud Supabase is not required.
- Git under `agents/` is authoritative for agent definitions and `enabled` state.
- Agent Spec Phase 1 contract is v1.1 and uses `model.profile`, not deployment-specific `model.provider`, `model.model`, or `model.baseUrl` fields.
- Phase 1 agent inference uses CT108 Ollama only; no Groq/Gemini/OpenAI/Anthropic fallback is allowed for agent requests.
- The existing general FRIDAY assistant provider chain remains unchanged and is used only after the agent router returns a safe no-match.
- No infrastructure tool executor, shell execution, Docker/Proxmox/network mutation, task execution, approval workflow, or durable agent memory is introduced.
- Agent APIs must never claim an infrastructure action executed; responses include `execution.performed: false`.
- VM102 remains the Friday controller; CT108 remains the local Ollama host.
- Secrets remain server-side and never use `VITE_*` environment variables.
- Registry/API/provider failures must not break `/api/overview`, monitoring, incidents, diagnostics, or the general assistant.
- Follow TDD: failing test -> verify RED -> minimal implementation -> verify GREEN -> commit.

---

## File Map

**Modify:** `agents/proxmox-observer.json`, `server/config.mjs`, `server/config.test.mjs`, `server/ai/agent-runtime.mjs`, `server/ai/agent-runtime.test.mjs`, `server/http.mjs`, `server/http.test.mjs`, `server/index.mjs`, `src/lib/api.ts`, `src/hooks/useFridaySession.ts`, `src/pages/Dashboard.tsx`, `src/mobile.css`, `.env.example`, `compose.yaml`, `package.json`, `.github/workflows/ci.yml`, `README.md`, `docs/agent-spec-v1.md`, `docs/codex/API_CONTRACT.md`, `docs/codex/BUILD_STATUS.md`, `docs/codex/NEXT_STEPS.md`, `docs/local-agent-platform.md`, `docs/integrations.md`.

**Create:** `server/agents/model-profiles.mjs`, `server/agents/model-profiles.test.mjs`, `server/agents/supabase-client.mjs`, `server/agents/supabase-client.test.mjs`, `server/agents/registry-sync.mjs`, `server/agents/registry-sync.test.mjs`, `server/agents/registry-service.mjs`, `server/agents/registry-service.test.mjs`, `server/agents/orchestrator.mjs`, `server/agents/orchestrator.test.mjs`, `server/agents/agent-service.mjs`, `server/agents/agent-service.test.mjs`, `server/agents/input.mjs`, `server/agents/input.test.mjs`, `supabase/migrations/202608300001_friday_agent_registry.sql`, `scripts/validate-agent-registry-schema.mjs`, `scripts/validate-agent-registry-schema.test.mjs`, `src/hooks/useFridaySession.test.ts`, `src/components/AgentsWorkspace.tsx`, `src/components/AgentsWorkspace.test.tsx`, `src/agents.css`.

---

### Task 1: Agent Spec v1.1 and Model Profiles

**Files:** `agents/proxmox-observer.json`, `server/config.mjs`, `server/config.test.mjs`, `server/agents/model-profiles.mjs`, `server/agents/model-profiles.test.mjs`, `server/ai/agent-runtime.mjs`, `server/ai/agent-runtime.test.mjs`, `docs/agent-spec-v1.md`.

**Interfaces:**
- `resolveModelProfile(config, profileId) -> { id, provider:'ollama', baseUrl, model, context, maxTokens } | null`
- `validateAgentSpec(agent)` accepts `version:'1.1'`, `enabled?:boolean`, `model.profile:string`.
- `runLocalAgent({ agent, modelProfile, prompt, overview, fetchImpl, signal })`.

- [ ] **Step 1: Write failing model-profile/config tests.** Assert `getConfig()` builds `agents.modelProfiles['local-general']` from `FRIDAY_AGENT_LOCAL_GENERAL_*`; assert missing profile resolves `null`.
- [ ] **Step 2: Run RED.** `node --test server/config.test.mjs server/agents/model-profiles.test.mjs` -> FAIL because agent config/profile resolver is absent.
- [ ] **Step 3: Implement server profiles.** Parse:

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

- [ ] **Step 4: Write failing v1.1 runtime tests.** Fixture:

```js
const agent = {
  version: '1.1', id: 'proxmox-observer', name: 'Proxmox Observer', enabled: true,
  model: { profile: 'local-general' }, scope: { hosts: ['proxmox'] },
  tools: ['proxmox_read'], permissions: { inspect: 'auto', restart_vm: 'approval' },
}
```

Assert v1.1 rejects deployment-specific model fields and runtime uses only supplied `modelProfile`.
- [ ] **Step 5: Run RED.** `node --test server/ai/agent-runtime.test.mjs` -> FAIL against old provider/model contract.
- [ ] **Step 6: Implement minimal v1.1 validation and runtime migration.** `version==='1.1'`; id/name/model.profile/tools/permissions required; enabled defaults true; only `auto|approval|forbidden`; undeclared remains forbidden.
- [ ] **Step 7: Migrate `agents/proxmox-observer.json`.** Use `"version":"1.1"`, `"enabled":true`, `"model":{"profile":"local-general"}`; remove base URL/model deployment values.
- [ ] **Step 8: GREEN/regression.** `node --test server/config.test.mjs server/agents/model-profiles.test.mjs server/ai/agent-runtime.test.mjs && npm run test:server` -> PASS.
- [ ] **Step 9: Commit.** `git commit -m "feat: add profile-based local agent spec"` with Task 1 files.

---

### Task 2: Supabase Registry Schema and Server Client

**Files:** `supabase/migrations/202608300001_friday_agent_registry.sql`, `server/agents/supabase-client.mjs`, `server/agents/supabase-client.test.mjs`, `server/config.mjs`, `server/config.test.mjs`, `.env.example`, `compose.yaml`, `package.json`.

**Interfaces:** `createSupabaseRegistryClient({ baseUrl, serviceKey, fetchImpl })` -> methods `listAgents()`, `getAgent(id)`, `upsertAgent(row)`, `getRegistryState()`, `upsertRegistryState(row)`.

- [ ] **Step 1: Create migration with only two tables.** `friday_agents` fields: id PK, name, description, spec_version, source_path, source_checksum, enabled, model_profile, scope_json, tools_json, permissions_json, instructions_json, synced_at, created_at, updated_at. `friday_agent_registry_state`: id PK, last_sync_at, last_sync_status, source_commit, agents_seen, agents_synced, agents_rejected, error_summary.
- [ ] **Step 2: Write failing client/config tests.** Assert PostgREST requests carry `apikey`, `Authorization: Bearer <key>`, JSON content type, encoded IDs; config reads `FRIDAY_SUPABASE_URL` and `FRIDAY_SUPABASE_SERVICE_KEY` server-side.
- [ ] **Step 3: Run RED.** `node --test server/config.test.mjs server/agents/supabase-client.test.mjs` -> FAIL.
- [ ] **Step 4: Implement native-fetch client.** Restrict paths to `/rest/v1/friday_agents` and `/rest/v1/friday_agent_registry_state`; normalize non-2xx as `FRIDAY_AGENT_REGISTRY_UNAVAILABLE`; never include credentials in errors.
- [ ] **Step 5: Add env/Compose pass-through.** Add `FRIDAY_SUPABASE_URL=` and `FRIDAY_SUPABASE_SERVICE_KEY=` only to server/container environment; no `VITE_*` key.
- [ ] **Step 6: GREEN.** `node --test server/config.test.mjs server/agents/supabase-client.test.mjs && docker compose config >/dev/null` -> PASS.
- [ ] **Step 7: Commit.** `git commit -m "feat: add local Supabase agent registry boundary"`.

---

### Task 3: Git-Authoritative Registry Synchronization

**Files:** `server/agents/registry-sync.mjs`, `server/agents/registry-sync.test.mjs`, `server/agents/registry-service.mjs`, `server/agents/registry-service.test.mjs`, `server/index.mjs`.

**Interfaces:**
- `syncAgentRegistry({ agentsDir, sourceCommit, registryClient, modelProfiles, now }) -> { status, agentsSeen, agentsSynced, agentsRejected, errors }`
- `createAgentRegistryService({ registryClient, syncImpl, syncContext }) -> { list, get, status, sync }`

- [ ] **Step 1: Write failing sync/service tests.** Use temp `*.json` agent files and fake client. Prove valid sync, SHA-256 source checksum, invalid parse/spec/profile rejection, invalid changed definition cannot overwrite last-known-valid row, missing file does not delete registry row, `enabled` comes from Git only, sanitized status errors.
- [ ] **Step 2: Run RED.** `node --test server/agents/registry-sync.test.mjs server/agents/registry-service.test.mjs` -> FAIL.
- [ ] **Step 3: Implement enumeration/validation/checksum/upsert.** Only top-level `*.json` under configured `agentsDir`; use `fs/promises` and `crypto.createHash('sha256')`.
- [ ] **Step 4: Preserve last-known-valid policy.** Validate before upsert; reject invalid new bytes without changing existing active row; never auto-delete missing definitions in Phase 1.
- [ ] **Step 5: Implement sanitized registry facade.** Return source/checksum/policy/model-profile metadata but no Supabase key/resolved secret config.
- [ ] **Step 6: Wire non-fatal startup sync.** When enabled, startup attempts sync; failure does not prevent Friday server/overview/monitoring/general assistant from starting.
- [ ] **Step 7: GREEN/regression.** `node --test server/agents/registry-sync.test.mjs server/agents/registry-service.test.mjs && npm run test:server` -> PASS.
- [ ] **Step 8: Commit.** `git commit -m "feat: sync Git agents into local registry"`.

---

### Task 4: Deterministic-First Orchestrator and Local Router

**Files:** `server/agents/orchestrator.mjs`, `server/agents/orchestrator.test.mjs`.

**Interfaces:** `routeAgent({ prompt, requestedAgentId, agents, localRouter }) -> { matched, agentId?, agentName?, routing:'manual'|'deterministic'|'local-router'|'none', confidence, reason }`.

- [ ] **Step 1: Write failing routing tests.** Manual `proxmox-observer` wins; `check LXC 108 on Proxmox` deterministically selects it; disabled agents are excluded; ambiguous prompt invokes local router with enabled IDs only; unknown local-router output is rejected; unavailable router yields deterministic result if available else safe no-match.
- [ ] **Step 2: Run RED.** `node --test server/agents/orchestrator.test.mjs` -> FAIL.
- [ ] **Step 3: Implement pure deterministic rules.** Strong Proxmox signals: `proxmox`, `lxc`, CT/LXC/VM/QEMU identifier phrases. Do not map generic `server` automatically.
- [ ] **Step 4: Implement local-router fallback.** Use `local-router` CT108 profile; system prompt: return exactly one listed agent ID or `NO_MATCH`; never answer the infrastructure question.
- [ ] **Step 5: Revalidate model output.** Only enabled registry IDs are accepted; unknown/disabled -> no-match.
- [ ] **Step 6: GREEN.** `node --test server/agents/orchestrator.test.mjs` -> PASS.
- [ ] **Step 7: Commit.** `git commit -m "feat: add read-only local agent routing"`.

---

### Task 5: Agent Ask Service and Bounded Agent APIs

**Files:** `server/agents/input.mjs`, `server/agents/input.test.mjs`, `server/agents/agent-service.mjs`, `server/agents/agent-service.test.mjs`, `server/http.mjs`, `server/http.test.mjs`.

**Interfaces:**
- `validateAgentPrompt(value)` accepts trimmed 1..4000 chars.
- `createAgentService({ registryService, config, runLocalAgentImpl, routeAgentImpl, buildOverviewImpl }) -> { route(body), ask(agentId, body) }`.

- [ ] **Step 1: Write failing input/service tests.** Empty rejected; 4000 accepted; 4001 rejected; invalid agent ID rejected; registry unavailable normalized; successful ask returns `provider:'ollama'`, `mode:'local-agent'`, profile/model provenance and `execution:{performed:false,reason:'Phase 1 agents are advisory only.'}`.
- [ ] **Step 2: Run RED.** `node --test server/agents/input.test.mjs server/agents/agent-service.test.mjs` -> FAIL.
- [ ] **Step 3: Implement CT108-only ask service.** Load enabled registry agent, resolve `config.agents.modelProfiles[agent.modelProfile]`, build fresh normalized overview, call `runLocalAgent`; never inspect `config.ai.providerOrder` or call `answerAssistant`.
- [ ] **Step 4: Write failing HTTP tests for:**

```text
GET  /api/agents
GET  /api/agents/:agentId
GET  /api/agents/registry/status
POST /api/agents/route
POST /api/agents/:agentId/ask
POST /api/agents/registry/sync
```

Assert expected 200/400/404/503 paths and assert no PUT/PATCH/DELETE, `/execute`, `/tools/run`, `/restart`, `/shell` routes exist.
- [ ] **Step 5: Run RED.** `node --test server/http.test.mjs` -> FAIL.
- [ ] **Step 6: Implement routes/dependency injection.** Reuse existing request body ceiling plus agent-specific validation. `registry/sync` may mutate only Friday-owned registry tables from Git.
- [ ] **Step 7: GREEN/regression.** `node --test server/agents/input.test.mjs server/agents/agent-service.test.mjs server/http.test.mjs && npm run test:server` -> PASS.
- [ ] **Step 8: Commit.** `git commit -m "feat: expose advisory local agent APIs"`.

---

### Task 6: Integrate Automatic Agent Routing into the Shared FRIDAY Session

**Files:** `src/lib/api.ts`, `src/hooks/useFridaySession.ts`, `src/hooks/useFridaySession.test.ts`.

**Interfaces:**
- Frontend `routeFridayAgent(prompt, signal?)` -> `FridayAgentRouteResponse`.
- Frontend `askFridayAgent(agentId, prompt, signal?)` -> `FridayAgentResponse`.
- `FridaySessionMessage` gains optional `agentId`, `agentName`, `routing`, and supports `mode:'local-agent'` alongside existing assistant modes.

- [ ] **Step 1: Write failing session-routing tests with mocked API functions.** Use `renderHook`/`act`. Cases:
  1. route returns matched Proxmox agent -> `askFridayAgent` called, `askFridayAssistant` not called;
  2. route returns safe no-match -> existing `askFridayAssistant(prompt,{history})` called unchanged;
  3. route endpoint unavailable -> general assistant still runs so registry failure is non-fatal;
  4. matched agent ask fails with `local-agent-unavailable` -> show agent error for that turn and do **not** cloud-fallback that matched agent request;
  5. agent response message stores agent/model/routing provenance and `mode:'local-agent'`.
- [ ] **Step 2: Run RED.** `npx vitest run src/hooks/useFridaySession.test.ts` -> FAIL because route/agent helpers and session metadata are absent.
- [ ] **Step 3: Add typed frontend API helpers.** `routeFridayAgent()` POSTs `{prompt}` to `/api/agents/route`; `askFridayAgent()` POSTs `{prompt}` to encoded `/api/agents/:id/ask`.
- [ ] **Step 4: Implement routing precedence in `sendMessage`.** Before the existing `askFridayAssistant` call, try route. If `matched===true`, call selected local agent. If safe no-match or routing service unavailable, use the current general assistant path with the same completed history logic. A matched agent provider failure does not trigger general cloud fallback because that would violate local-agent-only inference.
- [ ] **Step 5: Preserve shared transcript semantics.** Agent and general-assistant replies remain in the same browser-only Friday session; completed exchanges still feed general-assistant history, while fresh infrastructure state remains server-authoritative.
- [ ] **Step 6: GREEN/regression.** `npx vitest run src/hooks/useFridaySession.test.ts && npm test && npm run build` -> PASS.
- [ ] **Step 7: Commit.** `git commit -m "feat: route Friday requests to local agents"`.

---

### Task 7: Functional Agents Workspace

**Files:** `src/components/AgentsWorkspace.tsx`, `src/components/AgentsWorkspace.test.tsx`, `src/agents.css`, `src/lib/api.ts`, `src/pages/Dashboard.tsx`, `src/mobile.css`.

**Interfaces:** frontend types `FridayAgent`, `FridayAgentRegistryStatus`, `FridayAgentResponse`, `FridayAgentRouteResponse`; helpers `fetchFridayAgents`, `fetchFridayAgentRegistryStatus`, `syncFridayAgentRegistry`, `askFridayAgent`, `routeFridayAgent`.

- [ ] **Step 1: Write failing API/component tests.** Assert list/status/sync/manual ask methods/paths. Render healthy registry and require `LOCAL AGENT REGISTRY`, `Advisory only · No actions executed`, agent name/profile/model/scope/tools/checksum/last sync and `Ask this agent`.
- [ ] **Step 2: Assert forbidden UI controls are absent.** No `Restart`, `Execute`, `Delete`, `Approve`, `Shell`, `Edit agent`, `Create agent`.
- [ ] **Step 3: Run RED.** `npx vitest run src/components/AgentsWorkspace.test.tsx` -> FAIL.
- [ ] **Step 4: Implement workspace.** Registry status + safe `Sync registry` control; agent list; selected detail; permissions/source metadata; manual read-only ask panel with provenance. Sync label must explain it updates Friday-owned registry state from Git only.
- [ ] **Step 5: Wire routing.** `active==='Agents'` renders `AgentsWorkspace` before generic `DetailView` on desktop and mobile.
- [ ] **Step 6: Responsive CSS.** One column on phone, wrapped metadata, >=44px primary controls, contained response text; no separate phone data model.
- [ ] **Step 7: GREEN/build.** `npx vitest run src/components/AgentsWorkspace.test.tsx && npm test && npm run build` -> PASS.
- [ ] **Step 8: Commit.** `git commit -m "feat: add Friday agents workspace"`.

---

### Task 8: Offline/Safety Regression and Schema CI Gate

**Files:** `scripts/validate-agent-registry-schema.mjs`, `scripts/validate-agent-registry-schema.test.mjs`, `server/agents/agent-service.test.mjs`, `.github/workflows/ci.yml`, `package.json`.

**Interfaces:** `validateAgentRegistryMigration(sql) -> { ok, errors }`.

- [ ] **Step 1: Write failing schema tests.** Require exactly the two Phase 1 tables/required columns; flag schema additions containing action/approval/task/memory executor tables.
- [ ] **Step 2: Add cloud-offline regression.** Blank Groq/Gemini/OpenAI/Anthropic credentials, mock Ollama, assert local agent succeeds and no cloud adapter endpoint is called.
- [ ] **Step 3: Add no-execution regression.** Prompt `restart VM 100 now`; regardless of advisory model text, normalized response has `execution.performed===false` and no executor call exists.
- [ ] **Step 4: Run RED.** `node --test scripts/validate-agent-registry-schema.test.mjs server/agents/agent-service.test.mjs` -> validator test FAIL until implemented.
- [ ] **Step 5: Implement deterministic SQL validator.** Credential-free text inspection of migration; no live Supabase required.
- [ ] **Step 6: Add CI command.** `node scripts/validate-agent-registry-schema.mjs supabase/migrations/202608300001_friday_agent_registry.sql`; keep all existing CI security/Compose/container gates.
- [ ] **Step 7: Full GREEN.** `npm test && npm run build && node scripts/validate-agent-registry-schema.mjs supabase/migrations/202608300001_friday_agent_registry.sql && docker compose config >/dev/null` -> PASS.
- [ ] **Step 8: Commit.** `git commit -m "test: enforce local agent registry safety"`.

---

### Task 9: Documentation and Deployment Validation Handoff

**Files:** `README.md`, `.env.example`, `docs/agent-spec-v1.md`, `docs/codex/API_CONTRACT.md`, `docs/codex/BUILD_STATUS.md`, `docs/codex/NEXT_STEPS.md`, `docs/local-agent-platform.md`, `docs/integrations.md`.

- [ ] **Step 1: Retire stale assistant milestone.** Mark shared Friday Assistant session UX completed/merged in `BUILD_STATUS`/`NEXT_STEPS`; remove it from not-implemented/next-feature sections.
- [ ] **Step 2: Document Phase 1.** Git authority, Supabase registry, v1.1 profiles, automatic routing + manual override, six agent APIs, shared-session routing behavior, Agents workspace, CT108-only agent inference, advisory-only boundary.
- [ ] **Step 3: Document local Supabase deployment.** Apply `supabase/migrations/202608300001_friday_agent_registry.sql`; put `FRIDAY_SUPABASE_URL`, `FRIDAY_SUPABASE_SERVICE_KEY`, and `FRIDAY_AGENT_*` values only in VM102 `.env`; preserve `.env` during controller update.
- [ ] **Step 4: Document live acceptance checks.** Validate `GET /api/agents`, registry status, sync, Proxmox route, direct Proxmox agent ask, and a general FRIDAY composer prompt that automatically routes to Proxmox. Require `provider=ollama`, `mode=local-agent`, expected profile/model, `execution.performed=false`.
- [ ] **Step 5: Safety grep.** Run:

```bash
! grep -R "VITE_.*SUPABASE\|VITE_.*SERVICE_KEY" -n .env.example compose.yaml src server docs
! grep -R "api/agents.*execute\|api/agents.*restart\|api/agents.*shell" -n server src
```

Expected: both exit 0.
- [ ] **Step 6: Final verification.** `npm test && npm run build && npm run test:server && node scripts/validate-agent-registry-schema.mjs supabase/migrations/202608300001_friday_agent_registry.sql && docker compose config >/dev/null` -> PASS.
- [ ] **Step 7: Commit.** `git commit -m "docs: document Friday local agent platform phase 1"`.

---

## Final Review / PR Gate

- [ ] No infrastructure mutation endpoint, unrestricted shell path, Docker TCP exposure, action executor, task execution, approval implementation, or durable memory implementation.
- [ ] Agent runtime never invokes the general cloud provider chain; only a **safe no-match** from routing may continue to the pre-existing general assistant path.
- [ ] A matched agent request that cannot reach CT108 fails locally and does not cloud-fallback.
- [ ] Every successful agent response reports `execution.performed=false`.
- [ ] Invalid Git definitions cannot replace the last-known-valid row; missing source files are not auto-deleted in Phase 1.
- [ ] Supabase credentials are server-only.
- [ ] Exact feature head passes GitHub CI before live deployment validation.
- [ ] Apply local Supabase migration separately, preserve VM102 `.env`, deploy Friday controller only, then validate CT108 inference and shared-session automatic routing.
- [ ] Perform desktop and phone Agents workspace acceptance.
- [ ] Keep PR draft/unmerged until runtime + UI acceptance and explicit user approval.
