import { useEffect, useState } from 'react'
import type { ActivityItem, AlertItem, ResourceMetric, Service, Site } from './infrastructure'
import { activities, alerts, resources, services, sites } from '../data/mock'

export type FridayAssistantMode = 'cloud-ai' | 'local-ai' | 'local-analysis'

export type FridayAssistantAttempt = {
  provider: string
  outcome: string
}

export type FridayAssistantResponse = {
  available: boolean
  mode?: FridayAssistantMode
  provider?: string
  model?: string | null
  text?: string
  reason?: string
  fallbackUsed?: boolean
  attempts?: FridayAssistantAttempt[]
}

export type FridayAssistantHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type FridayAssistantRequestOptions = {
  history?: FridayAssistantHistoryMessage[]
  signal?: AbortSignal
}

export type FridayIncident = {
  id: string
  fingerprint?: string
  type: string
  title: string
  detail: string
  severity: 'high' | 'warning' | 'info'
  status: 'open' | 'resolved'
  source: string
  host: string
  serviceId?: string
  serviceName?: string
  firstSeen: string
  lastSeen: string
  openedAt: string
  resolvedAt: string | null
  recommendedAction: string
  evidence: string[]
}

export type MonitoringSummary = {
  enabled: boolean
  status: 'disabled' | 'starting' | 'ok' | 'degraded'
  lastPollAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  activeIncidents: number
  openHigh: number
  openWarning: number
}

export type MonitoringEvent = {
  id: string
  type: string
  at: string
  source: string
  host?: string
  serviceId?: string
  serviceName?: string
  detail: string
}

export type DiagnosticFact = {
  id: string
  label: string
  value: string
}

export type DiagnosticReport = {
  id?: string
  incidentId: string
  source?: string
  host?: string
  serviceId?: string
  serviceName?: string
  collectedAt?: string
  status: 'pending' | 'available' | 'degraded' | 'unavailable' | 'not-supported'
  metadata?: Record<string, unknown> | null
  facts?: DiagnosticFact[]
  findings?: string[]
  likelyCauses?: string[]
  recommendations?: string[]
  logsAvailable?: boolean
  lastLogInspectionAt?: string | null
  error?: string | null
  reason?: string
}

export type DiagnosticLogsResponse = {
  incidentId: string
  serviceName?: string
  host?: string
  tail: number
  logs: string
  truncated: boolean
  observedAt?: string
}

export type FridayOverview = {
  mode: 'mock' | 'live'
  generatedAt?: string
  sites: Site[]
  services: Service[]
  alerts: AlertItem[]
  resources: ResourceMetric[]
  activities: ActivityItem[]
  integrations?: Array<{ id: string; enabled: boolean; mode: string }>
  incidents?: FridayIncident[]
  monitoring?: MonitoringSummary | null
}

const fallback: FridayOverview = {
  mode: 'mock',
  sites,
  services,
  alerts,
  resources,
  activities,
  incidents: [],
  monitoring: null,
}

export function useFridayOverview() {
  const [overview, setOverview] = useState<FridayOverview>(fallback)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/overview', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Friday API ${response.status}`)
        return response.json()
      })
      .then((data: FridayOverview) => {
        setOverview(data)
        setConnected(true)
      })
      .catch(() => setConnected(false))
    return () => controller.abort()
  }, [])

  return { overview, connected }
}

export async function askFridayAssistant(
  prompt: string,
  { history = [], signal }: FridayAssistantRequestOptions = {},
): Promise<FridayAssistantResponse> {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, history }),
    signal,
  })
  const body = await response.json() as FridayAssistantResponse
  if (!response.ok) throw new Error(body.reason || 'Friday assistant unavailable')
  return body
}

export async function fetchMonitoringHistory(signal?: AbortSignal) {
  const response = await fetch('/api/monitoring/history', { signal })
  if (!response.ok) throw new Error(`Friday monitoring history ${response.status}`)
  const body = await response.json() as { events?: MonitoringEvent[] }
  return Array.isArray(body.events) ? body.events : []
}

function incidentPath(id: string, suffix: 'diagnostics' | 'logs') {
  return `/api/incidents/${encodeURIComponent(id)}/${suffix}`
}

export async function fetchIncidentDiagnostics(incidentId: string, signal?: AbortSignal) {
  const response = await fetch(incidentPath(incidentId, 'diagnostics'), { method: 'GET', signal })
  const body = await response.json() as DiagnosticReport | { error?: string }
  if (!response.ok) {
    throw new Error('error' in body && body.error ? body.error : `Friday diagnostics ${response.status}`)
  }
  return body as DiagnosticReport
}

export async function rerunIncidentDiagnostics(incidentId: string, signal?: AbortSignal) {
  const response = await fetch(`${incidentPath(incidentId, 'diagnostics')}/rerun`, { method: 'POST', signal })
  const body = await response.json() as DiagnosticReport | { error?: string }
  if (!response.ok) {
    throw new Error('error' in body && body.error ? body.error : `Friday diagnostic rerun ${response.status}`)
  }
  return body as DiagnosticReport
}

export async function fetchIncidentLogs(incidentId: string, signal?: AbortSignal) {
  const response = await fetch(incidentPath(incidentId, 'logs'), { method: 'GET', signal })
  const body = await response.json() as DiagnosticLogsResponse | { error?: string }
  if (!response.ok) {
    throw new Error('error' in body && body.error ? body.error : `Friday diagnostic logs ${response.status}`)
  }
  return body as DiagnosticLogsResponse
}

export async function previewFridayCommand(message: string) {
  const response = await fetch('/api/commands/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.reason || 'Command preview failed')
  return body as { accepted: boolean; command: string; message: string; mode: 'preview' }
}
