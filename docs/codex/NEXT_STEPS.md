# Friday — Ordered Finish Queue

Work from top to bottom. Do not skip safety prerequisites to reach action features sooner.

## P0 — VM100 observer baseline — completed

- VM100 is static at `192.168.1.124`; the old `.74` DHCP address is retired from active configuration.
- VM100 observer is deployed on port `3199` with a dedicated bearer token and `.env` mode `600`.
- Unauthenticated inventory returns `401`; authenticated inventory returns sanitized real VM100 containers.
- VM102 uses the observer with `FRIDAY_DOCKER_ENABLED=false`.
- Docker's native TCP API remains unexposed.

## P1 — Monitoring & Incidents — completed and production validated

- PR #4 merged to `main`.
- Durable monitoring is enabled on VM102.
- Proxmox + VM100 observer report through read-only integrations.
- Monitoring state is persisted at `/data/monitoring-state.json`.
- Offline, degraded, integration-unavailable, and flapping rules are implemented.
- Monitoring never restarts, stops, starts, execs into, or modifies managed infrastructure.

## P2 — Incident Diagnostics + Mobile Dashboard — merged

PR #5 is merged into `main`; it is no longer a candidate.

Implemented outcomes:

- diagnostics remain environment-gated by `FRIDAY_DIAGNOSTICS_ENABLED`;
- observer inspect/log routes are fixed bearer-authenticated GET-only endpoints using sanitized inventory-derived IDs;
- inspect metadata is allowlisted and logs are bounded/sanitized;
- raw logs are explicit-request only and absent from persisted monitoring state/history;
- deterministic incident diagnosis separates facts, findings, likely causes, and recommendations;
- supported incidents receive one metadata-only diagnostic report/backfill, not recurring log collection;
- phone layout uses exact `(max-width: 700px)` routing;
- phone navigation is `Home | FRIDAY | Infrastructure | Incidents | More`;
- Mobile Home priority is `Incident attention -> Health -> FRIDAY -> Infrastructure -> Services`;
- desktop FRIDAY UI v3 remains the render path above 700px;
- diagnosis/log UI remains read-only and tests reject remediation controls.

Remaining production-polish checks:

1. Re-run VM100 observer `/health`, authenticated inventory, fixed inspect, and bounded logs before relying on diagnostics operationally.
2. Confirm the inspected VM100 container state does not change during validation.
3. Perform exact-width mobile acceptance at 360px, 390px, 430px and desktop 1440px when convenient.
4. Validate a real incident detail and explicit log panel on the deployed UI when an appropriate read-only incident is available.

These are validation/polish items, not merge gates; PR #5 is already merged.

## P3 — Multi-provider Friday AI — completed and production validated

PR #11 and PR #12 are merged and deployed on VM102.

Validated production chain:

```text
Groq -> Gemini -> CT108 GPU Ollama -> deterministic local analysis
```

Current validated settings include:

```env
FRIDAY_AI_ENABLED=true
FRIDAY_AI_PROVIDER_ORDER=groq,gemini,ollama
FRIDAY_CLOUD_AI_TIMEOUT_MS=15000
FRIDAY_LOCAL_AI_TIMEOUT_MS=45000
FRIDAY_LOCAL_AI_ENABLED=true
FRIDAY_LOCAL_AI_URL=http://192.168.1.70:11434
FRIDAY_LOCAL_AI_MODEL=qwen3:4b-instruct
FRIDAY_LOCAL_AI_CONTEXT=8192
FRIDAY_LOCAL_AI_MAX_TOKENS=512
```

Production checks proved:

- Groq primary succeeds without fallback;
- Gemini succeeds when isolated as the first provider;
- CT108 `qwen3:4b-instruct` succeeds as the isolated GPU local provider;
- the 45-second local timeout provides sufficient headroom for the normal Friday prompt;
- exact infrastructure identifier grounding returns `friday-ollama -> LXC 108` from normalized state;
- AI remains advisory/read-only and receives no execution tools.

## P4 — Finish the Friday Assistant experience — next feature milestone

1. Connect the primary FRIDAY command composer to `/api/assistant` when AI is enabled.
2. Keep `/api/commands/preview` as the deterministic no-AI fallback and safety classifier.
3. Show clear response provenance: provider, model, cloud/local/deterministic mode, and whether fallback occurred.
4. Add assistant conversation/history UX without granting execution authority.
5. Preserve explicit advisory/proposed-action language.
6. Add tests proving AI responses cannot be presented as successful infrastructure execution.
7. Keep provider failure non-fatal and surface the fallback path clearly to the operator.

Do not add action execution as part of this milestone.

## P5 — Complete real read-only visibility

1. Keep Proxmox on the dedicated read-only token.
2. Keep the VM100 observer authoritative for VM100 Docker visibility.
3. Use `make live` only if local VM102 Docker visibility is explicitly needed.
4. Add approved HTTP endpoint checks for both sites.
5. Compare FRIDAY output to actual infrastructure and fix normalization errors before adding more providers.
6. Prefer existing trustworthy monitoring data over duplicate probes where practical.

## P6 — Complete network/service read adapters

1. Omada read-only site/device/health adapter using the installed controller's supported API.
2. AdGuard Home status and DNS statistics adapter.
3. Prefer existing Prometheus/Uptime Kuma/Grafana data over duplicate probes where practical.
4. Keep every provider failure non-fatal to `/api/overview` and visible to monitoring as an integration incident.

## P7 — Authentication, roles, approval, and durable action audit

Implement before any infrastructure write operation:

- authentication for FRIDAY or a documented trusted reverse-proxy identity boundary;
- roles: Viewer, Operator, Administrator, Friday Agent;
- durable append-only **action** audit events separate from monitoring history;
- action request IDs and lifecycle states: proposed, awaiting-approval, approved, rejected, executing, succeeded, failed;
- explicit approval workflow;
- global automation kill switch.

## P8 — Controlled actions

Only after P7 is complete and tested:

1. Read-only health checks remain always safe.
2. Restart one explicitly allowlisted container through a dedicated action service.
3. Start/stop an allowlisted VM only after separate Proxmox action-policy review.

Every action must be explicit, allowlisted, auditable, and approval-gated by default. Never expose arbitrary shell execution or the native Docker API through FRIDAY.

## P9 — Multi-site operations polish

- Site A/Site B filtering and topology view.
- VPN status/latency history.
- Incidents grouped by site and severity.
- Secondary DNS/resilience visibility.
- Backup state and restore-test visibility.
- Notification routing.
- Voice input only after the assistant UX and identity/safety model are stable.

## When blocked by missing credentials or hardware

Do not invent provider responses or weaken authentication. Leave the adapter disabled, document the exact missing prerequisite, and continue on work that can be verified safely.