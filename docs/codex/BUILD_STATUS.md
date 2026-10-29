# Friday Build Status

## 2026-10-28 Grafana health and alert rule state (default off)

`server/adapters/grafana.mjs` adds the last planned monitoring adapter. It
reads `GET /api/health` and Grafana-managed alert rules with a Viewer
service account token and normalizes Grafana itself plus one service per
alerting rule; a rule firing beyond the grace period opens a warning
incident. Queries, annotations, labels other than `severity`, alert
instances and the token never leave the server. Disabled by default
(`FRIDAY_GRAFANA_ENABLED=false`); Settings reports its posture.

**Not deployed or live-validated.** No Grafana connection was made from
the cloud workspace. Activation requires a trusted HTTPS endpoint, a
Viewer token, a site label and comparison against Grafana's alert list.

## 2026-10-28 durable action audit (default off)

`server/audit/action-audit.mjs` adds the P8 durable append-only action
audit, separate from monitoring history. Each lifecycle event is one
SHA-256 hash-chained JSON line in a private (0700/0600, no symlinks)
`actions.jsonl`, fsynced before the caller continues. Writes are
serialized with reads; the store verifies the entire chain on open,
before every append and on every read, compares it with the last head it
wrote, and refuses further writes after tampering, truncation, deletion
or an unexpected writer. There is no update, delete, rotation or repair API;
at the size cap (default 16 MiB) audited actions are refused.

Registry sync and diagnostic rerun now record `requested` before running
and `succeeded`/`failed` after, with the verified Access actor (hashed
subject plus email or service label). When enabled, an action whose
request cannot be audited does not run. `GET /api/audit/events` is an
operator-only, bounded, paginated read. `FRIDAY_AUDIT_ENABLED=false`
by default, so behaviour is unchanged until an operator enables it and
adds an operator email; no infrastructure action or executor was added.
Approval queue, RBAC and kill switch remain separate P8 items.

## 2026-10-28 read-only settings inspection

`server/settings.mjs` and `GET /api/settings` replace the Settings
placeholder with a read-only view of the effective server configuration:
integration enabled/configured/credential-presence posture, AI failover
order, Access, monitoring and automation API state. Tests assert that no
secret, identity, Access value, URL or address from the environment ever
appears in the response. There is deliberately no write path; changing
settings remains a reviewed server-environment and deployment step.

## 2026-10-27 installable FRIDAY PWA — draft and not deployed

Friday gains a standards-based production-only PWA registration path,
standalone install manifest, branded opaque 180/192/512 PNG launcher
icons built deterministically from source, icon/favicon metadata and
an accessible Android/desktop install prompt when offered by the browser.
Responsive desktop/mobile layout and Cloudflare Access remain unchanged.

A root-scoped service worker **never caches authenticated HTML,
Cloudflare login pages, tasks, memory, monitoring or other API results**.
Only correctly typed, hashed immutable Vite JS/CSS may be cached; offline
navigation returns generic reconnect instructions with no private state.
Missing/offline PWA support never blocks ordinary Friday. The Node
server includes the webmanifest MIME and SW/manifest no-cache policy.
See `docs/pwa.md` for staged Android/iOS/desktop and cache audit tests.

**No production deploy, Access policy change, Supabase write, HomeLab
action, agent execution or grant enrollment has been performed.**
Final exact-head CI and staging browser acceptance are required before
production promotion.

## 2026-10-27 signed, default-off Tasks/Memory GET transport (draft only)

A fixed-origin server-side read-only PostgREST repository is included
(`server/work/read-only-repository.mjs`). It selects only projected task
and project Memory fields, validates bounded row shapes and responses
and exposes no writes or RPCs. Before activation, provision and
independently audit a dedicated SELECT-only credential; reusing the
existing writable Supabase service key is prohibited.

The merged private signed human Access read bridge can now be called from
the Friday HTTP server through an explicitly injected
`workReadBridge`. Exact routes support bounded GET-only task list,
task detail and **project-scoped** durable Memory search. The adapter
rejects duplicate/unknown query keys, unverified users, cross-project
reads, malformed IDs, invalid data, non-GET methods and backend errors.
It returns no private storage errors and sends `cache-control:no-store`.

**No running Friday feature activated.** `server/index.mjs` injects no
bridge; missing dependency returns 404 even for an authenticated user.
Before activation, require verified VM132 project rows, owner-private
grant-file lifecycle, signed-sub confirmation, independent read-only DB
permissions, audit, end-to-end staging tests and reviewed deployment.


## P8 pending approval queue — stacked draft PR #50, source only

An internal, read-only approval queue now derives from the owner-private,
append-only HomeLab audit store. Pending proposals are limited to the symbolic
unbound `staging-canary`, exclude approved/expired entries, and sort by expiry.
The bounded 512-event scan validates each record, ownership, file mode, symlink
safety and pairing; corruption or overflow fails closed rather than returning
partial results. The service verifies an Administrator's signed Access subject,
exact target role policy and independent automation gate before revealing only
safe request metadata and self-approval eligibility. No requester hash or
confirmation string is emitted. All results include `execution.performed:false`.

Test-first Node cases cover store reload, approval/expiry transitions, scan
limits, malformed/symlinked/permissive records, denial for other roles, absent
JWT/policy/store, kill revocation, and unavailable storage. PR #50 **depends on
unmerged draft PR #49** and must be reviewed with its exact-head verification.
PR #48 is a separate kill-switch foundation; no production integration or
executor is authorized. Live UI, durable event pagination/retention, production
role provisioning, a full human approval workflow, and all HomeLab action
control-plane security gates remain incomplete.


## P8 operator RBAC foundation — draft PR #49, source only

Internal operator policy now defines explicit server-injected, verified Cloudflare
Access JWT subject grants for the four intended roles: Viewer, Operator,
Administrator and Friday Agent. The dormant `createHomeLabControl` interface
requires a trusted exact-role/target policy on top of the signed human identity,
its existing durable audit, and its independently injected automation kill gate.
Missing/malformed bindings deny all. Proposal requires Operator/Admin;
approval requires Administrator and a **different verified subject** than the
original requester. Viewers and agent roles are read-only. The symbolic
`staging-canary` remains unbound and **no execution path exists**.

Test-first Node regressions exercise denied/invalid bindings, role matrix,
identity/target spoof attempts, snapshot mutation, missing policy, viewer and
agent restrictions, separation of duties, concurrent single-use approval, and
existing safety invariants. PR #49 is source-only. Its exact-head CI and
review status must be checked separately; no deployment, merge, or HomeLab
access was performed. It does not implement user-account provisioning,
session management, production policy binding, real target controls, or
global control-plane RBAC. P8 remains incomplete.



## 2026-10-27 four-project catalog bootstrap (stacked draft, source-only)

Reconciled after reviewed PR #76 and signed-read bridge PR #77 joined
main. This remains code-only and default-off pending owner-controlled
VM132 project registration, signed-sub confirmation and grant activation.

Added fixed owner-selected catalog metadata for Friday AI OS,
TechTactics, Web Growth Agents and App Builder to the trusted-grant
draft PR. Its default-off bootstrap requires exact fresh catalog
fingerprint and owner approval; never updates/deletes other projects.
A server-only Supabase adapter is GET-only by default and limits an
opt-in insert to exactly the four approved id/name pairs. Tests cover
empty and partial catalogs, unrelated rows, conflicting IDs/names,
stale fingerprints, invalid responses and post-write verification.

