# Friday Phase 2C — Group Skills, Plugin Policy, and Context Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Assemble an approved set of shared group skills, explicitly restricted plugin capability descriptions and project-scoped task context for Friday agents.

**Architecture:** Read a versioned, immutable Git catalog into a validated snapshot. A pure policy/skill resolver intersects authorization from all trusted layers, and an internal Context Builder combines those decisions with Phase 2B work, accepted decisions, handoffs and scoped memory. Do not add public routes, executors, model changes or tables.

**Tech Stack:** Existing Node.js ESM (.mjs), built-in fs/path/crypto, node:test, Supabase-backed Phase 1 registry and Phase 2B domain services. No new npm packages.

**Spec:** \`docs/superpowers/specs/2026-10-11-friday-phase2c-policy-skills-context-design.md\` (operator-approved, PR #26).

## Global Constraints

- Preserve Phase 1 Agent Spec v1.1 and the existing Proxmox Observer, advisory Ollama routing and \`execution.performed=false\`.
- Use the existing Phase 2B \`normalizeActor\`, \`workService.get\`, \`decisionService.listAccepted\`, \`workService.getLatestHandoff\`, and \`memoryService.search\` methods; do not change the migrated Supabase schema, ACLs, RLS, or authoritative state semantics.
- Phase 2C is internal-only, feature-disabled by default and separate from the live Friday controller. No public policy/task/memory write endpoint, MCP bridge, plugin execution, model inference change, infrastructure mutation or new paid dependency.
- All catalog files are Git-authoritative in the immutable **reviewed release**. Model text, work records, user requests or web pages cannot become catalog updates. Existing Phase 1 registered agents do not require a group assignment to keep functioning.
- One primary group per agent in Phase 2C; any absent trust/allow layer denies Phase 2C capability use. Explicit deny wins. A connected plugin is not authorized merely because it is healthy; write/high-risk capability descriptions are not executable.
- Exact memory owner grants are intersected with trusted \`ActorContext\`, group/agent policy, task policy and authorized work item. Session memory stays ephemeral and principal-bound.
- Never persist or reveal secrets, approval tokens, environment variables or private authentication settings in Git manifests, prompts, packets, browser output or test fixtures.
- Serialized context defaults to <=12,000 chars; max 32,000. Max 16 skills / 2,000 chars per skill / 20 memory entries / 1,000 chars per memory excerpt. Mandatory security policy, required skills, authoritative work, and accepted decisions never silently truncate.
- Each task uses verified TDD RED -> GREEN, a focused commit and reviewer gate. Execution on an isolated feature branch is **not** authorized until operator separately approves this plan. Production deployment requires separate explicit authorization.

## File Responsibilities and Interfaces

| File | Contract and owner |
|---|---|
| \`server/fabric/manifest-validation.mjs\` | \`validateFabricManifest(kind,value)\` and \`parseManifestJson(raw)\`: strict normalized/frozen group, skill, plugin, assignment objects |
| \`server/fabric/catalog-loader.mjs\` | \`loadFabricCatalog({rootDir,sourceCommit='',limits={}})\` -> immutable, versioned \`catalog\`, \`policyHash\`, status |
| \`server/fabric/skill-resolver.mjs\` | \`resolveSkillInstructions({catalog,requiredSkillIds,optionalSkillIds,taskRequestedSkillIds,approvedSkillIds,maxChars})\` -> ordered skills/omissions |
| \`server/fabric/policy-resolver.mjs\` | \`resolveEffectivePolicy({catalog,agent,actor,projectId,workItem,taskPolicy,serverCeilings})\` -> capabilities, trace, skill references |
| \`server/fabric/memory-grants.mjs\` | \`resolveMemoryScopes({actor,workItem,groupId,agentId,assignment,serverCeilings,taskPolicy})\` -> exact \`{scope,ownerId}[]\` |
| \`server/fabric/context-builder.mjs\` | \`buildAgentContext({actor,agentId,workItemId,taskPolicy,catalog,registryService,workService,decisionService,memoryService,sessionContext,serverCeilings,maxChars})\` |
| \`server/fabric/safe-context.mjs\` | \`serializeSafeContext({mandatory,optional,maxChars})\` -> bounded, provenance-labeled context or typed \`context-too-large\` |
| \`server/fabric/bootstrap.mjs\` | \`createFabricRuntime({enabled=false,catalog,services,serverCeilings})\` -> default-off, no HTTP wiring |
| \`groups/\`, \`skills/\`, \`plugin-catalog/\`, \`agent-assignments/\` | Versioned non-secret manifests/SOPs, no implicit Proxmox assignment |
| \`scripts/validate-fabric-catalog.mjs\`, \`docs/fabric-phase2c.md\`, \`package.json\`, \`.github/workflows/ci.yml\` | Operator validation, tests and independent regression gates |

The task order is 1 strict manifest validation -> 2 atomic catalog filesystem loader -> 3 skill dependency resolution -> 4 plugin/policy resolver -> 5 memory scope intersection -> 6 Context Builder -> 7 privacy and budgets -> 8 internal-only startup, CI and runbook. Tasks 4–5 resolve policy for Task 6; Task 7 wraps the Task 6 packet; Task 8 integrates without exposing a route.

## Review Focus — extra failures the specification implies

1. A JSON object with duplicate authorization keys must be rejected before parsing silently overwrites one of them (Task 1).
2. An allowed file inside a symlinked parent directory must still be rejected; the catalog loader must not follow it outside root (Task 2).
3. A capability with a wildcard, Unicode-confusable segment, unexpected case or partial prefix is not an exact grant (Task 4).
4. An identical agent ID across different actors, projects, work-item versions or policy hashes cannot reuse a previously built packet (Task 7).
5. An accepted decision or handoff returned with the wrong work-item ID, or an unverified "tests passed" claim inside memory, must never become trusted evidence (Tasks 6–7).

---

### Task 1: Strict versioned manifests and typed errors

**Files:**
- Create `server/fabric/manifest-validation.mjs`
- Test `server/fabric/manifest-validation.test.mjs`

**Interfaces:** `validateFabricManifest(kind,input) -> deep-frozen normalized descriptor`; `parseManifestJson(raw)` rejects repeated object keys; `FabricPolicyError.kind` is one sanitized fixed code.

- [ ] **Step 1: Write failing tests.** Test all four kinds (`group|skill|plugin|assignment`) with version `"1"`, exact allowlisted fields, canonical lowercase IDs 3–64 chars and exact capability IDs; reject malformed UTF-8, duplicate JSON keys (`{"id":"safe","id":"admin"}`), unsupported versions, extra keys, wildcards, embedded secrets, executable URL/commands, duplicate list entries, oversized fields. Example: `assert.throws(() => parseManifestJson('{"id":"safe","id":"admin"}'),e=>e.kind==='catalog-invalid')`.
  Representative named RED test (use the task's fixture objects):

  ```js
  test('duplicate JSON member rejected', () => {
    assert.throws(() => parseManifestJson('{"id":"a","id":"b"}'), e => e.kind === 'catalog-invalid')
  })
  ```

- [ ] **Step 2: Run RED.** Run `node --test server/fabric/manifest-validation.test.mjs`; expected FAIL on absent module, absent behavior or stricter security assertion.
- [ ] **Step 3: Implement the smallest solution.** Implement bounded JSON tokenizer/validator that correctly recognizes escaped JSON strings and rejects duplicate property names before `JSON.parse` (do not use a bare key-matching regex); normalize and deep-freeze; plugin descriptors contain metadata/capabilities only, not connection secrets; skills contain no permission grants.
- [ ] **Step 4: Run GREEN and inspect results.** Run `node --test server/fabric/manifest-validation.test.mjs`; Zero failed tests; fixture parser returns the same normalized values every run.
- [ ] **Step 5: Commit the focused slice.** Stage the files named above and `git commit -m "feat: validate versioned fabric manifests"`; record revision, RED/GREEN evidence, reviewer outcome and any policy decisions in the work ledger.

### Task 2: Safe atomic catalog and minimal Git examples

**Files:**
- Create `server/fabric/catalog-loader.mjs` and `server/fabric/catalog-loader.test.mjs`
- Add `groups/engineering.json`, `skills/engineering/safe-code-review/manifest.json`, `skills/engineering/safe-code-review/SKILL.md`, `plugin-catalog/github.json`, `plugin-catalog/supabase.json`, `agent-assignments/.gitkeep`

**Interfaces:** `loadFabricCatalog({rootDir,sourceCommit,limits}) -> Promise<{catalog,policyHash,sourceCommit,status:'ok'}>`; error `catalog-invalid`. Entire catalog accepted/rejected atomically; no partial mutation of previous snapshots.

- [ ] **Step 1: Write failing tests.** Use node test temporary directories. Valid test catalog has 1 group, 1 skill, 2 disabled/description-only plugins and 0 assignments; repeated reads hash identically. Reject symlinked nested directories, symlink files, traversal, invalid UTF-8, excessive files/bytes, duplicate IDs, unsupported files, skill deps referencing unknown IDs, and an invalid replacement snapshot while old snapshot remains unchanged.
  Representative named RED test (use the task's fixture objects):

  ```js
  test('catalog reload is all-or-nothing', async () => {
    const baseline = await loadFabricCatalog({rootDir:validFixture})
    await assert.rejects(loadFabricCatalog({rootDir:symlinkFixture}), e => e.kind === 'catalog-invalid')
    assert.equal(baseline.catalog.groups.engineering.id, 'engineering')
  })
  ```

- [ ] **Step 2: Run RED.** Run `node --test server/fabric/catalog-loader.test.mjs`; expected FAIL on absent module, absent behavior or stricter security assertion.
- [ ] **Step 3: Implement the smallest solution.** Read only allowlisted repository subfolders with built-in `fs/promises`, `lstat`, `realpath`, `path.relative` and `crypto`; check every directory segment, no symlinks or remote includes. Use limits max 128 files, max 1 MiB total, 16 KiB manifest, 2 KiB SOP; canonical sorted SHA-256. No default assignment to existing Proxmox Observer.
- [ ] **Step 4: Run GREEN and inspect results.** Run `node --test server/fabric/catalog-loader.test.mjs`; Repeat GREEN and verify policy hash, source provenance, immutable snapshot, fail-closed reload.
- [ ] **Step 5: Commit the focused slice.** Stage the files named above and `git commit -m "feat: load immutable Git fabric catalog"`; record revision, RED/GREEN evidence, reviewer outcome and any policy decisions in the work ledger.

### Task 3: Mandatory/shared/direct skill resolver

**Files:**
- Create `server/fabric/skill-resolver.mjs`, `server/fabric/skill-resolver.test.mjs`

**Interfaces:** `resolveSkillInstructions({catalog,requiredSkillIds=[],optionalSkillIds=[],taskRequestedSkillIds=[],approvedSkillIds=[],maxChars=12000}) -> {skills,omissions}`; each skill has `{id,version,checksum,source,required,excerpt}`.

- [ ] **Step 1: Write failing tests.** System + organization required skills precede group required, then group optional, agent-direct, approved task requested. Duplicate references dedupe by exact ID/version; required unknown/cyclic/version conflict rejects entire resolution; optional unavailable skill is omitted with explicit reason. Dependencies precede dependents. Unapproved task-requested skills (absent from explicit approvedSkillIds) cannot enter output or bypass mandatory SOP.
  Representative named RED test (use the task's fixture objects):

  ```js
  test('task cannot self-approve a skill', () => {
    const r = resolveSkillInstructions({catalog,requiredSkillIds:['safe-code-review'],taskRequestedSkillIds:['privileged'],approvedSkillIds:[]})
    assert.equal(r.skills.some(x => x.id === 'privileged'), false)
  })
  ```

- [ ] **Step 2: Run RED.** Run `node --test server/fabric/skill-resolver.test.mjs`; expected FAIL on absent module, absent behavior or stricter security assertion.
- [ ] **Step 3: Implement the smallest solution.** Implement pure dependency DAG with deterministic topological sort; reject cycles/missing mandatory dependency; normalize source precedence and canonical IDs; maximum 16 skills and 2,000 characters/SOP. Skills never contain or grant capabilities.
- [ ] **Step 4: Run GREEN and inspect results.** Run `node --test server/fabric/skill-resolver.test.mjs`; GREEN with two identical calls deeply equal, missing mandatory skill always fails closed.
- [ ] **Step 5: Commit the focused slice.** Stage the files named above and `git commit -m "feat: resolve inherited and mandatory agent skills"`; record revision, RED/GREEN evidence, reviewer outcome and any policy decisions in the work ledger.

### Task 4: Plugin capability policy and deny reasons

**Files:**
- Create `server/fabric/policy-resolver.mjs`, `server/fabric/policy-resolver.test.mjs`

**Interfaces:** `resolveEffectivePolicy({catalog,agent,actor,projectId,workItem,taskPolicy,serverCeilings}) -> {agentId,groupId,policyHash,skills,capabilities,capabilityTrace,memoryScopeRequests,requiredProcessRules}`.

- [ ] **Step 1: Write failing tests.** A connected plugin absent from any global/org/group/assignment/task/actor allowset is denied; explicit deny beats all allows, disabled/unknown plugin denied, absent assignment denies, wildcard/Unicode-confusable capability denied, and a write/high-risk capability remains `approval-required` and nonexecutable even when statically allowed. The Phase 1 `agent.tools` list never auto-grants a plugin.
  Representative named RED test (use the task's fixture objects):

  ```js
  test('explicit deny outranks connected plugin', () => {
    const policy = resolveEffectivePolicy({catalog,agent,actor,workItem,projectId:'p-a',taskPolicy,serverCeilings})
    assert.equal(policy.capabilities.includes('github.branch.write'), false)
  })
  ```

- [ ] **Step 2: Run RED.** Run `node --test server/fabric/policy-resolver.test.mjs`; expected FAIL on absent module, absent behavior or stricter security assertion.
- [ ] **Step 3: Implement the smallest solution.** Require registered/enabled agent and normalized trusted ActorContext; exact capability set intersection across all six layers plus enabled catalog descriptor; explicit deny overrides allow; deterministic reason codes without tokens/connection configs. Invoke Task 3 resolver for skill IDs and mandatory process rules; one validated primary group only.
- [ ] **Step 4: Run GREEN and inspect results.** Run `node --test server/fabric/policy-resolver.test.mjs`; GREEN with no executable plugin handles, connection secrets, unexpected wildcard grants or changed Phase 1 permissions.
- [ ] **Step 5: Commit the focused slice.** Stage the files named above and `git commit -m "feat: resolve deny-first plugin capability descriptors"`; record revision, RED/GREEN evidence, reviewer outcome and any policy decisions in the work ledger.

### Task 5: Exact memory owner scope intersections

**Files:**
- Create `server/fabric/memory-grants.mjs`, `server/fabric/memory-grants.test.mjs`
- Modify `server/fabric/policy-resolver.mjs`, `server/fabric/policy-resolver.test.mjs`

**Interfaces:** `resolveMemoryScopes({actor,workItem,groupId,agentId,assignment,serverCeilings,taskPolicy}) -> Array<{scope,ownerId}>`, deduplicated and canonically sorted.

- [ ] **Step 1: Write failing tests.** An actor with project-A and project-B grants working on project-A gets only project-A; group-B, agent-B, task-B and other user's session never appear. Missing work, unknown owner, wildcard or untrusted `scope:'project'` grant denies. Global/org exact owners require positive grants. More than 30 requests are bounded; order independent.
  Representative named RED test (use the task's fixture objects):

  ```js
  test('scope grants use exact owner and work project', () => {
    const result = resolveMemoryScopes({actor,workItem:{id:'w-a',projectId:'p-a'},groupId:'engineering',agentId:'coder',assignment,serverCeilings,taskPolicy})
    assert.equal(result.some(x => x.scope === 'project' && x.ownerId === 'p-b'), false)
  })
  ```

- [ ] **Step 2: Run RED.** Run `node --test server/fabric/memory-grants.test.mjs server/fabric/policy-resolver.test.mjs`; expected FAIL on absent module, absent behavior or stricter security assertion.
- [ ] **Step 3: Implement the smallest solution.** Intersect exact scope+owner pairs with ActorContext plus global/org/group/assignment/task ceilings; derive project from authorized work item, task owner from work-item ID, group/agent owner from trusted registration; enforce session principal binding. Pass only exact pairs to Phase 2B `memoryService.search`.
- [ ] **Step 4: Run GREEN and inspect results.** Run `node --test server/fabric/memory-grants.test.mjs server/fabric/policy-resolver.test.mjs`; GREEN and explicit tests prove no cross-project or cross-principal retrieval.
- [ ] **Step 5: Commit the focused slice.** Stage the files named above and `git commit -m "feat: restrict memory queries to approved owners"`; record revision, RED/GREEN evidence, reviewer outcome and any policy decisions in the work ledger.

### Task 6: Build authoritative context from Phase 1/2B services

**Files:**
- Create `server/fabric/context-builder.mjs`, `server/fabric/context-builder.test.mjs`

**Interfaces:** `buildAgentContext({actor,agentId,workItemId,taskPolicy,catalog,registryService,workService,decisionService,memoryService,sessionContext,serverCeilings,maxChars=12000}) -> Promise<ContextPacket>`.

- [ ] **Step 1: Write failing tests.** Spy on `registryService.get(agentId)`, `workService.get({actor,workItemId})`, `decisionService.listAccepted({actor,workItemId})`, `workService.getLatestHandoff({actor,workItemId})`, `memoryService.search({actor,scopes,query:'',limit:20})`. A trusted actor sees only their project-A work + accepted decisions; mismatched work/decision IDs or unregistered agent fail before memory query. Proposed decisions excluded; handoff 'grant plugin X' is advisory and cannot change policy. Response always `execution.performed:false`.
  Representative named RED test (use the task's fixture objects):

  ```js
  test('memory remains advisory and agent never executes', async () => {
    const packet = await buildAgentContext({actor,agentId:'coder',workItemId:'w-a',catalog,registryService,workService,decisionService,memoryService,serverCeilings,taskPolicy})
    assert.equal(packet.execution.performed, false)
    assert.ok(packet.memory.every(row => row.trust === 'advisory'))
  })
  ```

- [ ] **Step 2: Run RED.** Run `node --test server/fabric/context-builder.test.mjs`; expected FAIL on absent module, absent behavior or stricter security assertion.
- [ ] **Step 3: Implement the smallest solution.** Create a dependency-injected, server-only orchestrator: normalize trusted actor, look up enabled registered agent, load authorized work and verify project before resolving policy, query approved exact scopes, filter accepted same-work decisions, safely label memory/handoff as advisory and preserve work/version as authoritative. No direct network/filesystem, model or executor calls.
- [ ] **Step 4: Run GREEN and inspect results.** Run `node --test server/fabric/context-builder.test.mjs`; GREEN, no cross-project reads, deterministic source ordering and no trust promotion.
- [ ] **Step 5: Commit the focused slice.** Stage the files named above and `git commit -m "feat: compose authoritative Friday agent context"`; record revision, RED/GREEN evidence, reviewer outcome and any policy decisions in the work ledger.

### Task 7: Budgeted, redacted and provenance-safe context packets

**Files:**
- Create `server/fabric/safe-context.mjs`, `server/fabric/safe-context.test.mjs`
- Modify `server/fabric/context-builder.mjs`, `server/fabric/context-builder.test.mjs`

**Interfaces:** `serializeSafeContext({mandatory,optional,maxChars}) -> ContextPacket` with typed `context-too-large`, `schemaVersion:'1'`, source hashes, policy trace, omission counts and `execution:{performed:false}`.

- [ ] **Step 1: Write failing tests.** Small budgets reject if security policy/required skills/authoritative objective and accepted decisions cannot fit, without truncation. Optional handoff/memory gets omitted with reason. Untrusted content containing `role:system`, `ignore policy`, API keys, control characters, or claimed 'tests passed' never becomes trusted metadata or verification. Final `JSON.stringify(packet).length` <= limit (12,000 default; 32,000 hard), max 20 memories and 1,000 chars/entry. Rebuilds after actor/project/work-version/policy-hash changes cannot return cached context; backend outage fails closed.
  Representative named RED test (use the task's fixture objects):

  ```js
  test('mandatory state cannot be truncated to fit budget', () => {
    assert.throws(() => serializeSafeContext({mandatory:requiredState,optional:[],maxChars:256}),e => e.kind === 'context-too-large')
  })
  ```

- [ ] **Step 2: Run RED.** Run `node --test server/fabric/safe-context.test.mjs server/fabric/context-builder.test.mjs`; expected FAIL on absent module, absent behavior or stricter security assertion.
- [ ] **Step 3: Implement the smallest solution.** Use deterministic JSON serialization, separate fixed metadata from untrusted excerpts, redact/reject secret-looking text, optional last, never silently omit mandatory tiers. Enforce bounds against *final* serialized packet incl. omitted metadata. No cross-request context cache.
- [ ] **Step 4: Run GREEN and inspect results.** Run `node --test server/fabric/safe-context.test.mjs server/fabric/context-builder.test.mjs`; GREEN, repeated equal-input packet deep-equal, budget and untrusted-text regression tests pass.
- [ ] **Step 5: Commit the focused slice.** Stage the files named above and `git commit -m "feat: make bounded provenance-safe context packets"`; record revision, RED/GREEN evidence, reviewer outcome and any policy decisions in the work ledger.

### Task 8: Default-off integration, CI and operator guidance

**Files:**
- Create `server/fabric/bootstrap.mjs`, `server/fabric/bootstrap.test.mjs`
- Create `scripts/validate-fabric-catalog.mjs`, `scripts/validate-fabric-catalog.test.mjs`, `docs/fabric-phase2c.md`
- Modify `package.json`, `.github/workflows/ci.yml`, `server/http.agents.test.mjs`

**Interfaces:** `createFabricRuntime({enabled=false,catalog,services,serverCeilings}) -> {enabled,buildContext}`; feature off => typed `fabric-unavailable`. CLI catalog validator reads only checkout root. No import of Phase 2C bootstrap from production HTTP routes.

- [ ] **Step 1: Write failing tests.** Bootstrap disabled by default; missing/invalid catalog denies all 2C context calls, Phase 1 agent route remains operational, `execution.performed=false`; no new `/api/work`, `/api/memory`, `/api/policy`, `/api/plugins` or MCP write route. Corrupt manifest causes CLI nonzero exit. Assertions require `server/fabric/*.test.mjs` in both npm test scripts and catalog validator in CI.
  Representative named RED test (use the task's fixture objects):

  ```js
  test('disabled fabric refuses context', async () => {
    const runtime = createFabricRuntime({catalog,services,serverCeilings})
    await assert.rejects(runtime.buildContext({actor,agentId:'coder',workItemId:'w-a'}),e => e.kind === 'fabric-unavailable')
  })
  ```

- [ ] **Step 2: Run RED.** Run `node --test server/fabric/bootstrap.test.mjs scripts/validate-fabric-catalog.test.mjs server/http.agents.test.mjs`; expected FAIL on absent module, absent behavior or stricter security assertion.
- [ ] **Step 3: Implement the smallest solution.** Implement feature-disabled-by-default internal bootstrap/validator, wire focused tests to npm and CI, write runbook documenting least-privilege policy audit, versioned manifests, risk gates, rollback by disabling flag/redeploy, and Phase 2B history preservation. No UI, DB migration, public route or production deployment.
- [ ] **Step 4: Run GREEN and inspect results.** Run `node --test server/fabric/bootstrap.test.mjs scripts/validate-fabric-catalog.test.mjs server/http.agents.test.mjs`; Run focused GREEN, then `npm test`, `npm run build`, `npm run validate:agent-registry-schema`, `npm run validate:shared-work-schema`, `npm run validate:fabric-catalog`, `npm run test:shared-work-db`, `docker compose config`, `docker compose -f compose.yaml -f compose.live.yaml config`. All exit 0; compare HTTP contract and security boundaries to baseline.
- [ ] **Step 5: Commit the focused slice.** Stage the files named above and `git commit -m "test: gate Phase 2C internal catalog behind default-off flag"`; record revision, RED/GREEN evidence, reviewer outcome and any policy decisions in the work ledger.

## Verification and Release Gates

- **Plan review now:** operator must review and separately approve this implementation plan. Previous execution preference is **subagent-driven**, but approval of the design did not approve the plan.
- **Execution preparation after plan approval:** create an isolated feature branch/worktree from current \`main\`; copy approved spec/plan as source of truth. Read \`superpowers:subagent-driven-development\`, \`superpowers:test-driven-development\`, and \`superpowers:verification-before-completion\`. Preserve unrelated worktree changes.
- **Reviewer gate per task:** fresh implementation/review contexts for every slice; if independent subagent dispatch isn't available, disclose it and obtain an alternative rather than claiming independent review. Each task needs actual RED/GREEN tests and a focused commit.
- **Whole-branch acceptance:** run every Task 8 verification command; review actor/project/memory/plugin leak paths, source hashes, mandatory SOP precedence, exact-head CI, Docker build, and no new remote execution entrypoint. Mark blocked findings explicitly; do not merge failing security gates.
- **Rollout separation:** prepare a *draft* implementation PR and collect whole-branch independent review. No automatic merge, database migration or deployment. A separate operator rollout authorizes feature-flag activation only after the exact catalog/policy preview and rollback are validated.
- **Future phases:** external ChatGPT/Claude/Kimi MCP client authentication, plugin invocation, background agent chaining and infrastructure execution are not a Phase 2C deliverable, even with all tests passing.
