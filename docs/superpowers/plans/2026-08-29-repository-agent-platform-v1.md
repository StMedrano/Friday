# Friday Repository-Aware Agent Platform v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Friday display and safely use real local agents across any explicitly registered Git repository while preserving the existing local-first, read-only safety boundary.

**Architecture:** Add a local repository registry parallel to the existing local AgentRepository, expose safe read-only API metadata, register bounded repository-inspection tools, add deterministic repository-scoped Explorer orchestration, and replace the generic Agents UI with data-backed Agents/Repositories workspaces. All repository file access is canonicalized, constrained to a registered root, and filtered through secret/exclusion rules before model context is built.

**Tech Stack:** Node 22 ESM, React 19 + TypeScript + Vite, native Node test runner, Vitest/Testing Library, Ollama, local JSON configuration.

**Spec:** `docs/superpowers/specs/2026-08-29-repository-agent-platform-v1-design.md`

## Global Constraints

- Supabase is not a dependency.
- Only explicitly registered repository roots are accessible.
- No arbitrary shell execution.
- No unrestricted filesystem browsing.
- Secret/excluded paths must never be returned to agents or model context.
- Undeclared tools and permissions default to forbidden.
- Explorer v1 is read-only.
- Developer writes remain isolated/approval-gated and are not activated in this milestone.
- Production deployment remains forbidden.
- Existing Friday monitoring, diagnostics, assistant, and infrastructure safety tests must stay green.

---

## File structure

**Create**
- `server/repositories/repository.mjs` — local repository registry, canonical root validation, safe public metadata.
- `server/repositories/repository.test.mjs` — registry/path/exclusion tests.
- `server/ai/repository-tools.mjs` — bounded Explorer read tools.
- `server/ai/repository-tools.test.mjs` — tool behavior and safety tests.
- `server/agents/orchestrator.mjs` — deterministic Explorer task routing/state.
- `server/agents/orchestrator.test.mjs` — routing/failure-state tests.
- `repositories.example.json` — operator-safe registry example.
- `src/components/AgentsWorkspace.tsx` — real agent inventory UI.
- `src/components/RepositoriesWorkspace.tsx` — repository inventory UI.
- `src/components/agents-workspace.test.tsx` — UI behavior tests.

**Modify**
- `server/index.mjs` — construct repositories/agent repository and inject into HTTP server.
- `server/http.mjs` — safe `/api/agents`, `/api/repositories`, and repository analysis endpoint.
- `server/http.test.mjs` — API contract/security tests.
- `src/lib/api.ts` — agent/repository API types and fetch helpers.
- `src/pages/Dashboard.tsx` — route Agents and Repositories to dedicated workspaces; hydrate Agent Mesh.
- `agents/codebase-explorer.json` — align tool names with concrete Explorer tools.
- `.env.example` — local repository registry path only; no credentials.
- `docs/codex/BUILD_STATUS.md` — record shipped milestone after verification.

---

### Task 1: Local Repository Registry

**Files:**
- Create: `server/repositories/repository.mjs`
- Create: `server/repositories/repository.test.mjs`
- Create: `repositories.example.json`
- Modify: `.env.example`

**Interfaces:**
- Produces `LocalRepositoryRegistry({ registryPath })`
- Produces `list(): Promise<RepositoryDefinition[]>`
- Produces `get(id): Promise<RepositoryDefinition|null>`
- Produces `resolvePath(repository, relativePath): Promise<string>`
- Produces `toPublicRepository(repository): PublicRepository`

- [ ] **Step 1: Write failing tests for registry loading and safe metadata**

```js
const registry = new LocalRepositoryRegistry({ registryPath })
assert.equal((await registry.get('friday')).mode, 'development')
assert.deepEqual(toPublicRepository(await registry.get('friday')), {
  id: 'friday', name: 'Friday', remote: 'https://github.com/StMedrano/Friday.git',
  defaultBranch: 'main', mode: 'development', enabled: true,
})
```

- [ ] **Step 2: Write failing path-security tests**