The real VM132 `friday_projects` and `friday_work_items` tables
were each observed **empty** through a read-only authenticated REST
request. **No database write or live user grant has been made.**
After reviewed project bootstrap, verify real catalog rows, signed
identity subject, private policy ownership, and staging denial before
separate production integration approval.

## 2026-10-27 four-project trusted user read scope — proposed, gated

The owner selected Friday AI OS, TechTactics, Web Growth Agents and App
Builder for one existing, Cloudflare-verified human account's **read-only
Tasks and project Memory** authorization. Added a deterministic
four-project policy helper on the dormant trusted-grant branch; it
accepts a verified Access UUID, requires **four distinct owner-verified
VM132 work project IDs** and rejects guessed, missing, duplicate,
wildcard or extra mappings. Its output is the same short-lived
canonical file schema tested by the signed private read bridge. Tests
also verify no plaintext user UUID, email, role or action permissions
are emitted.

No authoritative VM132 project IDs, private policy file, real signed
login JWT or live backend wiring have been supplied in this draft.
The user's Cloudflare login is verified, **but no production Friday
Tasks/Memory grant is live**. Do not infer projects from group IDs or
the unrelated cloud Supabase project.


## 2026-10-27 signed trusted-user enrollment for Tasks/Memory (stacked draft)

The opt-in `createTrustedWorkReadBridge` now binds signed human
Cloudflare Access subjects to narrowly scoped, owner-private policy
file grants using domain-separated subject digests, not emails or
browser roles. The file is read per operation and must be canonical,
owner-only, size-bounded, short-lived and exact. Revocation and
downgrades take effect on the next request. Test-first fixtures cover
genuine signed JWTs, email/role spoofing, denied subjects, project
scopes, expired grants, symlinks, file permissions, replacement and
duplicate authority keys.

This is a **stacked source-only PR on the prior disabled Phase 2B
read bridge**, not production rollout or user enrollment. Neither
`server/index.mjs` nor the UI mounts these methods; no owner
policy, identity subject, real token, Supabase key or approval
authority has been provisioned. Runtime Actions remain unavailable.


## 2026-10-27 Phase 2B private Tasks/Memory read bridge (draft, source-only)

Added a default-disabled, server-owned `createPrivateWorkReadBridge`
that verifies signed human Cloudflare Access JWTs, resolves project and
memory-scope grants from a separate trusted server-side source and
calls existing Phase 2B services for bounded read-only task lists,
individual task summaries and memory search. Read results are
explicitly projected and fail closed on malformed, wrong-project,
untrusted, excessive or sensitive data. Test-first coverage includes
denied/expired/mismatched JWTs, subject-only grants, cross-project
isolation, strict bounds and unavailable providers.

**No live routes, production database connections, user/team grants,
approval buttons, writes or VM102 deployment**. The dashboard still
correctly identifies Tasks and Memory as not connected. Activation
requires a trusted role/grant source, audited access, staging and
production review; do not give human rights to Cloudflare service
tokens or LLM output.


## 2026-10-27 operator dashboard honesty and Applications slice (draft, source-only)

The mainline Dashboard's previously hardcoded Approvals count `2` and
unconnected, initially enabled Automation toggle are removed. A static
read-only automation-unavailable state now makes clear that a browser
switch cannot arm HomeLab actions. The top bar describes read-only live
monitoring rather than promising unrestricted operational authority.

The Applications navigation now opens a real, responsive read-only
workspace backed **only by Friday's existing normalized overview**:
observed `app`, `media` and `container` category services; measured
status counts; search/status filters; and selected service identifiers,
source site/host/details/timestamps. No unverified website URLs, service
discovery, credential-backed launchers or app management endpoints are
invented. Offline fixtures are explicitly labelled preview only.
Desktop and mobile use the same workspace.

Tasks, Memory, Approvals, Audit and Settings now explain explicitly
that production identity-bound operations are **not connected** instead
of displaying the same unrelated generic inventory for every tab.
Existing Phase 2B shared-work and memory services remain internal and
unmounted. Existing HomeLab actions remain non-executable. No production
deployment, database migration or Authentik/DNS/Cloudflare change has
been performed. Review exact-head CI, production build, accessibility,
staging desktop/mobile and release approval before promotion.


## 2026-10-27 Authentik per-site session lifecycle (source-only draft)

The disabled `createPublicLoginRuntime` now exposes a **trusted-process
only** `maintenanceFor(siteId)` adapter, independently bound to Family
and TechTactics. A caller with independently authenticated and audited
operator authority can request an exact issuer-scoped subject session
revocation or bounded per-site sweeps of expired encrypted OIDC
transactions and website sessions. Wrong tenants, unknown subjects,
extra fields and unbounded cleanup requests fail closed. A cleanup
failure returns no success claim; partial sweeps are idempotent and
can be retried. Tests cover tenant isolation, expiry, revoked subjects
and backend failure sanitization.

This adds **no public API route, listener, scheduler, real DB access,
Authentik user lifecycle, role assignment or HomeLab permission**.
A website session revocation does not disable the account at the
identity provider, invalidate Authentik SSO cookies, or stop an
already in-flight callback; true offboarding still requires IdP
disable/revocation, an account-deny barrier and operator audit.
Production remains unchanged.


## 2026-10-27 Authentik public-login runtime assembly (draft, not deployed)

The default-disabled `createPublicLoginRuntime` factory combines the
merged dual-site login pages, signed OIDC authorization-code/PKCE flow,
cross-replica encrypted PostgreSQL state, durable website sessions,
browser cookie binding and strict per-site HTTP handler into one
server-owned composition. Two independent websites are required;
reused OIDC clients/secrets, DB query connections or encryption keys
fail closed. The test suite covers synthetic signed identities, real
loopback HTTP, callback replay denial and site-isolated sessions/logout.

This is a **source-only implementation** and is not imported by
Friday's production server. There are no public sockets, real OIDC
providers, applied migrations, DB credentials or DNS changes. Real
database-role and TLS verification, MFA, rate controls, end-to-end
browser acceptance and owner release approval are still pending.


## 2026-10-27 Public Authentik: cross-instance encrypted OIDC state (draft PR #73)

Friday's two separate public login site foundations are deployed as
**disabled source code** on the production controller. Real Authentik
on VM120 at `10.1.60.10:9000` responds to its internal health check,
and the existing `friday` OIDC discovery endpoint responds HTTP 200.
Neither the `family` nor the `techtactics` OIDC provider is registered
yet (each discovery path returns 404). The live Cloudflare zone has
`portal.mytechtactics.com` directed to an existing **Zoho Catalyst**
service; it must not be displaced. The proposed separate TechTactics
sign-in landing URL is now `accounts.mytechtactics.com`, pending
owner confirmation. The DNS and identity service remain unchanged.

Added a new, default-disabled `createPostgresOidcTransactions` adapter
for **cross-instance, one-use Authentik authorization-code/PKCE state**.
It implements the existing OIDC transaction seam with a separate
pre-provisioned PostgreSQL connection and 32-byte encryption key
per portal. A keyed SHA-256 state index excludes raw login-state bytes
from filenames/SQL lookup, and AES-256-GCM protects the state,
nonce, PKCE verifier and site/client binding at rest. Atomic
`DELETE ... RETURNING` prevents replay across replicas.
A new **UNAPPLIED** private SQL migration
`20261027010000_friday_identity_oidc_transactions.sql` defines a
five-minute TTL, unique composite key, forced RLS and disjoint Family
vs TechTactics database-role policies. A bounded cleanup method
requires trusted server-only scheduling. Offline disposable
PostgreSQL and synthetic signed OIDC roundtrip tests cover the
integration. CI result pending.

