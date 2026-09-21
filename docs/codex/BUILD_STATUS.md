# Friday Build Status

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Authoritative branch, hosts, and UI

- `main` is the authoritative FRIDAY build after reviewed feature work is merged.
- Live Proxmox inventory on 2026-09-21 identifies running VM102 (`friday-controller`) as the authoritative controller. VM131 is absent.
- VM100 (`ubuntu-docker`) is managed infrastructure and hosts the separate read-only Docker observer.
- CT108 (`friday-ollama`) is the local Ollama host.
- The deployed frontend is FRIDAY UI v3 under `src/`.
- PR #5 merged Incident Diagnostics + Mobile Dashboard.
- PR #11/#12 merged the multi-provider advisory assistant and local-timeout/identifier-grounding work.
- PR #14 merged the shared session-only Friday Assistant UX.

## 2026-09-21 read-only nic1/vmbr1 discovery

Live state differs from the proposed address map. Deployment configuration must use the verified rows below, not the proposed host-number convention, and networking must not be changed to make live state match documentation.

| VM/LXC | Hostname | vmbr1 guest interface | VLAN | nic1 address | Prefix | Gateway | Legacy vmbr0 address | Default route |
|---|---|---|---:|---|---:|---|---|---|
| Proxmox node `home` | Proxmox VE | `vmbr1` over `nic1` | VLAN-aware trunk: 2,10,20,30,40,50,60,70,99 | none | — | none | `192.168.1.211/32` on `vmbr0` | legacy `vmbr0` via `192.168.1.254` |
| VM100 | `ubuntu-docker` | `net1` / `ens19` | 10 | `10.1.10.10` | `/24` | `10.1.10.1` | `192.168.1.124/24` on `ens18` | `ens19` via `10.1.10.1` |
| VM102 | `friday-controller` | `net1` / `eth1` | 10 | `10.1.10.11` | `/24` | not verified | `192.168.1.64/24` on `eth0` | not verified from guest |
| CT108 | `friday-ollama` | `net1` / `eth1` | 10 | `10.1.10.12` (Proxmox config) | `/24` | `10.1.10.1` (Proxmox config) | `192.168.1.76/24` on `eth0` | not verified from inside CT108 |
| VM110 | Umbrel / media | `net1` | 50 | not discovered | unknown | unknown | legacy address not revalidated | unknown |
| VM120 | Identity / Authentik | `net1` / `eth1` | 60 | `10.1.60.10` | `/24` | not verified | `192.168.1.73/24` | not verified from guest |
| VM131 | — | — | — | absent from live inventory | — | — | — | — |
| VM132 | Supabase production | `net1` / `eth1` | 20 | `10.1.20.10` | `/24` | not verified | `192.168.1.71/24` | not verified from guest |

Discovery sources were the local VM100 guest state plus read-only Proxmox cluster/config and QEMU guest-agent reads. `vmbr1` has no IP address and no gateway, as required. No VLAN, bridge, guest network, DHCP, DNS, firewall, Omada, or routing configuration was changed.

The proposed values `10.1.2.211`, `10.1.10.100`, `10.1.20.131`, `10.1.20.132`, and `10.1.70.120` were not verified live. In particular, Proxmox has no `10.1.2.211` interface, VM100 is `10.1.10.10`, VM131 is absent, VM132 is `10.1.20.10`, and VM120 is currently VLAN 60 at `10.1.60.10`.

### Address-reference classification

- **Current runtime/example configuration:** the VM100 observer examples now use verified nic1 `10.1.10.10:3199`.
- **Legacy/rollback configuration:** Proxmox `192.168.1.211` remains the only verified reachable management API path. It is labeled legacy until a nic1 management address is verified.
- **CT108 gated legacy configuration:** agent profile defaults still name a legacy vmbr0 endpoint. CT108 `10.1.10.12` was discovered in Proxmox configuration, but inside-CT validation and VM102 TCP/11434, `/api/tags`, and `/api/chat` checks have not succeeded; the strict migration gate therefore prohibits changing those defaults yet.
- **Test fixtures:** remaining `192.168.1.x` values in `*.test.*` are isolated adapter/provider fixtures and do not configure deployment.
- **Historical documentation:** files under `docs/superpowers/specs/` and `docs/superpowers/plans/` preserve the addresses used by their original approved designs and plans.

