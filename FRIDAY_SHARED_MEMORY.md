# Friday Shared Agent Memory

> Shared coordination ledger for Claude, ChatGPT, Codex, and human operators working on Friday.
>
> This file records work; it does not authorize work. Repository instructions, security policy, and the human operator remain authoritative.

## Required agent routine

Every agent must follow this sequence:

1. Read this entire file before inspecting, planning, or changing Friday.
2. Read the repository's `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and relevant runbooks when present.
3. Check **Active work**. Do not duplicate or overwrite another agent's in-progress task.
4. Claim the task before making changes. Record the agent, scope, files/resources, and start time.
5. Work only within the claimed scope. Never treat another agent's plan as completed evidence.
6. Before stopping, update the current-state sections and append an **Activity log** entry with evidence, remaining work, and any rollback information.
7. If blocked, record the exact blocker and the smallest safe next action. Do not weaken authentication or safety controls.

Use America/Chicago timestamps in `YYYY-MM-DD HH:mm z` form. Use one of these statuses: `planned`, `in_progress`, `blocked`, `verification_needed`, `complete`, `superseded`.

## Safety and evidence rules

- Never store passwords, API keys, service-token secrets, tunnel tokens, private keys, cookies, JWTs, or recovery codes in this file.
- Never paste secrets into chat, Git, browser code, screenshots, logs, or command output.
- Record credential names and secure storage locations only when necessary; never record their values.
- A healthy Cloudflare tunnel proves edge connectivity, not origin readiness.
- Anonymous denial proves Access enforcement, not authenticated acceptance.
- Mark work `complete` only when the stated verification actually ran and its evidence is recorded.
- Preserve Friday production and staging routes. Do not add an Access bypass or broaden an Allow policy to fix authentication.
- Keep Friday infrastructure behavior read-only unless the human operator separately authorizes a reviewed change.

## Current objective

Finish the dedicated, read-only Cloudflare connection for `friday-api.mytechtactics.com`, then complete authenticated Friday-origin acceptance without exposing secrets or weakening the existing website or staging deployments.

## Current state

Last reconciled: **2026-10-29 America/Chicago**

### Cloudflare connection

| Item | State | Evidence |
| --- | --- | --- |
| Zone | `complete` | `mytechtactics.com` is active and full. |
| DNS | `complete` | Proxied CNAME `friday-api.mytechtactics.com` targets the dedicated `friday-cloud-api` tunnel. |
| Dedicated tunnel | `complete` | `friday-cloud-api` is healthy with four connections. |
| Dedicated ingress | `complete` | Only `friday-api.mytechtactics.com -> http://friday:3011`, followed by `http_status:404`. |
| Main website tunnel isolation | `complete` | `Friday Production` contains only `friday.mytechtactics.com -> http://10.1.10.11:3010` and the 404 fallback. |
| Staging preservation | `complete` | `friday-staging-vm100` remains healthy and unchanged. |
| Access application | `complete` | Full hostname protected by the self-hosted `Friday Cloud API` application; app launcher visibility is disabled. |
| Access policy | `complete` | `Friday cloud reader only` is scoped to the dedicated service token. No bypass or Everyone rule was added. |
| Service identity | `verification_needed` | `friday-cloud-reader` is enabled and expires **2026-11-24**. Its secret was not retrieved or recorded. Plan renewal before expiry. |
| Anonymous acceptance | `complete` | On 2026-10-29, `/`, `/index.html`, `/api/overview`, `/api/agents`, `/api/assistant`, and `/healthz` each returned HTTP 401. |
| Authenticated acceptance | `verification_needed` | The complete managed-runtime checker passed on 2026-10-26. The current post-restart rerun is blocked because the credential was intentionally removed from VM102 and is not bound to this local task; do not retrieve or rotate it merely to repeat the test. |

### Friday / VM102 origin

| Item | State | Evidence or blocker |
| --- | --- | --- |
| Current Friday checkout | `complete` | Read-only SSH on 2026-10-29 confirmed `/srv/infrastructure/apps/friday` on host `friday-controller` is a clean Git checkout of `https://github.com/StMedrano/Friday.git`, on `main`, synchronized 0 ahead / 0 behind `origin/main`, at commit `fef9e01`. |
| API service on port 3011 | `complete` | On 2026-10-29 the healthy Friday container had automation enabled on 3011, monitoring enabled, live mode, and Docker observation disabled. Direct container-network probes reached the listener and received 403 without identity. Port 3011 is not published on VM102. |
| Origin JWT verification | `complete` | The live origin audience and service-client fingerprints exactly matched Cloudflare. Missing identity, invalid JWT, and raw Access client headers each failed closed with 403. |
| Read-only route boundary | `complete` | Current `main` exposes exactly four automation GET routes. Focused tests on 2026-10-29 passed denial of writes, unknown routes, query strings, encoded aliases, unavailable snapshots, and oversized responses; the listener does not forward to UI, repository, AI, diagnostics, or action handlers. |
| Authenticated live request | `verification_needed` | Four authenticated 200 reads, write rejection, excluded-route rejection, and query rejection passed from the managed runtime on 2026-10-26. The current image/source correspondence is verified, but the checker has not been rerun after the 2026-10-29 container restart because credentials are unavailable to this task. |
| Operational documentation | `complete` | Current `main` contains `docs/cloud-connection.md`, the secret-safe acceptance checker, deployment overlays, rollback guidance, and the 2026-10-26 acceptance record. |
| Controller hardening | `verification_needed` | Current `main` and the running Friday controller use root with a writable root filesystem and no capability drop or PID limit; this is source-aligned rather than runtime drift. Draft PR #29 already owns the non-root/read-only/capability hardening path and retains explicit staging, backup, migration, and production-cutover holds. The separate tunnel connector is already non-root, read-only, capability-dropped, and uses a mode-0600 token file. |

## Active work

Only one agent should own a task or overlapping files/resources at a time.

