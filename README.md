# Friday

Friday is a two-site homelab control plane for VM 100. It combines a responsive operations UI with a small backend API that can safely read infrastructure state without exposing privileged credentials to the browser.

## Current MVP

- Responsive dark operations dashboard
- Site A + Site B visibility
- Site-to-site VPN model
- Docker inventory adapter for VM 100
- Proxmox read-only API adapter
- HTTP/HTTPS endpoint health checks
- Mock mode for safe development
- Live mode with opt-in adapters
- Alerts, activities and resource panels
- Friday command composer backed by a preview-only API
- Docker/Compose deployment on port `3010`
- GitHub CI for tests, frontend build and container build
- VM 100 bootstrap/update/verify scripts
- Security, network and live-integration documentation
- Codex and agent handoff instructions

## Safety model

Friday starts in `FRIDAY_MODE=mock`. The current API is read-only. Natural-language requests are resolved only to an allowlist of previewable health/status intents. No restart, delete, network-change, firewall-change, VLAN-change or device-adoption endpoint exists in this MVP.

Read `docs/security-model.md` before adding actions.

## Pull onto VM 100

```bash
sudo mkdir -p /srv/infrastructure/apps
sudo chown -R "$USER:$USER" /srv/infrastructure/apps
cd /srv/infrastructure/apps

git clone https://github.com/StMedrano/Friday.git friday
cd friday
cp .env.example .env

docker compose config
docker compose up -d --build
sh scripts/verify.sh
```

Open:

```text
http://<VM100-IP>:3010
```

For the current VM 100 address this is expected to be:

```text
http://192.168.1.74:3010
```

## Update Friday on VM 100

```bash
cd /srv/infrastructure/apps/friday
sh scripts/update-vm100.sh
```

The updater uses a fast-forward-only pull, validates Compose, rebuilds the container and runs the verification script.

## Enable live data

Edit `.env` and enable only the adapters you are ready to use. Example:

```env
FRIDAY_MODE=live
FRIDAY_DOCKER_ENABLED=true
FRIDAY_PROXMOX_ENABLED=false
FRIDAY_ENDPOINTS_ENABLED=false
```

Then:

```bash
docker compose up -d --build
```

See `docs/live-integrations.md` for Proxmox tokens and endpoint monitoring.

## Local development

```bash
npm install
npm test
npm run build
npm run dev
```

The production server is:

```bash
npm run start
```

It serves both the compiled UI and API from port `3010`.

## API

```text
GET  /healthz
GET  /api/health
GET  /api/overview
POST /api/commands/preview
```

## Important architecture rule

Do **not** give the browser direct credentials to Proxmox, Omada, Docker, AdGuard, or other infrastructure services. Secrets stay server-side and each system gets its own adapter with minimal permissions.

Start Codex by reading `AGENTS.md`, `CODEX.md`, `docs/security-model.md`, and `docs/live-integrations.md`.
