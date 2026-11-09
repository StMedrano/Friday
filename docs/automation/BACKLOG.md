# Friday backlog

Work queue for the [nightly builder](nightly-builder.md). It takes the first
`ready` item from the top. Statuses: `ready`, `in-review` (a pull request is
open), `done`, `needs-approval` (owner must decide first; never started by
the builder).

Keep each item small enough for one pull request.

---

## fix-authentik-flaky-test — `done`

**Scope:** `server/security/authentik.test.mjs` and, only if the root cause
is there, `server/security/authentik*.mjs`.

The test "invalid issuer…deny" intermittently fails under parallel test load.
Find the cause (shared state, timing, port or clock reuse) and make it
deterministic without loosening what it asserts.

**Done when:** the test passes 50 consecutive runs under
`node --test --test-concurrency=8 server/`, its assertions are unchanged or
stricter, and `make verify` passes.

## port-auth-failover-docs — `done`

**Scope:** docs only. Source: `docs/friday-authentication-failover.md` and
`docs/phase2c-operator-auth-hardening.md` on branch
`integration/friday-development-main-20261029` (PR #109).

Bring both documents onto `main`, corrected to match how `main` actually
works today (`server/security/access.mjs`, Authentik support, operator-only
routes in `server/http.mjs`). Drop or flag anything that describes code
`main` does not have.

**Done when:** every route, env var and file the docs name exists on `main`
(checked with grep), and `docs/codex/NEXT_STEPS.md` links them.

## port-e2e-smoke — `done`

**Scope:** `playwright.config.mjs`, `tests/e2e/`, a CI step, `package.json`
script. Source: the same #109 branch.

Port the Playwright setup as a mock-mode, zero-credential smoke test of the
read-only dashboard: load, overview renders, phone navigation sheet opens and
traps focus, Settings is reachable. Do **not** port any test that creates or
edits tasks; that write path is not approved. Use the pre-installed Chromium
in CI only if the runner provides it; otherwise install Playwright's
Chromium in the CI step.

**Done when:** `npm run test:e2e` passes locally and in a new CI step, and
`make verify` is unchanged in runtime by more than a few seconds (e2e runs
as its own CI step, not inside `make verify`).

## refresh-next-steps — `done`

**Scope:** `docs/codex/NEXT_STEPS.md` only.

It still lists work that has since merged (#108–#119). Rewrite it as an
accurate, ordered queue: what is merged but not deployed, what needs an
owner decision, and what is next. Use `git log` and the ledger as the
source; do not invent status.

**Done when:** every item references a real PR, file, or ledger entry.

## wire-model-routing-into-chat — `done`

**Scope:** `server/ai/` and the assistant route. Off by default.

Let the assistant use the free-only model router from #115 when
`FRIDAY_MODEL_FABRIC_ENABLED=true`, keeping today's provider path when it is
off. Sequential failover only, never parallel. Normalized Friday state only;
no tools.

**Done when:** tests cover flag off (unchanged behavior), flag on (router
used, local first), and every provider failing (same safe error as today),
and `make verify` passes.

## refresh-docs-after-138 — `in-review`

**Scope:** `docs/codex/NEXT_STEPS.md`, `docs/codex/BUILD_STATUS.md` and the
Active work table in `FRIDAY_SHARED_MEMORY.md` only. Docs only.

NEXT_STEPS still says "(this PR)" for the New task work; it merged as #138.
The ledger row "Tasks write path (create only)" still says
`verification_needed`, and several redesign-backend rows still read "Open PR"
or "Merge after green CI" although they merged. Bring them in line with
`git log` on `main`. Do not record a deploy unless the ledger already has
evidence of it.

**Done when:** every PR named in those files has the state `git log` shows,
no "(this PR)" placeholder remains, and `make verify` passes.

## service-token-expiry-warning — `in-review`

**Scope:** `server/config.mjs`, a read-only field on an existing status
response, `compose.yaml`, `.env.example`, the Settings or Overview UI, tests,
`docs/integrations.md`.

The `friday-cloud-reader` service token expires on 2026-11-24 and nothing in
Friday shows it. Add an optional `FRIDAY_SERVICE_TOKEN_EXPIRES_AT` (ISO date,
no secret) and show "expires in N days" in the UI, as a warning when 14 days
or fewer remain and as an error once expired. Unset or invalid shows nothing
and must not break startup. Never read or show the token itself.

**Done when:** tests cover unset, invalid, more than 14 days, 14 days or fewer
and expired; the variable is listed in `compose.yaml` and `.env.example`; and
`make verify` passes.

## e2e-tasks-approvals-smoke — `in-review`

**Scope:** `tests/e2e/smoke.spec.mjs`, `tests/e2e/mock-server.mjs`.

Extend the mock-mode Playwright smoke test so it also opens the Tasks screen
and the Approvals queue and checks each renders (with mock data or its
"Not connected" state). Read-only: do not click New task, approve, or reject
anything, and do not turn on any write flag in the mock server.

**Done when:** `npm run test:e2e` passes locally and in the `e2e` CI job, the
two existing tests are unchanged, and `make verify` passes.

## not-connected-setup-links — `ready`

**Scope:** `src/components/NotConnected.tsx`, its callers, their tests.

Each "Not connected" placeholder tells the user nothing about how to connect
it. Give `NotConnected` an optional setup reference and pass, where one
exists, the matching `docs/integrations.md` section name (for example
"Approvals queue", "Uptime history", "New tasks"). Show it as plain text or
a link to the repository doc; no new routes and no backend changes.
Placeholders with no setup doc keep today's text.

**Done when:** tests cover a placeholder with and without a setup reference,
every reference names a heading that exists in `docs/integrations.md`
(checked in a test), and `make verify` passes.

---

## Needs owner approval (do not start)

## tasks-write-path — `done`

Owner approved creating tasks on 2026-11-06 ("Creating task"). Scope: a New
task form and `POST /api/work/tasks` behind `FRIDAY_WORK_WRITE_ENABLED`
(default off), operator plus project grant, insert-only `friday_work_writer`
role. Merged as #138. Claiming, moving and editing tasks are not part of
this approval.

## authentik-primary-login — `needs-approval`

Making Authentik the primary login instead of Cloudflare Access. Owner
decision.

## controller-nonroot-cutover — `needs-approval`

Switching production to the `runtime-nonroot` image. Needs a VM102
maintenance window; see `docs/controller-nonroot-migration.md`.
