import type { ActivityItem, AlertItem, ResourceMetric, Service, Site } from '../lib/infrastructure'

export const sites: Site[] = [
  { id: 'site-a', name: 'Site A', location: 'Primary Homelab', status: 'online', gateway: 'ER7206', network: '10.10.0.0/16', latencyMs: 4, vpn: 'online', devicesOnline: 31, devicesTotal: 32 },
  { id: 'site-b', name: 'Site B', location: 'Remote Site', status: 'online', gateway: 'Omada Gateway', network: '10.20.0.0/16', latencyMs: 18, vpn: 'online', devicesOnline: 17, devicesTotal: 18 }
]

export const services: Service[] = [
  { id: 'proxmox', name: 'Proxmox VE', category: 'virtualization', host: 'pve-01', site: 'Site A', status: 'online', detail: 'Hypervisor · 8 VMs', updated: '12 sec ago' },
  { id: 'vm100', name: 'VM 100 · Infrastructure', category: 'container', host: 'ubuntu-docker', site: 'Site A', status: 'online', detail: 'Docker host · 14 containers', updated: '8 sec ago' },
  { id: 'omada', name: 'Omada Controller', category: 'network', host: 'vm100', site: 'Both Sites', status: 'online', detail: '2 sites · 9 managed devices', updated: '15 sec ago' },
  { id: 'adguard', name: 'AdGuard Home', category: 'dns', host: 'vm100', site: 'Both Sites', status: 'online', detail: 'DNS · Filtering active', updated: '22 sec ago' },
  { id: 'npm', name: 'Nginx Proxy Manager', category: 'network', host: 'vm100', site: 'Site A', status: 'online', detail: 'Reverse proxy · TLS', updated: '18 sec ago' },
  { id: 'umbrel', name: 'VM 110 · Umbrel', category: 'media', host: 'umbrel', site: 'Site A', status: 'degraded', detail: 'Media services · 1 warning', updated: '31 sec ago' }
]

export const resources: ResourceMetric[] = [
  { label: 'CPU', value: 34, helper: '8 cores allocated' },
  { label: 'Memory', value: 61, helper: '12.2 GB of 20 GB' },
  { label: 'Storage', value: 42, helper: '842 GB used' },
  { label: 'Containers', value: 78, helper: '14 of 18 expected' }
]

export const activities: ActivityItem[] = [
  { id: 'a1', title: 'Site-to-site VPN healthy', detail: 'Site A ↔ Site B tunnel verified', time: '2 min ago', status: 'online' },
  { id: 'a2', title: 'VM 100 backup completed', detail: 'Infrastructure snapshot verified', time: '18 min ago', status: 'online' },
  { id: 'a3', title: 'Umbrel service warning', detail: 'One media container restarted', time: '34 min ago', status: 'degraded' },
  { id: 'a4', title: 'Omada inventory synced', detail: 'All managed devices accounted for', time: '1 hr ago', status: 'online' }
]

export const alerts: AlertItem[] = [
  { id: 'al1', title: 'Umbrel restart detected', detail: 'A media workload restarted once in the last hour.', severity: 'warning', source: 'VM 110' },
  { id: 'al2', title: 'Backup destination not configured', detail: 'Friday has a local backup plan but no off-host target yet.', severity: 'info', source: 'Backup' }
]
