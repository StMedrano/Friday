# Friday — Ordered Finish Queue

Last refreshed 2026-11-07 from `git log` on `main` (at `42ace44`, #140) and
`FRIDAY_SHARED_MEMORY.md`.
Earlier versions of this file (PWA staging, Tasks read path, four-project
catalog) described work that has since merged; see `git log -- docs/codex/NEXT_STEPS.md`.

Production is VM102. It runs `main` at `7aac30d` (#130), deployed by the owner
on 2026-11-05 with `FRIDAY_GITHUB_ENABLED`, `FRIDAY_MONITORING_UPTIME_ENABLED`
and `FRIDAY_AGENT_ACTIVITY_ENABLED` set to true (ledger, 2026-11-05).

## 1. Merged, not deployed yet

Deploying needs the owner's go-ahead (`make preflight`, `make update`,
`make health` in `/srv/infrastructure/apps/friday`). Every feature below is off
by default unless noted.

| PR | What | To use it after deploy |
| --- | --- | --- |
| #131 | Chat asks the free-only model router first (`server/assistant.mjs`). | Set `FRIDAY_MODEL_FABRIC_ENABLED=true` and configure free NVIDIA models (`docs/model-fabric.md`). |
| #132 | Repositories can be registered by GitHub URL with no checkout. Always available. | Settings, Repositories: add each repo by name and GitHub URL. |
| #133 | Approvals queue for incident remediation; decisions recorded and audited, nothing executed. | Set `FRIDAY_APPROVALS_ENABLED=true` (`docs/integrations.md`, Approvals queue). |
| #134 | Test-only: deterministic Authentik tampered-signature test. | Nothing. |
| #135 | Mock-mode Playwright smoke test in its own `e2e` CI job. | Nothing (CI only). |
| #136, #137 | Docs only: this queue, and the authentication failover and operator-access docs. | Nothing. |
| #138 | New task on the Tasks screen: operators with a project grant add a `ready` task. Nothing claims or runs it. | Apply `supabase/migrations/202611060001_friday_work_writer.sql` on VM132, mint a `friday_work_writer` JWT into `FRIDAY_WORK_WRITE_KEY`, set `FRIDAY_WORK_WRITE_ENABLED=true` (`docs/integrations.md`, New tasks). |
| #123 | Server-side AIDesigner REST client: list design sessions, generate a design (operator-only, audited, spends credits). No UI. | Add `AIDESIGNER_API_KEY` and set `FRIDAY_AIDESIGNER_ENABLED=true` (`docs/integrations.md`). |
| #139 | Docs only: four `ready` items added to `docs/automation/BACKLOG.md`. | Nothing. |
| #140 | Phone layout matches the AIDesigner phone design. Always on. | Nothing beyond the deploy. |

## 2. Waiting on an owner decision (do not start)

Listed in `docs/automation/BACKLOG.md` under "Needs owner approval" or in the ledger.

- **Authentik as primary login** (`authentik-primary-login`). Authentik verification exists (`server/security/authentik.mjs`); Cloudflare Access is still primary. Runbook for the switch and the outage fallback: `docs/friday-authentication-failover.md`.
- **Non-root controller cutover** (`controller-nonroot-cutover`). The candidate image is on `main` (#118); the cutover needs a VM102 data-volume ownership change in a maintenance window.
- **Claiming, moving or editing tasks** from Friday: not built; only creating a task was approved (2026-11-06).
- **Automated fixes**: acting on approved proposals from #133. Today an approval is a record only.
- **Create agents from Friday** and **Open app** (Applications): still "Not connected" by design.
- **Endpoint checks**: `FRIDAY_ENDPOINTS_ENABLED` stays off (owner's call, ledger 2026-10-29).

## 3. Operations that need the owner or a maintenance window

- **Service-token renewal**: `friday-cloud-reader` expires **2026-11-24** (ledger, Service identity). Rotate with an overlap, update the managed-runtime binding, rerun acceptance.
- **Authenticated Cloudflare acceptance** (ledger, `verification_needed`): rerun `node scripts/check-cloud-connection.mjs` from the managed runtime.
- **VM100 observer redeploy** needs `FRIDAY_DOCKER_SOCKET_GID` (#116).
- **Grants renewal timer** on VM102 is host configuration only and is lost on a VM102 rebuild (ledger, 2026-11-01).

## 4. Next agent work (no approval needed)

Taken in order by the nightly builder from `docs/automation/BACKLOG.md`.

1. `env-check-script`: offline check of a VM102 `.env` against `compose.yaml` before the next deploy.
2. `aidesigner-sessions-panel` (in review on `bot/nightly-aidesigner-sessions-panel`): Settings, General lists AIDesigner design sessions, read only (no Generate button).
3. `refresh-codex-md`: correct stale PR and branch states in `CODEX.md`.
4. Keep this file current after each merge or deploy.

#142 (service token expiry), #143 (Tasks and Approvals smoke test), #144
(setup links on Not connected placeholders) and #145 (Supabase probe retry)
merged on 2026-11-09 and are not deployed. Settings, General now lists every
opt-in feature as on or off (settings-feature-flags).

The authentication docs from #109's branch are on `main`, corrected to what
`main` does: `docs/friday-authentication-failover.md` and
`docs/phase2c-operator-auth-hardening.md` (origin checks, operator-only routes).

PR #109 (`integration/friday-development-main-20261029`) stays open as a source
branch; do not merge it whole.
