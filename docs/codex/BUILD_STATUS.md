# Friday Build Status

## Public multi-site Authentik OIDC foundation — draft PR #60 (source-only)

Friday's Authentik design now explicitly includes **public internet sign-in**
for Friday, TechTactics and future third-party/client websites.
One planned public HTTPS Authentik identity hub can serve independent
per-application OIDC issuers, client registrations, strict redirect URIs,
and Authentik MFA/enrollment. The source-only
`createPublicOidcFlow` implements server-side multi-application
authorization-code + PKCE S256 initiation and server-side callback
exchange with one-use five-minute state, nonce, client-bound authorization,
pinned provider discovery/RS256 JWKS, and strictly checked signed ID
token subject, issuer, audience and expiry. Per-app confidential
credentials stay server-side; user-facing output excludes tokens and
secrets. Each registered app has an independent client, issuer slug
and redirect; arbitrary request-supplied redirect/issuer/client cannot
be accepted.

AuthentiK public SSO is a **separate, lower-privilege website login**
from the dormant P8 privileged `friday_control` token and HomeLab
role/kill/audit requirements. Cross-domain sites share the Authentik
login provider but **not** the site's session cookie or roles.
Legacy sites may use Authentik single-app forward auth.
No actual Authentik VM120, Cloudflare tunnel, public login hostname,
provider registration, secret, session store, secure cookie,
callback HTTP route, site account provisioning, deployment or
HomeLab command has been configured or contacted. An owner-controlled
atomic distributed transaction store, validated sessions, signout,
live OIDC verification, security acceptance and ingress controls are
prerequisites to public release. See `docs/authentik-public-sso.md`.
This draft PR is stacked on #58. CI result pending.


## P8 Authentik human identity adapter — draft PR #58, source only

Friday now has an **opt-in internal Authentik OIDC access-token verifier**,
complementing (not replacing) the signed Cloudflare Access boundary.
The source-only `createAuthentikAccessGate` pins an HTTPS provider-specific
issuer, exact OIDC discovery/JWKS endpoints, client audience, RS256 signing
keys and a dedicated signed `friday_control` access-token scope.
It fails closed on unsupported global issuer, HS256, wrong issuer/audience,
unsigned/expired/unscoped/malformed/service tokens, malicious discovery,
invalid keys, and missing config. There is no secret or source of roles in
claims. Authentik subjects are qualified by an issuer-specific hash to
prevent Cloudflare subject/role collisions.

The disabled-by-default HomeLab safety-runtime can *explicitly* select
the Authentik verifier for isolated tests, with no request-based provider
choice or fallthrough to Cloudflare. It still needs server-owned exact
subject/role bindings, owner-private append-only audit and five-minute
revocable kill switch. Verified identity expiration is rechecked after
async diagnostics/approval boundaries; roles and kill gates continue to
be revalidated. All allowed fixture actions remain non-executable.

Test-first Authentik JWT, discovery/JWKS, boundary and synthetic signed
Operator/Administrator/Viewer integration cases cover two-person approval,
authorization failures, no cross-provider fallback, session expiry,
and emergency kill. No live Authentik/Cloudflare/HomeLab connection
was made; there is **no OIDC browser login/callback**, cookie/session,
HTTP endpoint, real role provisioning, executor or production deployment.
Full confidential code+PKCE login, MFA/account-lifecycle acceptance,
trusted reverse-proxy boundary and live OIDC interoperability remain
future tasks. See `docs/authentik.md`. This draft stacks on PR #56.
Independent review and CI evidence are needed before production integration.


## P8 private read-only proposal lifecycle lookup — draft PR #56 (source only)

A bounded `readLifecycle({requestId,at})` projection in the owner-private
append-only audit store validates the original symbolic staging proposal
against its sole terminal decision event, expiration, actor attribution,
action target, event timestamps and strict five-minute lifetime.
It denies missing, orphaned, corrupt, symlinked, forged, incomplete or
inconsistent records instead of returning partial results. Historical
approval is a non-executable audit state, never authority to restart.

The dormant `getRequestStatus` control requires a verified Cloudflare
Access human identity and currently effective server-owned rights.
Only the original proposer, while retaining `action.propose`, or an
Administrator with `action.approve` may inspect a request.
Viewer/Agent and unrelated Operators are denied. It repeats both policy
and kill-switch checks before and after asynchronous storage reads,
returns pending/expired/approved/rejected/withdrawn statuses, and never
returns actor hashes, raw audit data, emails, JWTs or confirmations.
Every result explicitly states `execution.performed:false`.

Test-first coverage includes private-store reload, terminal outcomes,
clock rollback/expiry, tampered files and symlinks, role scope, privacy,
unexpected audit failure, mid-read revocation, and the real dormant
file-backed kill/role composition using synthetic identities. No live
HTTP route, UI, HomeLab connection, executor, deployment or new secret
is added. PR #56 is stacked on draft PR #54. CI and owner review are
required; production identity, request status UI, multi-process
consistency, log retention and P9 independent action gates remain open.


