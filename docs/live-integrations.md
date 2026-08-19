# Friday Live Integrations

Friday starts in `mock` mode. Live integrations are opt-in and read-only.

## Proxmox on VM102

Set `FRIDAY_MODE=live` and configure the dedicated read-only Proxmox token in VM102's `.env`. Proxmox uses the base `compose.yaml`; no Docker socket mount is required.

## VM100 Docker observer

Deploy `observer/` on VM100 (`192.168.1.74`) after confirming port `3199` is unused. Configure a strong bearer token in VM100's observer `.env`, then configure the same token server-side on VM102:

```env
FRIDAY_VM100_OBSERVER_ENABLED=true
FRIDAY_VM100_OBSERVER_URL=http://192.168.1.74:3199
FRIDAY_VM100_OBSERVER_TOKEN=
FRIDAY_VM100_OBSERVER_HOST_NAME=VM 100
```

Recreate FRIDAY with the base Compose file. The controller queries only the observer API; Docker's native TCP API is not exposed.

## Optional local Docker on VM102

Local Docker observation is separate from VM100 inventory. Enable it only when intentionally needed:

```env
FRIDAY_DOCKER_ENABLED=true
FRIDAY_DOCKER_HOST_NAME=VM 102
```

Then use `make live`, which adds the read-only local socket mount. Keep this disabled for the normal Proxmox + VM100 observer architecture.

## HTTP endpoint checks

`FRIDAY_ENDPOINTS_ENABLED=true` enables approved read-only health URLs. Do not embed credentials in URLs.

## Actions

`POST /api/commands/preview` remains preview-only. Neither the controller nor VM100 observer implements restart, stop, delete, exec, firewall, VLAN, or other infrastructure mutation endpoints.
