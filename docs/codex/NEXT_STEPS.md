# Friday — Ordered Finish Queue

Work from top to bottom. Do not skip safety prerequisites to reach action features sooner.

## P0 — Validate and deploy the current MVP
1. Run `make verify`.
2. On VM100 run `make preflight`.
3. Deploy with `make up` in mock mode.
4. Verify `make health` and the dashboard at port 3010.
5. Configure Nginx Proxy Manager for the chosen internal hostname/TLS.
6. Confirm rollback: `docker compose down` followed by `make up` returns Friday to healthy state.

## P1 — Enable real read-only state
1. Docker: use `make live`; confirm container inventory and health.
2. Proxmox: create a dedicated read-only API token and populate `.env`.
3. Endpoint checks: add known service URLs for both sites.
4. Compare live output to the actual Proxmox/Docker inventory; fix normalization errors before adding new providers.

## P2 — Finish the Friday assistant experience
1. Connect the command composer to `/api/assistant` when AI is enabled.
2. Keep `/api/commands/preview` as the deterministic no-AI fallback and safety classifier.
3. Add an assistant response panel/history in memory first; do not add a database until the UX is stable.
4. Add tests proving AI output cannot claim execution status.
5. Add explicit UI labels for advisory/proposed actions.

## P3 — Complete the network/service read adapters
1. Omada read-only site/device/health adapter using the controller's supported API for the installed controller version.
2. AdGuard Home status and DNS statistics adapter.
3. Monitoring adapter: prefer existing Prometheus/Uptime Kuma data over duplicating probes where practical.
4. Add integration health to `/api/overview` without making one provider failure fatal.

## P4 — Authentication, roles, and audit
Implement before any write operation:
- Authentication for Friday itself or a documented trusted reverse-proxy identity boundary.
- Roles: Viewer, Operator, Administrator, Friday Agent.
- Durable append-only audit events in `/data` or a small database.
- Action request IDs and lifecycle states: proposed, awaiting-approval, approved, rejected, executing, succeeded, failed.

## P5 — Controlled actions
Start with low-risk actions only after P4 is complete:
1. Run a health check.
2. Restart an allowlisted Docker container.
3. Start/stop an allowlisted VM only after separate Proxmox action-policy review.

Every action must be explicit, allowlisted, auditable, and approval-gated by default. Never expose arbitrary shell execution through Friday.

## P6 — Multi-site operations polish
- Site A/Site B filtering and topology view.
- VPN status/latency history.
- Alerts grouped by site and severity.
- Secondary DNS/resilience visibility.
- Backup state and restore-test visibility.
- Notification routing.

## When blocked by missing credentials or hardware
Do not invent provider responses or weaken authentication. Leave the adapter disabled, document the exact missing prerequisite, and continue on work that can be verified locally.
