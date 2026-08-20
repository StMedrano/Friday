# Friday — Ordered Finish Queue

Work from top to bottom. Do not skip safety prerequisites to reach action features sooner.

## P0 — VM100 observer baseline — completed
- VM100 is static at `192.168.1.124`; the old DHCP `.74` address is retired from active configuration.
- VM100 observer is deployed on port `3199` with a dedicated bearer token and `.env` mode `600`.
- Unauthenticated inventory returns `401`; authenticated inventory returns sanitized real VM100 containers.
- VM102 has `FRIDAY_VM100_OBSERVER_ENABLED=true` and `FRIDAY_DOCKER_ENABLED=false`.
- FRIDAY `/api/overview` verified Proxmox + VM100 observer together and reported 16 VM100 containers.
- Docker's native TCP API remains unexposed and the observer remains GET-only.

## P1 — Merge and roll out Monitoring & Incidents
1. Finish PR #4 verification: frontend, server, adapter, monitoring, observer tests; production build; shell syntax; security greps; Compose validation; both Docker image builds.
2. Merge only after verification is clean and the owner explicitly approves the merge.
3. On VM102 (`192.168.1.64`) pull merged `main` with monitoring still disabled; run `make preflight`, recreate FRIDAY with base `compose.yaml`, and run `make health`.
4. Confirm existing Proxmox and VM100 observer integrations still report live.
5. Enable `FRIDAY_MONITORING_ENABLED=true` with the documented defaults while keeping `FRIDAY_DOCKER_ENABLED=false`.
6. Recreate only FRIDAY with base Compose.
7. Verify `GET /api/overview`, `GET /api/incidents`, and `GET /api/monitoring/history`.
8. Wait through the configured offline grace period and confirm the existing `nginx-proxy-manager` outage becomes one `service-offline` incident on VM100.
9. Confirm monitoring did not change any VM100 container state.
10. If rollback is needed, disable monitoring and recreate FRIDAY; preserve `/data/monitoring-state.json`.

## P2 — Complete real read-only visibility
1. Keep Proxmox on the dedicated read-only token.
2. Use the VM100 observer as the authoritative path for VM100 Docker inventory.
3. Use `make live` only if local VM102 Docker visibility is explicitly needed; it must never be mistaken for VM100 inventory.
4. Add approved HTTP endpoint checks for both sites.
5. Compare FRIDAY output to actual infrastructure and fix normalization errors before adding more providers.

## P3 — Finish the Friday assistant experience
1. Connect the command composer to `/api/assistant` when AI is enabled.
2. Keep `/api/commands/preview` as the deterministic no-AI fallback and safety classifier.
3. Add assistant response/history UX without granting execution authority.
4. Add tests proving AI output cannot claim execution status.
5. Add explicit UI labels for advisory/proposed actions.

## P4 — Complete network/service read adapters
1. Omada read-only site/device/health adapter using the installed controller's supported API.
2. AdGuard Home status and DNS statistics adapter.
3. Prefer existing Prometheus/Uptime Kuma monitoring data over duplicate probes where practical.
4. Keep every provider failure non-fatal to `/api/overview` and visible to monitoring as an integration incident.

## P5 — Authentication, roles, approval, and durable action audit
Implement before any infrastructure write operation:
- Authentication for FRIDAY or a documented trusted reverse-proxy identity boundary.
- Roles: Viewer, Operator, Administrator, Friday Agent.
- Durable append-only **action** audit events separate from monitoring history.
- Action request IDs and lifecycle states: proposed, awaiting-approval, approved, rejected, executing, succeeded, failed.
- Explicit approval workflow and global automation kill switch.

## P6 — Controlled actions
Only after P5 is complete and tested:
1. Read-only health checks remain always safe.
2. Restart one explicitly allowlisted container through a dedicated action service.
3. Start/stop an allowlisted VM only after separate Proxmox action-policy review.

Every action must be explicit, allowlisted, auditable, and approval-gated by default. Never expose arbitrary shell execution or the native Docker API through FRIDAY.

## P7 — Multi-site operations polish
- Site A/Site B filtering and topology view.
- VPN status/latency history.
- Incidents grouped by site and severity.
- Secondary DNS/resilience visibility.
- Backup state and restore-test visibility.
- Notification routing.

## When blocked by missing credentials or hardware
Do not invent provider responses or weaken authentication. Leave the adapter disabled, document the exact missing prerequisite, and continue on work that can be verified safely.
