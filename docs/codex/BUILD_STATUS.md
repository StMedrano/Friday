# Friday Build Status

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Authoritative branch, hosts, and UI

- `main` is the authoritative FRIDAY build after reviewed feature work is merged.
- VM102 (`friday-controller`, `192.168.1.64`) is the controller host.
- VM100 (`192.168.1.124`) is managed infrastructure and hosts the separate read-only Docker observer.
- CT108 (`friday-ollama`, `192.168.1.70`) is the local Ollama host.
- The deployed frontend is FRIDAY UI v3 under `src/`.
- PR #5 merged Incident Diagnostics + Mobile Dashboard.
- PR #11/#12 merged the multi-provider advisory assistant and local-timeout/identifier-grounding work.
- PR #14 merged the shared session-only Friday Assistant UX.

## Current deployed controller baseline

The last explicitly recorded VM102 production baseline predates the local Agent Platform Phase 1 branch. Existing production validation established a healthy Friday container on port `3010`, read-only Proxmox/VM100 visibility, Groq -> Gemini -> CT108 Ollama assistant fallback, exact infrastructure grounding, and no infrastructure mutation authority.

Do not infer that PR #19's local agent registry/routing/workspace has been deployed merely because its CI is green. VM102/Supabase/API/UI rollout acceptance is still required.

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
- shared Friday session automatically routes matched prompts to local agents before the existing assistant path;
- manual Agents workspace displays registry state, definition metadata, local provenance, sync control, and direct ask flow;
- agent API surface contains exactly the Phase 1 registry/route/ask operations documented in `API_CONTRACT.md`;
- successful agent replies expose `mode:"local-agent"`, `provider:"ollama"`, model/profile provenance, and `execution.performed=false`;
- there is no agent executor, shell/SSH path, restart endpoint, delete/edit/create API, durable agent memory, task system, approval system, or infrastructure mutation authority.

Task 8 regression gates are part of CI: exact two-table schema validation, local-only matched-agent behavior, no-execution regression, secret-boundary scan, and agent-route/shell safety scans.

### Remaining Phase 1 rollout acceptance

Before PR #19 is ready to merge:

1. apply `supabase/migrations/202608300001_friday_agent_registry.sql` to the intended self-hosted Supabase/Postgres instance;
2. preserve the VM102 production `.env` and add the server-only registry/model-profile variables from `.env.example`;
3. rebuild only the Friday controller and verify normal health/read-only integrations remain unchanged;
4. sync the registry and verify `GET /api/agents` plus registry status;
5. verify Proxmox routing, direct Proxmox agent ask, and shared-composer automatic routing all return local Ollama provenance and `execution.performed=false`;
6. complete desktop and phone Agents workspace acceptance.

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