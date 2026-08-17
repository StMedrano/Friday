# Codex Handoff — Friday

## Mission
Continue building Friday into the AI-assisted control plane for the user's two-site homelab without turning the frontend into a privileged infrastructure client.

## Current state
This repository is the initial UI baseline. It uses typed mock data so the operator experience can be reviewed before live infrastructure credentials are introduced.

## Environment
- Proxmox VE is the hypervisor.
- VM 100 (`ubuntu-docker`) is the core Infrastructure Docker VM.
- VM 110 is Umbrel/media.
- Omada is the preferred network control plane for two physical sites.
- Site A uses the `10.10.0.0/16` hierarchy in the target design.
- Site B uses the `10.20.0.0/16` hierarchy in the target design.
- The sites are expected to communicate through a routed site-to-site VPN.
- VM 100 currently exists on the legacy `192.168.1.x` LAN; do not migrate addressing as part of a UI task.

## Safety constraints
1. Never place infrastructure passwords, API tokens, JWT secrets, SSH keys, or cookie material in Vite variables. Vite variables are browser-visible.
2. Never mount `/var/run/docker.sock` into the Friday frontend container.
3. Never expose Proxmox or Omada administrative credentials to browser JavaScript.
4. Never implement destructive operations without an approval policy, audit log, and confirmation UX.
5. Preserve existing VM 100 services and ports. Inventory before changing Docker networking or published ports.
6. Do not change router, VLAN, DNS, DHCP, firewall, or VPN configuration just to make the UI work.

## Recommended implementation phases

### Phase 1 — Keep UI stable
- Run tests and build.
- Preserve the component/data boundaries.
- Replace mock data only through adapter interfaces.

### Phase 2 — Friday API service
Create a separate backend service responsible for authenticated reads. The browser talks only to this API.

Suggested endpoints:
- `GET /api/health`
- `GET /api/sites`
- `GET /api/hosts`
- `GET /api/vms`
- `GET /api/containers`
- `GET /api/services`
- `GET /api/alerts`
- `GET /api/activity`

Normalize responses to the existing frontend domain types.

### Phase 3 — Read-only adapters
Implement read-only integrations in this order:
1. Docker / VM 100 container health
2. Proxmox VE inventory and VM health
3. Uptime Kuma or monitoring data
4. Omada site/device health
5. AdGuard DNS statistics

### Phase 4 — Authentication and RBAC
Add operator authentication before any mutating action is exposed.

Roles should eventually include Viewer, Operator, Administrator, and Friday Agent.

### Phase 5 — Controlled actions
Add safe, auditable operations such as restarting a container or running a health check. Default to approval-required. Every action should record who/what requested it, target, inputs, result, and time.

### Phase 6 — Friday agent layer
Friday should reason over normalized infrastructure state and produce proposed actions. Infrastructure adapters execute actions only after policy evaluation and, where required, human approval.

## UI conventions
- Keep the dark graphite visual system.
- Prefer dense operational information over oversized decorative cards.
- Every status must have text/icon semantics, not color alone.
- Preserve responsive behavior.
- Do not add random gradients or neon effects that reduce readability.
- Reuse components rather than duplicating dashboard markup.

## Commands
```bash
npm install
npm test
npm run build
docker compose config
docker compose up -d --build
sh scripts/verify.sh
```

## Important docs
- `docs/architecture.md`
- `docs/network-plan.md`
- `docs/vm100-integration.md`
- `docs/superpowers/specs/2026-08-16-friday-control-plane-design.md`
- `docs/superpowers/plans/2026-08-16-friday-control-plane-initial.md`
