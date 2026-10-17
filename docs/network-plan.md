# Friday VLAN Network Plan

Friday's current production/staging architecture uses Proxmox `nic1` through VLAN-aware bridge `vmbr1`, with `10.1.<VLAN>.0/24` addressing. `vmbr0`/`nic0` remains the legacy rollback network and must not be modified by application work. `vmbr1` itself must not receive an IP address or default gateway.

## Configured VLANs

| Function | VLAN | Subnet |
|---|---:|---|
| Management | 2 | `10.1.2.0/24` |
| Infrastructure | 10 | `10.1.10.0/24` |
| Production | 20 | `10.1.20.0/24` |
| Development | 30 | `10.1.30.0/24` |
| Reserved/workload | 40 | `10.1.40.0/24` |
| Reserved/workload | 50 | `10.1.50.0/24` |
| Media | 60 | `10.1.60.0/24` |
| Identity | 70 | `10.1.70.0/24` |
| Native/parking | 99 | `10.1.99.0/24` |

VLAN 80 is not configured and must not be introduced.

## Application safety boundary

- Workloads must not receive a second default gateway.
- Live Proxmox/guest inspection is authoritative over proposed host numbering.
- Do not alter VLANs, bridges, physical NIC mappings, vmbr0, DHCP, DNS, firewall rules, Omada, ER7206, Nginx Proxy Manager, AdGuard, Twingate, Cloudflare, or OPNsense from Friday application work.
- Address migration in this repository changes Friday application configuration only after the target service path is verified live.

See `docs/codex/BUILD_STATUS.md` for the latest verified guest mappings and documented discrepancies.