```js
await assert.rejects(() => registry.resolvePath(repo, '../secret.txt'), /outside repository/i)
await assert.rejects(() => registry.resolvePath(repo, '.env'), /excluded/i)
await assert.rejects(() => registry.resolvePath(repo, '.env.production'), /excluded/i)
```

Include a symlink fixture pointing outside the repo and assert rejection after `realpath()` canonicalization.

- [ ] **Step 3: Run the new test file and verify failure**

Run: `node --test server/repositories/repository.test.mjs`
Expected: FAIL because the registry module does not exist.

- [ ] **Step 4: Implement the registry**

Use `fs.readFile`, `fs.realpath`, `path.resolve`, and `path.relative`. Reject disabled or malformed definitions. Treat these as default exclusions in addition to per-repo `exclude` entries:

```js
const DEFAULT_EXCLUDES = [
  '.env', '.env.*', '.git/**', '**/*.pem', '**/*.key', '**/id_rsa', '**/id_ed25519',
  'node_modules/**', 'dist/**', 'build/**', '.next/**',
]
```

Do not expose `path` from `toPublicRepository()`.

- [ ] **Step 5: Add operator example/config**

`repositories.example.json`:

```json
[
  {
    "id": "friday",
    "name": "Friday",
    "path": "/srv/infrastructure/apps/friday",
    "remote": "https://github.com/StMedrano/Friday.git",
    "defaultBranch": "main",
    "mode": "development",
    "enabled": true,
    "exclude": ["data/**"]
  }
]
```

Add `FRIDAY_REPOSITORY_REGISTRY_PATH=./repositories.json` to `.env.example`.

- [ ] **Step 6: Run tests**

Run: `node --test server/repositories/repository.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/repositories repositories.example.json .env.example
git commit -m "feat: add local repository registry"
```

---

### Task 2: Safe Agents and Repositories APIs

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/http.mjs`
- Modify: `server/http.test.mjs`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes `LocalAgentRepository` and `LocalRepositoryRegistry`
- Produces `GET /api/agents`
- Produces `GET /api/repositories`
- Produces `fetchFridayAgents()` and `fetchFridayRepositories()`

- [ ] **Step 1: Add failing HTTP tests**

Inject stub repositories into `createFridayServer` and assert:

```js
const agents = await (await fetch(`${base}/api/agents`)).json()
assert.equal(agents.agents[0].id, 'codebase-explorer')
assert.equal('instructions' in agents.agents[0], false)

const repos = await (await fetch(`${base}/api/repositories`)).json()
assert.equal(repos.repositories[0].id, 'friday')
assert.equal('path' in repos.repositories[0], false)
```

Also assert POST/PUT/PATCH/DELETE to both collection routes return 404.

- [ ] **Step 2: Run HTTP tests and verify failure**

Run: `node --test server/http.test.mjs`
Expected: FAIL with 404 on the new GET endpoints.

- [ ] **Step 3: Add safe serializers and GET routes**

Extend `createFridayServer` injection arguments:

```js
agentRepository = null,
repositoryRegistry = null,
```

Return only safe agent fields:

```js
{id, name, description, model:{provider,model}, tools, permissions, scope}
```

Return repositories through `toPublicRepository()`.

- [ ] **Step 4: Wire runtime construction**

In `server/index.mjs`, construct:

```js
const agentRepository = new LocalAgentRepository({ directory: './agents' })
const repositoryRegistry = new LocalRepositoryRegistry({
  registryPath: process.env.FRIDAY_REPOSITORY_REGISTRY_PATH || './repositories.json',
})
```

Inject both into `createFridayServer`.

- [ ] **Step 5: Add frontend API types/helpers**

In `src/lib/api.ts`, add `FridayAgentSummary`, `FridayRepositorySummary`, `fetchFridayAgents`, and `fetchFridayRepositories` with abort-signal support and non-2xx error handling matching existing helpers.

- [ ] **Step 6: Run focused tests**

Run: `node --test server/http.test.mjs server/agents/repository.test.mjs server/repositories/repository.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/index.mjs server/http.mjs server/http.test.mjs src/lib/api.ts
git commit -m "feat: expose safe agent and repository inventory"
```

---

### Task 3: Explorer Read-Only Repository Tools

**Files:**
- Create: `server/ai/repository-tools.mjs`
- Create: `server/ai/repository-tools.test.mjs`
- Modify: `agents/codebase-explorer.json`

**Interfaces:**
- Produces `registerRepositoryTools({ registry, toolRegistry })`
- Tools: `repo.status`, `repo.list`, `repo.read`, `repo.search`, `repo.history`, `repo.manifest`
- All tools consume `{ repositoryId, ...args }`

- [ ] **Step 1: Add failing tests for each read tool**

Use a temporary Git fixture repository. Assert bounded directory listing, UTF-8 reads, search hits, manifest parsing, and Git history metadata.

- [ ] **Step 2: Add failing security tests**

```js
assert.equal((await execute('repo.read', { path: '.env' })).status, 'failed')
assert.equal((await execute('repo.read', { path: '../outside.txt' })).status, 'failed')
assert.equal((await execute('repo.read', { path: 'big.txt' })).output.truncated, true)
```

Verify binary files are rejected and result sizes are bounded.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test server/ai/repository-tools.test.mjs`
Expected: FAIL because tools are not implemented.

