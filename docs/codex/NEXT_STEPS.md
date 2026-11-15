# Friday — Ordered Finish Queue

Last refreshed 2026-11-15 from `git log` on `main` (after #154) and
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
| #150 | Web Growth, Website designs: AIDesigner design list plus Generate with a credit confirm step (operator only, audited). | With #123 set up, also set `FRIDAY_AIDESIGNER_GENERATE_ENABLED=true` (`docs/integrations.md`, AIDesigner design generation). |
| #147 | `make env-check`: offline check of a VM102 `.env` against `compose.yaml`. | Run it on VM102 before the next deploy. |
| #148 | Settings, General lists AIDesigner design sessions, read only. | Same settings as #123. |
| #149 | Claim and move tasks on the Tasks screen (operator plus project grant; a live claim held by someone else blocks the move). | Apply `supabase/migrations/202611150001_friday_work_mover.sql` on VM132 after the #138 migration, then set `FRIDAY_WORK_MOVE_ENABLED=true` (needs the #138 write path on). `docs/integrations.md`, Claim and move tasks. |
| #151 | Automated fixes: after an approval, an operator presses Run fix; the action comes only from the owner's playbook file. Dry run by default. | `FRIDAY_APPROVALS_ENABLED=true`, `FRIDAY_REMEDIATION_ENABLED=true`, a playbook file. Execute mode also needs `FRIDAY_MODE=live`, the action audit, an owner-run https executor and an armed automation gate. `docs/integrations.md`, Automated fixes. |
| #152 | `make observer-prep` on VM100 checks the observer `.env` and (with `--write-gid`) sets `FRIDAY_DOCKER_SOCKET_GID`. | Run on VM100 before the observer redeploy (`observer/README.md`). |
| #153 | Non-root controller cutover tooling: `compose.nonroot.yaml`, `scripts/migrate-friday-data-nonroot.sh --confirm`. Default stays root. | Maintenance window on VM102: `docs/controller-nonroot-migration.md`, then `FRIDAY_CONTROLLER_NONROOT=true`. Repoint the grants renewal timer to `friday_data_nonroot`. |
| #154 | Authentik as primary login: operator routes can require a signed Access claim set only by the Authentik login. Settings shows your own access. | Owner sets up Authentik OIDC in Cloudflare, checks the claim at `/cdn-cgi/access/get-identity`, then sets `FRIDAY_ACCESS_OPERATOR_IDP_CLAIM` and `FRIDAY_ACCESS_OPERATOR_IDP_VALUE` (`docs/friday-authentication-failover.md`). |

## 2. Waiting on an owner decision (do not start)

Listed in `docs/automation/BACKLOG.md` under "Needs owner approval" or in the ledger.

- Authentik as primary login, the non-root cutover, claiming and moving tasks, and automated fixes were approved on 2026-11-15 and are built (#149, #151, #153, #154, all off by default). Turning each on is in the table above.
- **Create agents from Friday** and **Open app** (Applications): still "Not connected" by design.
- **Endpoint checks**: `FRIDAY_ENDPOINTS_ENABLED` stays off (owner's call, ledger 2026-10-29).

## 3. Operations that need the owner or a maintenance window

- **Service-token renewal**: `friday-cloud-reader` expires **2026-11-24** (ledger, Service identity). Rotate with an overlap, update the managed-runtime binding, rerun acceptance.
- **Authenticated Cloudflare acceptance** (ledger, `verification_needed`): rerun `node scripts/check-cloud-connection.mjs` from the managed runtime.
- **VM100 observer redeploy** needs `FRIDAY_DOCKER_SOCKET_GID` (#116). `make observer-prep` on VM100 checks the `.env` and, with `sh scripts/prepare-observer-redeploy.sh --write-gid`, sets it; see `observer/README.md`.
- **Grants renewal timer** on VM102 is host configuration only and is lost on a VM102 rebuild (ledger, 2026-11-01).

## 4. Next agent work (no approval needed)

Taken in order by the nightly builder from `docs/automation/BACKLOG.md`.

1. `refresh-codex-md`: correct stale PR and branch states in `CODEX.md`.
2. Keep this file current after each merge or deploy.

#142 (service token expiry), #143 (Tasks and Approvals smoke test), #144
(setup links on Not connected placeholders) and #145 (Supabase probe retry)
merged on 2026-11-09 and are not deployed. Settings, General now lists every
opt-in feature as on or off (settings-feature-flags).

The authentication docs from #109's branch are on `main`, corrected to what
`main` does: `docs/friday-authentication-failover.md` and
`docs/phase2c-operator-auth-hardening.md` (origin checks, operator-only routes).

PR #109 (`integration/friday-development-main-20261029`) stays open as a source
branch; do not merge it whole.
