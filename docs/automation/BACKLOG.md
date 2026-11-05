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

## port-auth-failover-docs — `ready`

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

## refresh-next-steps — `in-review`

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

---

## Needs owner approval (do not start)

## tasks-write-path — `needs-approval`

Creating or editing project tasks from Friday (the #109 create/paging path).
Needs the owner to approve a Tasks write path and its database role first.

## authentik-primary-login — `needs-approval`

Making Authentik the primary login instead of Cloudflare Access. Owner
decision.

## controller-nonroot-cutover — `needs-approval`

Switching production to the `runtime-nonroot` image. Needs a VM102
maintenance window; see `docs/controller-nonroot-migration.md`.