- [ ] **Step 4: Implement bounded tools**

Use direct Node filesystem APIs for list/read/search. For Git metadata use `spawnFile`/`execFile` with fixed executable `git`, fixed subcommands, explicit `cwd` equal to the canonical registered root, bounded timeout/output, and no user-supplied flags.

Suggested hard limits:

```js
MAX_FILE_BYTES = 128 * 1024
MAX_LIST_ENTRIES = 500
MAX_SEARCH_RESULTS = 100
MAX_GIT_ENTRIES = 50
```

`repo.read` returns `{path, text, truncated}`. `repo.search` returns safe relative path + line number + bounded snippet. Never return absolute paths.

- [ ] **Step 5: Update Explorer definition**

Replace conceptual tool names with:

```json
["repo.status","repo.list","repo.read","repo.search","repo.history","repo.manifest"]
```

Map all to an `inspect_repository: auto` permission. Keep write/deploy permissions forbidden.

- [ ] **Step 6: Run tests**

Run: `node --test server/ai/repository-tools.test.mjs server/ai/tool-registry.test.mjs server/ai/agent-runtime.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/ai/repository-tools.mjs server/ai/repository-tools.test.mjs agents/codebase-explorer.json
git commit -m "feat: add safe repository explorer tools"
```

---

### Task 4: Deterministic Repository Explorer Orchestrator

**Files:**
- Create: `server/agents/orchestrator.mjs`
- Create: `server/agents/orchestrator.test.mjs`
- Modify: `server/http.mjs`
- Modify: `server/http.test.mjs`

**Interfaces:**
- Produces `createAgentOrchestrator({ agentRepository, repositoryRegistry, toolRegistry, runAgent })`
- Produces `analyzeRepository({ repositoryId, prompt }): Promise<AgentTaskResult>`
- Produces `POST /api/agents/explore`

- [ ] **Step 1: Write failing orchestrator tests**

Assert enabled registered repo selects `codebase-explorer`, disabled/unknown repo fails before model invocation, and state transitions are deterministic:

```js
assert.deepEqual(result.states, ['QUEUED','ANALYZING','COMPLETED'])
```

- [ ] **Step 2: Add failing HTTP contract tests**

POST body:

```json
{"repositoryId":"friday","prompt":"Find where assistant requests are handled"}
```

Assert 200 for successful analysis, 400 for invalid prompt/repository ID, 404 for unknown repository, and no generic tool/action endpoint is introduced.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test server/agents/orchestrator.test.mjs server/http.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement deterministic routing**

The orchestrator must explicitly choose `codebase-explorer`; v1 does not ask the model to choose agents. Build repository context from safe metadata only. The runtime may reason and request Explorer tools, but every tool executes through the existing `executeAgentTool` gateway.

Keep task result shaped like:

```js
{
  id,
  repositoryId,
  agentId: 'codebase-explorer',
  status: 'COMPLETED',
  states,
  answer,
  toolEvents,
}
```

Do not persist task history yet.

- [ ] **Step 5: Wire POST endpoint**