## Current deployed controller baseline

The last explicitly recorded VM102 production baseline predates the local Agent Platform Phase 1 branch. Existing production validation established a healthy Friday container on port `3010`, read-only Proxmox/VM100 visibility, Groq -> Gemini -> CT108 Ollama assistant fallback, exact infrastructure grounding, and no infrastructure mutation authority.

Do not infer that PR #19's local agent registry/routing/workspace has been deployed merely because its CI is green. The live controller responds over nic1 at `10.1.10.11:3010` (and the legacy rollback path), but its agent list and registry-status endpoints returned 503 during this discovery. VM102/Supabase/API/UI rollout acceptance is still required.

## Monitoring, diagnostics, mobile, and assistant — merged

The following capabilities are already part of `main`:

- durable monitoring/incidents with read-only incident APIs;
- fixed, sanitized VM100 observer diagnostics and explicit bounded log inspection;
- purpose-built mobile operations shell at `(max-width: 700px)`;
- multi-provider advisory Friday Assistant;
- one shared browser-memory assistant session across Overview, FRIDAY, and mobile surfaces;
- provider/model/fallback provenance;
- fresh normalized Friday state authoritative over conversation history;
- no server-side assistant conversation persistence;
- no infrastructure execution authority.

PR #14 is merged; the old “finish the Friday Assistant experience” milestone is retired.

## Local Agent Platform Phase 1 — implemented in draft PR #19

Source branch: `feature/friday-local-agent-platform-phase1-20260830`.

Implemented behavior:

- Agent Spec v1.1 with deployment-independent `model.profile` references;
- Git `agents/` definitions are authoritative;
- self-hosted Supabase stores only runtime registry state in exactly two tables: `friday_agents` and `friday_agent_registry_state`;
- server-only model profiles `local-router`, `local-general`, and `local-coder` resolve to Ollama;
- explicit/manual agent override;
- deterministic routing for strong registered agent matches;
- bounded CT108 local-router classification for ambiguous requests;
- matched agents execute inference on CT108/local Ollama only and never fall back to cloud assistant providers;
- agent requests receive a fresh normalized Friday overview;
- server-side `POST /api/assistant` automatically routes matched prompts to local agents before the existing assistant provider chain while reusing the same fresh overview;
- manual Agents workspace displays registry state, definition metadata, local provenance, sync control, and direct ask flow;
- agent API surface contains exactly the Phase 1 registry/route/ask operations documented in `API_CONTRACT.md`;
- successful agent replies expose `mode:"local-agent"`, `provider:"ollama"`, model/profile provenance, and `execution.performed=false`;
- there is no agent executor, shell/SSH path, restart endpoint, delete/edit/create API, durable agent memory, task system, approval system, or infrastructure mutation authority.

Task 8 regression gates are part of CI: exact two-table schema validation, local-only matched-agent behavior, no-execution regression, secret-boundary scan, and agent-route/shell safety scans.

Shared-composer implementation tests cover deterministic Proxmox routing, same-overview identity, response provenance, grounded output, no cloud/general fallback after a matched local failure, safe no-match fallback, routing-service failure fallback, and `execution.performed=false`. Live shared-composer acceptance remains pending deployment.

### Verification result — 2026-09-21

