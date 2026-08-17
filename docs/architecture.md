# Friday Architecture

```text
Browser
   |
   v
Friday UI (VM 100, port 3010)
   |
   | future HTTPS/API only
   v
Friday API / Policy Layer
   |
   +--> Proxmox adapter
   +--> Docker adapter
   +--> Omada adapter
   +--> Monitoring adapter
   +--> AdGuard adapter
   |
   v
Audit + approval layer
```

The initial repository implements only the browser UI. Keeping credentials behind a backend boundary is intentional.

## Frontend boundaries

`src/lib/infrastructure.ts` defines the normalized domain types. `src/data/mock.ts` provides development data. Components consume these domain types. Future API clients should map backend responses into the same shapes.

## Infrastructure model

```text
Proxmox
├── VM 100 Infrastructure
│   ├── Friday UI
│   ├── Omada Controller
│   ├── AdGuard Home
│   ├── Nginx Proxy Manager
│   ├── Arcane
│   ├── Homepage
│   ├── Uptime Kuma
│   └── Monitoring / apps
└── VM 110 Umbrel
    ├── Emby
    └── SABnzbd
```

Friday should observe both VMs while remaining isolated from privileged control surfaces until the backend/policy layer exists.
