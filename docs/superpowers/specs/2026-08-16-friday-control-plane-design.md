# Friday Control Plane — Initial UI Design

## Product goal
Friday is the operator console for a two-site homelab. The first release is a frontend-first control plane that makes infrastructure state readable at a glance and gives Codex a clean foundation for later Proxmox, Omada, Docker, monitoring, and agent integrations.

## Initial scope
- Polished dark operations dashboard, not a marketing page or loose card mockup.
- Persistent application shell with navigation and top-level command/search affordance.
- Site A and Site B health, VPN state, infrastructure/service health, resource summaries, alerts, and activity.
- Friday command bar as the primary future AI interaction entry point.
- Mock data behind typed interfaces so real infrastructure APIs can replace it later.
- Responsive desktop/tablet design with usable mobile fallback.
- Dockerized static build suitable for VM 100 behind Nginx Proxy Manager.

## Information architecture
Primary navigation: Dashboard, Sites, Network, Proxmox, Docker, Services, Automations, Agents, Logs, Settings.

Dashboard hierarchy:
1. Environment status and command/search header.
2. KPI strip: sites, VMs, services, active alerts.
3. Site health cards for Site A and Site B.
4. Resource utilization.
5. Service inventory with status and location.
6. Friday activity feed and alerts.
7. Persistent Friday command composer.

## Visual system
- Dark graphite surfaces with subtle elevation, thin borders, and restrained blue/cyan accents.
- Status encoded with text plus icon/color, never color alone.
- Dense but readable spacing.
- Moderate corner radii rather than oversized decorative tiles.
- Compact typography optimized for an operations console.

## Architecture boundaries
- `src/data/mock.ts`: initial data only.
- `src/lib/infrastructure.ts`: domain types.
- `src/lib/status.ts`: status-derived UI behavior.
- `src/components/*`: reusable presentation units.
- `src/pages/Dashboard.tsx`: composition only.

Real integrations should populate the same domain types through adapters instead of changing presentation components.

## VM 100 deployment
The UI builds to static assets served by Nginx in Docker. Compose publishes host port `3010` by default to avoid the existing Homepage service on port `3000`.

## Non-goals for initial upload
- Direct Proxmox/Omada credentials.
- Docker socket mounting.
- Destructive infrastructure actions.
- Authentication.
- Persistent database.
- Live AI execution.
