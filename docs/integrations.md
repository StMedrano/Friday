# Friday Integrations

Friday integrations are server-side and read-only unless a future action adapter is explicitly introduced after authentication, approval, and audit controls exist.

## Docker Engine
- Current adapter: `server/adapters/docker.mjs`
- Transport: local Unix socket.
- Deployment: socket is mounted read-only only by `compose.live.yaml`.
- Purpose: container inventory/health.
- Do not expose Docker TCP without authenticated TLS and a separate architecture review.

## Proxmox VE
- Current adapter: `server/adapters/proxmox.mjs`
- Authentication: dedicated API token.
- Use the smallest read-only role that can list nodes, VMs/CTs, and status.
- Never reuse the root password or a broad administrator token.
- `FRIDAY_PROXMOX_INSECURE=true` is a bootstrap exception for a trusted self-signed certificate, not the desired end state.

## HTTP endpoint checks
- Current adapter: `server/adapters/endpoints.mjs`
- Purpose: read-only availability checks of known HTTP/HTTPS services.
- Do not place credentials in `FRIDAY_ENDPOINT_URLS` query strings.

## OpenAI
- Current adapter: `server/ai/openai.mjs`
- API key: `OPENAI_API_KEY` on the Friday server/container only.
- Enable with `FRIDAY_AI_ENABLED=true`.
- Default model: `gpt-5.6-terra`, configurable with `OPENAI_MODEL`.
- Friday sends normalized infrastructure state for advisory analysis.
- No Docker, Proxmox, shell, or network mutation tools are exposed to the model.

## Planned adapters
- Omada controller: site/device/health only first.
- AdGuard Home: status/statistics only first.
- Prometheus/Uptime Kuma/Grafana: consume existing monitoring data where possible.

## Adapter checklist
For every provider:
1. Explicit disabled-by-default configuration.
2. Dedicated least-privilege credential.
3. Timeout and degraded-state handling.
4. Provider response normalization.
5. Tests without real credentials.
6. `.env.example` names with empty secrets.
7. Documentation of minimum permissions.
8. Mock mode still passes all tests with no credentials.
