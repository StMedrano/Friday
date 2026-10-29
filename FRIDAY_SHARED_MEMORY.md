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
| Authenticated acceptance | `blocked` | Requires the existing service-token credentials through approved secure handling and a known read-only endpoint. |

### Friday / VM102 origin

| Item | State | Evidence or blocker |
| --- | --- | --- |
| Current Friday checkout | `blocked` | The current repository or VM102 session has not been made available to this task. An older checkout does not contain the port-3011 service and must not be treated as current deployment evidence. |
| API service on port 3011 | `verification_needed` | Cloudflare is configured for `http://friday:3011`; the process/container and internal health have not been independently verified. |
| Origin JWT verification | `verification_needed` | Confirm the port-3011 service validates Cloudflare's signed Access JWT against the dedicated application audience and team issuer. |
| Read-only route boundary | `verification_needed` | Confirm the exposed API contains only approved read routes and rejects or omits writes and privileged actions. |
| Authenticated live request | `verification_needed` | With securely supplied client credentials, confirm a known read endpoint returns the expected 2xx response through Cloudflare. |
| Operational documentation | `verification_needed` | Install this ledger in the current repository and update `docs/cloud-connection.md` with deploy, test, renewal, and rollback procedures. |

## Active work

Only one agent should own a task or overlapping files/resources at a time.

| Task | Owner | Status | Scope / files / resources | Started | Last update | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| Install shared ledger in current Friday repo | Codex/ChatGPT | `complete` | Repository root, `AGENTS.md`, `CLAUDE.md`, `FRIDAY_SHARED_MEMORY.md` | 2026-10-29 | 2026-10-29 | Pull the tracked branch before each task and keep this ledger current. |
| Verify VM102 port-3011 origin | unclaimed | `planned` | VM102 and current Friday deployment; read-only first | - | 2026-10-29 | Use existing key-based SSH access, inspect deployment state, and run internal health checks without printing secrets. |
| Authenticated Cloudflare acceptance | unclaimed | `planned` | Dedicated Access app and Friday read-only API | - | 2026-10-29 | Use credentials already installed in an approved secret location; test valid, missing, and invalid authentication plus write denial. |
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
