# Friday Live Integrations

Friday starts in `mock` mode. Live integrations are opt-in and read-only.

## Proxmox on VM102

Set `FRIDAY_MODE=live` and configure the dedicated read-only Proxmox token in VM102's `.env`. Proxmox uses the base `compose.yaml`; no Docker socket mount is required.

## VM100 Docker observer

The deployed VM100 address is `192.168.1.124`. Configure the token-authenticated observer on port `3199` and configure the same token server-side on VM102:

```env
FRIDAY_VM100_OBSERVER_ENABLED=true
FRIDAY_VM100_OBSERVER_URL=http://192.168.1.124:3199
FRIDAY_VM100_OBSERVER_TOKEN=
FRIDAY_VM100_OBSERVER_HOST_NAME=VM 100
```

Recreate FRIDAY with the base Compose file. The controller queries only the observer API; Docker's native TCP API is not exposed.

## Monitoring & Incidents

Monitoring consumes the normalized live overview; it does not call Docker/Proxmox mutation APIs and grants no new infrastructure authority.

Enable after the reviewed monitoring milestone is merged and pulled onto VM102:

```env
FRIDAY_MONITORING_ENABLED=true
FRIDAY_MONITORING_POLL_SECONDS=30
FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS=300
FRIDAY_MONITORING_STATE_PATH=/data/monitoring-state.json
FRIDAY_MONITORING_HISTORY_LIMIT=2000
```

Use base `compose.yaml` and keep `FRIDAY_DOCKER_ENABLED=false` for the normal VM100-observer architecture. Monitoring state is persisted in FRIDAY's existing `/data` volume.

## Optional local Docker on VM102

Local Docker observation is separate from VM100 inventory. Enable it only when intentionally needed:

```env
FRIDAY_DOCKER_ENABLED=true
FRIDAY_DOCKER_HOST_NAME=VM 102
```

Then use `make live`, which adds the read-only local socket mount. Keep this disabled for the normal Proxmox + VM100 observer + monitoring architecture.

## HTTP endpoint checks

`FRIDAY_ENDPOINTS_ENABLED=true` enables approved read-only health URLs. Do not embed credentials in URLs.

## Actions

`POST /api/commands/preview` remains preview-only. `/api/incidents` and `/api/monitoring/history` are GET-only. Neither the controller nor VM100 observer implements restart, stop, delete, exec, firewall, VLAN, or other infrastructure mutation endpoints.
