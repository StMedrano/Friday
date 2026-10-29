import { useEffect, useState } from 'react'
import type { ActivityItem, AlertItem, ResourceMetric, Service, Site } from './infrastructure'
import { activities, alerts, resources, services, sites } from '../data/mock'

export type FridayAssistantMode = 'cloud-ai' | 'local-ai' | 'local-analysis' | 'local-agent'

export type FridayAssistantAttempt = { provider: string; outcome: string }

export type FridayAssistantResponse = {
  available: boolean
  error?: string
  mode?: FridayAssistantMode
  provider?: string
  model?: string | null
  modelProfile?: string
  agentId?: string
  agentName?: string
  routing?: FridayAgentRoutingProvenance
  execution?: FridayAgentExecution
  text?: string
  reason?: string
  fallbackUsed?: boolean
  attempts?: FridayAssistantAttempt[]
}

export type FridayAssistantHistoryMessage = { role: 'user' | 'assistant'; content: string }
export type FridayAssistantRequestOptions = { history?: FridayAssistantHistoryMessage[]; signal?: AbortSignal }
export type FridayAgentRouting = 'manual' | 'deterministic' | 'local-router' | 'none'

export type FridayAgentRoutingProvenance = {
  matched: true
  method: FridayAgentRouting
  confidence: number
  reason: string
}

export type FridayAgentRouteResponse = {
  matched: boolean
  agentId?: string
  agentName?: string
  routing: FridayAgentRouting
  confidence: number
  reason: string
  error?: string
}

export type FridayAgentExecution = { performed: false; reason: string }

export type FridayAgentResponse = {
  available: boolean
  mode?: 'local-agent'
  provider?: 'ollama'
  agentId?: string
  agentName?: string
  modelProfile?: string
  model?: string | null
  text?: string
  reason?: string
  error?: string
  execution: FridayAgentExecution
}

export type FridayAgent = {
  version: string
  id: string
  name: string
  description: string
  enabled: boolean
  model: { profile: string }
  scope: Record<string, unknown>
  tools: string[]
  permissions: Record<string, unknown>
  instructions?: string[]
  source: { path?: string; checksum?: string; syncedAt?: string | null }
}

export type FridayAgentRegistryStatus = {
  id?: string
  status?: string
  lastSyncAt?: string | null
  sourceCommit?: string | null
  agentsSeen?: number
  agentsSynced?: number
  agentsRejected?: number
  errors?: string[]
}

export type FridayRepository = { id: string; name: string; remote?: string; defaultBranch: string; mode: string; enabled: boolean }
export type FridayRepositoryStatus = { branch: string; dirty: boolean }

async function repositoryGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'GET', signal })
  const body = await response.json() as T | { error?: string }
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? body.error : undefined
    throw new Error(error || 'Repository request failed')
  }
  return body as T
}

export function fetchFridayRepositories(signal?: AbortSignal) {
  return repositoryGet<FridayRepository[]>('/api/repositories', signal)
}

export function fetchFridayRepositoryStatus(id: string, signal?: AbortSignal) {
  return repositoryGet<FridayRepositoryStatus>(`/api/repositories/${encodeURIComponent(id)}/status`, signal)
}

export function fetchFridayRepositoryFiles(id: string, path = '.', signal?: AbortSignal) {
  const query = new URLSearchParams({ path, limit: '100' })
  return repositoryGet<string[]>(`/api/repositories/${encodeURIComponent(id)}/files?${query}`, signal)
}

export function fetchFridayRepositoryFile(id: string, path: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ path })
  return repositoryGet<{ path: string; content: string }>(`/api/repositories/${encodeURIComponent(id)}/file?${query}`, signal)
}

export type FridayAuditEvent = {
  seq: number; requestId: string; at: string; action: string
  phase: 'requested' | 'succeeded' | 'failed' | 'denied'
  actor: { kind: 'human' | 'service' | 'unauthenticated'; id: string | null; label: string | null }
  target: string | null; detail: string | null; prev: string; hash: string
}
export type FridayAuditPage = { integrity: 'verified' | 'broken'; events: FridayAuditEvent[]; nextBefore: number | null }

