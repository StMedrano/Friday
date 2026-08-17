export function getMockOverview() {
  return {
    mode: 'mock',
    sites: [
      { id: 'site-a', name: 'Site A', location: 'Home', status: 'online', gateway: '10.10.10.1', network: '10.10.0.0/16', latencyMs: 12, vpn: 'online', devicesOnline: 16, devicesTotal: 16 },
      { id: 'site-b', name: 'Site B', location: 'Remote', status: 'online', gateway: '10.20.10.1', network: '10.20.0.0/16', latencyMs: 28, vpn: 'online', devicesOnline: 8, devicesTotal: 8 },
    ],
    services: [
      { id: 'proxmox', name: 'Proxmox', category: 'virtualization', host: 'pve', site: 'Site A', status: 'online', detail: 'Hypervisor', updated: 'now' },
      { id: 'vm100', name: 'VM 100', category: 'container', host: 'ubuntu-docker', site: 'Site A', status: 'online', detail: 'Infrastructure', updated: 'now' },
      { id: 'vm110', name: 'VM 110', category: 'media', host: 'umbrel', site: 'Site A', status: 'online', detail: 'Media', updated: 'now' },
      { id: 'omada', name: 'Omada Controller', category: 'network', host: 'vm100', site: 'Site A', status: 'online', detail: '2 sites', updated: 'now' },
      { id: 'adguard', name: 'AdGuard Home', category: 'dns', host: 'vm100', site: 'Site A', status: 'online', detail: 'DNS filtering', updated: 'now' },
    ],
    alerts: [
      { id: 'mock-alert', title: 'Friday is running in mock mode', detail: 'Configure live adapters when VM 100 credentials are ready.', severity: 'info', source: 'Friday' },
    ],
    resources: [
      { label: 'CPU', value: 32, helper: 'Sample VM 100 metric' },
      { label: 'Memory', value: 61, helper: 'Sample VM 100 metric' },
      { label: 'Storage', value: 42, helper: 'Sample VM 100 metric' },
    ],
    activities: [
      { id: 'boot', title: 'Friday control plane ready', detail: 'Safe mock mode', time: 'now', status: 'online' },
    ],
  }
}
