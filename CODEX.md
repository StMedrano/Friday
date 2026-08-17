# Codex Handoff — Friday

## Mission
Finish Friday as the AI-assisted control plane for a two-site homelab while keeping infrastructure credentials server-side and infrastructure-changing actions behind explicit authentication, policy, approval, and audit controls.

## Read first
1. `AGENTS.md`
2. `docs/codex/BUILD_STATUS.md`
3. `docs/codex/NEXT_STEPS.md`
4. The relevant file under `skills/`

## Current architecture
Friday is now a real single-container MVP, not a frontend-only mockup.

- React + TypeScript + Vite UI.
- Node 22 server serves both UI and `/api/*`.
- Mock mode works with zero infrastructure credentials.
- Live read-only adapters exist for Docker, Proxmox, and generic HTTP endpoints.
- Optional server-side OpenAI Responses API adapter provides advisory analysis only.
- Command preview is deterministic and does not execute infrastructure work.
- `compose.yaml` is safe/mock and does not mount the Docker socket.
- `compose.live.yaml` explicitly adds read-only Docker socket access.

## Homelab environment
- Proxmox VE is the hypervisor.
- VM 100 (`ubuntu-docker`) is the Infrastructure Docker VM.
- VM 110 is Umbrel/media.
- Omada is the preferred network control plane for two physical sites.
- Target Site A hierarchy: `10.10.0.0/16`.
- Target Site B hierarchy: `10.20.0.0/16`.
- Sites communicate through a routed site-to-site VPN.
- VM100 currently exists on the legacy `192.168.1.x` LAN; do not migrate addressing as part of Friday application work.

## Safety constraints
- Never commit secrets or real tokens.
- Never use `VITE_*` for Proxmox, Docker, Omada, OpenAI, SSH, or other privileged secrets.
- Never expose arbitrary shell execution through Friday.
- Never hide writes inside read/health adapters.
- Do not change VM100 network, Omada routing, VLANs, DNS, DHCP, firewall, VPN, or Proxmox configuration as an incidental side effect.
- Do not add destructive actions before auth/RBAC + durable audit + approval queue exist.
- Never use Docker prune commands to recover Friday.

## Standard commands
```bash
make help
make install
make test
make build
make verify
make preflight
make up       # safe/mock
make live     # explicit live read-only adapters
make health
make logs
make update
```

## VM100 first deploy
```bash
sudo mkdir -p /srv/infrastructure/apps
sudo chown -R "$USER":"$USER" /srv/infrastructure/apps
cd /srv/infrastructure/apps
git clone https://github.com/StMedrano/Friday.git friday
cd friday
cp .env.example .env
make preflight
make up
make health
```

## Finish order
Follow `docs/codex/NEXT_STEPS.md`. The next major engineering work after VM100 validation is:
1. Finish assistant UX against `/api/assistant`.
2. Add Omada/AdGuard read-only adapters.
3. Add authentication/RBAC and durable audit storage.
4. Build an approval queue.
5. Only then introduce tightly allowlisted actions.

## Verification contract
Before completing application changes:
```bash
make verify
```
For VM100 deployment changes also run:
```bash
make preflight
make health
```
GitHub CI must be green before merging.

## Important docs
- `docs/architecture.md`
- `docs/network-plan.md`
- `docs/vm100-integration.md`
- `docs/integrations.md`
- `docs/codex/API_CONTRACT.md`
- `docs/codex/BUILD_STATUS.md`
- `docs/codex/NEXT_STEPS.md`
