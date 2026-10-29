# Friday — Ordered Finish Queue

## First: merge the combined development candidate to `main`

1. Finish the exact-result checks on
   `integration/friday-development-main-20261029`, whose payload is
   `feat/friday-operator-auth-20261011` at `dc64d49` reconciled onto
   current `main` at `52193d1`.
2. Push a replacement PR to `main` and require green Linux exact-head CI.
   Do not merge `feat/friday-group-workspace-20261013` separately; its
   squash payload is already present in the combined development head.
3. Merge the replacement PR to `main`, fetch the resulting merge commit,
   and verify the merge ancestry and required checks.
4. Only then begin the separately authorized production checkpoint:
   inventory VM102, preserve and back up its private `.env` and current
   data mapping, run preflight, deploy the merged `main`, and run health,
   Access, API, UI, monitoring and rollback acceptance.
5. Rotate `friday-cloud-reader` with bounded overlap after the merged
   deployment target is known; update the managed caller binding without
   exposing the secret, prove authenticated reads, then retire the prior
   credential.

No source verification, PR creation, or CI result by itself authorizes
an unmerged production deployment.

## Installable Friday PWA — test source, stage separately

- New manifest, secure-origin registration, 180/192/512 launcher icons,
  install prompt, SW and no-private-cache policy are implemented
  in the draft PWA feature branch. `docs/pwa.md` details rollout.
- Check exact-head CI, Lighthouse/DevTools installability over HTTPS,
  iOS/Android standalone launch, Cloudflare Access login/logout and
  offline/online read behavior. Cache Storage must never include private
  HTML, Access identity pages, API/Memory/Tasks or credential material.
- Preserve the owner's parallel production deployment. Do **not** mix
  unreviewed PWA changes into live VM102. Staging browser acceptance
  and owner-approved deployment remain separate.


## Next: activate signed private Tasks/Memory reads through reviewed staging

- Source-only GET routes are now available via `createFridayServer({workReadBridge})`.
  `server/index.mjs` does not inject them: all `/api/work/*` still
  return 404 without explicit secure server composition.
- The GET-only repository adapter is implemented behind a fixed
  `https://supabase.mytechtactics.com` origin and needs a separate
  SELECT-only database credential. Inspect the actual effective DB role
  grants and deny write-capable service tokens in the runtime configuration.
- Verify and register the four owner-selected project records on VM132
  after a separate backed-up, authorized database change. Inspect the
  actual `friday_projects` rows rather than trusting UI labels.
- Bind independently signed Cloudflare Access `sub` to exact current,
  revocable private file grants; never put email/subject/JWT in Git or
  rely on browser role headers. Provision an independently limited
  **read-only** database credential, log denial/read outcomes safely,
  verify cross-project isolation and expiry in staging.
- After approvals, connect the backend and desktop/mobile Tasks/Memory
  views, then pass live Access, browser, permission and rollback tests.
  No HomeLab actions, agent tools, approval writes, or deployment granted
  by this source-only API work.


## Staged four-project catalog registration — pending owner-reviewed apply

- Code now provides `createFourProjectCatalogBootstrap` and
  `createSupabaseProjectCatalogRepository`: exact metadata, bounded
  read-only inspection by default, opt-in insert-only subset and
  fresh-fingerprint check. No live runtime imports these modules.
- An authorized production change must begin with backup/restore
  verification and a fresh VM132 `friday_projects` inspection.
  Approve precisely the four owner-selected fixed new IDs/names,
  preserve unrelated catalog records, then perform a transaction-safe
  insert and verify authoritative rows. No automatic deployment.
- Only afterward convert real verified project rows into scoped
  `createFourProjectEnrollment` policy input, match a genuinely
  signed Access JWT `sub` to the Cloudflare identity, and provision
  revocable owner-private policy outside Git. Do not grant server
  execution or task writes.
- Runtime signed GET-only Tasks/Memory HTTP wiring, audit, browser
  access and production deployment remain separate release gates.

## Owner approved four-project read-only user scope — gated by database IDs

- Selected: Friday AI OS, TechTactics, Web Growth Agents and App
  Builder for read-only Tasks + project Memory. Their *logical*
  selection keys are defined in `server/work/four-project-enrollment.mjs`.
