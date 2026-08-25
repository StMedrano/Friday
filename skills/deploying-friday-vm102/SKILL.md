---
name: deploying-friday-vm102
description: Use when installing, updating, validating, or troubleshooting the Friday controller on VM102. VM100 is managed infrastructure and hosts only the separate read-only observer.
---

# Deploying Friday on VM102

## Core rule
Treat VM102 as the authoritative Friday controller host. Inventory first, preserve `.env`, and never change unrelated infrastructure as a side effect of a Friday deployment.

## Host roles

```text
VM102  friday-controller  192.168.1.64   authoritative Friday controller
VM100  ubuntu-docker      192.168.1.124  managed infrastructure + read-only Docker observer
CT108  friday-ollama      192.168.1.70   GPU local-AI fallback
```

Never deploy the Friday controller onto VM100 as part of the normal architecture.

## Workflow
1. Read `AGENTS.md`, `CODEX.md`, `docs/codex/BUILD_STATUS.md`, `docs/codex/NEXT_STEPS.md`, `.env.example`, and `compose.yaml`.
2. On VM102, run `git status` before an update and refuse to overwrite an unexplained dirty tree.
3. Preserve the production `.env`; never replace it with `.env.example` during an update.
4. Run `make preflight` before changing the controller container.
5. Use `make update` for the normal clean-tree update path, or an explicitly reviewed `docker compose up -d --build friday` when validating a specific controller change.
6. Verify the running controller with `make health` and check `/healthz`, `/api/health`, and `/api/overview` as appropriate.
7. Keep normal production on base `compose.yaml` with `FRIDAY_DOCKER_ENABLED=false`.
8. Use local VM102 Docker observation only after a separate explicit decision; do not casually mount the controller Docker socket.
9. Never use `docker system prune`, `docker volume prune`, or delete Friday/external volumes to solve a startup problem.

## AI deployment boundary
- Provider credentials stay server-side and outside `VITE_*` variables.
- Preferred provider order is `groq,gemini,ollama`.
- Cloud timeout default is 15 seconds; local timeout default is 45 seconds.
- CT108 Ollama is reached at `http://192.168.1.70:11434` and should be firewall-restricted to VM102.
- Default local model is `qwen3:4b-instruct`.
- AI receives no Docker, Proxmox, shell, network, deployment, or remediation tools.

## VM100 observer boundary
VM100 observer updates are a separate deployment concern. Follow `observer/README.md`; validate `/health`, authenticated inventory, fixed inspect, and bounded logs without mutating the inspected container.

## Verification
A controller deployment is not complete until the relevant repository verification is green and the running VM102 container reports healthy. For application changes, run `make verify`; for deployment validation, also run `make preflight` and `make health` on VM102.
