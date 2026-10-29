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
| Publish shared ledger for `main` review | Codex/ChatGPT | `in_progress` | Docs-only branch `docs/shared-agent-memory-20261029`; repository-root coordination files only | 2026-10-29 | 2026-10-29 | Push the main-based branch and open a review PR; do not deploy or merge it directly. |
| Verify VM102 port-3011 origin | Codex/ChatGPT | `complete` | Read-only VM102 container, listener, origin-health, and tracked-source inspection | 2026-10-29 | 2026-10-29 | Preserve the isolated listener and repeat origin checks after future reviewed deployments. |
| Authenticated Cloudflare acceptance | unclaimed | `verification_needed` | Dedicated Access app and Friday read-only API; current managed-runtime rerun requires its existing hostname-scoped secret binding | 2026-10-29 | 2026-10-29 | Run `node scripts/check-cloud-connection.mjs` from the managed cloud runtime without copying credentials to VM102 or chat. |
| Service-token renewal | unclaimed | `planned` | `friday-cloud-reader` | - | 2026-10-29 | Plan renewal before 2026-11-24 without disclosing or committing credentials. |

When claiming a task, replace `unclaimed`, set `in_progress`, record the exact scope, and add an Activity log entry. If an agent stops without completing it, release the claim or mark it `blocked` with a clear handoff.

## Decisions

| Date | Decision | Reason | Status |
| --- | --- | --- | --- |
| 2026-10-26 | Use a dedicated Cloudflare tunnel for the Friday cloud API. | Keeps automation traffic isolated from the human-facing Friday website and staging. | active |
| 2026-10-26 | Route the dedicated hostname to `http://friday:3011`. | Matches the prepared container-network architecture for the read-only API. | active |
| 2026-10-26 | Protect the full hostname with a dedicated Access service identity. | Prevents path gaps and keeps automation authorization separate from human login. | active |
| 2026-10-26 | Remove the stale `friday-api` ingress from the main production website tunnel. | Prevents the API hostname from falling back to the website service on port 3010. | active |
| 2026-10-29 | Keep authenticated acceptance open until both Cloudflare authorization and Friday origin verification pass. | Edge configuration alone does not prove that Friday is reachable or securely validating JWTs. | active |

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

### 2026-10-29 14:11 CDT — Codex/ChatGPT — Prepared shared ledger for main review

- Status: `in_progress`
- Scope claimed: Main-based documentation branch, automation route-boundary verification, existing controller-hardening ownership, and read-only managed-runtime task discovery.
- Work performed: Created `docs/shared-agent-memory-20261029` from current `origin/main` at `fef9e01`, applied the four existing coordination-document commits, inspected the automation listener and focused tests, located the durable Friday cloud task, and confirmed draft PR #29 already owns controller hardening.
- Changes made: Documentation only on the isolated branch; no VM102, Cloudflare, deployment, credential, network, database, or runtime change.
- Verification: `node --test server/automation.test.mjs scripts/check-cloud-connection.test.mjs` passed 12/12 on current `main`. The tests cover all four authenticated reads, write denial, unknown/query/encoded-route denial, snapshot validation, response bounds, credential-safe checking, and freshness checks. `git diff --check` passed.
- Decisions: Mark the read-only route boundary complete. Keep controller hardening in draft PR #29 and keep the authenticated rerun in the existing managed runtime with its hostname-scoped credential binding.
- Blockers/risks: The current authenticated checker has not been rerun after the 2026-10-29 restart because this task has no service-token secret. Do not copy or rotate that secret merely to rerun acceptance. Draft PR #29 is not release-ready.
- Next action: Push the docs-only branch, open a PR to `main`, then update this entry with the review link and final branch state.
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
