# Friday Agent Instructions

This file is the entry point for Codex and other coding agents working in this repository.

## Start every task
1. Read `CODEX.md`.
2. Read `docs/codex/BUILD_STATUS.md` and `docs/codex/NEXT_STEPS.md`.
3. Inspect the affected code before editing.
4. Load the relevant repo-local skill below.

## Skill routing
- VM102 Friday controller install/update/deployment: `skills/deploying-friday-vm102/SKILL.md`
- New infrastructure integration/adapter: `skills/adding-friday-adapters/SKILL.md`
- UI/dashboard/component work: `skills/iterating-friday-ui/SKILL.md`

If a task crosses categories, read each relevant skill before editing.

VM100 is managed infrastructure and hosts the separate read-only Docker observer. Do not treat VM100 as the Friday controller.

## Mandatory safety
- Never commit secrets or real infrastructure credentials.
- Never put privileged credentials in `VITE_*` variables or browser code.
- Normal production controller operation must keep `FRIDAY_DOCKER_ENABLED=false` unless local VM102 Docker observation is explicitly approved.
- Never expose Docker's native TCP API.
- VM100 Docker visibility/diagnostics must stay behind the fixed token-authenticated observer GET routes.
- Never modify VM100 networking, Omada routing, VLANs, DNS, DHCP, firewall rules, VPNs, Twingate, or Proxmox settings as an incidental side effect.
- Read adapters are not action adapters. Do not hide writes inside health/inventory/diagnostic code.
- AI providers receive normalized Friday state only; never grant Docker, Proxmox, shell, network, deployment, or remediation tools.
- Do not implement destructive/privileged execution until authentication, role policy, durable action audit, approval, and a global automation kill switch are present and tested.
- Do not use Docker prune commands to fix Friday.

## Engineering contract
- Node target: 22 (`.nvmrc`, `.node-version`).
- Write a failing test before application behavior changes.
- Keep provider-specific data behind server adapters and normalized Friday types.
- Keep mock mode functional with zero credentials.
- Keep AI provider failover sequential, never parallel fanout.
- Preserve exact infrastructure IDs/names from normalized state in AI policy and tests.
- Run `make verify` before considering application code complete.
- For VM102 controller deployment work, also run `make preflight` and `make health` on VM102.
- For VM100 observer deployment work, follow `observer/README.md` and validate observer routes separately.
- Update `docs/codex/BUILD_STATUS.md` when completing a major capability.

## Definition of done
A change is complete only when its relevant tests pass, the production build succeeds when application code changed, Compose validates when deployment configuration changed, no secrets were added, safety boundaries remain intact, and the relevant documentation reflects the new behavior.