- Before provisioning, verify four **distinct actual** work
  `project_id` values on VM132; existing group IDs alone do not
  establish work-item project IDs. Cross-check the verified Cloudflare
  user UUID with a signed Access JWT `sub` at the private runtime.
- Prepare short-lived canonical hashed-subject policy *outside Git*
  using the owner-controlled reader grant file; no secrets or personal
  IDs in source code. Stage deny on other users, project mismatch,
  expiry, replacement and removal. Then explicitly approve
  runtime/API/UI wiring and VM102 rollout.
- No approvals, agent tools, HomeLab execution or administrative
  scope accompanies this read-only selection.


## Trusted user binding on dormant Phase 2B reader (2026-10-27)

- Stacked draft adds a private, expiring, subject-digest based
  grant source feeding the existing signed human Cloudflare Access
  Phase 2B reader. This is source-only: no actual user's verified
  subject or project grants have been enrolled.
- Next: an owner/operator must supply and verify the intended
  Access `sub` and authorized project(s), provision the private
  policy outside Git, then stage signed good-user, denied-user,
  cross-project, expired and revoked acceptance.
- After identity/grant lifecycle and audit review, wire explicit
  **read-only** Tasks/Memory routes to VM102, implement desktop/mobile
  views and validate RLS. Approval mutations and HomeLab execution
  remain separate and disabled.


## Phase 2B Tasks/Memory signed read bridge candidate (2026-10-27)

- A **default-off internal** bridge now projects scoped task summaries and
  memory search only after signed human Cloudflare Access authentication
  and trusted server-derived grants. No HTTP route is connected; nothing
  is visible in the live Tasks/Memory workspaces yet.
- Next: create and review an owner-managed membership and project-grant
  repository, revocation and operator audit; add opt-in read-only routes
  and real desktop/mobile pages only after cross-project integration
  tests. Persisted Tasks/Memory writes, decisions/approval workflows
  and background agent execution require independent authorization gates.
- Preserve existing read-only cloud automation API and disabled
  HomeLab executor, and do not expose Supabase service keys in React.


## Production UI integrity and Applications release candidate (2026-10-27)

- Source-only feature branch `feat/real-apps-workspaces-controls-20261027`
  replaces the fake Approvals badge/Automation switch, connects
  Applications to honest read-only normalized inventory and displays
  explicit unconnected states for Tasks, Memory, Approvals, Audit and
  Settings rather than repurposing unrelated service data.
- Complete exact-head CI, responsive/browser checks and reviewed
  VM102 release before calling the UI correction deployed. Do not
  infer application endpoints or launch URLs from status descriptions.
- **Next functional milestone:** connect Phase 2B `server/work/`
  services under verified, server-derived identity and exact project
  grants; implement paginated read-only task/memory views first,
  then independently authorized/audited task mutations and decision
  approval. Reconcile the three-group UI from PR #33's feature-base
  branch rather than assuming it entered `main`.
- Keep HomeLab executor and automation toggle OFF; public Authentik
  portal activation and infrastructure action approvals have separate
  release requirements.


Work from top to bottom. Do not skip safety prerequisites to reach action features sooner.

## User-requested cloud access — completed

The read-only automation API at `friday-api.mytechtactics.com` is deployed on VM102 behind its dedicated Cloudflare Access application and tunnel. The tunnel is healthy. The managed cloud runtime has an enforced exact-host policy and ready URL/service-credential bindings; `scripts/check-cloud-connection.mjs` passed all authenticated reads, denial, write-rejection, and excluded-route checks on 2026-10-26. The temporary VM102 service-token copy was removed, the tunnel-token file was preserved, and both VM102 health and cloud acceptance passed afterward. PR #45 was merged to `main` on 2026-10-26 (`7b89228`); the running VM102 image is separately recorded at application commit `608d85b`, so do not infer a later deployment from the merge. PR #46 (fail-closed cloud snapshot shape validation) merged as `c0e5024`. The acceptance checker now also requires query-suffixed-route rejection and bounded overview freshness (at most five minutes old, at most one minute in the future); rerun it against the live endpoint after the next reviewed deployment. Rotate or replace the current service token before its documented 2026-11-24 expiry. Do not expose the UI port as the automation origin or grant deployment/execution tools through this API.

