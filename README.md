# Friday

Friday is a two-site homelab control plane hosted on **VM 102 (`friday-controller`, `192.168.1.64`)**. It combines the authoritative **FRIDAY UI v3 command center**, a server-side infrastructure API, read-only live adapters, and an optional AI analysis boundary without exposing privileged credentials to the browser.

## Authoritative build

`main` is the canonical FRIDAY build and deployment source.

The production UI is the React/TypeScript implementation under `src/`, with `src/pages/Dashboard.tsx` and `src/styles.css` carrying the approved FRIDAY UI v3 command-center experience. Standalone HTML prototypes and older dashboard designs are reference artifacts only.

VM 102 deploys and updates FRIDAY by pulling `main` and using the repository Makefile/Compose workflow. VM 100 is managed infrastructure and hosts a separate read-only Docker observer; it is not the FRIDAY controller.

## Current MVP

- FRIDAY UI v3 command-center interface
- Responsive React + TypeScript + Vite frontend
- Unified Node 22 server for UI + API
- Safe credential-free mock mode
- Proxmox read-only API adapter
- VM100 token-authenticated read-only Docker observer
- Optional local VM102 Docker inventory adapter, disabled by default
- HTTP/HTTPS endpoint health checks
- Deterministic preview-only command classifier
- Optional server-side OpenAI analysis endpoint
- Safe base Compose with no Docker socket mount
- Explicit local-Docker override only when intentionally requested
- VM102 controller preflight/update/verification scripts
- GitHub CI for controller + observer tests, builds, Compose validation, and shell syntax

## Safety model

Friday starts in `FRIDAY_MODE=mock`. Read adapters cannot mutate infrastructure. The AI endpoint is advisory only and receives normalized Friday state, not Docker/Proxmox execution tools.

No restart/delete/network/firewall/VLAN/device-adoption execution endpoint exists in this MVP. Infrastructure actions remain blocked until authentication/RBAC, durable audit logging, and approval workflow exist.

The VM100 observer exposes only:

```text
GET /health
GET /api/v1/containers
```

It does not expose Docker's native TCP API and has no restart, stop, exec, remove, image, volume, or network mutation routes.

## Deploy FRIDAY on VM 102

```bash
sudo mkdir -p /srv/infrastructure/apps
sudo chown -R "$USER:$USER" /srv/infrastructure/apps
cd /srv/infrastructure/apps

git clone https://github.com/StMedrano/Friday.git friday
cd friday
cp .env.example .env
chmod 600 .env

make preflight
make up
make health
```

FRIDAY is available at:

```text
http://192.168.1.64:3010
```

## Enable read-only Proxmox and VM100 observer data

Set `FRIDAY_MODE=live` in VM102's `.env` and enable only the integrations you intend to use. Proxmox and the VM100 observer work through the base `compose.yaml`; they do **not** require VM102's Docker socket.

Example observer settings on VM102:

```env
FRIDAY_VM100_OBSERVER_ENABLED=true
FRIDAY_VM100_OBSERVER_URL=http://192.168.1.74:3199
FRIDAY_VM100_OBSERVER_TOKEN=
FRIDAY_VM100_OBSERVER_HOST_NAME=VM 100
```

Then recreate the controller without the local Docker override:

```bash
make preflight
docker compose up -d --force-recreate
make health
```

`make live` is reserved for the explicit case where you intentionally enable **local VM102 Docker observation** with `FRIDAY_DOCKER_ENABLED=true`; it mounts VM102's Docker socket read-only.

## Deploy the VM100 observer

The observer source and exact deployment guide are under `observer/`.

Target:

```text
VM 100: 192.168.1.74
Port:   3199
Path:   /srv/infrastructure/friday-observer
```

Before deployment, confirm port `3199` is unused. See `observer/README.md` for the preflight, install, authentication test, update, and security boundary.

## Optional Friday AI

Friday AI is disabled by default. Configure server-side values only:

```env
FRIDAY_AI_ENABLED=true
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
```

Never rename provider or infrastructure secrets to a `VITE_*` variable.

## Update Friday on VM 102

```bash
cd /srv/infrastructure/apps/friday
make update
```

The controller updater refuses a dirty Git tree, fast-forwards `main`, preserves `.env`, and avoids mounting the local Docker socket unless local Docker observation is explicitly enabled.

## Development / verification

```bash
make install
make test
make build
make verify
```

`make verify` validates the controller Compose files and the standalone VM100 observer Compose project.

## API

FRIDAY controller:

```text
GET  /healthz
GET  /api/health
GET  /api/overview
POST /api/commands/preview
POST /api/assistant
```

VM100 observer:

```text
GET /health
GET /api/v1/containers
```

See `docs/codex/API_CONTRACT.md` and `docs/integrations.md`.

## Codex start point

Codex should begin with:

1. `AGENTS.md`
2. `CODEX.md`
3. `docs/codex/BUILD_STATUS.md`
4. `docs/codex/NEXT_STEPS.md`
5. The relevant workflow under `skills/`

Codex must treat the current React UI on `main` and VM102 controller architecture as authoritative.
