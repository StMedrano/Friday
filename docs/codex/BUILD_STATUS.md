# Friday Build Status

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Implemented in the repository

### Application shell
- React + TypeScript + Vite dashboard.
- Responsive operations layout and typed infrastructure domain model.
- Site, service, resource, alert, and activity views.
- Friday command composer with preview-only command classification.

### Friday server
- Node 22 HTTP server serving the production UI and API from one container.
- `GET /healthz` and `GET /api/health`.
- `GET /api/overview` normalized aggregation.
- `POST /api/commands/preview` with a read-only command allowlist.
- Optional `POST /api/assistant` provider boundary for server-side AI analysis.

### Read-only adapters
- Mock adapter for credential-free development.
- Docker Engine inventory through the local Unix socket.
- Proxmox VE API inventory through a token.
- Generic HTTP/HTTPS endpoint health checks.
- Adapter failures degrade their integration instead of taking down the whole overview.

### AI boundary
- OpenAI Responses API adapter using server-side `OPENAI_API_KEY` only.
- AI disabled by default.
- Default model configuration is `gpt-5.6-terra` and is environment-overridable.
- AI receives normalized Friday state; it has no infrastructure execution tools.

### Deployment and verification
- Multi-stage Docker image.
- Safe/mock `compose.yaml` with no Docker socket mount.
- Explicit `compose.live.yaml` override with read-only Docker socket.
- Persistent `friday_data` volume reserved for future audit/state data.
- `Makefile`, VM100 preflight, update, bootstrap, and verification scripts.
- GitHub Actions tests, TypeScript/Vite build, and Docker image build.
- Node 22 declared in `.nvmrc` and `.node-version`.

### Agent handoff
- `AGENTS.md` dispatcher.
- `CODEX.md` architecture and safety brief.
- Repo-local deployment, adapter, and UI skills under `skills/`.

## Requires the real VM100 / network environment
- Validate Docker inventory against VM100's real container set.
- Create and test the dedicated Proxmox read-only token.
- Configure actual Site A/Site B endpoint URLs.
- Verify reverse proxy hostname/TLS through Nginx Proxy Manager.
- Confirm site-to-site VPN routing before enabling remote-site health checks.

## Not implemented yet
- Omada authenticated read-only API adapter.
- AdGuard authenticated read-only API adapter/statistics.
- Uptime Kuma/Prometheus/Grafana native adapters.
- Application authentication and RBAC.
- Durable audit log and action request store.
- Human approval queue.
- Infrastructure mutation/execution endpoints.
- Notification delivery.
- Full Friday chat/history UI connected to `/api/assistant`.
- Voice input pipeline.

## Safety gate
Do not implement infrastructure-changing actions until authentication, role policy, approval, and durable audit logging exist and are tested.