This source-only release **does not deploy the database migration,
create Authentik providers, DNS, TLS, client secrets, real site
listeners or login sessions**. Do not replace existing Cloudflare
Access, reveal PKCE keys or grant HomeLab executor access through
a public login. Owner-reviewed live provider provisioning, HTTPS,
DB credentials, user/MFA and browser acceptance remain prerequisites.
See `docs/authentik-two-login-sites.md`.


## 2026-10-26 production release candidate: dormant public Authentik code

This release branch contains **only public-login components** brought
from the tested Family HomeLab and TechTactics development stack.
It deliberately excludes HomeLab approval, executor or management
actions from the separate P8 security branches.

The included code provides two independently branded Family/HomeLab
and TechTactics HTML sign-in screens, OIDC authorization-code+PKCE
callbacks, cookie/session isolation, two optional HTTP handlers and
private site-scoped PostgreSQL web session schema/tests.
All components remain disabled/unmounted in the actual Friday
runtime. Merging code does **not** register live login routes,
create real Authentik apps, change Cloudflare policy, add credentials,
publish DNS or apply the DB migration to production.

The disposable PostgreSQL integration test validates the *unapplied*
new migration and its separate database roles. To make the two
portals operational, separately approve DNS/TLS, MFA, provider
registration, server-only OAuth and database credentials, distributed
OIDC transaction storage, real session lifecycle/offboarding,
public browser acceptance and an explicit staged cutover.
Existing Friday production Cloudflare Access remains in force.


## P8 global automation gate foundation — draft PR #48, source only

A fail-closed file-backed `createFileAutomationGate` is implemented under
`server/security/automation-kill-switch.mjs`. A missing, corrupt, symlinked,
group/world-accessible, expired or overly permissive gate file denies. Only an
exact owner-private schema with `state:allow-approved-actions` and at most a
five-minute expiration passes; the file is reopened on every check so owner
revocation is effective without a server restart. The gate is tested with the
existing dormant HomeLab control callback and does not create a file or an HTTP
route. It does not enable infrastructure execution, authenticate operators,
or confer independent RBAC/approval/audit permissions.

PR #48 is for source review only, with no production wiring or HomeLab access.
CI and a separate production/security design review must be completed before
future action development. P8 is **not complete**: authenticated role policy,
a durable approval queue, cross-instance audit/deny semantics, and a reviewed
runtime kill-switch integration remain pending. The read-only cloud automation
endpoint remains unrelated and unchanged.


## Two-site operations views — draft PR #47, source only

`feat/site-aware-infrastructure-20261026` implements a real read-only
Infrastructure workspace replacing the generic placeholder on desktop and
mobile. It derives site membership only from normalized service.site and
declared site identifiers/names, groups services by observed host, offers
site filters, highlights degraded/offline/maintenance services, and labels
mock and missing inventory accurately. `Both Sites` and missing membership
are separate Shared/Unassigned buckets; the view is explicitly an inventory
grouping, **not** proof of site-to-site VPN links or physical topology.

The Incidents workspace now supports read-only site and severity filters
with exact incident.serviceId-to-service.id attribution. Unmatched incidents
remain Unassigned regardless of host text; resolution lists follow filters
and health history is explicitly unfiltered. Selection hides stale incident
details when an active filter excludes their record. Existing diagnostics
are unchanged and do not acquire execution authority.

Test-first cases cover exact service grouping, ambiguous shared membership,
fallback/unavailable states, filtered incidents and desktop/phone navigation.
Full exact-head GitHub CI and source review must pass before the draft can
be considered ready. No merge, deployment, private services, access/role
policy, network configuration or HomeLab command was changed.


## Cloud snapshot boundary hardening — PR #46, source-only

Draft PR #46 (`fix/cloud-automation-snapshot-contract-20261026`) extends the
read-only automation listener's response boundary to reject invalid cache
envelopes, including Promise-like unresolved values that otherwise serialize as
HTTP 200 with an empty object. The overview requires mode, parsable collection
timestamp and services array; incidents require a numeric summary and array;
history requires an events array. Missing or malformed snapshots return
the existing generic 503 and never trigger polling, AI or actions.

Failing-first test commit `a9e59e7` reproduced the defect in GitHub CI:
468 of 469 Node tests passed; the new case failed on actual HTTP 200 instead
of expected 503. Subsequent implementation, documentation and final-head
verification are tracked in PR #46. No change to credentials, Access grants,
cloud deployment, live monitoring, HomeLab execution or production occurred.
Snapshot-envelope validation does not attest cache freshness.


## Cloud automation API — deployed and live-validated, 2026-10-26

Prepared the user-selected `friday-api.mytechtactics.com` connection: an optional separate port 3011 listener accepts only signed, explicitly allowlisted Cloudflare Access service identities for a dedicated application audience. It exposes authenticated health plus cached overview, incidents and monitoring history. All writes, query strings, repository/AI/diagnostic endpoints and other routes are denied. The existing UI's human/operator authentication remains separate. No infrastructure calls are triggered by cloud reads.

The listener defaults off, fails closed without authentication settings, bounds responses, and emits sanitized structured request logs. `compose.automation.yaml` publishes only VM102 loopback for a host-local connector and rotates controller logs. A dedicated container tunnel overlay (`compose.cloud-tunnel.yaml`) publishes no host port and mounts its token from a protected file; a host-local tunnel ingress template and proxy-aware, secret-safe acceptance checker accompany the [activation runbook](../cloud-connection.md). The default test commands now include the previously omitted `server/security/*.test.mjs` suite.

Validation: Node 22 `make verify` passed **90 frontend and 453 server/observer/script tests**, production build and five Compose configurations; the subsequently added dedicated-tunnel overlay also passed Compose validation. Signed-token integration tests verify permitted reads and denial of browser identities, other service identities, missing credentials, writes, queries and unsupported routes; audit sanitization, unavailable caches and response bounds also pass.

**Live deployment passed.** The dedicated `Friday Cloud API` Access application permits only the exact `friday-cloud-reader` Service Auth identity. Its remotely managed `friday-cloud-api` tunnel routes to the unexposed Docker listener at `http://friday:3011`; Cloudflare reports the tunnel healthy with four active connections. The existing website application remains separate and still redirects unauthenticated visitors to Access.

VM102 is checked out at deployment-record commit `5021012` from `codex/friday-cloud-api-read-adapters`; its running image contains application commit `608d85b`. Friday and the dedicated connector are healthy. Public acceptance returned 200 for authenticated health, overview, incidents, and monitoring history; 401 without the service token; 405 for a write attempt; and 404 for the excluded repositories route. Live identity, mode, service inventory, and overview timestamp checks passed. The tunnel token remains in its owner-only runtime file.

**Managed cloud acceptance and credential cleanup passed on 2026-10-26.** The runtime reports its restricted hostname policy enforced, `FRIDAY_CLOUD_URL` ready, and both hostname-scoped service credential bindings ready. Running `node scripts/check-cloud-connection.mjs` from that runtime reproduced all seven expected results: four authenticated 200 reads, unauthenticated 401, write rejection 405, and excluded repository route 404. An authorized VM102 session then removed only the temporary owner-only service-token copy at `/home/stalin/.config/friday-cloud-api/client.json`; the separate mode-600 tunnel-token runtime file was preserved. VM102 `make health` passed, and the cloud acceptance checker reproduced all seven results after cleanup. PR #45 merged into `main` on 2026-10-26 (`7b89228`). The separately reported VM102 running image remains at application commit `608d85b` until a new deployment is verified; GitHub source merge alone is not deployment acceptance.

