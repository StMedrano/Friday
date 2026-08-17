# Friday Build Status

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Authoritative branch and UI

- `main` is the authoritative FRIDAY build and VM100 deployment source.
- The approved frontend is **FRIDAY UI v3**, implemented in the React/TypeScript control plane under `src/`.
- `src/pages/Dashboard.tsx` is the primary command-center composition and `src/styles.css` contains the v3 visual system.
- Older dashboard implementations and standalone HTML prototypes are reference artifacts only. Do not restore them over the React v3 interface.
- Future UI work must evolve the v3 React interface in place while preserving the server/API safety boundary.

## Verification status
The FRIDAY core MVP has passed Friday CI end-to-end: frontend/backend tests, TypeScript/Vite production build, shell-script syntax validation, safe Compose validation, live Compose override validation, and Docker image build. UI v3 also has a dashboard regression test covering the authoritative command surface and read-only status messaging.

## Implemented in the repository

### Application shell
- FRIDAY UI v3 React + TypeScript + Vite command center.
- Responsive narrow operations rail and command-center layout.
- Primary FRIDAY assistant command surface.
- System-health summary, infrastructure nodes, VM telemetry, application health, agent mesh, and operational detail views.
- Typed infrastructure domain model backed by the existing overview API.
- Friday command composer remains non-mutating in the current MVP.

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
- AI receives normalized infrastructure state; it has no infrastructure execution tools.

### Deployment and verification
- Multi-stage Docker image.
- `.dockerignore` excludes runtime secrets and local data from image build context.
- Safe/mock `compose.yaml` with no Docker socket mount.
- Explicit `compose.live.yaml` override with read-only Docker socket.
- Persistent `friday_data` volume reserved for future audit/state data.
- `Makefile`, VM100 preflight, update, bootstrap, and verification scripts.
- GitHub Actions tests, TypeScript/Vite build, Compose validation, shell checks, and Docker image build.
- Node 22 declared in `.nvmrc` and `.node-version`.

### Agent handoff
- `AGENTS.md` dispatcher.
- `CODEX.md` architecture and safety brief.
- Ordered Codex finish queue and API contract under `docs/codex/`.
- Repo-local deployment, adapter, and UI skills under `skills/`.
- Ready-to-paste Codex start prompt.

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
