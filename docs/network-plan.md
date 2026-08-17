# Two-Site Network Plan

Friday is designed around two Omada-managed sites connected by routed site-to-site VPN.

## Addressing convention

Use `10.SITE.VLAN.x` as the human-readable hierarchy.

| Function | VLAN | Site A | Site B |
|---|---:|---|---|
| Management | 10 | `10.10.10.0/24` | `10.20.10.0/24` |
| Servers | 20 | `10.10.20.0/24` | `10.20.20.0/24` |
| Trusted | 30 | `10.10.30.0/24` | `10.20.30.0/24` |
| IoT | 40 | `10.10.40.0/24` | `10.20.40.0/24` |
| Cameras | 50 | `10.10.50.0/24` | `10.20.50.0/24` |
| Guest | 60 | `10.10.60.0/24` | `10.20.60.0/24` |
| Lab | 70 | `10.10.70.0/24` | `10.20.70.0/24` |

## Access principle

The homelab can physically remain at Site A and be reachable from authorized Site B networks through Layer-3 VPN routes. Do not stretch a server VLAN across both sites merely to make addresses look local.

Recommended policy intent:
- Management -> infrastructure administration allowed as needed.
- Trusted -> approved homelab services allowed.
- Servers -> explicit east/west rules only.
- IoT -> narrowly scoped service access.
- Cameras -> recorder/required destinations only.
- Guest -> Internet only.
- Lab -> isolated by default, explicit exceptions.

Do not implement these VLANs automatically from this repository. This file is a design target for later Omada/network work.