## P0 — VM100 observer baseline — completed; nic1 example migrated

- VM100's verified nic1 address is `10.1.10.10/24` on VLAN 10; observer port `3199` remains the read-only Docker boundary.
- `192.168.1.124` is the legacy vmbr0 rollback address.
- VM102 uses the observer with local controller Docker observation disabled in normal production operation.
- Docker's native TCP API remains unexposed.

## P1 — Monitoring & Incidents — completed and production validated

- Durable monitoring/incidents are part of `main`.
- Proxmox + VM100 observer feed read-only normalized state.
- Monitoring never restarts, stops, starts, execs into, or modifies managed infrastructure.

## P2 — Incident Diagnostics + Mobile Dashboard — merged

PR #5 is merged. Remaining observer/real-device checks are production polish, not missing feature implementation.

## P3 — Multi-provider Friday AI — completed and production validated

PR #11 and PR #12 are merged. Preferred assistant chain remains:

```text
Groq -> Gemini -> CT108 GPU Ollama -> deterministic local analysis
```

The assistant receives normalized Friday state and no Docker, Proxmox, shell, network, deployment, or remediation tools.

## P4 — Shared Friday Assistant experience — completed and merged

PR #14 is merged.

Completed behavior:

- one in-memory Friday conversation shared by Overview, FRIDAY, Mobile Home, and mobile FRIDAY;
- newest bounded completed exchanges supplied as provider context;
- provider/model/fallback provenance;
- fresh normalized state authoritative over conversational context;
- browser-only Clear session and no server/database conversation persistence;
- advisory-only language and no execution authority.

The old “finish Friday Assistant experience” milestone is retired.

## P5 — Local Agent Platform Phase 1 — completed and production validated

The Phase 1 implementation is in `main`. The old PR #19 head is stale relative to the merged security and cloud-API work and must not be used as a deployment source.

Implemented source behavior:

1. Git under `agents/` is authoritative for agent definitions and enabled state.
2. Self-hosted Supabase is the runtime registry only, limited to `friday_agents` and `friday_agent_registry_state`.
3. Agent Spec v1.1 uses server-resolved local model profiles.
4. Routing order is manual override -> deterministic match -> bounded CT108 local-router for ambiguity.
5. A matched agent runs through CT108/local Ollama only; matched-agent failure never falls back to cloud AI.
6. Server-side `POST /api/assistant` automatically routes matched requests using the same current overview; no-match or routing-service unavailability preserves the existing assistant path.
7. The Agents workspace supports registry visibility, explicit sync, agent details, manual selection, and direct ask.
8. Every Phase 1 response remains advisory with `execution.performed=false`.
9. CI validates the exact two-table schema and rejects agent execution routes, shell/SSH paths, and browser-visible Supabase credentials.

### Live acceptance — completed 2026-10-28

All gates below passed. PR #92 merged to `main` as `407fd85`; VM102 now runs `main` via `make update` (`cd94dfc` at the time of writing). VM132 stability: three snapshots at 16:54:53Z, 17:00:20Z and 17:05:45Z each reported `supabase-db` running and healthy with restart count 1, `SELECT 1` = 1, and authenticated PostgREST 200 with exactly `proxmox-observer`. A production-path direct Ask with all monitoring incidents answered locally (`ollama`, `qwen3:4b-instruct`, `execution.performed=false`) with correct counts, offline services, site label and open incidents. Owner-run shared-composer and desktop/phone Agents checks passed, and the managed-cloud checker passed all eight gates. The original checklist is kept for reference.


