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
- CT108 (`192.168.1.70`) runs native Ollama with `qwen3:4b-instruct` on the Radeon 780M through RADV/Vulkan.
- Cloud timeout default is 15 seconds; local timeout default is 45 seconds.
- Deterministic local analysis is the final non-AI fallback.
- The AI policy requires exact preservation of service IDs, VM/LXC numbers, host names, and service-name mappings from normalized state.
- Command preview is deterministic and does not execute infrastructure work.
- No infrastructure mutation endpoint exists.

## Homelab environment
- Proxmox VE host: `192.168.1.211`.
- VM 100 (`ubuntu-docker`, `192.168.1.124`) is managed infrastructure and hosts the read-only Docker observer on port `3199`.
- VM 102 (`friday-controller`, `192.168.1.64`) is the authoritative Friday controller.
- CT108 (`friday-ollama`, `192.168.1.70`) is the GPU local-AI host.
- VM 110 (`192.168.1.72`) is Umbrel/media.
- Omada is the preferred network control plane for two physical sites.
- Target Site A hierarchy: `10.10.0.0/16`.
- Target Site B hierarchy: `10.20.0.0/16`.
- Sites are intended to communicate through a routed site-to-site VPN.
- Current Friday work must not migrate addressing or redesign the network as an incidental application change.

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
PR #9 is the separate private-HTTPS routing foundation and remains draft/open. Do not merge, modify, close, or fold it into assistant/read-adapter work unless the owner explicitly requests that PR.

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
Follow `docs/codex/NEXT_STEPS.md` exactly. The current next product milestone is the **Friday Assistant experience**:

1. Connect the primary FRIDAY command composer to `/api/assistant` when AI is enabled.
2. Keep `/api/commands/preview` as deterministic safety/no-AI fallback.
3. Add provider/model/fallback provenance and conversation/history UX.
4. Keep all output advisory and read-only.
5. Then complete read-only endpoint/network/service adapters.
6. Then add authentication/RBAC, durable action audit, approval workflow, and a global kill switch.
7. Only after those safety prerequisites are tested may tightly allowlisted actions be considered.

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