export class FridayAuditError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export async function fetchFridayAuditEvents(before: number | null = null, signal?: AbortSignal): Promise<FridayAuditPage> {
  const query = new URLSearchParams({ limit: '50' })
  if (before !== null) query.set('before', String(before))
  const response = await fetch(`/api/audit/events?${query}`, { method: 'GET', signal })
  const body = await response.json().catch(() => ({})) as FridayAuditPage | { error?: string }
  if (!response.ok) throw new FridayAuditError('error' in body && body.error ? body.error : 'audit-unavailable', response.status)
  return body as FridayAuditPage
}

export type FridayCredentialState = 'present' | 'missing' | 'not-required'
export type FridaySettingsIntegration = {
  id: string; name: string; enabled: boolean; configured: boolean; credentials: FridayCredentialState
  site: string | null; tls: 'verified' | 'unverified' | null; checks?: number; error?: string | null
}
export type FridaySettings = {
  mode: 'live' | 'mock'
  access: { originVerification: boolean; configured: boolean; operators: number }
  integrations: FridaySettingsIntegration[]
  ai: { enabled: boolean; providerOrder: string[]; cloudTimeoutMs: number | null; localTimeoutMs: number | null
    providers: Array<{ id: string; inOrder: boolean; credentials: FridayCredentialState; model: string | null; enabled?: boolean }> }
  notifications?: { ntfy: boolean }
  monitoring: { enabled: boolean; pollSeconds: number | null; offlineGraceSeconds: number | null; historyLimit: number | null; diagnostics: boolean }
  automationApi: { enabled: boolean; port: number | null; serviceTokens: number; readOnly: boolean }
  audit: { enabled: boolean; integrity: 'verified' | 'broken' | 'unavailable' | null; events: number | null }
  safety: { writableSettings: boolean; infrastructureActions: boolean; executor: boolean }
}

export type FridaySiteSettings = {
  sites: Array<{ id: string; name: string }>
  sources: Array<{ id: string; name: string; site: string | null; defaultSite: string; enabled: boolean }>
}

export class FridaySiteSettingsError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

function siteSettingsBody(body: unknown, status: number): FridaySiteSettings {
  const value = body as Partial<FridaySiteSettings> & { error?: string }
  if (status >= 400 || !Array.isArray(value?.sites) || !Array.isArray(value?.sources))
    throw new FridaySiteSettingsError(typeof value?.error === 'string' ? value.error : 'site-settings-unavailable', status)
  return value as FridaySiteSettings
}

export async function fetchSiteSettings(signal?: AbortSignal): Promise<FridaySiteSettings> {
  const response = await fetch('/api/settings/sites', { method: 'GET', signal })
  return siteSettingsBody(await response.json().catch(() => ({})), response.status)
}

export async function saveSiteSettings(settings: { sites: string[]; sources: Record<string, string | null> }): Promise<FridaySiteSettings> {
  const response = await fetch('/api/settings/sites', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings),
  })
  return siteSettingsBody(await response.json().catch(() => ({})), response.status)
}

export type FridayEndpointCheck = { id: string; name: string; site: string; url: string; expectedStatuses: number[] | null }
export type FridayEndpointCheckInput = Omit<FridayEndpointCheck, 'id'>
export type FridayEndpointChecks = { managed: boolean; enabled: boolean; limit: number; checks: FridayEndpointCheck[] }

export class FridayEndpointChecksError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

async function endpointChecksResponse(response: Response): Promise<FridayEndpointChecks> {
  const value = await response.json().catch(() => ({})) as Partial<FridayEndpointChecks> & { error?: string }
  if (response.status >= 400 || !Array.isArray(value?.checks))
    throw new FridayEndpointChecksError(typeof value?.error === 'string' ? value.error : 'endpoint-checks-unavailable', response.status)
  return value as FridayEndpointChecks
}

const ENDPOINT_CHECKS = '/api/settings/endpoints'
const jsonRequest = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export async function fetchEndpointChecks(signal?: AbortSignal): Promise<FridayEndpointChecks> {
  return endpointChecksResponse(await fetch(ENDPOINT_CHECKS, { method: 'GET', signal }))
}

export async function createEndpointCheck(check: FridayEndpointCheckInput): Promise<FridayEndpointChecks> {
  return endpointChecksResponse(await fetch(ENDPOINT_CHECKS, jsonRequest('POST', check)))
}

export async function updateEndpointCheck(id: string, check: FridayEndpointCheckInput): Promise<FridayEndpointChecks> {
  return endpointChecksResponse(await fetch(`${ENDPOINT_CHECKS}/${encodeURIComponent(id)}`, jsonRequest('PUT', check)))
}