## P8 terminal proposal decisions — draft PR #54, source only

The internal dormant HomeLab approval workflow now supports **exactly one**
durable terminal outcome for a symbolic staging restart proposal:
- Approved by a *different* signed Administrator.
- Rejected by a *different* signed Administrator.
- Withdrawn by the verified original proposer.

All three decisions use the *same* create-only,
fsynced `<requestId>.restart-decided.json` audit file, with an explicit
validated `outcome` field. Competing decisions cannot each persist their
own separate terminal file. Pending-approval scans exclude every terminal
outcome and fail closed on orphan, corrupt, missing, misattributed or
inconsistent events. An expired request has no accepted final decision.
A successful result always states `execution.performed:false`.

New test-first audit, controller and wired dormant-runtime tests cover
signed role scopes, same-person denial, wrong-owner denial, confirmation,
expiry, replay prevention, simultaneous approve/reject/withdraw races,
audit reload and immutable storage, revocation/kill-gate denial,
and corrupted decision records. This is not connected to production
server/index.mjs and creates no real HomeLab executor.

**Dependency:** draft PR #54 is stacked above the approved source
branch from prior PR #53. PR #48 is merged on main and PRs #50-53
were merged into their parent development branches; PR #49 remains
awaiting main merge. Do not deploy or infer live approval availability
from these source changes. CI/review gates remain mandatory.


## P8 dormant safety-boundary composition — draft PR #53 (source only)

The standalone internal `createDormantHomeLabRuntime` composes Friday's
already-tested signed Cloudflare Access human identity, exact role/target
policy, owner-private short-lived revocable **file-based role bindings**,
durable private action audit, and **owner-private five-minute kill switch**.
The kill gate and its five regression tests are copied byte-for-byte from
unmerged PR #48 to enable exact-head integration testing in the stacked PR
chain; this is a deliberate temporary overlap, not a competing rewrite.

Absent explicit `enabled:true`, the factory creates no audit directory,
reads no role/kill files, makes no infrastructure connections, and returns
a disabled control. An opted-in *internal fixture* still needs valid private
files, signed human JWT, role permission and kill arm **at every authorization
boundary**. All actions remain symbolic `staging-canary` proposals or
durable, non-executable two-person approval records. No HomeLab Docker,
Proxmox, shell, SSH, container restart, public API, UI, AI executor, real
target mapping, secret or production deployment is introduced.

Tests exercise default-disable, missing/invalid private files, signed
operator/administrator/viewer flows, disarm and expiry, role downgrade, and
disarming during read-only diagnostics, plus PR #48's original kill tests.
PR #53 stacks on draft #52 -> #51 -> #50 -> #49. PR #48 remains separate
until a reviewed integration/merge decision resolves the duplicate file
diffs. Exact-head CI and owner/security review required. P8 remains
**incomplete**: trusted live identity lifecycle, production kill control,
full approval state machine, multi-instance revocation and action-boundary
audit/verification need independent work.


## P8 async reauthorization — draft PR #52, source only

The dormant HomeLab control now rechecks the verified Access JWT subject's current
server-owned role and target policy, plus the independent automation gate,
after asynchronous audit reads, queue scans, diagnostics, assistant inference,
and before/after durable audit appends. This closes a stale-permission response
gap during role changes or kill-gate revocation. Tests cover role downgrade
during the approval read, pending queue scan, diagnostic read and assistant
inference, and disarming during a proposal audit append.

A successfully fsynced append cannot be rolled back if revocation occurs
mid-write; the post-write recheck denies a stale success response but the
historical event can exist. No executor exists and any future action must
independently revalidate identity, policy, approval and kill status at execution.
This draft depends on PR #51 -> #50 -> #49; the separate PR #48 is unmerged.
P8 is incomplete, with no merge, deployment, runtime binding, new credentials
or HomeLab contact.


## P8 private operator role provisioning — draft PR #51, source only

A small internal adapter reloads an owner-private canonical JSON role
policy on every permission check, expires each trust snapshot within
24 hours, rejects symlinked/insecure/malformed/duplicate-key records,
and delegates actual Viewer/Operator/Administrator/Agent capability
intersections to PR #49's exact role policy. Source integration tests
on PR #50's dormant HomeLab controller exercise immediate downgrades,
administrator revocation, and fail-closed missing policy while retaining
durable audit and non-execution semantics.

This is a stacked **draft PR #51**, based on draft #50 which depends on
draft #49; PR #48 is a separate kill-switch foundation. It is not
deployed or configured, does not create UI/API mutation or an executor,
and makes no HomeLab connections. CI evidence and separate owner/security
review are required; P8 is **not yet complete**. Real trusted identity
provisioning and rotation, multi-node revocation semantics, full
approval lifecycle, and global production control policies remain
pending.


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


## Cloud automation API — deployed and live-validated, 2026-10-26