1. CT108 nic1 validation is complete: its running-container interface reports `10.1.10.12/24`, and authoritative VM102 passes TCP/11434, `/api/tags`, and `/api/chat` over vmbr1.
2. Agent defaults now use `http://10.1.10.12:11434`; post-migration `make verify` passed on 2026-09-22.
3. Current `main` contains timeout hardening: registry requests are bounded to 10 seconds, local routing to 15 seconds, and matched local inference to 90 seconds by default.
4. VM132's PostgreSQL ownership failure caused one automatic database restart on 2026-09-22. On 2026-10-26, three authenticated PostgREST reads five minutes apart passed, but that VM102 session could not run `SELECT 1` or verify the database container restart count. On 2026-10-28 an owner read-only check reported restart count 1, healthy, and `SELECT 1` = 1. Complete three snapshots at least five minutes apart (restart count, `SELECT 1`, authenticated PostgREST) and stop on any failure or restart-count change before deploying. See the [PR #19 rollout plan](../superpowers/plans/2026-09-22-pr19-rollout-completion.md).
5. The existing `friday_agents` and `friday_agent_registry_state` tables matched the checked-in migration on 2026-09-22. No schema write is currently needed.
6. Preserve VM102 `.env`; its three agent URLs are already configured as `http://10.1.10.12:11434`. Keep all other production values and `FRIDAY_DOCKER_ENABLED=false` unchanged.
7. Deploy only a reviewed continuation based on current `main`; include `compose.cloud-tunnel.yaml` when resolving the existing production project and rebuild only Friday so the connector remains intact.
8. Rerun `make preflight` before deployment and `make health` afterward; verify `GET /api/agents`, agent detail, and registry status.
9. Run `POST /api/agents/registry/sync` with `{}` only if registry state is stale, then verify a healthy sync.
10. Route a Proxmox prompt and verify `proxmox-observer` is selected.
11. Directly ask `proxmox-observer` and require `provider:"ollama"`, `mode:"local-agent"`, expected model/profile, `execution.performed:false`, and text that matches current service/site/incident/severity facts. The 2026-10-26 live check failed this grounding gate, so the new retry-and-fail-closed guard must be deployed and revalidated first.
12. Send a Proxmox request through the normal shared Friday composer and verify automatic local-agent routing/provenance with the same grounding requirements.
13. Complete desktop and phone Agents workspace acceptance and confirm no action controls appear. Obtain explicit owner approval before merge.

Do **not** add an executor, approvals/tasks/memory persistence, shell/SSH execution, restart endpoints, or cloud fallback for matched agents as part of this rollout.

## Repository-aware agent platform — in progress (issue #20)

- Server-side registry and bounded GET-only repository tools are implemented in draft PR #35.
- Repositories workspace supports desktop and mobile browsing, Git status, safe file listing, and bounded text preview.
- Remaining: repository-scoped task flow and live acceptance after explicit checkout registration. No shell execution or repository writes.
- Do not mount live roots, deploy, or merge without owner review.

## P6 — Complete real read-only visibility

1. Keep Proxmox on its dedicated read-only token.
2. Keep the VM100 observer authoritative for VM100 Docker visibility.
3. Structured, bounded HTTP endpoint checks for both sites are implemented; production activation waits for approved Site A and Site B health URLs.
4. Compare FRIDAY output to actual infrastructure and fix normalization errors before adding more providers.
5. Prefer existing trustworthy monitoring data over duplicate probes where practical.

## P7 — Complete network/service read adapters

1. Omada Open API v1 read-only site/device inventory is implemented and disabled by default. Live acceptance still requires a reachable controller, trusted TLS certificate, controller API/version confirmation, and a dedicated read-only application scoped to approved sites; compare IDs/counts/status to Omada before activation. WAN/VPN/routing health remains outside this inventory slice. See `docs/integrations.md`.
2. AdGuard Home status and aggregate DNS statistics are implemented for one explicitly configured instance and disabled by default. Live acceptance requires a trusted HTTPS endpoint, suitable server-only credentials/access restrictions, and the correct site label; compare running/protection state and counters with AdGuard. Secondary DNS instances remain future work. See `docs/integrations.md`.
3. Prometheus active-target scrape health and Uptime Kuma monitor metrics are implemented and disabled by default, using existing monitoring data without duplicate probes. Prometheus acceptance requires restricted Basic credentials and accurate site labels. Kuma acceptance requires a metrics-only key, exported `monitor_id` labels, and an explicit site label. Both require trusted HTTPS and comparison against their source inventories. Grafana health and Grafana-managed alert rule state are also implemented and disabled by default; acceptance requires a Viewer service account token, trusted HTTPS, a site label and comparison against Grafana's alert list. See `docs/integrations.md`.
4. Keep provider failure non-fatal to `/api/overview` and visible to monitoring.

## P8 — Authentication, roles, approval, and durable action audit

