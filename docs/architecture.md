# Friday Architecture

```text
Browser
   |
   v
FRIDAY UI/API — VM 102 (192.168.1.64:3010)
   |
   +--> Proxmox read-only API — 192.168.1.211:8006
   +--> VM100 observer — 192.168.1.74:3199
   +--> HTTP endpoint checks
   +--> optional local VM102 Docker adapter
   |
   v
Future policy / approval / audit layer
```

VM 102 is the authoritative FRIDAY controller. VM 100 is managed infrastructure and hosts the standalone read-only Docker observer; VM 110 remains the media/Umbrel workload.

## Safety boundaries

The controller base Compose does not mount the Docker socket. Proxmox and the VM100 observer are network read-only integrations. Local VM102 Docker observation is an explicit opt-in through the live override.

The VM100 observer uses the local Unix socket but exposes only `GET /health` and authenticated `GET /api/v1/containers`. Docker's native TCP API is never published.

No infrastructure mutation endpoints exist in the current controller or observer.
