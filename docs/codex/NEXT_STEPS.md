# Friday — Ordered Finish Queue

Work from top to bottom. Do not skip safety prerequisites to reach action features sooner.

## P0 — VM100 observer baseline — completed

- VM100 is static at `192.168.1.124` and observer port `3199` is the read-only Docker boundary.
- VM102 uses the observer with local controller Docker observation disabled in normal production operation.
- Docker's native TCP API remains unexposed.

## P1 — Monitoring & Incidents — completed and production validated

- Durable monitoring/incidents are part of `main`.
- Proxmox + VM100 observer feed read-only normalized state.
- Monitoring never restarts, stops, starts, execs into, or modifies managed infrastructure.

## P2 — Incident Diagnostics + Mobile Dashboard — merged

PR #5 is merged. Remaining observer/real-device checks are production polish, not missing feature implementation.

## P3 — Multi-provider Friday AI — completed and production validated

PR #11 and PR #12 are merged. Preferred assistant chain remains:

```text
Groq -> Gemini -> CT108 GPU Ollama -> deterministic local analysis
```

The assistant receives normalized Friday state and no Docker, Proxmox, shell, network, deployment, or remediation tools.

## P4 — Shared Friday Assistant experience — completed and merged

PR #14 is merged.

Completed behavior:

- one in-memory Friday conversation shared by Overview, FRIDAY, Mobile Home, and mobile FRIDAY;
- newest bounded completed exchanges supplied as provider context;
- provider/model/fallback provenance;
- fresh normalized state authoritative over conversational context;
- browser-only Clear session and no server/database conversation persistence;
- advisory-only language and no execution authority.

The old “finish Friday Assistant experience” milestone is retired.

## P5 — Local Agent Platform Phase 1 — implementation complete; live acceptance next

Draft PR #19 implements the Phase 1 local advisory agent platform.

Implemented source behavior:

1. Git under `agents/` is authoritative for agent definitions and enabled state.
2. Self-hosted Supabase is the runtime registry only, limited to `friday_agents` and `friday_agent_registry_state`.
3. Agent Spec v1.1 uses server-resolved local model profiles.
4. Routing order is manual override -> deterministic match -> bounded CT108 local-router for ambiguity.
5. A matched agent runs through CT108/local Ollama only; matched-agent failure never falls back to cloud AI.
6. Shared Friday composer automatically routes matched requests; no-match preserves the existing assistant path.
7. The Agents workspace supports registry visibility, explicit sync, agent details, manual selection, and direct ask.
8. Every Phase 1 response remains advisory with `execution.performed=false`.
9. CI validates the exact two-table schema and rejects agent execution routes, shell/SSH paths, and browser-visible Supabase credentials.

### Required live acceptance before PR #19 merge readiness

1. Apply `supabase/migrations/202608300001_friday_agent_registry.sql` to self-hosted Supabase/Postgres.
2. Back up/preserve VM102 `.env`, then configure only the server-side Phase 1 variables from `.env.example`.
3. Rebuild the Friday controller without changing unrelated infrastructure.
4. Verify `GET /api/agents` and `GET /api/agents/registry/status`.
5. Run `POST /api/agents/registry/sync` with `{}` and verify a healthy sync.
6. Route a Proxmox prompt and verify `proxmox-observer` is selected.
7. Directly ask `proxmox-observer` and require `provider:"ollama"`, `mode:"local-agent"`, expected model/profile, and `execution.performed:false`.
8. Send a Proxmox request through the normal shared Friday composer and verify automatic local-agent routing/provenance.
9. Complete desktop and phone Agents workspace acceptance and confirm no action controls appear.

Do **not** add an executor, approvals/tasks/memory persistence, shell/SSH execution, restart endpoints, or cloud fallback for matched agents as part of this rollout.

## P6 — Complete real read-only visibility

1. Keep Proxmox on its dedicated read-only token.
2. Keep the VM100 observer authoritative for VM100 Docker visibility.
3. Add approved HTTP endpoint checks for both sites.
4. Compare FRIDAY output to actual infrastructure and fix normalization errors before adding more providers.
5. Prefer existing trustworthy monitoring data over duplicate probes where practical.

## P7 — Complete network/service read adapters

1. Omada read-only site/device/health adapter.
2. AdGuard Home status and DNS statistics adapter.
3. Prefer existing Prometheus/Uptime Kuma/Grafana data over duplicate probes where practical.
4. Keep provider failure non-fatal to `/api/overview` and visible to monitoring.

## P8 — Authentication, roles, approval, and durable action audit

Implement before any infrastructure write operation:

- authentication or a documented trusted reverse-proxy identity boundary;
- roles: Viewer, Operator, Administrator, Friday Agent;
- durable append-only action audit events separate from monitoring history;
- action request IDs/lifecycle states;
- explicit approval workflow;
- global automation kill switch.

## P9 — Controlled actions

Only after P8 is complete and tested:

1. define a typed allowlisted tool registry/executor;
2. permit only separately reviewed low-risk reversible actions;
3. require before/after verification and durable audit;
4. require explicit approval for higher-risk configuration actions.

Never expose arbitrary shell execution or the native Docker API through FRIDAY.

## P10 — Multi-site operations polish

- Site A/Site B filtering and topology view.
- VPN status/latency history.
- Incidents grouped by site/severity.
- Secondary DNS/resilience visibility.
- Backup state and restore-test visibility.
- Notification routing.
- Voice input only after identity/safety controls are stable.

## When blocked by credentials or hardware

Do not invent provider responses or weaken authentication. Leave the integration disabled, document the exact missing prerequisite, and continue on safely verifiable work.