Prepared the user-selected `friday-api.mytechtactics.com` connection: an optional separate port 3011 listener accepts only signed, explicitly allowlisted Cloudflare Access service identities for a dedicated application audience. It exposes authenticated health plus cached overview, incidents and monitoring history. All writes, query strings, repository/AI/diagnostic endpoints and other routes are denied. The existing UI's human/operator authentication remains separate. No infrastructure calls are triggered by cloud reads.

The listener defaults off, fails closed without authentication settings, bounds responses, and emits sanitized structured request logs. `compose.automation.yaml` publishes only VM102 loopback for a host-local connector and rotates controller logs. A dedicated container tunnel overlay (`compose.cloud-tunnel.yaml`) publishes no host port and mounts its token from a protected file; a host-local tunnel ingress template and proxy-aware, secret-safe acceptance checker accompany the [activation runbook](../cloud-connection.md). The default test commands now include the previously omitted `server/security/*.test.mjs` suite.

Validation: Node 22 `make verify` passed **90 frontend and 453 server/observer/script tests**, production build and five Compose configurations; the subsequently added dedicated-tunnel overlay also passed Compose validation. Signed-token integration tests verify permitted reads and denial of browser identities, other service identities, missing credentials, writes, queries and unsupported routes; audit sanitization, unavailable caches and response bounds also pass.

**Live deployment passed.** The dedicated `Friday Cloud API` Access application permits only the exact `friday-cloud-reader` Service Auth identity. Its remotely managed `friday-cloud-api` tunnel routes to the unexposed Docker listener at `http://friday:3011`; Cloudflare reports the tunnel healthy with four active connections. The existing website application remains separate and still redirects unauthenticated visitors to Access.

VM102 is checked out at deployment-record commit `5021012` from `codex/friday-cloud-api-read-adapters`; its running image contains application commit `608d85b`. Friday and the dedicated connector are healthy. Public acceptance returned 200 for authenticated health, overview, incidents, and monitoring history; 401 without the service token; 405 for a write attempt; and 404 for the excluded repositories route. Live identity, mode, service inventory, and overview timestamp checks passed. The tunnel token remains in its owner-only runtime file.

**Managed cloud acceptance and credential cleanup passed on 2026-10-26.** The runtime reports its restricted hostname policy enforced, `FRIDAY_CLOUD_URL` ready, and both hostname-scoped service credential bindings ready. Running `node scripts/check-cloud-connection.mjs` from that runtime reproduced all seven expected results: four authenticated 200 reads, unauthenticated 401, write rejection 405, and excluded repository route 404. An authorized VM102 session then removed only the temporary owner-only service-token copy at `/home/stalin/.config/friday-cloud-api/client.json`; the separate mode-600 tunnel-token runtime file was preserved. VM102 `make health` passed, and the cloud acceptance checker reproduced all seven results after cleanup. PR #45 remains draft pending final owner review.

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

On 2026-09-24, read-only SSH confirmed VM102 (`friday-controller`, `10.1.10.11`) has a clean checkout at `127af8a` on the PR branch. This is behind the GitHub PR head `1f7bc0a` and does not include the current uncommitted timeout patch. VM102 `make preflight` completed without blocking errors and `make health` reported the Friday container running with health/overview endpoints OK.

Live API checks from VM102 on 2026-09-24 returned one enabled `proxmox-observer` definition with the checked-in checksum, registry status `ok` with one synced and zero rejected agents, and deterministic `/api/agents/route` selection of `proxmox-observer` at confidence `0.98` for “Summarize the current Proxmox health.” Direct Ask returned local provenance (`ollama`, `qwen3:4b-instruct`) and `execution.performed:false`, but failed grounding: it invented Site A/B networks, gateways, device counts, resource metrics, and incident history absent from the normalized live overview. It also conflated legacy and current VM100 observer addresses. This is the production failure addressed by PR head `1f7bc0a`; it is not deployed yet. Shared-composer live acceptance remains pending on a grounded build.

Do not infer that GitHub's green check on `1f7bc0a` validates either the uncommitted timeout changes or the currently deployed `127af8a` image. The production agent endpoint remains the verified CT108 nic1 address `10.1.10.12:11434`; the timeout patch has not been deployed.

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

## Local Agent Platform Phase 1 — implemented in draft PR #19

Source branch: `feature/friday-local-agent-platform-phase1-20260830`.

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
- Grafana native adapter (Prometheus target scrape health and Uptime Kuma monitor metrics are implemented above; live acceptance remains pending).
- Application authentication and RBAC.
- Durable action audit/action request store.
- Human approval queue and global automation kill switch.
- Agent tool executor or infrastructure mutation endpoints.
- Durable agent memory/task orchestration.
- Notification delivery.
- Voice input pipeline.

## Next product milestone

Finish **Local Agent Platform Phase 1 live rollout and acceptance** without adding execution authority. After that, continue read-only adapter coverage and design authentication/RBAC + durable audit + approval + kill-switch prerequisites before any controlled action work.

## Safety gate

Do not implement infrastructure-changing agent or assistant actions until authentication, role policy, explicit approval, durable action audit logging, and the global automation kill switch exist and are tested.
