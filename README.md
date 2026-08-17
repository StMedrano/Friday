# Friday

Friday is a two-site homelab control plane for VM 100. It combines a responsive operations UI, a server-side infrastructure API, read-only live adapters, and an optional AI analysis boundary without exposing privileged credentials to the browser.

## Current MVP

- Responsive dark operations dashboard
- Site A + Site B visibility and site-to-site VPN model
- Unified Node 22 server for UI + API
- Safe credential-free mock mode
- Docker read-only inventory adapter
- Proxmox read-only API adapter
- HTTP/HTTPS endpoint health checks
- Alerts, activity, resource and service panels
- Deterministic preview-only command classifier
- Optional server-side OpenAI Responses API analysis endpoint
- Safe `compose.yaml` with no Docker socket
- Explicit `compose.live.yaml` read-only socket override
- VM100 preflight/bootstrap/update/verification scripts
- Makefile build/deploy commands
- GitHub CI for tests, build, Compose validation, script syntax, and Docker image build
- Codex instructions, ordered finish queue, and repo-local skills

## Safety model

Friday starts in `FRIDAY_MODE=mock`. Read adapters cannot mutate infrastructure. The AI endpoint is advisory only and receives normalized Friday state, not Docker/Proxmox execution tools.

No restart/delete/network/firewall/VLAN/device-adoption execution endpoint exists in this MVP. Infrastructure actions remain blocked until authentication/RBAC, durable audit logging, and approval workflow exist.

## Pull onto VM 100

```bash
sudo mkdir -p /srv/infrastructure/apps
sudo chown -R "$USER:$USER" /srv/infrastructure/apps
cd /srv/infrastructure/apps

git clone https://github.com/StMedrano/Friday.git friday
cd friday
cp .env.example .env

make preflight
make up
make health
```

Friday defaults to:

```text
http://<VM100-IP>:3010
```

## Enable live read-only data

Edit `.env` and configure only the integrations you intend to use. Then run:

```bash
make preflight
make live
make health
```

`make live` combines `compose.yaml` with `compose.live.yaml`; that explicit override is what adds the Docker socket as a read-only mount.

See `docs/integrations.md` before enabling Proxmox, Docker, endpoint monitoring, or AI.

## Optional Friday AI

Friday AI is disabled by default. Configure server-side values only:

```env
FRIDAY_AI_ENABLED=true
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
```

Never rename the API key to a `VITE_*` variable. Browser-visible environment variables must not contain infrastructure or provider secrets.

## Update Friday on VM 100

```bash
cd /srv/infrastructure/apps/friday
make update
```

The updater refuses a dirty Git tree, fast-forwards `main`, preserves `.env`, preserves mock/live runtime mode, rebuilds, and verifies the running service.

## Development / verification

```bash
make install
make test
make build
make verify
```

Useful commands:

```bash
make help
make logs
make health
```

## API

```text
GET  /healthz
GET  /api/health
GET  /api/overview
POST /api/commands/preview
POST /api/assistant
```

See `docs/codex/API_CONTRACT.md`.

## Codex start point

Codex should begin with:

1. `AGENTS.md`
2. `CODEX.md`
3. `docs/codex/BUILD_STATUS.md`
4. `docs/codex/NEXT_STEPS.md`
5. The relevant workflow under `skills/`

A ready-to-paste prompt is in `docs/codex/START_HERE_PROMPT.md`.
