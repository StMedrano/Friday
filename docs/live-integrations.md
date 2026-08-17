# Friday Live Integrations

Friday starts in `mock` mode. Live integrations are opt-in and read-only.

## Docker on VM 100

1. Set `FRIDAY_MODE=live`.
2. Set `FRIDAY_DOCKER_ENABLED=true`.
3. Keep the Compose mount `/var/run/docker.sock:/var/run/docker.sock:ro`.
4. Rebuild with `docker compose up -d --build`.

Friday reads Docker inventory through the Engine HTTP API over the Unix socket. It does not expose write endpoints.

## Proxmox

Create a dedicated Proxmox API token with the minimum read-only permissions needed to inspect nodes and guest resources. Do not reuse a root password.

Configure:

```env
FRIDAY_MODE=live
FRIDAY_PROXMOX_ENABLED=true
FRIDAY_PROXMOX_URL=https://<proxmox-ip>:8006
FRIDAY_PROXMOX_TOKEN_ID=<user@realm!token-name>
FRIDAY_PROXMOX_TOKEN_SECRET=<secret>
```

Prefer a trusted certificate. `FRIDAY_PROXMOX_INSECURE=true` exists only for a controlled bootstrap period with a self-signed certificate.

## HTTP endpoint checks

Friday can monitor approved HTTP/HTTPS endpoints without credentials:

```env
FRIDAY_ENDPOINTS_ENABLED=true
FRIDAY_ENDPOINT_URLS=http://service-a/healthz,https://service-b.example/health
```

Keep management interfaces off this list if checking them would expose authentication data or if they are not intended to be queried by Friday.

## Omada

The current MVP represents Omada in the domain model and endpoint-health layer but does not yet store Omada administrator credentials or execute Omada actions. Add a dedicated read-only Omada adapter before enabling controller data beyond HTTP health checks.

## Actions

`POST /api/commands/preview` only resolves allowlisted read-only intents. It cannot restart, stop, delete, modify firewall rules, change VLANs, adopt devices, or change VM/container state.

Future write actions must use a separate approval service and an explicit per-action allowlist.
