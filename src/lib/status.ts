import type { InfrastructureStatus } from './infrastructure'

const labels: Record<InfrastructureStatus, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
  maintenance: 'Maintenance'
}

const priorities: Record<InfrastructureStatus, number> = {
  online: 0,
  maintenance: 1,
  degraded: 2,
  offline: 3
}

export const statusLabel = (status: InfrastructureStatus) => labels[status]
export const statusPriority = (status: InfrastructureStatus) => priorities[status]

export type HealthLevel = 'nominal' | 'attention' | 'critical' | 'unknown'

const healthLabels: Record<HealthLevel, string> = {
  nominal: 'Nominal',
  attention: 'Attention',
  critical: 'Critical',
  unknown: 'No data'
}

type HealthService = { status: InfrastructureStatus }

export function summarizeHealth<T extends HealthService>(services: T[], openIncidents: number) {
  const online = services.filter((service) => service.status === 'online').length
  const attention = services
    .filter((service) => service.status === 'degraded' || service.status === 'offline')
    .sort((a, b) => statusPriority(b.status) - statusPriority(a.status))
  const level: HealthLevel = !services.length ? 'unknown'
    : attention.some((service) => service.status === 'offline') ? 'critical'
    : attention.length || openIncidents > 0 ? 'attention'
    : 'nominal'
  return {
    level,
    label: healthLabels[level],
    online,
    total: services.length,
    percent: services.length ? Math.round((online / services.length) * 100) : null,
    attention
  }
}
