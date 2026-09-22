# Friday PR #19 Rollout Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy and accept PR #19's local advisory agent platform on authoritative VM102, then present a verified merge decision to the owner.

**Architecture:** GitHub PR head remains the source for the Friday application. VM102 holds the production `.env` and runs Friday through base Compose; VM132 Supabase holds only the two agent registry tables; CT108 serves Ollama over nic1. The rollout changes only Friday application checkout/configuration and its approved registry rows. Any VM132 database ownership repair is a separate infrastructure task.

**Tech Stack:** Node 22, React/Vite, Docker Compose, PostgreSQL/PostgREST, Ollama, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-friday-local-agent-platform-phase1-design.md`; current safety/status authority: `AGENTS.md`, `CODEX.md`, `docs/codex/BUILD_STATUS.md`, and `docs/codex/NEXT_STEPS.md`.

## Global Constraints

- Keep Phase 1 advisory and read-only, with `execution.performed=false` and no cloud fallback after a matched local agent.
- Keep VM102 at `10.1.10.11/24` and CT108 at verified `10.1.10.12/24` on vmbr1/VLAN 10. Do not change networking or add VLAN 80.
- Keep `FRIDAY_DOCKER_ENABLED=false`, the base Compose file, and the VM102 controller Docker socket unmounted.
- Preserve the production `.env`; do not print, copy into Git, or expose credential values to the browser.
- Do not use `make update` for PR validation: `scripts/update-controller.sh` switches to `main`.
- Do not merge PR #19 without the owner's explicit approval after all acceptance evidence is reported.

## Verified Starting State (2026-09-22)

- GitHub PR #19 is open, draft, mergeable/CLEAN, head `a2ff409`, zero commits behind `main`, and CI `verify` passed. Local checkout is clean at that head.
- VM102 checkout is clean at older `a12b540`; its healthy container began on 2026-09-12. The account currently available by SSH (`arcane-deploy`) cannot read owner-only `.env` or modify the checkout, and has no noninteractive sudo.
- VM102's deployed agent route selects `proxmox-observer`; direct Ask returns local Ollama `qwen3:4b-instruct` with `execution.performed=false`. Its shared `/api/assistant` still answers through Groq because that container predates the PR head.
- VM132 has both registry tables with one agent and one status row. The live columns, types, nullability, defaults, primary keys, and exact two-table scope match the checked-in migration. It suffered a PostgreSQL `Permission denied` incident and one automatic restart; later authenticated SQL and service-role REST returned successfully. The mechanism that changed data ownership is unresolved.

## Review Focus

1. **VM132 transient recovery:** three consecutive SQL and authenticated REST checks plus unchanged restart count must precede writes; any recurrence stops the rollout.
2. **VM102 owner-only `.env`:** a trusted VM102 owner/operator must back it up and edit only the three agent URLs while preserving all existing credentials.
3. **PR checkout drift:** deployment must use the reviewed `a2ff409` or a newer reviewed PR head, never switch to `main` or overwrite a dirty checkout.
4. **Wrong Ollama path:** deployed agent profile URLs and VM102 route selection must prove `10.1.10.12:11434` over `eth1`; legacy `192.168.1.x` must not be the agent path.
5. **Agent-first safety:** matched shared composer responses must show local provenance and `execution.performed=false`; local failure must never invoke Groq/Gemini/OpenAI/Anthropic.

---

### Task 1: Stabilize and validate the existing Supabase registry

**Files:** `supabase/migrations/202608300001_friday_agent_registry.sql` (read-only reference), `docs/codex/BUILD_STATUS.md` (record evidence).

**Interfaces:** Consumes authenticated VM132 SQL and service-role REST; produces verified registry readiness for Task 3.

- [x] **Step 1: Capture VM132 baseline.** On 2026-09-22, `supabase-db` was running/healthy after one restart at 12:36:47 UTC; `supabase-rest` was healthy on later checks. PostgreSQL ran as UID/GID `100:101`; the top-level data directory and `pg_filenode.map` were UID 100 after restart. No ownership change was made by Friday work.
- [ ] **Step 2: Check query readiness repeatedly.** At three points at least five minutes apart, run `SELECT 1` through authenticated loopback PostgreSQL and a service-role GET against `/rest/v1/friday_agents?select=id`; require SQL success, REST 200, and unchanged restart count each time. Stop if any check fails.
- [x] **Step 3: Validate schema rather than replay the migration blindly.** Read-only SQL on 2026-09-22 confirmed both tables' expected columns, types, nullability, defaults, and primary keys; no other `friday_` table exists. The deployed agent checksum equals `sha256sum agents/proxmox-observer.json` (`2ee1f134d03d61dad46ebb7e0c693e54740bb945cb00d8cc7d3a61b64677f92f`).
- [ ] **Step 4: Address the ownership incident separately.** If permission errors recur, capture timestamped PostgreSQL/container/system logs and the before/after owners. The infrastructure owner investigates the process that changes UID/GID and repairs it under a separately reviewed database change. Resume only after Step 2 passes.
- [ ] **Step 5: Record the final stability result.** Update `docs/codex/BUILD_STATUS.md` after Step 2 with the measured readiness. The schema matches the approved two-table migration, so no migration write is currently needed.

### Task 2: Prepare the exact VM102 deployment

**Files:** VM102 `/srv/infrastructure/apps/friday/.env` (production secret, never committed), `compose.yaml`, `skills/deploying-friday-vm102/SKILL.md`.

**Interfaces:** Consumes the reviewed GitHub PR SHA and verified CT108 endpoint; produces a clean VM102 checkout and validated server-only Compose configuration for Task 3.

- [ ] **Step 1: Obtain an owner-capable VM102 session.** Use the existing `stalin` owner account or an explicitly delegated equivalent. Confirm `id`, checkout ownership, `.env` readability, Docker access, and a clean Git tree; stop if any is unavailable.
- [ ] **Step 2: Preserve production config.** In `/srv/infrastructure/apps/friday`, create a mode-600, timestamped backup of `.env` outside Git. Compare only variable names/selected nonsecret addresses, without printing service keys.
- [ ] **Step 3: Fast-forward the PR branch.** Fetch origin, verify the remote PR SHA, and fast-forward the clean VM102 branch to that exact reviewed SHA. Recheck `git status --porcelain` and `git rev-parse HEAD`. Do not invoke `make update`.
- [ ] **Step 4: Set only the three agent URLs.** Configure `FRIDAY_AGENT_LOCAL_ROUTER_URL`, `FRIDAY_AGENT_LOCAL_GENERAL_URL`, and `FRIDAY_AGENT_LOCAL_CODER_URL` as `http://10.1.10.12:11434`. Preserve all other production values, including Supabase URL/key, Proxmox and observer credentials, and `FRIDAY_DOCKER_ENABLED=false`.
- [ ] **Step 5: Validate before restarting.** Run `make preflight` and `docker compose config` from VM102 with the preserved `.env`; inspect only sanitized output to confirm the three nic1 URLs, base Compose, and no controller Docker socket mount.

