# Codex Handoff — Friday

## Mission
Finish Friday as the AI-assisted control plane for a two-site homelab while keeping infrastructure credentials server-side and infrastructure-changing actions behind explicit authentication, policy, approval, and audit controls.

## Read first
1. `AGENTS.md`
2. `docs/codex/BUILD_STATUS.md`
3. `docs/codex/NEXT_STEPS.md`
4. The relevant file under `skills/`
5. The relevant approved design/plan under `docs/superpowers/` when changing an existing milestone

## Current architecture
Friday is a real single-container control-plane MVP on VM102 with separate read-only infrastructure adapters and an external GPU local-AI fallback.

- React + TypeScript + Vite UI.
- Node 22 server serves both UI and `/api/*`.
- Mock mode works with zero infrastructure credentials.
- Live read-only Proxmox integration exists.
- VM100 Docker visibility comes through a separate token-authenticated read-only observer.
- Normal VM102 production runs with `FRIDAY_DOCKER_ENABLED=false` and no controller Docker socket mount.
- Durable monitoring/incidents are implemented.
- Incident Diagnostics and the Mobile Dashboard shipped in merged PR #5.
- `/api/assistant` provides advisory analysis with sequential provider failover.
- Preferred production provider order is `groq,gemini,ollama`.
- OpenAI and Anthropic adapters remain available for explicit compatibility but are not in the default provider order.
- CT108 runs native Ollama with `qwen3:4b-instruct` on the Radeon 780M through RADV/Vulkan. Its running-container interface and Proxmox config verify nic1 at `10.1.10.12/24` on VLAN 10, and VM102 passes TCP/11434, `/api/tags`, and `/api/chat` over vmbr1. `192.168.1.70` is a legacy vmbr0 rollback reference.
- Cloud timeout default is 15 seconds; local timeout default is 45 seconds.
- Deterministic local analysis is the final non-AI fallback.
- The AI policy requires exact preservation of service IDs, VM/LXC numbers, host names, and service-name mappings from normalized state.
- Command preview is deterministic and does not execute infrastructure work.
- No AI-driven infrastructure mutation exists. The only action path is the approvals queue (#133) plus automated fixes (#151, `FRIDAY_REMEDIATION_ENABLED`, off and dry-run by default): an operator approves, then presses Run fix; the action comes only from the owner's playbook file and execute mode also needs `FRIDAY_MODE=live`, the action audit, an owner-run executor and an armed automation gate.
- Shared-work writes (create a task #138, claim and move #149) are off by default and touch only VM132 Supabase rows through dedicated least-privilege roles.
- Operator routes can additionally require the Authentik login claim (#154, off by default).

## Homelab environment
- Proxmox `vmbr1` is a VLAN-aware bridge over `nic1` with VLANs 2, 10, 20, 30, 40, 50, 60, 70, and 99. It intentionally has no IP address or gateway. The verified management API remains the legacy vmbr0 path `192.168.1.211:8006`; proposed `10.1.2.211` is not live.
- VM 100 (`ubuntu-docker`) nic1 is `10.1.10.10/24` on VLAN 10 and hosts the read-only Docker observer on port `3199`; legacy vmbr0 is `192.168.1.124`.
- VM 102 (`friday-controller`) nic1 is `10.1.10.11/24` on VLAN 10 and is the authoritative Friday controller; legacy vmbr0 is `192.168.1.64`. VM131 is absent from live Proxmox inventory.
- CT108 (`friday-ollama`) nic1 is verified as `10.1.10.12/24` on VLAN 10; active agent defaults use `http://10.1.10.12:11434`.
- VM 110 is Umbrel/media on VLAN 50; its nic1 address is not yet verified.
- VM 120 Identity is currently `10.1.60.10/24` on VLAN 60, not the proposed VLAN 70 mapping.
- VM 132 Supabase is currently `10.1.20.10/24` on VLAN 20.
- Omada is the preferred network control plane for two physical sites.
- Current VLAN addressing follows `10.1.<VLAN>.0/24`.
- Sites are intended to communicate through a routed site-to-site VPN.
- Current Friday work must not modify vmbr0, addressing, bridges, VLANs, default routes, Omada, or any network control plane as an incidental application change.

## Safety constraints
- Never commit secrets or real tokens.
- Never use `VITE_*` for Groq, Gemini, OpenAI, Anthropic, Proxmox, Docker, Omada, SSH, or other privileged secrets.
- Never expose arbitrary shell execution through Friday.
- Never give an AI provider Docker, Proxmox, shell, network, deployment, or other infrastructure mutation tools.
- Never hide writes inside read/health adapters.
- Do not change VM100 networking, Omada routing, VLANs, DNS, DHCP, firewall, VPN, Twingate, or Proxmox configuration as an incidental side effect.
- Do not add destructive or privileged actions before authentication/RBAC + durable action audit + approval queue + global kill switch exist.
- Never use Docker prune commands to recover Friday.
- Keep provider failover sequential; do not fan prompts/state out to providers in parallel.
- Keep the optional Compose Ollama sidecar private; do not add a host `ports:` mapping.
- Preserve the observer's fixed GET-only Docker boundary; never expose Docker's native TCP API.

## Pull request isolation
PR #9 (private-HTTPS routing foundation) was closed without merging on 2026-10-19; its branch `feature/https-private-routing-20260821` remains for reference. Do not revive or fold it into other work unless the owner explicitly asks.

PR #109 (`integration/friday-development-main-20261029`) stays open as a source branch for ported slices; do not merge it whole.

## Standard commands
```bash
make help
make install
make test
make build
make verify
make preflight
make up
make health
make logs
make update
```

The normal production controller uses base `compose.yaml` with `FRIDAY_DOCKER_ENABLED=false`. `make live` is reserved for an explicit decision to observe local VM102 Docker and must not be used casually.

For the optional private Compose local-AI recovery path:

```bash
docker compose --profile local-ai up -d
./scripts/pull-local-model.sh
```

## VM102 controller deploy/update
First deployment:

```bash
sudo mkdir -p /srv/infrastructure/apps
sudo chown -R "$USER":"$USER" /srv/infrastructure/apps
cd /srv/infrastructure/apps
git clone https://github.com/StMedrano/Friday.git friday
cd friday
cp .env.example .env
chmod 600 .env
make preflight
make up
make health
```

Normal update:

```bash
cd /srv/infrastructure/apps/friday
make update
```

Preserve the local `.env`; never overwrite production secrets from `.env.example`.

## Finish order
Follow `docs/codex/NEXT_STEPS.md`, the ordered queue of what is merged, deployed, waiting on the owner, and next. Local Agent Platform Phase 1 was live-accepted on 2026-10-28 (`docs/codex/BUILD_STATUS.md`). Small agent work comes from `docs/automation/BACKLOG.md`. New features stay off by default behind a flag; deploying and turning flags on is the owner's step.

## Verification contract
Before completing application changes:

```bash
make verify
```

For VM102 deployment changes also run:

```bash
make preflight
make health
```

For VM100 observer deployment changes, use the observer runbook and validate its fixed authenticated GET routes separately.

GitHub CI must be green before merging.

Assistant changes must additionally preserve these invariants:

```text
AI providers receive no infrastructure mutation tools.
API keys remain server-side.
Provider failover is sequential, not parallel fanout.
Assistant output is advisory and cannot authorize or execute infrastructure changes.
Exact infrastructure identifiers come from normalized state and are not inferred or renumbered.
```

## Important docs
- `README.md`
- `docs/architecture.md`
- `docs/security-model.md`
- `docs/network-plan.md`
- `docs/vm100-integration.md`
- `docs/integrations.md`
- `docs/live-integrations.md`
- `docs/codex/API_CONTRACT.md`
- `docs/codex/BUILD_STATUS.md`
- `docs/codex/NEXT_STEPS.md`
