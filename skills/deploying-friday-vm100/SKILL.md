---
name: deploying-friday-vm100
description: Use when installing, updating, validating, or troubleshooting Friday on VM 100 or another Docker host.
---

# Deploying Friday on VM100

## Core rule
Treat VM100 as an existing production-like host. Inventory first; never prune or overwrite unrelated Docker workloads.

## Workflow
1. Read `AGENTS.md`, `CODEX.md`, `.env.example`, `compose.yaml`, and `compose.live.yaml`.
2. Run `make preflight` before changing containers.
3. For a first safe deployment: copy `.env.example` to `.env`, keep `FRIDAY_MODE=mock`, then run `make up`.
4. Verify with `make health`; confirm `/healthz`, `/api/health`, and `/api/overview`.
5. Run `make live` only after read-only adapter credentials are configured and reviewed.
6. Never use `docker system prune`, `docker volume prune`, or delete Friday/external volumes to solve a startup problem.
7. Before an update run `git status`; preserve local `.env`; use `make update` only from a clean working tree.

## Live-mode safety
- Docker socket: read-only mount from `compose.live.yaml` only.
- Proxmox: use a dedicated read-only API token.
- OpenAI: server-side `OPENAI_API_KEY`; never a `VITE_*` variable.
- Keep port `3010` unless the port registry says otherwise.

## Verification
A deployment is not complete until `make verify` succeeds in the repo and `make health` succeeds against the running container.
