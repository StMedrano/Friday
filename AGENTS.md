# Friday Agent Instructions

This file is the entry point for Codex and other coding agents working in this repository.

## Start every task
1. Read `CODEX.md`.
2. Read `docs/codex/BUILD_STATUS.md` and `docs/codex/NEXT_STEPS.md`.
3. Inspect the affected code before editing.
4. Load the relevant repo-local skill below.

## Skill routing
- VM100 install/update/deployment: `skills/deploying-friday-vm100/SKILL.md`
- New infrastructure integration/adapter: `skills/adding-friday-adapters/SKILL.md`
- UI/dashboard/component work: `skills/iterating-friday-ui/SKILL.md`

If a task crosses categories, read each relevant skill before editing.

## Mandatory safety
- Never commit secrets or real infrastructure credentials.
- Never put privileged credentials in `VITE_*` variables or browser code.
- The base `compose.yaml` must remain safe/mock and Docker-socket-free.
- Docker socket access belongs only in the explicit live override and must stay read-only.
- Never modify VM100 networking, Omada routing, VLANs, DNS, DHCP, firewall rules, VPNs, or Proxmox settings as an incidental side effect.
- Read adapters are not action adapters. Do not hide writes inside health/inventory code.
- Do not implement destructive/privileged execution until authentication, policy, approval, and audit paths are present.
- Do not use Docker prune commands to fix Friday.

## Engineering contract
- Node target: 22 (`.nvmrc`, `.node-version`).
- Write a failing test before application behavior changes.
- Keep provider-specific data behind server adapters and normalized Friday types.
- Keep mock mode functional with zero credentials.
- Run `make verify` before considering code complete.
- For deployment work, also run `make preflight` and `make health` on VM100.
- Update `docs/codex/BUILD_STATUS.md` when completing a major capability.

## Definition of done
A change is complete only when tests pass, the production build succeeds, Compose validates, no secrets were added, mock mode still works, and the relevant documentation reflects the new behavior.
