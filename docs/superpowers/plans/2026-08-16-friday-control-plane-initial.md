# Friday Control Plane Initial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a production-shaped Friday frontend baseline that can run on VM 100 and be extended by Codex.

**Architecture:** React + TypeScript + Vite frontend with typed infrastructure domain models and isolated mock data. Presentation components consume domain types so future Proxmox, Omada, Docker, and monitoring adapters can replace mock data without a UI rewrite. A multi-stage Docker build serves the static bundle from Nginx.

**Tech Stack:** React, TypeScript, Vite, Lucide React, Vitest, Testing Library, Docker, Nginx

## Global Constraints
- Friday UI defaults to host port `3010`.
- No production credentials or Docker socket access in the initial upload.
- Site A and Site B must both be represented.
- Infrastructure services must show textual status in addition to color.
- Mock data must be isolated from presentation components.

## Completed baseline tasks
- [x] Define typed infrastructure and status model.
- [x] Add status behavior tests.
- [x] Build reusable dashboard components.
- [x] Compose the two-site operations dashboard.
- [x] Add responsive visual system.
- [x] Add safe Friday command preview UX.
- [x] Add Docker + Nginx VM100 deployment.
- [x] Add Codex/agent safety instructions.
- [x] Document architecture and two-site network target.

## Next implementation tasks for Codex
- [ ] Install dependencies and run `npm test` and `npm run build` on VM 100 or a development workstation.
- [ ] Fix only reproducible build/test issues before adding functionality.
- [ ] Add a separate authenticated Friday API service.
- [ ] Create a read-only Docker adapter for VM 100 container state.
- [ ] Add read-only Proxmox inventory integration.
- [ ] Add Uptime Kuma/monitoring adapter.
- [ ] Add read-only Omada health integration for both sites.
- [ ] Replace mock dashboard data through adapters without changing presentation contracts.
- [ ] Add authentication/RBAC before implementing mutations.
- [ ] Add policy, approvals, and audit events before allowing Friday to execute infrastructure actions.
