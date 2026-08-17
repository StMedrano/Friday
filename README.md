# Friday

Friday is a two-site homelab control-plane UI. This initial upload is intentionally frontend-first: it gives Codex a clean, runnable application and documented integration boundaries before any privileged Proxmox, Omada, Docker, or automation credentials are introduced.

## What is included

- Responsive dark operations dashboard
- Site A + Site B status
- Site-to-site VPN visibility
- Proxmox / VM 100 / VM 110 service inventory
- Omada, AdGuard, Nginx Proxy Manager and infrastructure service state
- VM 100 resource utilization
- Alerts and recent activity
- Interactive Friday command composer in safe preview mode
- Typed infrastructure domain model and isolated mock data
- Docker + Nginx deployment for VM 100
- Codex continuation guide and network architecture notes
- Superpowers design + implementation plan documents

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints, normally `http://localhost:5173`.

## Run on VM 100 with Docker

```bash
git clone https://github.com/StMedrano/Friday.git
cd Friday
cp .env.example .env
docker compose up -d --build
```

Friday defaults to:

```text
http://<VM100-IP>:3010
```

Port `3010` was selected to avoid the existing Homepage deployment on port `3000`.

## Verify

```bash
./scripts/verify.sh
```

## Architecture rule

Do **not** give the browser direct credentials to Proxmox, Omada, Docker, AdGuard, or other infrastructure services. Future live data should flow through a Friday backend/API with narrowly scoped credentials and explicit action policies.

Read `CODEX.md` before adding integrations.
