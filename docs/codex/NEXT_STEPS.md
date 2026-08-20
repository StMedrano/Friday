# Friday — Ordered Finish Queue

Work from top to bottom. Do not skip safety prerequisites to reach action features sooner.

## P0 — VM100 observer baseline — completed

- VM100 is static at `192.168.1.124`; the old `.74` DHCP address is retired from active configuration.
- VM100 observer is deployed on port `3199` with a dedicated bearer token and `.env` mode `600`.
- Unauthenticated inventory returns `401`; authenticated inventory returns sanitized real VM100 containers.
- VM102 uses the observer with `FRIDAY_DOCKER_ENABLED=false`.
- Docker's native TCP API remains unexposed.

## P1 — Monitoring & Incidents — completed and production validated

- PR #4 merged to `main`.
- VM102 pulled the merged build and monitoring is enabled.
- Proxmox + VM100 observer continue to report live.
- Durable monitoring state is active at `/data/monitoring-state.json`.
- The existing VM100 Nginx Proxy Manager outage opened one high `service-offline` incident after the configured grace period.
- Monitoring history recorded the incident opening.
- VM100 proof confirmed NPM remained `Exited (255)`; monitoring did not mutate it.

## P2 — Finish Incident Diagnostics candidate on PR #5

1. Keep the feature isolated on `feature/incident-diagnostics-mobile`.
2. Finish diagnostics documentation and exact-head GitHub Actions verification.
3. Require the diagnostics safety gate to pass on the exact final head.
4. Confirm observer inspect/log routes remain fixed GET-only endpoints with sanitized inventory-derived IDs.
5. Confirm raw logs are explicit-request only and absent from persisted state/history.
6. Keep `FRIDAY_DIAGNOSTICS_ENABLED=false` by default.
7. Do not merge or deploy until the owner explicitly approves.
8. After merge approval, roll out observer first and controller second using `docs/live-integrations.md`.
9. Use the existing NPM outage only as a read-only validation target; do not restart or repair it during diagnostics validation.

## P3 — Implement the approved Mobile Dashboard on PR #5

Use the approved mobile implementation plan and TDD sequence. The target is an incident-first operations view rather than a shrunken desktop dashboard.

Required outcomes:

- mobile Home prioritizes active incidents and infrastructure attention state;
- bottom navigation replaces desktop rail behavior on narrow viewports;
- diagnosis view presents facts, findings, likely causes, recommendations, and explicit log inspection access;
- existing desktop FRIDAY UI v3 remains intact;
- no mobile remediation/restart/repair controls are introduced;
- responsive behavior is tested around the approved narrow breakpoint;
- full frontend/server/security/build CI remains green.

Stop at the PR merge gate after exact-head verification.

## P4 — Production rollout of PR #5

Only after explicit merge and rollout approval:

1. Upgrade VM100 observer first.
2. Validate `/health`, inventory, fixed inspect, and bounded logs.
3. Obtain container IDs only from sanitized observer inventory.
4. Confirm NPM state did not change.
5. Upgrade VM102 with diagnostics still disabled.
6. Confirm existing monitoring/integrations remain healthy.
7. Enable only `FRIDAY_DIAGNOSTICS_ENABLED=true`.
8. Validate the existing NPM incident receives one metadata-only backfill.
9. Explicitly request logs through the controller and verify they are not persisted.
10. Confirm NPM still remains in its pre-validation state.
11. Validate the mobile dashboard on phone-width and desktop-width clients.

## P5 — Complete real read-only visibility

1. Keep Proxmox on the dedicated read-only token.
2. Keep the VM100 observer authoritative for VM100 Docker visibility.
3. Use `make live` only if local VM102 Docker visibility is explicitly needed.
4. Add approved HTTP endpoint checks for both sites.
5. Compare FRIDAY output to actual infrastructure and fix normalization errors before adding more providers.

## P6 — Finish the Friday assistant experience

1. Connect the command composer to `/api/assistant` when AI is enabled.
2. Keep `/api/commands/preview` as the deterministic no-AI fallback and safety classifier.
3. Add assistant response/history UX without granting execution authority.
4. Add tests proving AI output cannot claim execution status.
5. Keep advisory/proposed-action labels explicit.

## P7 — Complete network/service read adapters

1. Omada read-only site/device/health adapter using the installed controller's supported API.
2. AdGuard Home status and DNS statistics adapter.
3. Prefer existing Prometheus/Uptime Kuma monitoring data over duplicate probes where practical.
4. Keep every provider failure non-fatal to `/api/overview` and visible to monitoring as an integration incident.

## P8 — Authentication, roles, approval, and durable action audit

Implement before any infrastructure write operation:

- authentication for FRIDAY or a documented trusted reverse-proxy identity boundary;
- roles: Viewer, Operator, Administrator, Friday Agent;
- durable append-only **action** audit events separate from monitoring history;
- action request IDs and lifecycle states: proposed, awaiting-approval, approved, rejected, executing, succeeded, failed;
- explicit approval workflow and global automation kill switch.

## P9 — Controlled actions

Only after P8 is complete and tested:

1. Read-only health checks remain always safe.
2. Restart one explicitly allowlisted container through a dedicated action service.
3. Start/stop an allowlisted VM only after separate Proxmox action-policy review.

Every action must be explicit, allowlisted, auditable, and approval-gated by default. Never expose arbitrary shell execution or the native Docker API through FRIDAY.

## P10 — Multi-site operations polish

- Site A/Site B filtering and topology view.
- VPN status/latency history.
- Incidents grouped by site and severity.
- Secondary DNS/resilience visibility.
- Backup state and restore-test visibility.
- Notification routing.

## When blocked by missing credentials or hardware

Do not invent provider responses or weaken authentication. Leave the adapter disabled, document the exact missing prerequisite, and continue on work that can be verified safely.