- `make verify`: **passed** in a temporary Node 22 + Make + Docker Compose tool container because the discovery host lacks host-installed Node/Make.
- Frontend: **85/85 tests passed** across 19 files.
- Server/observer/scripts: **225/225 tests passed**.
- Production TypeScript/Vite build: **passed**.
- Base, live-overlay, and observer Compose validation: **passed**.
- VM100 observer nic1 health: `http://10.1.10.10:3199/health` returned 200.
- VM102 Friday nic1 health: `http://10.1.10.11:3010/healthz` returned 200 in live mode; `/api/overview` returned 200.
- Agent list and registry status on the deployed controller: **503 `agent-registry-unavailable`**. Registry availability is not evidence of the deployed Git revision, which was not independently verified.
- `make preflight`, `make update`, and `make health` on VM102: **not run**; no deployment was attempted because CT108's mandatory nic1/Ollama validation and registry prerequisites are incomplete.

### Agents UI acceptance — 2026-09-21

Automated component and responsive CSS suites passed. Coverage confirms registry status/list/detail rendering, model/profile, scope, tools, checksum, registry sync, manual Ask, shared composer integration, and absence of Restart, Execute, Delete, Approve, Shell, Edit agent, and Create agent controls. Live desktop/mobile visual acceptance and manual Ask remain pending because the deployed registry is unavailable.

### CT108/Ollama migration status

- Proxmox configuration discovery: **passed** — CT108 `net1` is `eth1`, attached to `vmbr1`, VLAN 10, configured as `10.1.10.12/24` with gateway `10.1.10.1`.
- Verification from inside CT108: **blocked** — available SSH credentials were rejected and the read-only Proxmox token cannot execute guest commands.
- TCP/11434 from the authoritative Friday controller: **not verified**.
- `GET /api/tags` and `POST /api/chat` from the authoritative Friday controller: **not verified**.
- Configuration migration to `10.1.10.12`: **not performed**, by the explicit safety gate.

### Remaining Phase 1 rollout acceptance

Before PR #19 is ready to merge:

1. obtain read-only guest access sufficient to validate CT108 from inside and verify TCP/11434, `/api/tags`, and `/api/chat` from VM102 over `10.1.10.12`;
2. only after those checks pass, update the three agent profile URLs to the verified CT108 nic1 endpoint;
3. apply `supabase/migrations/202608300001_friday_agent_registry.sql` to the intended self-hosted Supabase/Postgres instance;
4. preserve the VM102 production `.env` and add the server-only registry/model-profile variables from `.env.example`;
5. rebuild only the Friday controller and verify normal health/read-only integrations remain unchanged;
6. sync the registry and verify `GET /api/agents` plus registry status;
7. verify Proxmox routing, direct Proxmox agent ask, and shared-composer automatic routing all return local Ollama provenance and `execution.performed=false`;
8. complete desktop and phone Agents workspace acceptance.

Do not represent those live rollout checks as complete until they are actually performed.

## VM100 observer security boundary

Docker's native TCP API must never be exposed. Inventory/diagnostic IDs come from sanitized current inventory. The observer must never gain restart, stop, kill, exec, remove, image creation, volume mutation, network mutation, archive write, or arbitrary Docker-path proxy behavior.

## Not implemented yet

- Omada authenticated read-only site/device/health adapter.
- AdGuard authenticated read-only API/statistics adapter.
- Uptime Kuma/Prometheus/Grafana native adapters.
- Application authentication and RBAC.
- Durable action audit/action request store.
- Human approval queue and global automation kill switch.
- Agent tool executor or infrastructure mutation endpoints.
- Durable agent memory/task orchestration.
- Notification delivery.
- Voice input pipeline.

## Next product milestone

Finish **Local Agent Platform Phase 1 live rollout and acceptance** without adding execution authority. After that, continue read-only adapter coverage and design authentication/RBAC + durable audit + approval + kill-switch prerequisites before any controlled action work.

## Safety gate

Do not implement infrastructure-changing agent or assistant actions until authentication, role policy, explicit approval, durable action audit logging, and the global automation kill switch exist and are tested.