export async function deleteEndpointCheck(id: string): Promise<FridayEndpointChecks> {
  return endpointChecksResponse(await fetch(`${ENDPOINT_CHECKS}/${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

export type FridayRepositoryEntry = {
  id: string; name: string; path: string; remote?: string; defaultBranch: string
  mode: 'read-only' | 'development' | 'pr-enabled'; enabled: boolean; exclude: string[]
}
export type FridayRepositoryEntryInput = Omit<FridayRepositoryEntry, 'id' | 'mode' | 'remote'> & { remote?: string }
export type FridayRepositorySettings = { managed: boolean; allowedRoots: string[]; limit: number; repositories: FridayRepositoryEntry[] }

export class FridayRepositorySettingsError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

async function repositorySettingsResponse(response: Response): Promise<FridayRepositorySettings> {
  const value = await response.json().catch(() => ({})) as Partial<FridayRepositorySettings> & { error?: string }
  if (response.status >= 400 || !Array.isArray(value?.repositories))
    throw new FridayRepositorySettingsError(typeof value?.error === 'string' ? value.error : 'repository-settings-unavailable', response.status)
  return value as FridayRepositorySettings
}

const REPOSITORY_SETTINGS = '/api/settings/repositories'

export async function fetchRepositorySettings(signal?: AbortSignal): Promise<FridayRepositorySettings> {
  return repositorySettingsResponse(await fetch(REPOSITORY_SETTINGS, { method: 'GET', signal }))
}

export async function createRepositoryEntry(entry: FridayRepositoryEntryInput): Promise<FridayRepositorySettings> {
  return repositorySettingsResponse(await fetch(REPOSITORY_SETTINGS, jsonRequest('POST', entry)))
}

export async function updateRepositoryEntry(id: string, entry: FridayRepositoryEntryInput): Promise<FridayRepositorySettings> {
  return repositorySettingsResponse(await fetch(`${REPOSITORY_SETTINGS}/${encodeURIComponent(id)}`, jsonRequest('PUT', entry)))
}

export async function deleteRepositoryEntry(id: string): Promise<FridayRepositorySettings> {
  return repositorySettingsResponse(await fetch(`${REPOSITORY_SETTINGS}/${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

export async function fetchFridaySettings(signal?: AbortSignal): Promise<FridaySettings> {
  const response = await fetch('/api/settings', { method: 'GET', signal })
  if (!response.ok) throw new Error('settings-unavailable')
  return await response.json() as FridaySettings
}

export type FridayIncident = {
  id: string; fingerprint?: string; type: string; title: string; detail: string
  severity: 'high' | 'warning' | 'info'; status: 'open' | 'resolved'; source: string; host: string
  serviceId?: string; serviceName?: string; firstSeen: string; lastSeen: string; openedAt: string
  resolvedAt: string | null; recommendedAction: string; evidence: string[]
}

export type MonitoringSummary = {
  enabled: boolean; status: 'disabled' | 'starting' | 'ok' | 'degraded'; lastPollAt: string | null
  lastSuccessAt: string | null; lastError: string | null; activeIncidents: number; openHigh: number; openWarning: number
}

export type MonitoringEvent = { id: string; type: string; at: string; source: string; host?: string; serviceId?: string; serviceName?: string; detail: string }
export type DiagnosticFact = { id: string; label: string; value: string }
export type DiagnosticReport = {
  id?: string; incidentId: string; source?: string; host?: string; serviceId?: string; serviceName?: string; collectedAt?: string
  status: 'pending' | 'available' | 'degraded' | 'unavailable' | 'not-supported'; metadata?: Record<string, unknown> | null
  facts?: DiagnosticFact[]; findings?: string[]; likelyCauses?: string[]; recommendations?: string[]; logsAvailable?: boolean
  lastLogInspectionAt?: string | null; error?: string | null; reason?: string
}
export type DiagnosticLogsResponse = { incidentId: string; serviceName?: string; host?: string; tail: number; logs: string; truncated: boolean; observedAt?: string }

export type FridayOverview = {
  mode: 'mock' | 'live'; generatedAt?: string; sites: Site[]; services: Service[]; alerts: AlertItem[]
  resources: ResourceMetric[]; activities: ActivityItem[]; integrations?: Array<{ id: string; enabled: boolean; mode: string }>
  incidents?: FridayIncident[]; monitoring?: MonitoringSummary | null
}

const fallback: FridayOverview = { mode: 'mock', sites, services, alerts, resources, activities, incidents: [], monitoring: null }

export function useFridayOverview() {
  const [overview, setOverview] = useState<FridayOverview>(fallback)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/overview', { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`Friday API ${response.status}`); return response.json() })
      .then((data: FridayOverview) => { setOverview(data); setConnected(true) })
      .catch(() => setConnected(false))
    return () => controller.abort()
  }, [])
  return { overview, connected }
}

export async function askFridayAssistant(prompt: string, { history = [], signal }: FridayAssistantRequestOptions = {}): Promise<FridayAssistantResponse> {
  const response = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, history }), signal })
  const body = await response.json() as FridayAssistantResponse
  if (!response.ok) {
    throw Object.assign(new Error(body.reason || 'Friday assistant unavailable'), { response: body })
  }
  return body
}

