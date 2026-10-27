# Friday Phase 2B shared work — operator and staging guide

**Status:** The authorized homelab Supabase schema migration was applied on 2026-10-11 after a restricted PostgreSQL 17.6 backup and isolated restore rehearsal. Its permissions were verified in production. Application deployment remains a separate step.

## Components

- Schema: `supabase/migrations/202610090001_friday_shared_work.sql`; additive `friday_*` tables, restricted role grants and invoker-style lease/checkpoint/handoff/review RPCs.
- Internal server-only JavaScript: `server/work/validation.mjs`, `supabase-repository.mjs`, `work-service.mjs`, `memory-service.mjs`, `decisions.mjs`, `continuation.mjs`.
- Tests: `npm test`, `npm run validate:shared-work-schema`, and `npm run test:shared-work-db`. The DB runner starts **its own ephemeral PostgreSQL 16 container** without volumes, host ports or an external network; it checks no configured DB URL is present and destroys only its own container.
- Existing Phase 1 registry migration is unchanged. No task/memory HTTP APIs, MCP writes or infrastructure executors exist in 2B. New modules are **not wired into the public running Friday controller**.

## Default-off identity-bound private reads (2026-10-27 source candidate)

`server/work/private-read-bridge.mjs` composes existing Phase 2B work and
memory services behind a **verified human Cloudflare Access JWT** and an
independent server-provisioned `grantsForSubject(subject)` function. Only
exact project grants and durable memory scope grants permit bounded
`listTasks`, `getTask`, and `searchMemory` projections. Responses
omit work objectives, detailed packets, credentials and unverified service
metadata. Wrong project rows, over-limit results, malformed or untrusted
grant snapshots, unexpected inputs, unavailable backends and invalid JWTs
all fail closed. Service token identities cannot acquire human task access.
The bridge offers **no writes or approval actions**.

The bridge is `enabled:false` by default, has no HTTP handlers, no public
route, no user-grant provisioner, no real credentials and no runtime wiring
in `server/index.mjs`. It cannot be advertised as a live Tasks/Memory
product. Before connecting a UI, implement an owner-reviewed durable
operator/project group-membership source, signed identity lifecycle and
revocation, bounded pagination and audit logs, independent database role
checks and staging cross-project denial tests. Do not use browser-provided
project/role claims as authorization. The source-only addition does not
execute infrastructure actions.

## Trusted user enrollment for Phase 2B reads (draft-only; not live)

A new optional `createTrustedWorkReadBridge` composes the signed-human
Cloudflare Access reader with `createFileWorkSubjectGrants`: an
**owner-private, canonical, one-day-expiring policy file** that maps the
**SHA-256 digest of the VERIFIED Access `sub`** (domain-separated;
`workSubjectHash(sub)`) to explicit project IDs and memory scopes.
Matching an email, browser role, AI claim, or merely belonging to an
Authentik Brand **does not** enroll a user.

The policy must be provisioned by the actual owner outside Git, in an
owner-owned mode-0700 directory, as a regular mode-0600 single-link
file. It is read fresh on every request: removing the binding,
replacing the policy atomically or letting it expire immediately denies
subsequent reads. Maximum validity is 24 hours; stale, malformed,
duplicated, wildcard, excessive, symlinked, group/world-readable, or
noncanonical JSON denies **every** user instead of falling back.
No server ever automatically creates this file. The policy is
read-only and cannot authorize writes, HomeLab actions, agent tools,
global memory or impersonation.

The exact policy structure, with sample-only placeholders, is:

```json
{
  "schemaVersion": 1,
  "expiresAt": 1793103600000,
  "users": [
    {
      "subjectHash": "replace-with-64-lowercase-hex-from-verified-access-sub",
      "allowedProjectIds": ["example-project"],
      "allowedMemoryScopes": [
        {"scope": "project", "ownerId": "example-project"}
      ]
    }
  ]
}
```

The example expiry is **illustrative and time-limited**, not a
production enrollment artifact. The actual file must contain compact,
canonical JSON in the shown field order, followed by one newline;
pretty-printed or manually edited duplicate-key JSON fails closed.
An authorized operator must (1) inspect the signed JWT in a trusted
backend, verify `iss`/`aud`/`exp`/`sub`, (2) compute the digest using
the source helper rather than copying an email or token into Git, (3)
create a narrowly scoped owner-private file and atomically replace it
after independent review, (4) verify accepted reads and other-user
and cross-project denials in staging, and (5) regularly renew or revoke
the short-lived policy. Never commit personal subject IDs, Access JWTs,
the policy file, or Supabase keys.

**Important:** this PR provisions **no actual user**, real role file,
HTTP handler, production credential or live runtime; the wrapper is
disabled by default. Current production tasks/memory remain
unconnected. A separate approved bootstrap, audited grant
administration, identity lifecycle acceptance and rollout are required
to claim a person is connected.

## Four-project trusted account scope — owner-selected, not activated

The owner approved **read-only Tasks and project Memory** for one existing,
verified Cloudflare Access account across these four logical projects:

| Requested project | Owner-reviewed key | Authoritative work project ID |
| --- | --- | --- |
| Friday AI OS | `friday-ai-os` | **Not yet resolved from VM132** |
| TechTactics | `techtactics` | **Not yet resolved from VM132** |
| Web Growth Agents | `web-growth-agents` | **Not yet resolved from VM132** |
| App Builder | `app-builder` | **Not yet resolved from VM132** |

The keys are *selection labels*, **not** proven Supabase
`friday_work_items.project_id` values or activation of a group catalog.
TechTactics and App Builder also have independent group design IDs. Those
must not be treated as database project IDs without validation. In
particular, the hosted Supabase cloud account is not automatically the
VM132 homelab Supabase database. Keep every project unbound and deny
access rather than guess database identifiers.

