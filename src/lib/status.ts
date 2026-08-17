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
