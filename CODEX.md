# Codex Handoff — Friday

## Mission
Finish Friday as the AI-assisted control plane for a two-site homelab while keeping infrastructure credentials server-side and infrastructure-changing actions behind explicit authentication, policy, approval, and audit controls.

## Read first
1. `AGENTS.md`
2. `docs/codex/BUILD_STATUS.md`
3. `docs/codex/NEXT_STEPS.md`
4. `docs/superpowers/specs/2026-08-23-friday-multi-provider-assistant-design.md`
5. `docs/superpowers/plans/2026-08-23-friday-multi-provider-assistant.md`
6. The relevant file under `skills/`

## Current architecture
Friday is now a real single-container control-plane MVP with an optional private local-AI sidecar.

- React + TypeScript + Vite UI.
- Node 22 server serves both UI and `/api/*`.
- Mock mode works with zero infrastructure credentials.
- Live read-only adapters exist for Docker, Proxmox, and generic HTTP endpoints.
- `/api/assistant` provides advisory analysis with sequential provider failover.
- Supported AI providers are OpenAI, Anthropic, Gemini, and optional private Ollama.
- Default local model is `qwen3:4b`; Ollama is profile-gated and has no host-published port.
- Deterministic `previewCommand` analysis is the final non-AI fallback.
- UI provenance distinguishes `FRIDAY CLOUD AI`, `FRIDAY LOCAL AI`, and `LOCAL ANALYSIS · NO AI`.
- Command preview is deterministic and does not execute infrastructure work.
- `compose.yaml` does not mount the Docker socket.
- `compose.live.yaml` explicitly adds read-only Docker socket access.

## Homelab environment
- Proxmox VE is the hypervisor.
- VM 100 (`ubuntu-docker`) is the Infrastructure Docker VM.
- VM 102 (`friday-controller`) is the authoritative Friday controller.
- VM 110 is Umbrel/media.
- Omada is the preferred network control plane for two physical sites.
- Target Site A hierarchy: `10.10.0.0/16`.
- Target Site B hierarchy: `10.20.0.0/16`.
- Sites communicate through a routed site-to-site VPN.
- VM100 currently exists on the legacy `192.168.1.x` LAN; do not migrate addressing as part of Friday application work.

## Safety constraints
- Never commit secrets or real tokens.
- Never use `VITE_*` for Proxmox, Docker, Omada, OpenAI, Anthropic, Gemini, SSH, or other privileged secrets.
- Never expose arbitrary shell execution through Friday.
- Never give an AI provider Docker, Proxmox, shell, network, or other infrastructure mutation tools.
- Never hide writes inside read/health adapters.
- Do not change VM100 network, Omada routing, VLANs, DNS, DHCP, firewall, VPN, or Proxmox configuration as an incidental side effect.
- Do not add destructive actions before auth/RBAC + durable audit + approval queue exist.
- Never use Docker prune commands to recover Friday.
- Keep provider failover sequential; do not fan prompts/state out to providers in parallel.
- Keep Ollama private to `friday_frontend`; do not add a host `ports:` mapping.

## Pull request isolation
PR #9 is the separate private-HTTPS routing foundation and must not be folded into assistant work. Assistant work belongs to its own reviewed branch/PR. Do not merge, modify, or close PR #9 as a side effect of assistant changes.

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

For optional local AI:

```bash
docker compose --profile local-ai up -d
./scripts/pull-local-model.sh
```

## VM102 first deploy
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
Follow `docs/codex/NEXT_STEPS.md`. The assistant UX/provider milestone is implemented by PR #10. After it is reviewed and merged, the next major engineering work is:
1. Add Omada/AdGuard read-only adapters.
2. Add authentication/RBAC and durable audit storage.
3. Build an approval queue.
4. Only then introduce tightly allowlisted actions.

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
GitHub CI must be green before merging.

Assistant changes must additionally preserve these invariants:

```text
AI providers receive no infrastructure mutation tools.
API keys remain server-side.
Ollama has no host-published port.
Provider failover is sequential, not parallel fanout.
Assistant output is advisory and cannot authorize or execute infrastructure changes.
```

## Important docs
- `docs/architecture.md`
- `docs/security-model.md`
- `docs/network-plan.md`
- `docs/vm100-integration.md`
- `docs/integrations.md`
- `docs/codex/API_CONTRACT.md`
- `docs/codex/BUILD_STATUS.md`
- `docs/codex/NEXT_STEPS.md`
- `docs/superpowers/specs/2026-08-23-friday-multi-provider-assistant-design.md`
- `docs/superpowers/plans/2026-08-23-friday-multi-provider-assistant.md`