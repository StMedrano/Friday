export const VALID_COMMANDS = new Set([
  'health-check',
  'list-alerts',
  'backup-status',
  'network-overview',
  'service-status',
])

export function normalizeOverview(parts = {}) {
  const sites = Array.isArray(parts.sites) ? parts.sites : []
  const services = Array.isArray(parts.services) ? parts.services : []
  const alerts = Array.isArray(parts.alerts) ? parts.alerts : []
  const resources = Array.isArray(parts.resources) ? parts.resources : []
  const activities = Array.isArray(parts.activities) ? parts.activities : []
  return {
    mode: parts.mode === 'live' ? 'live' : 'mock',
    generatedAt: parts.generatedAt ?? new Date().toISOString(),
    sites,
    services,
    alerts,
    resources,
    activities,
  }
}

export function resolveCommandIntent(value = '') {
  const input = String(value).trim().toLowerCase()
  if (!input) return null
  if (VALID_COMMANDS.has(input)) return input
  if (input.includes('health')) return 'health-check'
  if (input.includes('alert')) return 'list-alerts'
  if (input.includes('backup')) return 'backup-status'
  if (input.includes('network') || input.includes('vpn') || input.includes('site')) return 'network-overview'
  if (input.includes('service') || input.includes('container') || input.includes('docker')) return 'service-status'
  return null
}

export function previewCommand(input = {}) {
  const command = resolveCommandIntent(input.command ?? input.message ?? '')
  if (!command) {
    return { accepted: false, mode: 'preview', reason: 'unsupported-command' }
  }
  return {
    accepted: true,
    mode: 'preview',
    command,
    destructive: false,
    requiresApproval: false,
    message: `Preview only: ${command} would run read-only checks.`,
  }
}

export function integrationSummary(config = {}) {
  return [
    { id: 'docker', enabled: config.docker === true, mode: config.docker ? 'live' : 'mock' },
    { id: 'proxmox', enabled: config.proxmox === true, mode: config.proxmox ? 'live' : 'mock' },
    { id: 'vm100-observer', enabled: config.vm100Observer === true, mode: config.vm100Observer ? 'live' : 'mock' },
    { id: 'endpoints', enabled: config.endpoints === true, mode: config.endpoints ? 'live' : 'mock' },
  ]
}