### Task 3: Deploy and verify Friday

**Files:** `compose.yaml`, `server/http.mjs`, `server/agents/*`, `src/components/AgentsWorkspace.tsx`, `docs/codex/BUILD_STATUS.md`.

**Interfaces:** Consumes Task 1 registry readiness and Task 2 prepared checkout/config; produces live endpoint and UI acceptance evidence.

- [ ] **Step 1: Recheck the dependency immediately before deployment.** Require VM132 SQL query, authenticated Friday registry REST GET, and unchanged database restart count. Stop on any failure.
- [ ] **Step 2: Rebuild only Friday.** On VM102 run `docker compose up -d --build friday` using the base Compose file. Preserve the existing Friday data volume and all other containers.
- [ ] **Step 3: Check base health.** Run `make health` on VM102; require `/healthz`, `/api/health`, and `/api/overview` 200, live mode, current overview, and healthy container. Verify VM100 observer and read-only Proxmox integrations remain available.
- [ ] **Step 4: Verify registry and provenance.** Run `GET /api/agents`, `GET /api/agents/proxmox-observer`, and `GET /api/agents/registry/status`. If checksum/state is stale, run the explicit `POST /api/agents/registry/sync` with `{}` once and recheck. Require one valid enabled agent and zero rejections.
- [ ] **Step 5: Verify the three assistant entry points.** Send `Summarize the current Proxmox health.` to `POST /api/agents/route`, `POST /api/agents/proxmox-observer/ask`, and `POST /api/assistant`. Require deterministic `proxmox-observer` routing; for direct Ask and shared composer require `mode:local-agent`, `provider:ollama`, model from `local-general`, grounded live overview text, and `execution.performed:false`. Confirm the container's three agent URLs point to `10.1.10.12:11434` and VM102 routes there via `eth1` with source `10.1.10.11`.
- [ ] **Step 6: Verify safe fallback.** In a controlled test environment, prove a no-match request retains the general assistant chain and a matched local Ollama failure returns `local-agent-unavailable` without cloud invocation. Do not disrupt CT108 production to create a failure.
- [ ] **Step 7: Verify the Agents workspace at desktop and phone widths.** Confirm registry status, sync, list, detail, model/profile, scope, tools, checksum, manual Ask, and shared composer. Confirm absence of Restart, Execute, Delete, Approve, Shell, Edit, and Create controls.
- [ ] **Step 8: Record deployment evidence.** Update `docs/codex/BUILD_STATUS.md` with VM102 SHA, service health, API/UI results, model, routing provenance, and any remaining exceptions. Run `make verify` for any new application or Compose change and require GitHub CI green.

### Task 4: Present the merge decision

**Files:** PR #19 and `docs/codex/BUILD_STATUS.md`.

**Interfaces:** Consumes Tasks 1–3 evidence; produces a final owner review package.

- [ ] **Step 1: Reconcile GitHub and VM102.** Confirm GitHub head, local head, VM102 head, deployed image start time, PR review state, and CI. Confirm no uncommitted changes or unexpected commits.
- [ ] **Step 2: Report acceptance.** Provide exact live response provenance, health, registry, desktop/phone UI, database stability, and rollback path. Name any failed gate plainly.
- [ ] **Step 3: Request explicit merge approval.** Keep PR #19 draft/open until the owner approves the reviewed result. After approval, merge only the approved PR head and recheck `main` and production health.