Post-merge acceptance hardening (ported onto current `main` on 2026-10-28 from `de567b5`) requires the live overview snapshot to be no older than five minutes and no more than one minute in the future, and adds a query-suffixed overview request (`/api/overview?probe=1`) that must return 404. On 2026-10-26 the original branch checker passed all eight managed-runtime gates: four authenticated 200 reads, unauthenticated 401, write rejection 405, excluded repository route 404, and query-suffixed overview rejection 404. Node 22 regression tests cover both freshness boundaries and the exact query rejection. The ported checker has not yet been rerun against the live endpoint from current `main`.

## Uptime Kuma monitor health — local implementation, 2026-10-25

Friday now reads Uptime Kuma's existing `monitor_status` metrics through fixed `GET /metrics` access using a dedicated metrics API key. Monitor IDs stay stable across renames, label ordering, target URL changes, and health transitions. Down/up/pending/maintenance map to offline/online/degraded/maintenance, preserving existing incident grace and recovery behavior. No monitor controls, administrator login, Socket.IO access, or duplicate probes were added.

`FRIDAY_UPTIME_KUMA_ENABLED` defaults to false. HTTPS origin, metrics key, and explicit site label remain empty in examples and are passed only to the controller. Collection is bounded to five seconds, 512 KiB, and 200 monitors; status samples require `monitor_id`, `monitor_name`, and `monitor_type`. Monitored URLs, raw metric labels, and unrelated metric families are excluded from normalized state. Invalid, duplicate, oversized, or failed upstream data degrades only this integration. The observation timestamp is collection time, not proof of a fresh heartbeat. Setup and compatibility limits are in [integrations.md](../integrations.md#uptime-kuma-monitor-health).

Verification on Node 22.23.4: `make verify` passed with **90 frontend tests and 435 server/observer/script tests**, production build, and all four Compose configurations. New tests cover metrics-key authentication, fixed read routes, status/maintenance mapping, stable IDs, Prometheus escapes/numeric notation, privacy filtering, malformed/duplicate/bounded responses, deadlines, disabled/mock behavior, overview isolation, and incident grace/recovery. Mock smoke checks passed for `/healthz`, `/api/health`, `/api/overview`, and `/`, with all four new adapters disabled; resolved Compose settings confirmed server-only key forwarding.

**Not deployed or live-validated.** Activation requires a trusted HTTPS endpoint, enabled metrics API, dedicated key, explicit site label, and output containing `monitor_id`, followed by comparison with the user's Kuma instance. Creating a first Kuma metrics key changes existing metrics authentication, so that configuration remains an operator rollout task. No live keys, monitors, deployments, or production settings were changed. Grafana integration and Phase 1 live acceptance remain pending.

## Prometheus target scrape health — local implementation, 2026-10-25

Friday now consumes existing Prometheus active-target health through the fixed read-only `/api/v1/targets?state=active` endpoint. Each target becomes a monitoring service with job name, sanitized instance host/port, explicit target/fallback site, last scrape time, and scrape outcome. Stable IDs use the scrape pool and sorted final labels, preserving incident identity across health and ordering changes. Details distinguish scrape success/failure from application health; no duplicate probes or query execution were added.

`FRIDAY_PROMETHEUS_ENABLED` defaults to false. HTTPS origin, Basic credentials, and fallback site label remain empty in examples and are passed only to the controller. The adapter bounds requests to five seconds, responses to 512 KiB, and inventory to 200 active targets. Raw label maps, discovery data, upstream URLs/errors, and credentials are excluded from normalized state. Malformed/oversized inventory or upstream failures degrade only this integration. Setup, credential restrictions, bounds, and live checks are documented in [integrations.md](../integrations.md#prometheus-target-scrape-health).

Verification on Node 22.23.4: `make verify` passed with **90 frontend tests and 420 server/observer/script tests**, production build, and all four Compose configurations. New tests cover fixed authenticated GET access, stable identities, site assignment, conservative health mapping, URL/credential redaction, malformed/duplicate/oversized data, timeouts, disabled/mock behavior, overview failure isolation, and incident grace/recovery. Mock smoke checks passed for `/healthz`, `/api/health`, `/api/overview`, and `/`, with all three new adapters disabled; a resolved Compose check confirmed server-only configuration forwarding.

**Not deployed or live-validated.** This cloud workspace has no homelab credentials. Activation requires the intended Prometheus HTTPS endpoint/trusted certificate, suitably restricted Basic-auth access, accurate site labels, and comparison of target inventory and last-scrape health with Prometheus. See the newer Uptime Kuma checkpoint above; Grafana integration and the existing Phase 1 live acceptance remain pending. Production and monitoring configuration were not changed.

## AdGuard Home status and statistics — local implementation, 2026-10-25

The new server-side AdGuard Home adapter reads only `/control/status` and `/control/stats`. It adds one normalized DNS service with running/protection state, aggregate query/filtering counts, and average processing time for AdGuard's configured statistics window. Domain/client breakdowns are discarded before entering Friday's API, assistant context, or monitoring store. No query-log request, DNS probe, configuration write, reset, or protection toggle was added.

`FRIDAY_ADGUARD_ENABLED` defaults to false. HTTPS origin, credentials, and an explicit site label are required for activation; examples remain empty and base Compose passes configuration only to the controller. Collection has a five-second total deadline, bounded bodies, strict field validation, and sanitized integration errors. Stopped DNS maps to offline, disabled protection to degraded, and existing incident grace/recovery behavior applies. Native AdGuard Basic-auth credentials are not inherently read-only; prefer a dedicated proxy identity restricted to the two GET routes. See [integrations.md](../integrations.md#adguard-home-status-and-dns-statistics).

Verification on Node 22.23.4: `make verify` passed with **90 frontend tests and 407 server/observer/script tests**, production build, and all four Compose configurations. New regressions cover fixed read routes/authentication, privacy normalization, status mapping, seconds-to-milliseconds conversion, invalid/missing data, HTTP/network failures, response/deadline bounds, disabled/mock behavior, overview isolation, and incident opening/recovery. Mock HTTP smoke checks returned 200 for `/healthz`, `/api/health`, `/api/overview`, and `/`; both Omada and AdGuard remained disabled. A resolved Compose check confirmed server-only configuration forwarding.

**Not deployed or live-validated.** No homelab credentials are configured in this cloud workspace. Acceptance needs the intended instance's reachable HTTPS origin/trusted certificate, appropriate credential restrictions, site label, and comparison of real status/counters against AdGuard. One instance is supported; secondary DNS visibility remains future work. Production, DNS, proxy configuration, and the earlier Phase 1 live-acceptance gates remain unchanged.

## Omada read-only inventory — local implementation, 2026-10-25

The Open API v1 adapter now adds observed site summaries and device connectivity to Friday's existing network service inventory. It uses server-only Client Credentials authentication and fixed GET inventory routes; the sole POST obtains an OAuth token. Tokens stay in memory, responses and pagination are bounded, errors are sanitized, and failed inventory collection leaves the other integrations available. No device or network configuration action was added.

`FRIDAY_OMADA_ENABLED` defaults to false. The HTTPS origin, controller ID, client ID, and client secret remain empty in examples and are passed through base Compose only to the controller. Mock mode still needs zero credentials. Site summaries do not invent WAN, VPN, gateway, or routing health. Setup, bounds, status mapping, and acceptance requirements are in [integrations.md](../integrations.md#omada-site-and-device-inventory).

Verification on Node 22.23.4: `make verify` passed with **90 frontend tests and 396 server/observer/script tests**, production build, and all four Compose configurations. New regressions cover multi-site normalization, complete pagination, ID uniqueness, token expiry/rotation, strict configuration, oversized/malformed responses, total deadlines, credential redaction, disabled/mock behavior, and non-fatal integration failure. A temporary mock server returned 200 for `/healthz`, `/api/health`, `/api/overview`, and `/`; the overview reported Omada disabled.

**Not deployed or live-validated.** This cloud workspace has no homelab VPN or Omada credentials. Activation requires the target controller's API/version confirmation, reachable HTTPS address and trusted certificate, a dedicated read-only application scoped to the intended sites, and comparison of actual names/IDs/counts/status to Omada. Phase 1's existing live acceptance requirements remain pending; no production configuration, registry, deployment, or network was changed.

## Production Access rollout correction — 2026-10-19

The first VM102 deployment attempt for security release `d92c632` built successfully but returned `503 access-not-configured` for protected APIs because base Compose did not pass the server-only Access settings. Production was restored to the preserved last-known-good image while the checkout remained on current `main`.

The rollout correction passes `FRIDAY_ACCESS_TEAM_DOMAIN`, `FRIDAY_ACCESS_AUD`, and `FRIDAY_ACCESS_OPERATOR_EMAILS` through base Compose. An empty operator allowlist now provides signed viewer access while denying all operator-only actions. Deployment health requires 200 from both health endpoints and accepts only 200, 401, or 403 from `/api/overview`; a 503 remains a failed deployment.

PR #41 merged and deployed to VM102 as `5cfeae3` on 2026-10-19. Exact-head GitHub CI and VM102 `make verify` passed with 90 frontend tests and 372 server/script tests. The rebuilt controller is healthy without a Docker socket mount: direct `/healthz` and `/api/health` return 200, direct `/api/overview` returns the intended 403, the container can fetch the Access JWKS, and the public Cloudflare route redirects to Access with the configured application audience. The production operator list remains deliberately empty, so signed viewers can read while every operator-only action remains denied. An authenticated browser session was not available for the final signed-viewer request. LAN split DNS still resolves the public hostname directly to the origin proxy, where the origin verifier correctly denies requests without an Access JWT; LAN clients must use a route that traverses Cloudflare Access.

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Intentionally stopped guests, 2026-10-29

A Proxmox guest that is stopped is reported `maintenance` instead of `offline` when its config has `onboot: 0` or carries a `maintenance` or `friday-ignore` tag, so monitoring opens no incident and no notification is pushed for a planned shutdown (for example the Umbrel VM powered off on 2026-10-29). Only stopped guests are inspected, at most sixteen per collection, and a config read failure leaves the guest `offline`. A guest that should autostart but is stopped still reports offline.
## Browser push for the installed PWA, 2026-10-29

The installed Friday PWA can receive incident notifications directly. With `FRIDAY_VAPID_PUBLIC_KEY`, `FRIDAY_VAPID_PRIVATE_KEY` and `FRIDAY_VAPID_SUBJECT` set, `GET /api/notifications/web-push` returns the public key, and any Access-verified user may POST or DELETE their own browser subscription (JSON, same-site only). Subscriptions are validated, capped at 32 and stored at `/data/push-subscriptions.json`; the VAPID private key never reaches the browser. The monitoring runtime pushes the same incident open and resolve events as the ntfy channel, at most five per poll, and a subscription that returns 404 or 410 is removed. The service worker shows the notification and focuses Friday when it is tapped. Adds the `web-push` dependency.

## Incident push notifications (ntfy), 2026-10-29

When `FRIDAY_NTFY_URL` is an https ntfy topic URL, the monitoring runtime pushes one message per newly opened incident and one per resolved incident, at most five per poll with a summary for larger bursts. Delivery runs in the background with a five-second timeout and never fails or delays a poll. Messages carry the already-sanitised incident title, service, host and severity only; the topic URL and optional `FRIDAY_NTFY_TOKEN` stay server-side. Settings shows whether notifications are configured.

## Proxmox host memory pressure — root cause and alerting, 2026-10-29

VM102's hard stop at 2026-10-28 18:34:26 UTC was the Proxmox host `home` out-of-memory killer: the host has 30.6 GiB RAM and 8 GiB swap while guests were allocated about 53 GiB, and the kernel killed VM102's QEMU process (largest RSS, 6.5 GiB). With owner approval the Umbrel VM (110) was powered off with autostart disabled and its allocation lowered to 2 GiB, and VM102 was resized to 4 GiB with a 2 GiB balloon; the host then had about 11 GiB available.

The Proxmox adapter now also reports each node as a `proxmox-node-<name>` host service using the existing read-only token (`/cluster/resources?type=node` and `/nodes/<name>/status`). Memory at or above 85% or swap at or above 80% marks the host degraded, which opens a monitoring incident after the grace period; an offline node is reported offline. Host status failures never break VM inventory.

## VM132 database ownership incident — root cause and alerting, 2026-10-28

Root cause of the 2026-09-22 `supabase-db` restart: on 2026-09-19 17:34 UTC a host-side `sudo chown -R stalin:stalin /srv/production` re-owned the bind-mounted PostgreSQL data directory `/srv/production/supabase/supabase-project/volumes/db/data`. PostgreSQL (container uid 100) then rejected about 114,000 connections with `could not open file "global/pg_filenode.map": Permission denied` for three days, until a PANIC on `global/pg_control` at 2026-09-22 12:36:47 UTC restarted the container, whose entrypoint restored ownership. No manual repair occurred. Never run recursive ownership changes over `/srv/production` on VM132; scope them to a single project directory.

Because that outage went unnoticed, Friday now probes VM132 with one bounded read-only PostgREST request per overview collection (`vm132-supabase`, on whenever the agent registry is enabled, `FRIDAY_SUPABASE_HEALTH_ENABLED=false` disables it). Server errors and failed requests report the service offline, so normal monitoring opens an incident after the offline grace period. No URL, key or response body is exposed.

## Operator-editable site labels — source only, 2026-10-28

Proxmox, VM100 observer, local Docker and legacy endpoint URL services read their site label from `FRIDAY_PROXMOX_SITE`, `FRIDAY_VM100_OBSERVER_SITE`, `FRIDAY_DOCKER_SITE` and `FRIDAY_ENDPOINTS_SITE` (default `Site A`). Operators can override those labels and declare up to eight sites from the Settings workspace. `GET /api/settings/sites` is available to any Access-verified user; `PUT /api/settings/sites` requires the operator role, JSON and a same-site request, and is recorded in the action audit as `settings.sites.update`. Settings persist atomically to `/data/site-settings.json` (`FRIDAY_SITE_SETTINGS_PATH`) and apply at the next overview collection. Declared sites appear in the live overview with status and counts derived only from member services; gateway, network, VPN and latency stay unmonitored. This relabels observed state only and grants no infrastructure action.

## Authoritative branch, hosts, and UI

- `main` is the authoritative FRIDAY build after reviewed feature work is merged.
- Live Proxmox inventory on 2026-09-21 identifies running VM102 (`friday-controller`) as the authoritative controller. VM131 is absent.
- VM100 (`ubuntu-docker`) is managed infrastructure and hosts the separate read-only Docker observer.
- CT108 (`friday-ollama`) is the local Ollama host.
- The deployed frontend is FRIDAY UI v3 under `src/`.
- PR #5 merged Incident Diagnostics + Mobile Dashboard.
- PR #11/#12 merged the multi-provider advisory assistant and local-timeout/identifier-grounding work.
- PR #14 merged the shared session-only Friday Assistant UX.

## 2026-09-21/22 read-only nic1/vmbr1 discovery

Live state differs from the proposed address map. Deployment configuration must use the verified rows below, not the proposed host-number convention, and networking must not be changed to make live state match documentation.

| VM/LXC | Hostname | vmbr1 guest interface | VLAN | nic1 address | Prefix | Gateway | Legacy vmbr0 address | Default route |
|---|---|---|---:|---|---:|---|---|---|
| Proxmox node `home` | Proxmox VE | `vmbr1` over `nic1` | VLAN-aware trunk: 2,10,20,30,40,50,60,70,99 | none | — | none | `192.168.1.211/32` on `vmbr0` | legacy `vmbr0` via `192.168.1.254` |
| VM100 | `ubuntu-docker` | `net1` / `ens19` | 10 | `10.1.10.10` | `/24` | `10.1.10.1` | `192.168.1.124/24` on `ens18` | `ens19` via `10.1.10.1` |
| VM102 | `friday-controller` | `net1` / `eth1` | 10 | `10.1.10.11` | `/24` | `10.1.10.1` | `192.168.1.64/24` on `eth0` | `eth1` via `10.1.10.1` (one default) |
| CT108 | `friday-ollama` | `net1` / `eth1` | 10 | `10.1.10.12` (running-container interface + Proxmox config) | `/24` | `10.1.10.1` (Proxmox config) | `192.168.1.76/24` on `eth0` | configured on `eth1`; route table not directly read |
| VM110 | Umbrel / media | `net1` | 50 | not discovered | unknown | unknown | legacy address not revalidated | unknown |
| VM120 | Identity / Authentik | `net1` / `eth1` | 60 | `10.1.60.10` | `/24` | not verified | `192.168.1.73/24` | not verified from guest |
| VM131 | — | — | — | absent from live inventory | — | — | — | — |
| VM132 | Supabase production | `net1` / `eth1` | 20 | `10.1.20.10` | `/24` | not verified | `192.168.1.71/24` | not verified from guest |

Discovery sources were the local VM100 guest state plus read-only Proxmox cluster/config and QEMU guest-agent reads. `vmbr1` has no IP address and no gateway, as required. No VLAN, bridge, guest network, DHCP, DNS, firewall, Omada, or routing configuration was changed.

The proposed values `10.1.2.211`, `10.1.10.100`, `10.1.20.131`, `10.1.20.132`, and `10.1.70.120` were not verified live. In particular, Proxmox has no `10.1.2.211` interface, VM100 is `10.1.10.10`, VM131 is absent, VM132 is `10.1.20.10`, and VM120 is currently VLAN 60 at `10.1.60.10`.

### Address-reference classification

- **Current runtime/example configuration:** the VM100 observer examples now use verified nic1 `10.1.10.10:3199`.
- **Legacy/rollback configuration:** Proxmox `192.168.1.211` remains the only verified reachable management API path. It is labeled legacy until a nic1 management address is verified.
- **Current CT108 runtime/default/example configuration:** the running-container interface API verifies CT108 `eth1` at `10.1.10.12/24`; VM102 routes to it over `eth1` with source `10.1.10.11` and passes TCP/11434, `/api/tags`, and `/api/chat`. The three agent profile defaults now use `http://10.1.10.12:11434`.
- **Legacy CT108 references:** `192.168.1.70:11434` remains only in intentionally historical design/plan documents and isolated test fixtures. CT108's currently observed legacy vmbr0 address is `192.168.1.76/24`, not `.70`.
- **Test fixtures:** remaining `192.168.1.x` values in `*.test.*` are isolated adapter/provider fixtures and do not configure deployment.
- **Historical documentation:** files under `docs/superpowers/specs/` and `docs/superpowers/plans/` preserve the addresses used by their original approved designs and plans.

## Current deployed controller baseline

On 2026-10-28 (evening), VM102 was returned to `main` with `make update` and runs `cd94dfc` (PR #88 on top of PR #92), with a healthy Friday container. Earlier that day it reported a clean checkout at `0ee4f0a` (PR #91) with a healthy Friday container, a running dedicated cloud-tunnel connector, and CT108 Ollama at `10.1.10.12:11434` answering HTTP 200. On 2026-10-26, an authorized read-only VM102 inspection had confirmed a clean detached checkout at `8dfe66b` with running application commit `608d85b`. The controller is healthy in live mode, retains `FRIDAY_DOCKER_ENABLED=false`, uses `http://10.1.10.12:11434` for all three agent profiles, mounts no controller Docker socket, and routes to CT108 through `eth1` with source `10.1.10.11`. Base plus live plus cloud-tunnel Compose resolves with the Friday data volume only; the dedicated connector remains unpublished.

That 2026-10-26 in-container, read-only service check returned one enabled `proxmox-observer` definition with checksum `2ee1f134d03d61dad46ebb7e0c693e54740bb945cb00d8cc7d3a61b64677f92f`, registry status `ok` with one synced and zero rejected agents, and deterministic routing at confidence `0.98`. Direct Ask used `ollama` with `qwen3:4b-instruct`, remained advisory, and exposed `execution.performed:false`. Grounding nevertheless failed twice: the normalized overview had no sites, 30 online services, and two offline services (`wga-development` and `wga-platform-postgres`), while the model invented Site A, reported incorrect counts or all services healthy, assigned unsupported `critical` severity, and generalized per-service uptime.

That 2026-10-26 result was a failed live acceptance gate. It was resolved by PR #92 and accepted live on 2026-10-28; see the Local Agent Platform Phase 1 section.

## Monitoring, diagnostics, mobile, and assistant — merged

The following capabilities are already part of `main`:

- durable monitoring/incidents with read-only incident APIs;
- fixed, sanitized VM100 observer diagnostics and explicit bounded log inspection;
- purpose-built mobile operations shell at `(max-width: 700px)`;
- multi-provider advisory Friday Assistant;
- one shared browser-memory assistant session across Overview, FRIDAY, and mobile surfaces;
- provider/model/fallback provenance;
- fresh normalized Friday state authoritative over conversation history;
- no server-side assistant conversation persistence;
- no infrastructure execution authority.

PR #14 is merged; the old “finish the Friday Assistant experience” milestone is retired.

## Repository-aware agent platform — in progress

Issue #20 starts the repository-aware, read-only agent milestone. The local registry foundation accepts explicitly registered Git working trees from the server-only `FRIDAY_REPOSITORY_REGISTRY_PATH` JSON file. `GET /api/repositories` returns safe metadata without local paths, exclusion policy, or URL credentials. Path resolution rejects traversal, symlink escapes, secrets, and dependency/build trees. The registry file stays out of Git and the container build context.

Read-only Explorer tools expose Git branch/dirty status, bounded file listings, and bounded text reads for registered roots. The responsive Repositories workspace browses those endpoints without write or execution controls. Paths remain canonicalized and exclusion-checked; reads cap at 64 KiB. Repository-scoped task flow remains unfinished. Source verification does not establish VM102 integration or live acceptance.

## Local Agent Platform Phase 1 — merged and live-accepted 2026-10-28

The original implementation merged to `main` in `ecb0c9e`. The later PR #19 branch is stale relative to current `main`; it must not be deployed over the merged PR #44/#45 baseline.

Implemented behavior:

- Agent Spec v1.1 with deployment-independent `model.profile` references;
- Git `agents/` definitions are authoritative;
- self-hosted Supabase stores only runtime registry state in exactly two tables: `friday_agents` and `friday_agent_registry_state`;
- server-only model profiles `local-router`, `local-general`, and `local-coder` resolve to Ollama;
- explicit/manual agent override;
- deterministic routing for strong registered agent matches;
- bounded CT108 local-router classification for ambiguous requests;
- matched agents execute inference on CT108/local Ollama only and never fall back to cloud assistant providers;
- agent requests receive a fresh normalized Friday overview;
- server-side `POST /api/assistant` automatically routes matched prompts to local agents before the existing assistant provider chain while reusing the same fresh overview;
- manual Agents workspace displays registry state, definition metadata, local provenance, sync control, and direct ask flow;
- agent API surface contains exactly the Phase 1 registry/route/ask operations documented in `API_CONTRACT.md`;
- successful agent replies expose `mode:"local-agent"`, `provider:"ollama"`, model/profile provenance, and `execution.performed=false`;
- there is no agent executor, shell/SSH path, restart endpoint, delete/edit/create API, durable agent memory, task system, approval system, or infrastructure mutation authority.

Task 8 regression gates are part of CI: exact two-table schema validation, local-only matched-agent behavior, no-execution regression, secret-boundary scan, and agent-route/shell safety scans.

Shared-composer implementation tests cover deterministic Proxmox routing, same-overview identity, response provenance, grounded output, no cloud/general fallback after a matched local failure, safe no-match fallback, routing-service failure fallback, and `execution.performed=false`. Live shared-composer acceptance remains pending deployment.

### Rollout continuation and grounding hardening — 2026-10-26, ported 2026-10-28

- Current merged `main` already contains the substantive post-merge PR #19 fixes: CT108 nic1 defaults, removal of sample state from live overview, registry/router/inference deadlines, and the shared state-grounding policy. The stale PR branch will not be cherry-picked.
- VM102 reaches VM132 on TCP/8000 and TCP/5432. Three authenticated PostgREST reads at `2026-10-26T18:06:26Z`, `18:11:33Z`, and `18:16:45Z` returned 200 with exactly `proxmox-observer`.
- On 2026-10-26 the strict database prerequisite was blocked because that VM102 session could not run `SELECT 1` or read the `supabase-db` restart count. On 2026-10-28 an owner read-only check reported `supabase-db` running and healthy with restart count 1, `SELECT 1` returning 1, and authenticated PostgREST returning exactly `proxmox-observer`. The three-snapshot, five-minute-spaced stability gate must still pass before deployment.
- The live-model grounding failure above showed that prompt instructions alone are insufficient for the 4B local model. The original continuation commits (`de567b5`, `c270fc6`) were based on old `main` `7b89228`, so they were ported onto current `main` rather than deployed. The ported code now derives exact service/site/incident/integration constraints before inference, rejects contradictory site/health/incident/severity claims, retries once with machine-derived rejection reasons, and then fails closed with `FRIDAY_AGENT_GROUNDING_INVALID`; it never falls back to a cloud provider. The agent service keeps the sanitized `local-agent-unavailable` error and adds `code: "FRIDAY_AGENT_GROUNDING_INVALID"` so operators can distinguish a grounding rejection from a transport failure; the shared composer returns 503 with that code and `execution.performed=false`. One inference deadline spans both attempts.
- Live acceptance on 2026-10-28 after deploying `771cc9d` to VM102: the controller was healthy and routing selected `proxmox-observer` at `0.98`, but every direct Ask failed closed with `FRIDAY_AGENT_GROUNDING_INVALID`. The live adapters label every service `site: 'Site A'` while `sites` is empty, so the original rule rejected a faithful site label; "not fully healthy" and a "Critical Observations" heading also tripped the health and severity rules. The rules now accept site labels carried by services, ignore negated health phrases, flag `critical` only as an asserted severity, and do not treat "no incident count" as asserted incident absence. Asserting no incidents without incident data is still rejected. After `041ec3a` was deployed, one live Ask correctly failed closed on "no active incidents" and a second answered with correct counts, offline services and site label, but still let through "two critical container services" and "No active alerts or incidents". The severity rule now also matches `critical` up to two words before its noun, and the incident rule matches incident absence folded into "alerts or incidents". These follow-up rules are source-verified only.
- On the real request path (monitoring enabled), the overview sent to the local agent carried every monitoring incident, including resolved history and raw evidence. With 23 incidents (19 resolved) the prompt reached about 9,800 tokens against the 8,192-token `local-general` context, so CT108 returned `exceed_context_size_error` and every matched local-agent request failed as `local-agent-unavailable`; current `main` also exceeded the limit. The local agent now receives only open incidents with compact fields plus `resolvedIncidentCount`; grounding checks use the same view. Against the same live overview and CT108, the prompt dropped to about 4,100 tokens and three of three direct asks answered with correct service counts, offline services and four open high-severity incidents.
- PR #92 review follow-up: complete multiword declared site labels are matched before unknown site labels are flagged, a negation anywhere earlier in the sentence ("No services are critical.") negates a critical-severity claim, and health claims are checked against the sites or services the sentence names, falling back to the whole environment only when it names none.
- Test-first coverage proves one corrective retry, fail-closed behavior after a second invalid draft, the surfaced grounding code through the agent service and shared composer, no cloud provider calls, and a single shared inference deadline. On 2026-10-28, Node 22.22.1 `make verify` on the ported branch passed 139 frontend tests, 657 server/observer/script tests, the production build, and all six Compose validations. This is source verification only; the grounding guard is not deployed or live-accepted.

### Live acceptance — 2026-10-28

- PR #92 merged as `407fd85`; VM102 returned to `main` with `make update` and is healthy.
- A production-path direct Ask, using the monitoring-decorated overview with 23 incidents, answered on the first attempt locally with 30 online and 2 offline services, both offline service names, `Site A`, and four open `high` incidents; `execution.performed=false`.
- Owner-supplied evidence: the shared composer routed to the local agent with `ollama · qwen3:4b-instruct` provenance and grounded facts, and desktop/phone Agents layouts showed no action controls. The managed-cloud checker passed all eight gates.
- Follow-ups: live adapters hardcode `site: 'Site A'` on every service while no sites are declared (P6 normalization); VM102 had an unexplained hard power-off at about 18:34Z on 2026-10-28 with no shutdown or OOM lines in its journal; the 2026-09-22 VM132 PostgreSQL ownership incident has not been root-caused.

### Verification result — 2026-09-22

- `make verify`: **passed** after the CT108 nic1 default migration, in a temporary Node 22 + Make + Docker Compose tool container because the discovery host lacks host-installed Node/Make.
- Frontend: **85/85 tests passed** across 19 files.
- Server/observer/scripts: **225/225 tests passed**.
- Production TypeScript/Vite build: **passed**.
- Base, live-overlay, and observer Compose validation: **passed**.
- Network configuration regression: **passed** — all three active agent defaults resolve to `10.1.10.12:11434`, no active default uses `192.168.1.70`, and VLAN 80 remains absent.
- VM100 observer nic1 health: `http://10.1.10.10:3199/health` returned 200.
- VM102 Friday nic1 health: `http://10.1.10.11:3010/healthz` returned 200 in live mode; `/api/overview` returned 200.
- Agent list, registry status, and `proxmox-observer` detail on the deployed controller: **200** on the later 2026-09-22 inspection. The status reports one synced agent, no rejections, and `sourceCommit:null`; the agent checksum matches the checked-in definition.
- VM102 `make preflight`: **passed** on 2026-09-22 with a process-local Git safe-directory override; the deployed checkout is clean on the PR branch at older commit `a12b540`.
- `make update`: **not run** because the script intentionally switches to `main`, which would not deploy this unmerged PR. The repo-local deployment skill permits an explicitly reviewed `docker compose up -d --build friday` for a PR checkpoint.
- `make health`: **not run after a new deployment**, because the PR head has not been deployed.
- Live old-build route/ask/composer comparison: `/api/agents/route` selected `proxmox-observer` with confidence `0.98`; direct `/api/agents/proxmox-observer/ask` returned `mode:local-agent`, `provider:ollama`, model `qwen3:4b-instruct`, and `execution.performed:false`. The shared `/api/assistant` returned Groq/cloud provenance and no agent ID, confirming the running build predates the PR head's agent-first composer change.

### Deadline hardening — 2026-09-24 PR verification

- GitHub PR #19 remains open/draft at `0e241b4`, merge state `CLEAN`; its `verify` check passed. The timeout changes are published in the PR but not deployed to VM102 yet.
- Added a 10-second Supabase registry request deadline and configurable local-router inference (15 seconds by default) plus local general/coder agent inference (90 seconds by default). Only the model-profile deadlines are environment-overridable through their corresponding `FRIDAY_AGENT_LOCAL_*_TIMEOUT_MS` variables. Existing general Friday assistant provider timeouts are unchanged.
- A stalled registry request maps to the existing sanitized registry-unavailable error. A stalled local router safely permits normal assistant fallback; stalled matched-agent inference returns `local-agent-unavailable` and never invokes cloud providers.
- TDD regressions cover profile defaults/overrides, stalled registry requests, stalled matched inference with no cloud fallback, and stalled routing with safe general fallback. The legacy config assertion now includes the profile timeout.
- `make verify`: **passed** from the current working tree in a temporary Node 22 Alpine tool container: 85/85 frontend tests, 232/232 server/observer/script tests, TypeScript/Vite production build, and all three Compose validations.
- The deployed health and direct-Ask evidence above are from VM102 `127af8a`, before commit `0e241b4`; they do not validate the timeout patch or the grounded-overview correction at `1f7bc0a`.

### Agents UI acceptance — 2026-09-21

Automated component and responsive CSS suites passed. Coverage confirms registry status/list/detail rendering, model/profile, scope, tools, checksum, registry sync, manual Ask, shared composer integration, and absence of Restart, Execute, Delete, Approve, Shell, Edit agent, and Create agent controls. Live desktop/mobile visual acceptance and manual Ask remain pending because the deployed registry is unavailable.

### CT108/Ollama migration status — verified 2026-09-22

- Proxmox configuration discovery: **passed** — CT108 `net1` is `eth1`, attached to `vmbr1`, VLAN 10, configured as `10.1.10.12/24` with gateway `10.1.10.1`; legacy `eth0` has no gateway.
- Running-container interface verification: **passed** through the read-only Proxmox LXC interfaces API — CT108 reports `eth1=10.1.10.12/24` and `eth0=192.168.1.76/24`.
- Authoritative controller path: **passed** — VM102 reports `10.1.10.12 dev eth1 src 10.1.10.11` and exactly one default route, via `10.1.10.1 dev eth1`.
- TCP/11434 from VM102: **passed**.
- `GET /api/tags` from VM102: **passed** — includes `qwen3:4b-instruct` and `qwen3:4b`.
- `POST /api/chat` from VM102: **passed** with `qwen3:4b-instruct`, `done:true`, and non-empty assistant content.
- Source configuration migration: **performed** — all three active agent profile defaults use `http://10.1.10.12:11434`; deployed VM102 `.env` migration remains part of the deployment checkpoint.

### Supabase rollout blocker — observed 2026-09-22

- VM132 `supabase-prod` is reachable from VM102 at verified nic1 `10.1.20.10`; the route uses VM102 `eth1` via `10.1.10.1`.
- The Supabase gateway is listening on TCP/8000, PostgreSQL/Supavisor ports are listening, and the service-role credential is present without being printed.
- Earlier on 2026-09-22, `supabase-rest` was unhealthy, authenticated service-role REST returned 503, and authenticated PostgreSQL queries failed because the server could not read `global/pg_filenode.map` (`Permission denied`). The database then restarted automatically once at 12:36:47 UTC.
- Later checks returned `supabase-rest:healthy`, service-role REST 200, successful authenticated SQL queries, and no additional restart. The data directory owner was observed as UID/GID `1000:1000` before restart; after restart the top-level directory and `pg_filenode.map` were UID 100, matching the PostgreSQL process UID. The mechanism that changed ownership has not been established, so this recovery is not yet evidence of stability.
- Both Friday registry tables exist in the `postgres` database with one agent row and one state row. Read-only inspection on 2026-09-22 confirmed exactly the two `friday_` tables, all expected columns/types/nullability/defaults, and each primary key against `supabase/migrations/202608300001_friday_agent_registry.sql`; no schema migration write is currently needed.
- The existing Supabase deployment `.env` is mode `0664`; this pre-existing credential-file permission issue was observed but not changed because infrastructure permission repair is outside this Friday application task.
- No VM102 `.env` migration, PR-head controller deployment, shared-composer live acceptance, or visual UI acceptance was performed. Investigate the ownership incident and validate sustained Supabase query readiness before deploying.

### Remaining Phase 1 rollout acceptance

Before PR #19 is ready to merge:

1. establish sustained Supabase SQL/PostgREST readiness and investigate the UID/GID ownership incident; the existing two-table schema has been validated and needs no migration write;
2. arrange VM102 access to the owner-only `.env` and clean checkout, preserve `.env`, then update the three agent URLs to `http://10.1.10.12:11434` without changing unrelated integration credentials;
3. fast-forward VM102's PR branch to the reviewed GitHub head and rebuild only the Friday controller with base Compose; do not use `make update`, which switches to `main`;
4. run `make health` and verify normal health/read-only integrations remain unchanged;
5. sync the registry and verify list, detail, and status against the deployed definition checksum;
6. verify Proxmox routing, direct Proxmox agent ask, and shared-composer automatic routing all return local Ollama provenance and `execution.performed=false`;
7. complete desktop and phone Agents workspace acceptance, then obtain explicit approval before merging PR #19.

Do not represent those live rollout checks as complete until they are actually performed.

## VM100 observer security boundary

Docker's native TCP API must never be exposed. Inventory/diagnostic IDs come from sanitized current inventory. The observer must never gain restart, stop, kill, exec, remove, image creation, volume mutation, network mutation, archive write, or arbitrary Docker-path proxy behavior.

## Not implemented yet

- Omada WAN/VPN/routing health (site/device inventory is implemented above; live acceptance remains pending).
- AdGuard live acceptance and secondary DNS visibility (single-instance status/statistics adapter is implemented above).
- Live acceptance of the Prometheus, Uptime Kuma and Grafana adapters.
- Application authentication and RBAC.
- Durable action audit/action request store.
- Human approval queue and global automation kill switch.
- Agent tool executor or infrastructure mutation endpoints.
- Durable agent memory/task orchestration.
- Notification delivery beyond ntfy push (email, chat, escalation, per-user routing).
- Voice input pipeline.

## Next product milestone

Local Agent Platform Phase 1 is live-accepted. Next, fix site normalization, continue read-only adapter coverage and design authentication/RBAC + durable audit + approval + kill-switch prerequisites before any controlled action work.

## Safety gate

Do not implement infrastructure-changing agent or assistant actions until authentication, role policy, explicit approval, durable action audit logging, and the global automation kill switch exist and are tested.