Inject `agentOrchestrator` into `createFridayServer`. Validate prompt length using the same 4000-character ceiling already used by Friday assistant input.

- [ ] **Step 6: Run focused backend tests**

Run: `node --test server/agents/orchestrator.test.mjs server/http.test.mjs server/ai/repository-tools.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/agents/orchestrator.mjs server/agents/orchestrator.test.mjs server/http.mjs server/http.test.mjs
git commit -m "feat: add repository explorer orchestration"
```

---

### Task 5: Real Agents and Repositories Workspaces

**Files:**
- Create: `src/components/AgentsWorkspace.tsx`
- Create: `src/components/RepositoriesWorkspace.tsx`
- Create: `src/components/agents-workspace.test.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/styles.css` or existing v3 component stylesheet only as needed

**Interfaces:**
- Consumes `fetchFridayAgents()` and `fetchFridayRepositories()`
- Produces dedicated `AgentsWorkspace` and `RepositoriesWorkspace`

- [ ] **Step 1: Add failing UI tests**

Mock the new fetch helpers and verify Agents shows real agent names/tools/permission states, Repositories shows repo mode/branch/remote, loading/error states are readable, and neither workspace exposes local filesystem paths.

- [ ] **Step 2: Run UI test and verify failure**

Run: `npm test -- --run src/components/agents-workspace.test.tsx`
Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement AgentsWorkspace**

Render compact v3 cards with name, description, model, status (`READY` when returned), tools, and permission badges. Do not add edit/delete/run buttons in v1.

- [ ] **Step 4: Implement RepositoriesWorkspace**

Render display name, repository ID, branch, remote identity, access mode, and enabled/availability status. No registration/edit mutation UI in this milestone.

- [ ] **Step 5: Integrate Dashboard navigation**

Add `Repositories` to navigation and mobile More content. Replace `DetailView` for Agents/Repositories with the new workspaces. Hydrate Overview Agent Mesh from `/api/agents`; retain a safe static fallback only when API data is unavailable.

- [ ] **Step 6: Run frontend tests/build**

Run:

```bash
npm test -- --run
npm run build
```

Expected: all tests PASS and Vite production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components src/pages/Dashboard.tsx src/lib/api.ts src/styles.css
git commit -m "feat: add agent and repository workspaces"
```

---

### Task 6: Full Safety Verification and Documentation

**Files:**
- Modify: `docs/codex/BUILD_STATUS.md`
- Modify: `docs/codex/NEXT_STEPS.md` only if its ordered milestone list is now stale

**Interfaces:**
- Verifies all prior interfaces together.

- [ ] **Step 1: Run repository-agent backend suite**

```bash
node --test server/agents/*.test.mjs server/ai/*.test.mjs server/repositories/*.test.mjs server/http.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run standard project verification**

Run: `make verify`
Expected: PASS with existing observer/monitoring/diagnostics safety boundaries intact.

- [ ] **Step 3: Validate Compose if configuration changed**

Run: `docker compose config >/dev/null`
Expected: exit 0.

- [ ] **Step 4: Perform explicit safety regression checks**

Confirm tests prove:

```text
unknown repository -> rejected
../ traversal -> rejected
symlink escape -> rejected
.env/.env.* -> rejected
private-key pattern -> rejected
absolute path -> never returned
Explorer write tool -> unavailable/forbidden
production deploy -> forbidden
POST/PUT/PATCH/DELETE /api/agents -> 404
POST/PUT/PATCH/DELETE /api/repositories -> 404
```

- [ ] **Step 5: Update build status**

Record repository registry, safe inventory APIs, Explorer tool set, deterministic orchestrator, UI workspaces, and the exact limitations: no persistent task memory, no write workflow, no arbitrary shell, no production automation.

- [ ] **Step 6: Commit docs**

```bash
git add docs/codex/BUILD_STATUS.md docs/codex/NEXT_STEPS.md
git commit -m "docs: record repository agent platform milestone"
```

- [ ] **Step 7: Final branch verification**

Run:

```bash
make verify
git status --short
git log --oneline -8
```

Expected: `make verify` PASS and working tree clean before PR review.
