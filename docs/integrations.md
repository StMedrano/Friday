# Friday Integrations

Friday integrations are server-side and read-only unless a future action adapter is explicitly introduced after authentication, approval, and audit controls exist.

## VM100 Docker observer
- Controller adapter: `server/adapters/vm100-observer.mjs`
- Observer service: `observer/`
- Transport: token-authenticated HTTP from VM102 to VM100 on `192.168.1.74:3199`.
- Observer Docker access: local Unix socket only.
- Exposed routes: `GET /health` and `GET /api/v1/containers` only.
- Purpose: sanitized VM100 container inventory.
- Never expose Docker's native TCP API.

## Local Docker Engine on VM102
- Adapter: `server/adapters/docker.mjs`
- Transport: local Unix socket.
- Disabled by default.
- Host label defaults to `VM 102` through `FRIDAY_DOCKER_HOST_NAME`.
- Use the explicit Compose live override only when local controller Docker inventory is intentionally required.

## Proxmox VE
- Adapter: `server/adapters/proxmox.mjs`
- Authentication: dedicated API token.
- Use the smallest read-only role that can list nodes, VMs/CTs, and status.
- Never reuse the root password or a broad administrator token.
- `FRIDAY_PROXMOX_INSECURE=true` is a bootstrap exception for a trusted self-signed certificate.

## HTTP endpoint checks
- Adapter: `server/adapters/endpoints.mjs`
- Purpose: read-only availability checks of known HTTP/HTTPS services.
- Do not place credentials in `FRIDAY_ENDPOINT_URLS` query strings.

## OpenAI
- Adapter: `server/ai/openai.mjs`
- API key: `OPENAI_API_KEY` on the FRIDAY server/container only.
- AI remains advisory and receives no Docker, Proxmox, shell, or network mutation tools.

## Adapter checklist
Every provider must have explicit opt-in configuration, least-privilege credentials, timeouts, degraded-state handling, normalized responses, tests without real credentials, server-side secrets, and a working credential-free mock mode.