- **Per-site session maintenance is implemented in a draft-only source
  change:** trusted server bootstrap can access isolated
  `maintenanceFor('family'|'techtactics')` operations for exact
  issuer-scoped subject session revocation and bounded old login-state
  and session sweeps, with no HTTP exposure or production scheduler.
  Before real offboarding, add auditable operator authorization,
  Authentik account disable and IdP session revocation, atomic
  prevention of in-flight re-login, tested database role isolation
  and a reviewed rotation/retention runbook. This is not a public
  customer or HomeLab action endpoint.


- **Two public Authentik site handlers are now composable but disabled:**
  `server/security/public-login-runtime.mjs` assembles distinct Family
  and TechTactics OIDC/PKCE, encrypted state, session, cookie and HTTP
  handlers with separate server-provided DB query functions and signing
  keys. No listener or Friday production route is mounted. Before live
  use, validate separate LOGIN principals/RLS, real providers and MFA,
  approved HTTPS hostnames, ingress header stripping, distributed rate
  controls, operational key handling, cleanup and revocation, and
  external/browser callback/logout/isolation tests. Do not publish yet.


- **Encrypted, atomic PostgreSQL OAuth-state source (draft PR #73):** app-pinned cross-replica PKCE transaction store, fixed five-minute TTL, AEAD-encrypted sensitive login material, disjoint Family/TechTactics RLS and one-time `DELETE RETURNING` callback consumption. Migration remains unapplied. Existing `friday` Authentik OIDC discovery works internally, but `family` and `techtactics` return 404. Register both providers, secure their separate policies and HTTPS issuer domains, then provision distinct DB credentials and externally validate sessions. `portal.mytechtactics.com` is occupied by Zoho; use a separate proposed `accounts.mytechtactics.com` after owner review. Keep production Cloudflare Access unchanged until end-to-end test approval.

Implement before any infrastructure write operation:

- authentication or a documented trusted reverse-proxy identity boundary;
- **internal role policy foundation in draft PR #49**: exact JWT subject-to-role-and-target bindings for Viewer, Operator, Administrator and Friday Agent; enforced in the dormant HomeLab fixture service with proposer/approver separation. No production configuration, UI/RBAC endpoints, real target rights, or execution authority; full product RBAC remains pending.
- **durable append-only action audit events separate from monitoring history: implemented, default off** (`server/audit/action-audit.mjs`, `GET /api/audit/events`); enable with `FRIDAY_AUDIT_ENABLED=true` after reviewing the `/data/audit` volume;
- action request IDs/lifecycle states;
- **internal read-only pending-approval queue in stacked draft PR #50 (depends on #49)**: private bounded audit scan for unexpired, unapproved symbolic staging requests; signed Administrator-only projection with proposer/approver separation. No public UI/API, production operator identity provisioning or executor; full human approval workflow remains outstanding.
- a default-off, owner-file-backed **global automation gate foundation** is implemented in draft PR #48 and tested against the existing internal HomeLab approval seam. It is not wired into production, grants no action permission and has no user-facing toggle. Production-safe kill-switch activation, cross-instance reviews and the remaining authorization/audit/approval controls are still pending.

## P9 — Controlled actions

Only after P8 is complete and tested:

1. define a typed allowlisted tool registry/executor;
2. permit only separately reviewed low-risk reversible actions;
3. require before/after verification and durable audit;
4. require explicit approval for higher-risk configuration actions.

Never expose arbitrary shell execution or the native Docker API through FRIDAY.

## P10 — Multi-site operations polish

- Site-aware, host-grouped **read-only inventory topology** with exact service-site filters is implemented in draft PR #47 (desktop and phone). It does not claim verified network links, VPN state, or live deployment; source review, passing exact-head CI, and authenticated live site-data acceptance are still required. Network topology/link verification remains future work.
- VPN status/latency history.
- Read-only incident triage by observed service/site membership and severity, including explicit Unassigned handling and unfiltered monitoring-history labeling, is implemented in draft PR #47. Live accuracy, permission-scoped incident visibility, production deployment and release review remain separate.
- Secondary DNS/resilience visibility.
- Backup state and restore-test visibility.
- Notification routing.
- Voice input only after identity/safety controls are stable.

## When blocked by credentials or hardware

Do not invent provider responses or weaken authentication. Leave the integration disabled, document the exact missing prerequisite, and continue on safely verifiable work.
