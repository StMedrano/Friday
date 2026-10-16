# Friday — Ordered Finish Queue

Use the current PR #29 queue first. Older P0–P10 entries below are historical product planning and must not trigger a repeat of completed rollout work. Do not skip safety prerequisites to reach action features sooner.

## Current PR #29 release queue — 2026-10-13

1. Resume existing draft `feat/friday-operator-auth-20261011`, not a new security implementation. Implementation baseline `511b9f70e237900fce24cbd0f0099c42c7bb3c97` passed CI #437.
2. **Completed on 2026-10-13 after VM100 reconnection:** inspected the existing staging app, changed only its Compose line and runtime policy to `unless-stopped`, and verified both service policies with unchanged container IDs/start times. Stage health, anonymous origin/edge denial and adjacent services passed. Do not repeat deployment, recreate the connector, or reboot Docker/VM100 for testing. Continue at step 3.
3. Configure Authentik as the only normal Friday login method through Cloudflare Access Generic OIDC. Validate the signed `friday_auth_source` claim, exact operator identity and staging access. Test the outage-only One-time PIN break-glass path from [Friday authentication failover](../friday-authentication-failover.md); fallback identities must remain Viewer-only. Complete unlisted-identity denial, sanitized Access log/policy evidence, and logout/expiry acceptance with required session-impact approval. Never collect JWTs/cookies or broaden Allow policy to make a test pass.
4. Obtain a genuine independent review of the final candidate. CI, self-review and user-reported login do not replace this gate.
5. Complete production Cloudflare/NPM forwarding and origin-isolation acceptance, then a verified offline backup and copy-only non-root volume migration under separate authorization. Do not change the root-owned production volume or deploy this draft directly.
6. Obtain separate explicit merge and production cutover decisions only after the concrete candidate and release evidence are reviewable. Keep Phase 2C disabled.

Token rotation, obsolete stopped-connector cleanup and post-rotation user-reported login are **complete**. Do not repeat them. VM102 production remains on healthy `friday-release:0fba466`; no production rollout is authorized by this queue.

See [build checkpoint](BUILD_STATUS.md#current-security-release-checkpoint-2026-10-13), [Access acceptance](../friday-cloudflare-acceptance-gates.md), and [staging reboot recovery](../cloudflare-friday-staging-vm100.md#staging-reboot-recovery-2026-10-13).

## Historical product queue

## P0 — VM100 observer baseline — completed; nic1 example migrated

- VM100's verified nic1 address is `10.1.10.10/24` on VLAN 10; observer port `3199` remains the read-only Docker boundary.
- `192.168.1.124` is the legacy vmbr0 rollback address.
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

## P5 — Local Agent Platform Phase 1 — implementation and network validation complete; live acceptance pending

Draft PR #19 implements the Phase 1 local advisory agent platform.

Implemented source behavior:

1. Git under `agents/` is authoritative for agent definitions and enabled state.
2. Self-hosted Supabase is the runtime registry only, limited to `friday_agents` and `friday_agent_registry_state`.
3. Agent Spec v1.1 uses server-resolved local model profiles.
4. Routing order is manual override -> deterministic match -> bounded CT108 local-router for ambiguity.
5. A matched agent runs through CT108/local Ollama only; matched-agent failure never falls back to cloud AI.
6. Server-side `POST /api/assistant` automatically routes matched requests using the same current overview; no-match or routing-service unavailability preserves the existing assistant path.
7. The Agents workspace supports registry visibility, explicit sync, agent details, manual selection, and direct ask.
8. Every Phase 1 response remains advisory with `execution.performed=false`.
9. CI validates the exact two-table schema and rejects agent execution routes, shell/SSH paths, and browser-visible Supabase credentials.

### Required live acceptance before PR #19 merge readiness

1. CT108 nic1 validation is complete: its running-container interface reports `10.1.10.12/24`, and authoritative VM102 passes TCP/11434, `/api/tags`, and `/api/chat` over vmbr1.
2. Agent defaults now use `http://10.1.10.12:11434`; post-migration `make verify` passed on 2026-09-22.
3. PR head `0e241b4` contains timeout hardening: registry requests are bounded to 10 seconds, local routing to 15 seconds, and matched local inference to 90 seconds by default. TDD tests, full `make verify`, and GitHub CI passed on 2026-09-24. The patch is not deployed to VM102 yet.
4. VM132's PostgreSQL ownership failure caused one automatic database restart on 2026-09-22. Later authenticated SQL and service-role REST passed; investigate the ownership incident and require sustained readiness before deploying Friday. See the [PR #19 rollout plan](../superpowers/plans/2026-09-22-pr19-rollout-completion.md).
5. The existing `friday_agents` and `friday_agent_registry_state` tables matched the checked-in migration on 2026-09-22. No schema write is currently needed.
6. Back up/preserve VM102 `.env`, then configure the three agent URLs to `http://10.1.10.12:11434` through an owner-capable VM102 session.
7. Fast-forward the clean VM102 PR branch to the reviewed head and rebuild only Friday with base Compose; `make update` is unsuitable because it switches to `main`.
8. Run `make preflight` and `make health`; verify `GET /api/agents`, agent detail, and registry status.
9. Run `POST /api/agents/registry/sync` with `{}` only if registry state is stale, then verify a healthy sync.
10. Route a Proxmox prompt and verify `proxmox-observer` is selected.
11. Directly ask `proxmox-observer` and require `provider:"ollama"`, `mode:"local-agent"`, expected model/profile, and `execution.performed:false`.
12. Send a Proxmox request through the normal shared Friday composer and verify automatic local-agent routing/provenance; the older running VM102 build currently answers through Groq.
13. Complete desktop and phone Agents workspace acceptance and confirm no action controls appear. Obtain explicit owner approval before merge.

Do **not** add an executor, approvals/tasks/memory persistence, shell/SSH execution, restart endpoints, or cloud fallback for matched agents as part of this rollout.

## Repository-aware agent platform — in progress (issue #20)

- Server-side registry and bounded GET-only repository tools are implemented in draft PR #35.
- Repositories workspace supports desktop and mobile browsing, Git status, safe file listing, and bounded text preview.
- Remaining: repository-scoped task flow and live acceptance after explicit checkout registration. No shell execution or repository writes.
- Do not mount live roots, deploy, or merge without owner review.

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