`server/work/four-project-enrollment.mjs` provides a *pure offline
proposal* for this exact four-project selection. It requires:

1. The exact Cloudflare Access user UUID **after** Cloudflare API
   identity validation and signed JWT `sub` acceptance. An email address
   is not a valid subject and must never be used as the grant key.
2. Exactly four distinct, independently verified VM132 `project_id`
   values; unknown, duplicated, wildcard or additional projects fail.
3. A short-lived expiration within 24 hours. No approval, agent
   execution, group memory, global memory, customer records or write
   permissions are included.

`createFourProjectEnrollment({verifiedAccessSub,verifiedProjectIds,
expiresAt,now})` returns the canonical policy object for subsequent
*operator-controlled, owner-private* provisioning. The returned object
contains only a subject hash and exact project read grants, never an
email, plaintext user UUID, JWT or token. Write the exact compact
JSON plus newline to a private single-link mode-0600 file under a
mode-0700 directory by an approved atomic replacement process.

**Deployment remains blocked:** the four work project IDs have not
been verified against the authoritative VM132 database; the
source-only bridge is unmounted and the private file is absent.
Before enabling, confirm that the live signed `sub` equals the user
record UUID, back up and verify the work datastore, stage identity
and cross-project denial tests, confirm read-only audit coverage,
and request a separate production rollout approval. Existing
Cloudflare Access login is **not** proof that Friday project
reads are enabled.

## Read-only homelab gateway preflight

Run `node scripts/preflight-shared-work-target.mjs http://10.1.20.10:8000` from VM102 to check that the intended VM132 gateway responds. Only an unauthenticated GET on `/rest/v1/` is made. HTTP **401 is an expected reachable/gated response** and **does not prove authenticated PostgREST access, successful backup/restore, SQL privileges, schema compatibility, or migration readiness**. The structured report intentionally always returns `authenticated:false` and `migrationReady:false`; only a separately approved privileged read-only audit and staged migration can close those gates. No service keys or secrets are accepted as inputs. The script is covered by three tests in GitHub CI.

## Staging acceptance checklist

1. Review the migration diff against all existing homelab schemas; verify an isolated backup and a tested restore path before any change to the actual shared server.
2. On VM102 development branch, run `npm install --no-audit --no-fund`, `npm test`, `npm run build`, `npm run validate:agent-registry-schema`, `npm run validate:shared-work-schema` and `npm run test:shared-work-db`. Also check Compose validation, CI, and source/secret boundaries.
3. Validate migration against a disposable or separate **staging** Postgres/Supabase instance with the actual role capabilities; do not assume generic Postgres test roles fully reproduce homelab settings.
4. After explicit production-rollout approval, take a consistent tested backup, separately review Postgres role grants, available disk, extension/version compatibility, RLS and exposed PostgREST schemas. Apply the reviewed additive SQL using an approved migration workflow with transaction and deployment log. Never paste credentials into GitHub, screenshots or commits.
5. Post-migration, verify nine tables exist with RLS enabled; `anon` and `authenticated` have no table or function permission; `service_role` can access the required tables/RPCs. Exercise work-item creation, two conflicting claims, renewal, expiry, checkpoint replay, handoff replay, decision review, memory grants and a second worker continuation **in staging first**.
6. Keep existing agent traffic pinned to its previous advisory-only path. Any separately approved switch-on must have a rollback and logs confirming no new task/agent execution authority.

## Security boundaries

All writes are performed **only by trusted Friday server code** with an authenticated, server-derived actor context and bounded project/scope/agent grants. The service-role key never belongs in Vite/browser variables, AI prompt context or database records. Context packets include authoritative work status and accepted decisions before advisory memory, are bounded and filtered for obvious credential patterns. Such filters do not guarantee detection of every secret; never persist secrets in the first place.

Session memory is in-process and expires; it is **not** stored in Postgres. Memory scope grants do not grant plugin, shell, Proxmox or Docker permissions. Accepted decision status requires a trusted authorized reviewer and an atomic version-checked SQL update.

## Reversal and recovery

Safe code rollback: leave Phase 2B service entrypoints disabled and redeploy the prior known-good controller **only after a separate rollout decision**. Leave all new `friday_*` tables and append-only history intact. Do **not** drop schema objects just to revert application code; dropping live history would be destructive. Recovery from database failure uses the separately validated backup and operator-owned Postgres procedures. Live failover/backups and service-account rotation require review before migration.

## Operational limitations before acceptance

This is not an autonomous multi-AI workflow: no authentication-bound external MCP clients, background scheduler, public work-management interface or automatic inference chain. Task continuation is a reusable **internal API**; integration with providers, group skills, plugins and external clients belongs to subsequent approved phases.

## Mandatory migration follow-up — Supabase default privileges

Supabase can default to **all table privileges for service_role** via owner-specific default ACLs. A narrower GRANT statement alone does not revoke that broad access. Always apply both migrations transactionally in order:

1. `supabase/migrations/202610090001_friday_shared_work.sql`
2. `supabase/migrations/202610110001_friday_shared_work_grants.sql`

Immediately verify the effective role grants with `tests/sql/shared-work.sql`. It must report no UPDATE or DELETE privilege for service_role on the append-only checkpoint, handoff, artifact, and memory tables. CI emulates broad Supabase default privileges before applying the two migrations.

For the authorized 2026-10-11 VM132 rollout, a backup and globals dump were saved in a private server-side directory; the backup was successfully restored to an isolated matching PostgreSQL 17.6 instance with the production shared-preload extensions. The schema and follow-up grants passed tests on that restored instance and on the production database. This does not approve public APIs, external task execution, or automatic model handoffs.