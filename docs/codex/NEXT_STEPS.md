# Friday — Ordered Finish Queue

Work from top to bottom. Do not skip safety prerequisites to reach action features sooner.

## P0 — Complete and deploy the VM100 observer
1. Finish PR #3 verification: controller tests, adapter tests, observer tests, production build, shell syntax, Compose validation, and both container builds.
2. Merge only after verification is clean.
3. On VM102 (`192.168.1.64`) pull `main`, run `make preflight`, update/recreate the controller, and confirm `make health` with the existing Proxmox integration.
4. On VM100 (`192.168.1.74`) verify port `3199` is unused before deploying the observer.
5. Deploy `observer/` with a dedicated bearer token and `.env` mode `600`.
6. From VM102 prove unauthenticated inventory returns `401` and authenticated inventory returns sanitized real VM100 containers.
7. Enable `FRIDAY_VM100_OBSERVER_ENABLED=true` on VM102 while keeping `FRIDAY_DOCKER_ENABLED=false`.
8. Recreate FRIDAY with base `compose.yaml`, then verify Proxmox + VM100 inventory together.
9. Stop only the observer temporarily and prove FRIDAY remains healthy with an `Integration degraded` warning; restart observer afterward.

## P1 — Complete real read-only visibility
1. Keep Proxmox on the dedicated read-only token.
2. Use the VM100 observer as the authoritative path for VM100 Docker inventory.
3. Use `make live` only if local VM102 Docker visibility is explicitly needed; it must never be mistaken for VM100 inventory.
4. Add approved HTTP endpoint checks for both sites.
5. Compare FRIDAY output to actual infrastructure and fix normalization errors before adding more providers.

## P2 — Finish the Friday assistant experience
1. Connect the command composer to `/api/assistant` when AI is enabled.
2. Keep `/api/commands/preview` as the deterministic no-AI fallback and safety classifier.
3. Add assistant response/history UX without granting execution authority.
4. Add tests proving AI output cannot claim execution status.
5. Add explicit UI labels for advisory/proposed actions.

## P3 — Complete network/service read adapters
1. Omada read-only site/device/health adapter using the installed controller's supported API.
2. AdGuard Home status and DNS statistics adapter.
3. Prefer existing Prometheus/Uptime Kuma monitoring data over duplicate probes where practical.
4. Keep every provider failure non-fatal to `/api/overview`.

## P4 — Authentication, roles, approval, and audit
Implement before any write operation:
- Authentication for FRIDAY or a documented trusted reverse-proxy identity boundary.
- Roles: Viewer, Operator, Administrator, Friday Agent.
- Durable append-only audit events.
- Action request IDs and lifecycle states: proposed, awaiting-approval, approved, rejected, executing, succeeded, failed.
- Explicit approval workflow and global automation kill switch.

## P5 — Controlled actions
Only after P4 is complete and tested:
1. Read-only health checks.
2. Restart one explicitly allowlisted container through a dedicated action service.
3. Start/stop an allowlisted VM only after separate Proxmox action-policy review.

Every action must be explicit, allowlisted, auditable, and approval-gated by default. Never expose arbitrary shell execution or the native Docker API through FRIDAY.

## P6 — Multi-site operations polish
- Site A/Site B filtering and topology view.
- VPN status/latency history.
- Alerts grouped by site and severity.
- Secondary DNS/resilience visibility.
- Backup state and restore-test visibility.
- Notification routing.

## When blocked by missing credentials or hardware
Do not invent provider responses or weaken authentication. Leave the adapter disabled, document the exact missing prerequisite, and continue on work that can be verified safely.
