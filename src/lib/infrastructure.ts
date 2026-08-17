export type InfrastructureStatus = 'online' | 'degraded' | 'offline' | 'maintenance'

export type Site = {
  id: string
  name: string
  location: string
  status: InfrastructureStatus
  gateway: string
  network: string
  latencyMs: number
  vpn: InfrastructureStatus
  devicesOnline: number
  devicesTotal: number
}

export type Service = {
  id: string
  name: string
  category: 'virtualization' | 'network' | 'container' | 'dns' | 'media' | 'monitoring' | 'app'
  host: string
  site: string
  status: InfrastructureStatus
  detail: string
  updated: string
}

export type ActivityItem = {
  id: string
  title: string
  detail: string
  time: string
  status: InfrastructureStatus
}

export type AlertItem = {
  id: string
  title: string
  detail: string
  severity: 'info' | 'warning' | 'critical'
  source: string
}

export type ResourceMetric = {
  label: string
  value: number
  helper: string
}