| Task | Owner | Status | Scope / files / resources | Started | Last update | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| Install shared ledger in current Friday repo | Codex/ChatGPT | `complete` | Repository root, `AGENTS.md`, `CLAUDE.md`, `FRIDAY_SHARED_MEMORY.md` | 2026-10-29 | 2026-10-29 | Pull the tracked branch before each task and keep this ledger current. |
| Publish shared ledger for `main` review | Codex/ChatGPT | `complete` | Docs-only branch `docs/shared-agent-memory-20261029`; repository-root coordination files only | 2026-10-29 | 2026-10-29 | Review and merge PR #105 through the normal repository workflow; then update VM102 only through a separately reviewed deployment. |
| Verify VM102 port-3011 origin | Codex/ChatGPT | `complete` | Read-only VM102 container, listener, origin-health, and tracked-source inspection | 2026-10-29 | 2026-10-29 | Preserve the isolated listener and repeat origin checks after future reviewed deployments. |
| Authenticated Cloudflare acceptance | unclaimed | `verification_needed` | Dedicated Access app and Friday read-only API; current managed-runtime rerun requires its existing hostname-scoped secret binding | 2026-10-29 | 2026-10-29 | Run `node scripts/check-cloud-connection.mjs` from the managed cloud runtime without copying credentials to VM102 or chat. |
| Service-token renewal | Codex/ChatGPT | `planned` | `friday-cloud-reader`; coordinated Cloudflare rotation and managed-runtime binding update | 2026-10-29 | 2026-10-29 | After the exact production merge target is identified, rotate with a bounded overlap, update the secure caller binding without exposing the secret, rerun acceptance, then retire the prior secret. |
| Production deployment after development merge | unclaimed | `planned` | Merged `main` revision and authoritative VM102 checkout | 2026-10-29 | 2026-10-29 | Identify the exact development PR/branch, require its merge and green exact-head verification, then inventory VM102, preserve `.env`, run preflight, deploy the merged `main`, and run health plus cloud acceptance. |
| Web Growth reader slice | Claude | `complete` | Branch `claude/friday-web-growth`: `server/adapters/web-growth*.mjs`, `/api/web-growth`, `integrations/web-growth-reader/`, Web Growth panel under the TechTactics group | 2026-10-31 | 2026-11-01 | Merged as #114. Stays disabled until an operator deploys the isolated reader and sets the reader URL, token and emails. |
| Wire free model routing into chat | Claude | `complete` | `server/assistant.mjs`, `server/ai/model-fabric.mjs`, tests, `docs/model-fabric.md`, backlog | 2026-11-05 | 2026-11-05 | Merged as #131. Stays off until `FRIDAY_MODEL_FABRIC_ENABLED=true` and free NVIDIA models are configured. |
| GitHub-only repositories | Claude | `complete` | `server/repositories/`, `RepositorySettingsPanel.tsx`, `RepositoriesWorkspace.tsx`, `src/lib/api.ts`, docs | 2026-11-05 | 2026-11-05 | Merged as #132. Owner redeploys VM102 and adds repos by GitHub URL in Settings. |
| Approvals queue | Claude | `complete` | `server/approvals/`, `server/http.mjs` approvals routes, `server/index.mjs`, `server/config.mjs`, `server/audit/action-audit.mjs`, compose/staging/.env.example, `ApprovalsQueue.tsx`, `AgentsWorkspace.tsx`, `Dashboard.tsx`, docs | 2026-11-05 | 2026-11-05 | Merged as #133. Owner sets `FRIDAY_APPROVALS_ENABLED=true` in an approved deploy. |
| Fix flaky Authentik test | Claude | `complete` | `server/security/authentik.test.mjs`, backlog | 2026-11-05 | 2026-11-05 | Merged as #134. |
| Port e2e smoke test | Claude | `complete` | `playwright.config.mjs`, `tests/e2e/`, CI `e2e` job, `package.json`, README | 2026-11-05 | 2026-11-05 | Merged as #135. |
| Refresh NEXT_STEPS | Claude | `complete` | `docs/codex/NEXT_STEPS.md`, backlog | 2026-11-05 | 2026-11-05 | Merged as #136. |
| Port auth failover docs | Claude | `complete` | `docs/friday-authentication-failover.md`, `docs/phase2c-operator-auth-hardening.md`, NEXT_STEPS, backlog | 2026-11-05 | 2026-11-05 | Merged as #137. |
| Add four ready backlog items | Claude | `complete` | `docs/automation/BACKLOG.md`, this ledger | 2026-11-06 | 2026-11-07 | Merged as #139. The nightly builder takes items from the top. |
| Tasks write path (create only) | Claude | `complete` | `server/work/task-insert-repository.mjs`, `server/work/http-writes.mjs`, bridge `createTask`, `supabase/migrations/202611060001_friday_work_writer.sql`, Tasks screen | 2026-11-06 | 2026-11-07 | Merged as #138, not deployed. Owner applies the role SQL on VM132, mints the key and sets the flag in an approved deploy. |
| Free model routing and NVIDIA readiness slice | Claude | `complete` | Branch `claude/friday-model-fabric`: `server/ai/model-{fabric,registry,router}.mjs`, `server/ai/nvidia.mjs`, `scripts/check-nvidia-catalog.mjs`, `modelFabric` config, docs | 2026-11-01 | 2026-11-01 | Merged as #115. Internal only and default off; not wired into chat or agents. |
| Container and observer hardening slice | Claude | `complete` | Branch `claude/friday-container-hardening`: `observer/docker-proxy.mjs`, `observer/Dockerfile*`, `observer/compose.yaml`, controller `Dockerfile`, CI observer steps | 2026-11-01 | 2026-11-02 | Merged as #116. VM100 observer rollout and the controller non-root data migration each need a separate operator-approved window. |
| #109 leftovers, slice A (history validation, HomeLab observations, phone sheet focus) | Claude | `complete` | Branch `claude/friday-109-ui-slice`: `server/monitoring/history.mjs`, `/api/monitoring/history`, `src/components/HomeLabSnapshot.tsx`, `src/hooks/useModalFocus.ts`, `MobileNavigation.tsx` | 2026-11-02 | 2026-11-02 | Merged as #117. |
| Non-root controller rehearsal (#109 leftovers, slice B) | Claude | `complete` | Branch `claude/friday-nonroot-rehearsal`: `Dockerfile` `runtime-nonroot` stage, `scripts/test-friday-volume-migration.sh`, `scripts/check-friday-volume-readiness.sh`, `scripts/test-controller-container-hardening.sh`, `scripts/scan-controller-image.sh`, CI | 2026-11-02 | 2026-11-02 | Merged as #118. Production cutover needs an approved VM102 window (see `docs/controller-nonroot-migration.md`). |
| VM100 staging stack (#109 leftovers, slice C) | Claude | `complete` | Branch `claude/friday-staging-stack`: `deploy/staging/`, `scripts/verify-friday-staging*`, `scripts/test-friday-staging-isolation.sh`, `scripts/check-friday-edge-readiness*`, `server/security/access-staging.test.mjs`, CI, Makefile | 2026-11-03 | 2026-11-03 | Merged as #119. Redeploying staging on VM100 from main is an operator step. |
| Setup links on Not connected placeholders (not-connected-setup-links) | Claude nightly builder | `complete` | Branch `bot/nightly-not-connected-setup-links`: `src/components/NotConnected.tsx`, six callers and their tests, `src/theme.css` | 2026-11-08 | 2026-11-11 | Merged as #144, not deployed. |
| Friday UI redesign from AIDesigner | Claude | `complete` | Branch `claude/project-thread-dnda8o`: `src/theme.css`, `src/pages/Dashboard.tsx` shell/Home, CSS palette in `src/*.css`, Geist fonts, `server/http.mjs` font MIME, audit API shape guard | 2026-11-05 | 2026-11-07 | Merged as #124, #125 and #126 (phone layout #140). #124 to #126 are deployed on VM102 at `7aac30d`; #140 is not deployed. |
| GitHub read integration for Repositories (PRs, CI, last commit) | Claude | `complete` | Branch `claude/project-thread-2sw5y6`: `server/adapters/github.mjs`, `/api/repositories/:id/github`, `server/config.mjs` `github`, `compose.yaml`, `.env.example`, `src/components/RepositoriesWorkspace.tsx`, `src/lib/api.ts`, docs | 2026-11-05 | 2026-11-07 | Merged as #127; deployed on VM102 at `7aac30d` with `FRIDAY_GITHUB_ENABLED` on. |
| Uptime history for Applications | Claude | `complete` | Branch `claude/project-thread-2sw5y6`: `server/monitoring/uptime.mjs`, runtime/state, `/api/monitoring/uptime`, `FRIDAY_MONITORING_UPTIME_ENABLED`, `ApplicationsWorkspace.tsx`, docs | 2026-11-05 | 2026-11-07 | Merged as #128; deployed on VM102 at `7aac30d` with `FRIDAY_MONITORING_UPTIME_ENABLED` on. |
| Agent activity log (Live agent events) | Claude | `complete` | Branch `claude/project-thread-2sw5y6`: `server/agents/activity-log.mjs`, `/api/agents/activity`, ask handler, `FRIDAY_AGENT_ACTIVITY_*`, `AgentActivityPanel.tsx`, docs | 2026-11-05 | 2026-11-07 | Merged as #129; deployed on VM102 at `7aac30d` with `FRIDAY_AGENT_ACTIVITY_ENABLED` on. |
| AIDesigner design generation API | Claude | `complete` | Branch `claude/project-thread-u3n07g`: `server/adapters/aidesigner.mjs`, `/api/aidesigner/*`, `aidesigner` config, compose/.env.example/staging flag, `docs/integrations.md` | 2026-11-05 | 2026-11-07 | Merged as #123, not deployed. Stays disabled until an operator sets `FRIDAY_AIDESIGNER_ENABLED` and `AIDESIGNER_API_KEY`. |
| Refresh docs after #138 (`refresh-docs-after-138`) | Claude nightly builder | `complete` | Branch `bot/nightly-refresh-docs-after-138`: `docs/codex/NEXT_STEPS.md`, `docs/codex/BUILD_STATUS.md`, this table, `docs/automation/BACKLOG.md`. Docs only. | 2026-11-07 | 2026-11-09 | Merged as #141. |
| Service token expiry warning (service-token-expiry-warning) | Claude nightly builder | `complete` | Branch `bot/nightly-service-token-expiry-warning`: `server/config.mjs` `serviceToken`, `server/settings.mjs` `serviceToken` field on `GET /api/settings`, `compose.yaml`, `.env.example`, `SettingsWorkspace.tsx`, `src/settings.css`, tests, `docs/integrations.md`, `docs/codex/API_CONTRACT.md` | 2026-11-08 | 2026-11-09 | Merged as #142, not deployed. To use: set `FRIDAY_SERVICE_TOKEN_EXPIRES_AT=2026-11-24` in VM102 `.env` and redeploy. |
| Tasks and Approvals browser smoke test (e2e-tasks-approvals-smoke) | Claude nightly builder | `complete` | Branch `bot/nightly-e2e-tasks-approvals-smoke`: `tests/e2e/smoke.spec.mjs` only (mock server unchanged) | 2026-11-08 | 2026-11-11 | Merged as #143. |
| Opt-in features in Settings (settings-feature-flags) | Claude | `in_progress` | Branch `claude/project-thread-4led58`: `server/settings.mjs`, `src/components/SettingsWorkspace.tsx`, `src/components/NotConnected.tsx`, `src/lib/api.ts`, tests, `docs/integrations.md`, `docs/codex/API_CONTRACT.md`, `docs/automation/BACKLOG.md` | 2026-11-11 | 2026-11-11 | Merge after CI. |

When claiming a task, replace `unclaimed`, set `in_progress`, record the exact scope, and add an Activity log entry. If an agent stops without completing it, release the claim or mark it `blocked` with a clear handoff.

## Decisions

| Date | Decision | Reason | Status |
| --- | --- | --- | --- |
| 2026-10-26 | Use a dedicated Cloudflare tunnel for the Friday cloud API. | Keeps automation traffic isolated from the human-facing Friday website and staging. | active |
| 2026-10-26 | Route the dedicated hostname to `http://friday:3011`. | Matches the prepared container-network architecture for the read-only API. | active |
| 2026-10-26 | Protect the full hostname with a dedicated Access service identity. | Prevents path gaps and keeps automation authorization separate from human login. | active |
| 2026-10-26 | Remove the stale `friday-api` ingress from the main production website tunnel. | Prevents the API hostname from falling back to the website service on port 3010. | active |
| 2026-10-29 | Keep authenticated acceptance open until both Cloudflare authorization and Friday origin verification pass. | Edge configuration alone does not prove that Friday is reachable or securely validating JWTs. | active |
| 2026-10-29 | Credential rotation and VM102 changes are authorized; production deployment must wait for the intended development branch to merge. | Explicit user instruction. This does not authorize deploying an unmerged head, bypassing review, exposing credentials, or guessing which branch is intended. | active |

## Handoff template

Copy this block into the Activity log and fill every field:

```text
### YYYY-MM-DD HH:mm z — <agent> — <short task>

- Status: <planned|in_progress|blocked|verification_needed|complete|superseded>
- Scope claimed: <exact files, services, or resources>
- Work performed: <concise factual summary>
- Changes made: <exact changes, or "none">
- Verification: <commands/checks and sanitized results>
- Decisions: <new decisions, or "none">
- Blockers/risks: <specific blocker, or "none">
- Next action: <smallest safe next step>
- Rollback/recovery: <how to reverse material changes, or "not applicable">
```

## Activity log

Append new entries at the top of this section. Do not rewrite or delete prior entries; supersede them with a newer entry when evidence changes.

### 2026-11-07 01:49 CST — Claude nightly builder — Refreshed docs after #138

- Status: `verification_needed`
- Scope claimed: Branch `bot/nightly-refresh-docs-after-138`; `docs/codex/NEXT_STEPS.md`, `docs/codex/BUILD_STATUS.md`, the Active work table, `docs/automation/BACKLOG.md`. Docs only.
- Work performed: Backlog item `refresh-docs-after-138`. NEXT_STEPS: replaced the "(this PR)" row with #138 and added #123, #136/#137, #139 and #140 to merged-not-deployed; next agent work lists the three remaining `ready` items. BUILD_STATUS: added a PR state table for every PR the file names (from `git log` ancestry on `main` at `42ace44` and the GitHub PR record); #50 reached `main` through #49; #20 is an open issue. Active work: the task write path, AIDesigner API, backlog, redesign, GitHub, uptime and agent activity rows now say merged, with deploy state only where the ledger already recorded it (`7aac30d`, 2026-11-05).
- Changes made: Docs only. Prior Activity log entries left as written.
- Verification: `make verify` passed (vitest 238/238, node 918 pass 0 fail 1 skipped of 919, build, Compose configs, staging validator); ancestry checked with `git merge-base --is-ancestor` against `main` and `7aac30d`.
- Decisions: none.
- Blockers/risks: `CODEX.md` still calls PR #9 "draft/open"; GitHub shows it closed unmerged. Outside this item's scope.
- Next action: Owner reviews and merges; the builder takes `service-token-expiry-warning` next.
- Rollback/recovery: Revert the pull request.

### 2026-11-05 11:30 CST — Claude — Added the AIDesigner design generation API

- Status: `verification_needed`
- Scope claimed: Branch `claude/project-thread-u3n07g`; `server/adapters/aidesigner.mjs`, `/api/aidesigner/sessions`, `/api/aidesigner/designs`, `aidesigner` config, settings posture, audit action `aidesigner.design.generate`, compose/.env.example/staging flag, docs.
- Work performed: Owner asked for an AIDesigner API in Friday (and separately to connect the AIDesigner MCP to Claude). Added a server-side REST client from AIDesigner's published API docs. Listing sessions needs a signed-in person; generating a design spends credits, so it is operator-only, JSON-only, audited, and returns references only, never HTML. Default off.
- Changes made: Code, tests, Compose env and docs. Nothing deployed; no key set anywhere.
- Verification: `make verify` passed locally (861 node tests, vitest, build, Compose configs, staging validator). Not tested against the live AIDesigner API (no key in this environment).
- Decisions: Premium `ultradesign` mode not exposed (extra credits). No UI yet.
- Blockers/risks: Needs an AIDesigner API key and an approved deploy to use.
- Next action: Review and merge the PR; then the owner adds `AIDESIGNER_API_KEY` to VM102 `.env` and sets `FRIDAY_AIDESIGNER_ENABLED=true` in an approved deploy.
- Rollback/recovery: Set `FRIDAY_AIDESIGNER_ENABLED=false` or revert the PR.
### 2026-11-06 13:53 CST — Claude — Added four ready items to the nightly backlog

- Owner asked to add all four suggested items (2026-11-06): `refresh-docs-after-138`, `service-token-expiry-warning`, `e2e-tasks-approvals-smoke`, `not-connected-setup-links`. Marked `tasks-write-path` `done` (merged as #138).
- Nightly PRs #121 and #122 are superseded by #134 and #137; owner to close them so the builder has room.
- Verification: docs only; `make verify` run before opening the PR.
- Next: the nightly builder takes `refresh-docs-after-138` first.

### 2026-11-03 05:41 CST — Claude — Added the nightly builder backlog and rules

- Owner approved a nightly scheduled session that builds Friday work from a backlog.
- Added `docs/automation/BACKLOG.md` (five `ready` items, three `needs-approval`) and `docs/automation/nightly-builder.md` (one PR per night, at most two open, never merges, deploys, or enables flags).
- Verification: docs only; referenced files and env vars checked with grep.
- Next: the scheduled session starts from this backlog once this PR merges.

### 2026-11-03 05:35 CST — Claude — Ported the VM100 staging stack onto main

- Status: `verification_needed`
- Scope claimed: Slice C of the #109 leftovers (owner said "Continue" on 2026-11-03).
- Work performed: Ported `deploy/staging/` (private, no host ports, tmpfs data, opt-in digest-pinned tunnel with a file secret), its offline Compose validator and CI smoke test, the anonymous edge readiness probe and the staging Access gate tests. Adapted to main: the stack builds `runtime-nonroot`, every integration and feature flag on main is forced off and checked, the staging access tests follow main's policy (diagnostic reruns open to signed-in readers, registry sync operator-only via Access identity), and the smoke test expects 403/503 from APIs because the UI shell is protected at the edge.
- Changes made: Code, CI and docs only. Nothing deployed; the existing VM100 staging install was not touched.
- Verification: `make verify` passed locally, including `scripts/verify-friday-staging.sh`.
- Decisions: Did not adopt #109's separate registry-sync bearer token or operator-only diagnostic reruns; those would change main's security policy and need the owner's call.
- Blockers/risks: None for this slice.

### 2026-11-01 20:05 CST — Claude — Ported #109 leftovers slice A onto main

- Status: `verification_needed`
- Scope claimed: First slice of the work that remains only in PR #109 (`integration/friday-development-main-20261029`).
- Work performed: `/api/monitoring/history` now projects events through `server/monitoring/history.mjs` and answers 503 (`monitoring-disabled`, `monitoring-history-unavailable`) or 502 (`monitoring-history-invalid`) instead of an empty list; the client validates the response and the home timeline says when monitoring is off. Added the read-only HomeLab observations panel under the HomeLab group, and a focus trap for the phone "More" sheet.
- Changes made: Code only. Legacy events with null optional fields are kept with those fields dropped. Nothing deployed.
- Verification: `make verify` passed locally.
- Decisions: #109's alternative project-task implementation (task pagination, actor bindings, project access) conflicts with main's Tasks design and is not ported here; its Cloudflare Access verifier duplicates `server/security/access.mjs`.
- Blockers/risks: None for this slice.

### 2026-11-01 20:42 CST — Claude — Prepared the non-root controller and CI image scanning

- Status: `verification_needed`
- Scope claimed: Slice B of the #109 leftovers, chosen by the owner on 2026-11-02.
- Work performed: Added a `runtime-nonroot` Dockerfile stage (UID/GID 10001) next to the default root `runtime` stage, which stays last and is still what Compose builds. Ported the read-only VM102 volume readiness check, the disposable data-migration rehearsal, the non-root smoke test and the digest-pinned Trivy scan, and wired the rehearsal, smoke test and scans of the controller, observer and proxy images into CI. Wrote `docs/controller-nonroot-migration.md`.
- Changes made: Code and CI only. Nothing deployed; `friday_data` untouched.
- Verification: `make verify` passed locally; Docker steps run in CI (no local Docker daemon).
- Decisions: The grants timer on VM102 writes `work-grants.json` as root, so the cutover must also change that timer.
- Blockers/risks: The Trivy step fails CI on any new HIGH/CRITICAL advisory in the base images.

### 2026-11-01 19:49 CST — Claude — Ported container and observer hardening onto main

- Status: `verification_needed`
- Scope claimed: Slice 7 of the group-workspace split, the restricted Docker proxy for the VM100 observer and controller image hardening.
- Work performed: Ported the read-only Docker proxy sidecar, rootless pinned observer and proxy images, and the observer Compose split from `feat/friday-group-workspace-20261013`. Added a bounded log route to the proxy (exact observer request, tail 1-200, 256 KiB cap, `FRIDAY_DOCKER_PROXY_ALLOW_LOGS`) so incident log diagnostics keep working. Pinned the controller Node/Alpine image, moved runtime dependency install into its own stage and removed npm/Yarn from the runtime.
- Changes made: Code only. Nothing deployed. The controller still runs as root on purpose.
- Verification: `make verify` passed locally; observer suite 26/26. Docker images are built in CI (no local Docker daemon).
- Decisions: Kept the controller as root because VM102's `friday_data` volume and the root-written `work-grants.json` are root-owned; the group branch's UID 10001 switch would break them without a migration. Not ported: the VM100 staging stack (it uses the old `FRIDAY_CF_ACCESS_*` names) and the controller read-only/non-root Compose settings.
- Blockers/risks: VM100 observer redeploy needs `FRIDAY_DOCKER_SOCKET_GID` in its private `.env`; Compose refuses to start without it.

### 2026-11-01 09:51 CST — Claude — Ported free model routing and NVIDIA readiness onto main

- Status: `verification_needed`
- Scope claimed: Slice 6 of the group-workspace split, the free-only model fabric and NVIDIA readiness checks.
- Work performed: Ported the model registry, router, fabric and NVIDIA provider, the NVIDIA catalog/readiness scripts and their docs from `feat/friday-group-workspace-20261013`; added the `modelFabric` config block, Compose variables, `.env.example` entries and `npm run check:nvidia-catalog`.
- Changes made: Code only, default off (`FRIDAY_MODEL_FABRIC_ENABLED=false`, `FRIDAY_NVIDIA_ENABLED=false`). The fabric is not called by chat, agents or any route. No NVIDIA key was created, stored or used.
- Verification: `make verify` passed locally (192 frontend, 801 server tests, build and Compose config checks).
- Decisions: The policy is frozen free-only (no paid fallback, zero paid spend), prefers local models, pins hosted NVIDIA calls to `integrate.api.nvidia.com/v1`, refuses redirects and keeps credentials server-side.
- Blockers/risks: Using it needs a later reviewed change that wires the fabric into chat or agents, plus an operator-held NVIDIA key in an owner-private file. The Radeon 780M host cannot run a local NIM, so local NVIDIA stays off.

### 2026-10-31 22:10 CDT — Claude — Ported the Web Growth reader onto main

- Status: `verification_needed`
- Scope claimed: Slice 5 of the group-workspace split, the private TechTactics Web Growth pipeline.
- Work performed: Ported the isolated reader (`integrations/web-growth-reader/`), its schema and adapter, and the Web Growth panel from `feat/friday-group-workspace-20261013`, and adapted `/api/web-growth` to main's Access gate identity.
- Changes made: Code only, default off (`FRIDAY_WEB_GROWTH_ENABLED=false`, no reader emails). No reader was deployed and no lead data was connected.
- Verification: `make verify` passed locally (192 frontend, 770 server tests, build and Compose config checks).
- Decisions: Only signed-in people listed in `FRIDAY_WEB_GROWTH_READER_EMAILS` can read; service tokens and demo mode are refused before the reader is contacted. The reader forwards no contact details, notes or outreach text.
- Blockers/risks: Going live needs the owner to deploy the reader next to the lead store, pick a private HTTPS transport, and set the URL, token and reader emails.

### 2026-10-29 14:15 CDT — Codex/ChatGPT — Recorded conditional production authority

- Status: `planned`
- Scope claimed: Authorization boundary for Cloudflare credential rotation, VM102 changes, and the future production rollout.
- Work performed: Verified the authenticated Cloudflare profile, inspected only non-secret metadata for `friday-cloud-reader`, and reconciled the relevant GitHub branch/PR states before any rotation or deployment.
- Changes made: Shared ledger only. No credential was rotated, retrieved, printed, or copied; no VM102, Cloudflare, managed-runtime, deployment, network, database, or production change occurred.
- Verification: Exactly one enabled `friday-cloud-reader` token exists and expires 2026-11-24. PR #33 for `feat/friday-group-workspace-20261013` was merged into PR #29's branch, while PR #29 was later closed without merging to `main`. Current open PRs are #103, #104, and docs-only PR #105, so the phrase "development branch" does not identify one safe production revision.
- Decisions: Treat credential rotation and VM102 modification as authorized, but enforce the user's condition that production deployment happens only after the intended development branch is merged. Use a coordinated, secret-safe rotation with acceptance before invalidating the previous credential.
- Blockers/risks: The exact production merge target must be identified. This task has no supported secret-injection path into the existing managed runtime; rotating through a model-visible API response before that path is ready could expose or lose the new secret.
- Next action: Confirm the intended development PR/branch. After it merges to `main`, verify the exact merged SHA and CI, arrange a secure managed-runtime credential update, rotate with bounded overlap, run VM102 inventory/preflight/deployment/health, then rerun the eight-gate cloud checker.
- Rollback/recovery: During rotation retain the previous secret only for the bounded migration window; if deployment health fails, restore the prior reviewed VM102 revision and preserve the existing `.env` and tunnel connector.

### 2026-10-29 14:11 CDT — Codex/ChatGPT — Published shared ledger for main review

- Status: `complete`
- Scope claimed: Main-based documentation branch, automation route-boundary verification, existing controller-hardening ownership, and read-only managed-runtime task discovery.
- Work performed: Created `docs/shared-agent-memory-20261029` from current `origin/main` at `fef9e01`, applied the four existing coordination-document commits, inspected the automation listener and focused tests, located the durable Friday cloud task, confirmed draft PR #29 already owns controller hardening, and opened PR #105 for review.
- Changes made: Documentation only on the isolated branch; no VM102, Cloudflare, deployment, credential, network, database, or runtime change.
- Verification: `node --test server/automation.test.mjs scripts/check-cloud-connection.test.mjs` passed 12/12 on current `main`. The tests cover all four authenticated reads, write denial, unknown/query/encoded-route denial, snapshot validation, response bounds, credential-safe checking, and freshness checks. `git diff --check` passed.
- Decisions: Mark the read-only route boundary complete. Keep controller hardening in draft PR #29 and keep the authenticated rerun in the existing managed runtime with its hostname-scoped credential binding.
- Blockers/risks: The current authenticated checker has not been rerun after the 2026-10-29 restart because this task has no service-token secret. Do not copy or rotate that secret merely to rerun acceptance. Draft PR #29 is not release-ready.
- Next action: Review and merge `https://github.com/StMedrano/Friday/pull/105`; then rerun the authenticated checker from the existing managed runtime and record the result without exposing its secret binding.
- Rollback/recovery: Revert the docs-only commits or close the review PR; no live system rollback is needed.

### 2026-10-29 — Codex/ChatGPT — Revalidated Friday cloud-API origin after restart

- Status: `verification_needed`
- Scope claimed: Read-only VM102 origin, dedicated tunnel, Cloudflare application/policy, public negative enforcement, and managed-credential availability.
- Work performed: Inspected current `main`, live containers, isolated listener, safe runtime settings, application/source hashes, tunnel configuration, token-file metadata, controller health, and public/direct negative requests. Reconciled the existing 2026-10-26 acceptance record instead of repeating completed deployment work.
- Changes made: none to VM102, Cloudflare, the deployment, credentials, network, or runtime. Shared ledger only.
- Verification: Friday and tunnel containers are healthy with zero restarts/OOMs. Critical automation/config source hashes match the running image. Port 3011 is unexposed on the host and returns 403 without valid origin identity. Invalid JWT and raw Access headers also return 403. Origin audience and client-ID fingerprints exactly match the live Cloudflare application/token. The dedicated tunnel has four registered connections, loaded the exact remote ingress, and has no origin failures since its current start. `make health` and overlay Compose validation passed. Public anonymous/bogus identity requests return 401; the separate Friday website still returns its Access redirect.
- Decisions: Treat VM102 origin readiness, isolation, and negative authentication as current. Do not rotate or recover the service secret solely to repeat acceptance; use the existing managed-runtime binding.
- Blockers/risks: The managed authenticated checker cannot be rerun from this local task because neither local environment nor VM102 has the client credentials; this is intentional cleanup. The running controller remains root with a writable root filesystem under current `main`; the separate security-hardening release work remains outstanding.
- Next action: From the managed cloud runtime, rerun `node scripts/check-cloud-connection.mjs`; then rotate or replace `friday-cloud-reader` before 2026-11-24. Keep controller hardening in its reviewed release path.
- Rollback/recovery: not applicable; no live configuration changed.

### 2026-10-29 — Codex/ChatGPT — Claimed Friday cloud-API acceptance

- Status: `in_progress`
- Scope claimed: Read-only VM102 origin inspection and dedicated Cloudflare Access acceptance for `friday-api.mytechtactics.com`.
- Work performed: Loaded the current repository instructions, VM102 deployment workflow, Cloudflare workflow, environment contract, and shared ledger.
- Changes made: Shared ledger claim only; no VM102, Cloudflare, deployment, network, or credential change.
- Verification: Authoritative checkout and SSH access were previously confirmed; live service and authenticated acceptance checks are beginning now.
- Decisions: Use only sanitized metadata and credentials already installed through approved secure handling.
- Blockers/risks: Service-token secret availability is unknown; never retrieve or print it merely to complete a test.
- Next action: Inventory the deployed containers and tracked port-3011 implementation, then run bounded GET-only origin checks.
- Rollback/recovery: Release or update the ledger claim when this acceptance pass ends.

### 2026-10-29 — Codex/ChatGPT — Verified authoritative VM102 checkout

- Status: `complete`
- Scope claimed: Read-only SSH verification of the Friday Git checkout on VM102; no deployment or runtime inspection.
- Work performed: Connected with existing key-based SSH to `stalin@10.1.10.11` and verified the host, checkout path, Git identity, branch, synchronization, and working-tree state.
- Changes made: none on VM102.
- Verification: Host `friday-controller`; repository root `/srv/infrastructure/apps/friday`; remote `https://github.com/StMedrano/Friday.git`; branch `main`; commit `fef9e01fa6366603b8b72f64aefe84cd2eac16a2`; clean working tree; 0 ahead / 0 behind `origin/main`.
- Decisions: Treat this VM102 checkout as the authoritative live repository evidence for subsequent read-only origin inspection.
- Blockers/risks: `FRIDAY_SHARED_MEMORY.md` and `CLAUDE.md` are not yet on VM102's `main`; they currently exist on `feat/friday-group-workspace-20261013`. Port 3011 and authenticated origin behavior remain unverified.
- Next action: Merge the coordination documentation through the normal reviewed path, then inspect the deployed port-3011 service read-only.
- Rollback/recovery: not applicable; VM102 was not changed.

### 2026-10-29 — Codex/ChatGPT — Installed repository-wide shared ledger

- Status: `complete`
- Scope claimed: Repository-root coordination documentation on `feat/friday-group-workspace-20261013`.
- Work performed: Added this ledger, made it the first required read in `AGENTS.md`, and added `CLAUDE.md` pointing Claude to the same authoritative instructions and update routine.
- Changes made: Documentation only; no application, deployment, Cloudflare, network, credential, or runtime configuration changed.
- Verification: Confirmed the tracked checkout was clean and fast-forwarded before editing; reviewed the resulting Git diff and scanned the ledger for credential-like values.
- Decisions: Use one committed repository ledger rather than separate model-specific memory files.
- Blockers/risks: Agents on another branch or device must pull the branch before relying on the ledger.
- Next action: Every agent reads and updates this file for future Friday work.
- Rollback/recovery: Revert the coordination-documentation commit if this workflow is retired.

### 2026-10-29 — Codex/ChatGPT — Reconciled live Cloudflare state

- Status: `verification_needed`
- Scope claimed: Read-only Cloudflare DNS, Tunnel, and Access inventory plus anonymous HTTPS probes.
- Work performed: Rechecked the intended zone, three Friday tunnels, dedicated ingress, Access application and policy, and service-token metadata.
- Changes made: none.
- Verification: Production, staging, and dedicated tunnels were healthy with four connections each. Six anonymous routes on `friday-api.mytechtactics.com` returned HTTP 401.
- Decisions: No additional Cloudflare configuration change is currently needed.
- Blockers/risks: Port 3011, origin JWT verification, and authenticated behavior remain unverified. Service token expires 2026-11-24.
- Next action: Obtain the current Friday checkout or read-only VM102 session and verify the origin before authenticated acceptance.
- Rollback/recovery: not applicable.

### 2026-10-26 — Codex/ChatGPT — Isolated Friday API from the main website tunnel

- Status: `complete`
- Scope claimed: `Friday Production` tunnel configuration only.
- Work performed: Removed the stale `friday-api.mytechtactics.com -> http://10.1.10.11:3010` ingress.
- Changes made: Production tunnel configuration advanced from version 6 to version 7. The website hostname and 404 fallback were preserved.
- Verification: The production website still reached its normal Cloudflare Access login; the dedicated tunnel and DNS target remained healthy and unchanged.
- Decisions: The API hostname must be served only by the dedicated `friday-cloud-api` tunnel.
- Blockers/risks: Authenticated Friday-origin behavior was not tested because no service-token secret was available through an approved secure path.
- Next action: Verify VM102 port 3011 and authenticated read-only behavior.
- Rollback/recovery: Re-adding the removed API rule is not recommended; the dedicated tunnel is the intended architecture.

## Repository bootstrap instruction

After placing this file at the current Friday repository root, add this exact instruction to both `AGENTS.md` and `CLAUDE.md` (or their nearest equivalent):

> Before starting work, read `FRIDAY_SHARED_MEMORY.md` completely. Claim your task in **Active work**, avoid overlapping another agent's scope, and update the ledger plus append an Activity log entry before stopping. Never put secrets in the ledger.

The ledger should normally be committed with the repository so every agent sees the same history. If runtime details should remain private, keep sensitive operational values in the approved secret manager and record only non-secret evidence here.

### 2026-11-05 — Claude — Friday UI redesign from AIDesigner
- Work: Pulled the owner's AIDesigner "Friday" canvases via the REST API and generated six more (Incidents, Applications, Repositories, Chat, Settings/Audit, phone). Re-skinned the app to zinc/indigo with bundled Geist fonts, replaced the icon rail with a grouped labeled sidebar, rebuilt desktop Home (greeting, Ask card, suggestions, stat cards, action-center rail) using real data only. Only Approvals and Memory are marked not connected now. Audit no longer crashes when the API answers 200 with non-JSON; the server serves .woff/.woff2 with font MIME types.
- Verification: `make verify` passed (vitest 213, node 849, build, Compose).
- Blockers: none. Deployed 2026-11-05 at `7aac30d`.
- Next: owner review of the PR.

### 2026-11-05 — Claude — Friday UI redesign slice 2 (backend check)
- Work: Merged #124. Ran the real server (`FRIDAY_MODE=mock`, built UI) and drove all 12 screens: no page errors; 503s only from features disabled in mock mode (agents, audit, monitoring history, assistant AI), each shown with an honest message. Chat gets an Active context rail (open incidents, visible services, suggested questions) from normalized state; Applications becomes a card grid; the preview banner now says mock mode when the API is connected.
- Verification: `make verify` passed (vitest 216, node 849).
- Next: owner review of the PR.

### 2026-11-05 — Claude — Friday UI redesign slice 3 (remaining page layouts)
- Work: Owner asked for the AIDesigner layouts on every page even where the backend lacks the feature. Added `NotConnected` (inert, text-labelled placeholder; disabled button at most). Incidents list+detail split; Repositories table + PR/CI side panel; Settings tabs incl. Audit log; Audit search, result filter and client-side CSV export of loaded events; Applications card metrics; Agents filters + action center; Infrastructure stat cards + services table; Tasks new-task placeholder. Existing safety tests (no create/approve/execute buttons) kept.
- Verification: `make verify` passed (vitest 219, node 849); all screens driven against the real server in mock mode with no page errors.
- Next: owner review of the PR.

### 2026-11-05 — Claude — GitHub read integration for Repositories
- Status: verification_needed (PR open; live GitHub read not run).
- Scope claimed: `server/adapters/github.mjs`, `GET /api/repositories/:id/github`, `github` config, `compose.yaml`, `.env.example`, staging flag, `RepositoriesWorkspace.tsx`, `src/lib/api.ts`, docs.
- Work performed: Server-side, GET-only GitHub reader (open PRs, default-branch CI from check runs plus commit statuses, last commit), cached per repo/branch, 4 MiB/8 s bounds, stable error codes, token never returned. Repositories page fills Open PRs / CI / Last commit and a PR side panel; keeps "Not connected" when the flag is off.
- Verification: `make verify` passed (vitest 223, node 860, build, Compose, staging validator). The cloud container gets 403 from api.github.com, so no live read was made.
- Decisions: off by default (`FRIDAY_GITHUB_ENABLED=false`); staging pins it false.
- Blockers/risks: needs a fine-grained read-only token in VM102 `.env` and a deploy.
- Next action: owner review/merge; then set `FRIDAY_GITHUB_ENABLED=true` and `FRIDAY_GITHUB_TOKEN` on VM102 in an approved deploy.
- Rollback/recovery: set `FRIDAY_GITHUB_ENABLED=false` or revert the PR.

### 2026-11-05 — Claude — Uptime history for Applications
- Status: verification_needed (PR open). GitHub integration #127 merged (deployed 2026-11-05 at `7aac30d`).
- Scope claimed: `server/monitoring/uptime.mjs`, `server/monitoring/{runtime,state}.mjs`, `/api/monitoring/uptime`, `server/config.mjs`, `compose.yaml`, `.env.example`, staging flag, `ApplicationsWorkspace.tsx`, `src/lib/api.ts`, docs.
- Work performed: Opt-in seven day hourly uptime record per service, written from each successful poll into the monitoring state file (max 300 services, maintenance excluded, degraded counts as up). Read-only route with explicit 503s. Applications shows 24h uptime, hourly bars and a 24h/7d detail.
- Verification: `make verify` (see PR).
- Blockers/risks: data starts accumulating only once the flag is on in production.
- Next action: merge after CI; set `FRIDAY_MONITORING_UPTIME_ENABLED=true` on VM102 in an approved deploy.
- Rollback/recovery: set the flag to false (the stored record is ignored) or revert.

### 2026-11-05 — Claude — Agent activity log
- Status: verification_needed (PR open). Uptime history #128 merged (deployed 2026-11-05 at `7aac30d`). Owner picked this slice on a decision card.
- Scope claimed: `server/agents/activity-log.mjs`, `server/http.mjs` ask handler and `/api/agents/activity`, `server/index.mjs`, `server/config.mjs`, `compose.yaml`, `.env.example`, staging flag, `src/components/AgentActivityPanel.tsx`, `AgentsWorkspace.tsx`, docs.
- Work performed: Opt-in, bounded, metadata-only log of agent questions (no prompts, answers, error text or identity), atomic 0600 file, write failures swallowed. Read-only route; Agents action center shows the latest eight.
- Verification: `make verify` passed.
- Blockers/risks: none; empty until the flag is on in production.
- Next action: merge after CI; set `FRIDAY_AGENT_ACTIVITY_ENABLED=true` on VM102 in an approved deploy. Remaining placeholders (approvals, remediation, new tasks/agents, open app) need owner approval.
- Rollback/recovery: set the flag to false or revert.

### 2026-11-05 — Claude — Agent on duty (Infrastructure)
- Status: verification_needed (PR open). Agent activity log #129 merged (deployed 2026-11-05 at `7aac30d`).
- Scope claimed: `src/components/AgentOnDuty.tsx`, `InfrastructureWorkspace.tsx`, `src/theme.css`. UI only, no new server route or flag.
- Work performed: Infrastructure's "Agent on duty" card now names the enabled registry agent whose declared `scope.hosts` covers the visible hosts, with its last answer time from the agent activity log when that is on. Stays "Not connected" when the registry is unavailable.
- Verification: `make verify` passed.
- Next action: merge after CI. Remaining placeholders (approvals, remediation, task/agent creation, open app) and the VM102 deploy wait for the owner.
- Rollback/recovery: revert the PR.

### 2026-11-05 — Claude — Free model routing in chat
- Status: verification_needed (PR open). #127 to #130 are deployed on VM102 at `7aac30d` (owner ran the deploy; GitHub, uptime and agent activity flags on, `make health` ok).
- Scope claimed: `server/assistant.mjs`, `server/ai/model-fabric.mjs`, `server/assistant.test.mjs`, `docs/model-fabric.md`, `docs/automation/BACKLOG.md`.
- Work performed: When `FRIDAY_AI_ENABLED` and `FRIDAY_MODEL_FABRIC_ENABLED` are both true, the assistant (chat, group advisory, agent ask) first tries the free-only router: eligible free NVIDIA targets one at a time, local first, normalized Friday state and history only, no tools. If none answers, it continues down today's provider order and deterministic analysis, so the safe unavailable result is unchanged. Router failures are recorded as sanitized attempts. Flag off changes nothing.
- Verification: `make verify` (see PR).
- Next action: merge after CI. Turning it on needs free NVIDIA models configured on VM102 in an approved deploy. Next slice: approvals queue (owner picked it 2026-11-05).
- Rollback/recovery: set `FRIDAY_MODEL_FABRIC_ENABLED=false` or revert.

### 2026-11-05 — Claude — GitHub-only repositories
- Status: verification_needed (PR open). Free model routing merged as #131 (not deployed).
- Why: the owner saw no repositories on Friday. VM102 mounts no checkouts (no `compose.repositories.yaml` overlay), so nothing was registered and the GitHub token had nothing to read. The owner chose GitHub-only registration on a decision card.
- Work performed: a registry entry may omit `path` when its `remote` is a github.com repository. The public list adds `checkout: true|false`; status, files and file reads refuse entries with no checkout. Settings, Repositories accepts a GitHub URL alone; the Repositories page skips file browsing for GitHub-only entries. No new flag (registration is operator-only and audited as before; GitHub data stays behind `FRIDAY_GITHUB_ENABLED`).
- Verification: `make verify` (see PR).
- Next action: merge after CI; owner redeploys VM102 and adds repositories by GitHub URL in Settings. Approvals queue is next (work saved locally, not pushed).
- Rollback/recovery: revert; stored GitHub-only entries would then fail validation and Friday falls back to the registry file, so remove them first.

### 2026-11-05 — Claude — Approvals queue
- Status: verification_needed (PR open). GitHub-only repositories merged as #132 (not deployed). Owner picked the approvals queue on a decision card ("operator only and audited; nothing is executed yet").
- Work performed: opt-in queue (`FRIDAY_APPROVALS_ENABLED`). Pending proposals are the open monitoring incidents with a recommended action; operators approve or deny on the Approvals page or in the Agents action center. Decisions are stored in an atomic 0600 file, serialized so the first wins, and audited as `approvals.decide`. Nothing executes (`execution.performed:false`). The older homelab-control staging-canary foundation is untouched.
- Verification: `make verify` (see PR).
- Next action: merge after CI; set `FRIDAY_APPROVALS_ENABLED=true` on VM102 in an approved deploy. Automated fixes that act on approved proposals still need owner approval.
- Rollback/recovery: set the flag to false (the stored decisions are ignored) or revert.

### 2026-11-05 — Claude — Flaky Authentik "invalid issuer…deny" test
- Status: verification_needed (PR open). Approvals queue merged as #133 (not deployed).
- Root cause: not load or shared state. The test tampered the signature by replacing its last two base64url characters with `xx`. A 256-byte RS256 signature is 342 characters and base64url ignores the 4 padding bits of the last one, so when the original ended in `x` plus a character whose top two bits are `11` (1 in 256 per run, with the random test key) the tampered token decoded to the real signature, verified, and the deny assertion saw 200.
- Fix: a `tamper()` helper changes the signature's first character (all 6 bits significant). Assertions unchanged. `server/security/access.test.mjs` uses a 5-character variant with a negligible (about 1 in 64^4) chance; left as is.
- Verification: 50 consecutive runs of `node --test --test-concurrency=8 server/security/*.test.mjs` passed; `make verify` (see PR).
- Next action: merge after CI. Next backlog items: port-e2e-smoke, refresh-next-steps.

### 2026-11-05 — Claude — Browser smoke test (port-e2e-smoke)
- Status: verification_needed (PR open). Flaky Authentik test fix merged as #134.
- Work performed: Playwright (`@playwright/test` 1.63.0, pinned) smoke test against a loopback mock-mode Friday server serving the built UI. Covers desktop load, overview nav and Read-only badge, Settings navigation, and the phone More sheet (opens, keeps focus inside over 12 Tabs, closes on Escape and returns focus, navigates to Settings). Wrote a fresh fixture instead of porting #109's task fixture; no task write tests. Runs as its own CI job (`e2e`), not inside `make verify`.
- Verification: `npm run test:e2e` passed locally (2 tests, about 3 s); `make verify` (see PR).
- Next action: merge after CI. Next backlog item: refresh-next-steps.

### 2026-11-05 — Claude — Refresh NEXT_STEPS (refresh-next-steps)
- Status: verification_needed (PR open). Browser smoke test merged as #135; its CI `e2e` job passed.
- Work performed: rewrote `docs/codex/NEXT_STEPS.md` as an ordered queue: merged-not-deployed (#131 to #135, with the flag to set for each), owner decisions, owner operations (service token expires 2026-11-24), and next agent work. Every item references a PR, file or ledger entry.
- Next action: merge after CI. Next backlog item: port-auth-failover-docs.

### 2026-11-05 — Claude — Port authentication docs (port-auth-failover-docs)
- Status: verification_needed (PR open). NEXT_STEPS refresh merged as #136.
- Work performed: brought `docs/friday-authentication-failover.md` and `docs/phase2c-operator-auth-hardening.md` from #109's branch, rewritten against `main` (`server/security/access.mjs`, the operator-only check in `server/http.mjs`, `server/config.mjs`). Dropped what `main` lacks and said so: no `FRIDAY_REGISTRY_SYNC_OPERATOR_TOKEN` second bearer for registry sync, no 20-per-minute POST limit, and diagnostic reruns are open to any valid identity (not operator-only). The failover doc is marked as a runbook for the unapproved `authentik-primary-login` decision. Linked both from NEXT_STEPS.
- Verification: grepped every file path and `FRIDAY_*` name in both docs against the tree; operator-only route list matches `server/http.mjs`; behaviour matches `server/security/access-staging.test.mjs`. Docs only, no code change.
- Next action: merge after CI. The backlog has no other `ready` items; the rest need owner approval.

### 2026-11-06 — Claude — New task (tasks-write-path, create only)
- Status: verification_needed (PR open). Owner approved "Creating task" on 2026-11-06 via the project chat. Claiming, moving and editing tasks are not approved and not built.
- Work performed: `POST /api/work/tasks` behind `FRIDAY_WORK_WRITE_ENABLED` (default off; needs work reads on). The work bridge re-verifies the Access JWT, requires an operator email and a project grant, derives the principal server-side, and writes through a new insert-only repository (fixed host, table and columns; retry-safe by request id; different content on a reused id is 409). Audited as `work.tasks.create`. New SQL `supabase/migrations/202611060001_friday_work_writer.sql` creates NOLOGIN `friday_work_writer` with column INSERT/SELECT on `friday_work_items` and RLS that only accepts new `ready` rows from `access:` principals. Tasks screen shows a New task form only when the list response says `canCreate`.
- Verification: role SQL and `tests/sql/shared-work-writer.sql` passed on a disposable local Postgres 16 (re-run safe); repository, bridge/HTTP and UI tests added; `make verify` (see PR).
- Next action: merge after CI. Owner, to switch on: apply the SQL on VM132, mint a `friday_work_writer` JWT into `FRIDAY_WORK_WRITE_KEY`, set `FRIDAY_WORK_WRITE_ENABLED=true`, redeploy.

- 2026-11-06 (Claude, UI redesign thread): Phone Home, header and tab bar restyled to match the AIDesigner phone canvas (greeting + ask bar first, icon stat cards with status tags, "Needs attention" cards, Home/Chat/Infra/Alerts/More tabs with indicator). New `src/mobile-aid.css`; no backend or API changes. Verification: `make verify` passed (vitest 237). Next: deploy to VM102 with the user's OK.

### 2026-11-08 01:50 CST — Claude nightly builder — Service token expiry warning (service-token-expiry-warning)
- Status: verification_needed (PR open). Tended bot PR #141 first: CI (`verify`, `e2e`) green, Codex review found nothing, no review threads.
- Work performed: optional `FRIDAY_SERVICE_TOKEN_EXPIRES_AT` (a date, never the token). `getConfig` keeps only a valid calendar date (`YYYY-MM-DD`, or the date part of an ISO timestamp); anything else becomes empty so startup never fails. `GET /api/settings` adds `serviceToken: { expiresAt, daysRemaining, state }` (`ok`, `warning` at 14 days or fewer, `expired` once the date has passed) or `null`. Settings, Access & roles shows "Expires in N days" with a warning or error pill. Listed in `compose.yaml` and `.env.example`; documented in `docs/integrations.md` and `docs/codex/API_CONTRACT.md`. Off unless set; no flag enabled.
- Verification: tests written first and failed, then passed: config (unset, valid, timestamp, five invalid forms), settings view (unset, invalid, 53 and 15 days ok, 14 and 0 days warning, -1 expired, token id never serialized), Settings UI (unset shows nothing; ok, warning, today, expired). `make verify` (see PR).
- Next action: owner merges, then sets `FRIDAY_SERVICE_TOKEN_EXPIRES_AT=2026-11-24` on VM102 at the next deploy. Next ready item: e2e-tasks-approvals-smoke.

### 2026-11-08 19:09 CST — Claude nightly builder — Setup links on Not connected placeholders (not-connected-setup-links)
- Status: verification_needed (PR open). Done at the owner's request to continue building on 2026-11-08.
- Work performed: `NotConnected` takes an optional `setup` naming a `docs/integrations.md` section and shows a "How to connect" link to that heading of the repository doc (new tab, `rel=noreferrer`). Wired for Uptime history, Agent on duty (Self-hosted Supabase runtime registry), Live agent events (Agent activity log), Approvals (Approvals queue), New tasks (New tasks (Tasks write path)) and Pull requests and CI (GitHub pull requests, CI and last commit). New agents, Automated remediation, Open app and Repository configuration have no setup doc and keep their text. No routes or backend changes.
- Verification: tests written first and failed (9), then passed: with and without a reference, anchor generation, every referenced section is a heading in `docs/integrations.md` (read in the test), and each caller shows its link. Checked the Approvals placeholder in the browser against the mock server. `make verify` (see PR).
- Next action: merge after CI. The backlog has no `ready` items left after this one.

### 2026-11-08 19:06 CST — Claude nightly builder — Tasks and Approvals browser smoke test (e2e-tasks-approvals-smoke)
- Status: verification_needed (PR open). Owner asked to continue building on 2026-11-08 while #141 and #142 were still open, so this run went past the two-open-PR pause at the owner's request.
- Work performed: two read-only Playwright tests in `tests/e2e/smoke.spec.mjs`. Tasks: opens the screen, checks the "Project tasks are not enabled on this controller." status and the "New tasks" not connected note, and that no Add task button exists. Approvals: opens the queue, checks its not connected note and that no Approve or Deny button exists. Nothing is clicked beyond navigation; `tests/e2e/mock-server.mjs` is unchanged and keeps every write flag off. The two existing tests are unchanged.
- Verification: `npm run test:e2e` passed locally (4 tests). Mutation check: renaming the Approvals placeholder and changing the Tasks message made both new tests fail; source restored. (Turning on `FRIDAY_APPROVALS_ENABLED` in the mock server does not change anything, because the approvals queue is created in `server/index.mjs`, not by `createFridayServer`.) `make verify` (see PR).
- Next action: merge after CI. Next ready item: not-connected-setup-links.

### 2026-11-11 17:55 CST — Claude — Opt-in features in Settings (settings-feature-flags)
- Status: in_progress (PR open). Owner asked to "continue building Friday" on 2026-11-11; the backlog had no `ready` items.
- Work performed: `GET /api/settings` adds `features`: GitHub, uptime history, agent activity, approvals, project tasks, new tasks, free model routing and Web Growth, each with `enabled`, `configured` (the settings the flag needs are present; values never sent) and `setup` (a `docs/integrations.md` heading). Settings, General shows them with On/Off, an Incomplete warning when a flag is on without what it needs, and a "How to turn on" link. Added `docs/integrations.md` sections Project tasks (read), Free model routing, Web Growth leads and Opt-in features in Settings. Backlog: #141 to #144 marked `done`; added `ready` items env-check-script, aidesigner-sessions-panel, refresh-codex-md and `needs-approval` items aidesigner-generate-ui, task-claim-and-move. Ledger rows for #143 and #144 marked complete.
- Verification: server and UI tests written first and failed, then passed; `make verify` (see PR).
- Next action: merge after CI (owner's standing rule). Not deployed; it ships with the next VM102 deploy along with #131 to #145.