export async function fetchFridayAgents(signal?: AbortSignal): Promise<FridayAgent[]> {
  const response = await fetch('/api/agents', { method: 'GET', signal })
  const body = await response.json() as FridayAgent[] | { error?: string }
  if (!response.ok) throw new Error(!Array.isArray(body) && body.error ? body.error : 'Agent registry unavailable')
  return Array.isArray(body) ? body : []
}

export async function fetchFridayAgentRegistryStatus(signal?: AbortSignal): Promise<FridayAgentRegistryStatus> {
  const response = await fetch('/api/agents/registry/status', { method: 'GET', signal })
  const body = await response.json() as FridayAgentRegistryStatus | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Agent registry unavailable')
  return body as FridayAgentRegistryStatus
}

export async function syncFridayAgentRegistry(signal?: AbortSignal): Promise<FridayAgentRegistryStatus> {
  const response = await fetch('/api/agents/registry/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}), signal })
  const body = await response.json() as FridayAgentRegistryStatus | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Agent registry sync unavailable')
  return body as FridayAgentRegistryStatus
}

export async function routeFridayAgent(prompt: string, signal?: AbortSignal): Promise<FridayAgentRouteResponse> {
  const response = await fetch('/api/agents/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }), signal })
  const body = await response.json() as FridayAgentRouteResponse
  if (!response.ok) throw new Error(body.reason || body.error || 'Friday agent routing unavailable')
  return body
}

export async function askFridayAgent(agentId: string, prompt: string, signal?: AbortSignal): Promise<FridayAgentResponse> {
  const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }), signal })
  const body = await response.json() as FridayAgentResponse
  if (!response.ok) throw new Error(body.reason || body.error || 'Local agent inference unavailable')
  return body
}

export async function fetchMonitoringHistory(signal?: AbortSignal) {
  const response = await fetch('/api/monitoring/history', { signal })
  if (!response.ok) throw new Error(`Friday monitoring history ${response.status}`)
  const body = await response.json() as { events?: MonitoringEvent[] }
  return Array.isArray(body.events) ? body.events : []
}

function incidentPath(id: string, suffix: 'diagnostics' | 'logs') { return `/api/incidents/${encodeURIComponent(id)}/${suffix}` }

export async function fetchIncidentDiagnostics(incidentId: string, signal?: AbortSignal) {
  const response = await fetch(incidentPath(incidentId, 'diagnostics'), { method: 'GET', signal })
  const body = await response.json() as DiagnosticReport | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : `Friday diagnostics ${response.status}`)
  return body as DiagnosticReport
}

export async function rerunIncidentDiagnostics(incidentId: string, signal?: AbortSignal) {
  const response = await fetch(`${incidentPath(incidentId, 'diagnostics')}/rerun`, { method: 'POST', signal })
  const body = await response.json() as DiagnosticReport | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : `Friday diagnostic rerun ${response.status}`)
  return body as DiagnosticReport
}

export async function fetchIncidentLogs(incidentId: string, signal?: AbortSignal) {
  const response = await fetch(incidentPath(incidentId, 'logs'), { method: 'GET', signal })
  const body = await response.json() as DiagnosticLogsResponse | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : `Friday diagnostic logs ${response.status}`)
  return body as DiagnosticLogsResponse
}

export async function previewFridayCommand(message: string) {
  const response = await fetch('/api/commands/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) })
  const body = await response.json()
  if (!response.ok) throw new Error(body.reason || 'Command preview failed')
  return body as { accepted: boolean; command: string; message: string; mode: 'preview' }
}
