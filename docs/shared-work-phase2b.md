# Friday Phase 2B shared work — operator and staging guide

**Status:** Code implementation on an isolated development branch. Live rollout is a separate approval gate. The intended eventual shared-work PostgreSQL backend is the existing **homelab Supabase**; no production schema changes are made by these scripts or CI.

## Components

- Schema: `supabase/migrations/202610090001_friday_shared_work.sql`; additive `friday_*` tables, restricted role grants and invoker-style lease/checkpoint/handoff/review RPCs.
- Internal server-only JavaScript: `server/work/validation.mjs`, `supabase-repository.mjs`, `work-service.mjs`, `memory-service.mjs`, `decisions.mjs`, `continuation.mjs`.
- Tests: `npm test`, `npm run validate:shared-work-schema`, and `npm run test:shared-work-db`. The DB runner starts **its own ephemeral PostgreSQL 16 container** without volumes, host ports or an external network; it checks no configured DB URL is present and destroys only its own container.
- Existing Phase 1 registry migration is unchanged. No task/memory HTTP APIs, MCP writes or infrastructure executors exist in 2B. New modules are **not wired into the public running Friday controller**.

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