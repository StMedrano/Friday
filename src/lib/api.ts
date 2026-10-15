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

export async function fetchMonitoringHistory(signal?: AbortSignal): Promise<MonitoringEvent[]> {
  const response = await fetch('/api/monitoring/history', { method:'GET', signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000) })
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    const message = response.status === 503 && failure?.error === 'monitoring-disabled' ? 'Monitoring disabled'
      : response.status === 502 && failure?.error === 'monitoring-history-invalid' ? 'Monitoring history response invalid'
      : 'Monitoring history unavailable'
    throw new Error(message)
  }
  const body: unknown = await response.json().catch(() => { throw new Error('Monitoring history response invalid') })
  const events = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as { events?: unknown }).events : undefined
  const validText = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000
  const validEvent = (value: unknown): value is MonitoringEvent => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const event = value as Record<string, unknown>
    return validText(event.id) && event.id.length > 0 &&
      validText(event.type) && event.type.length > 0 &&
      validText(event.at) && Number.isFinite(Date.parse(event.at)) &&
      validText(event.source) && event.source.length > 0 &&
      validText(event.detail) &&
      ['host', 'serviceId', 'serviceName'].every(key => event[key] === undefined || validText(event[key]))
  }
  if (!Array.isArray(events) || events.length > 5000 || !events.every(validEvent)) {
    throw new Error('Monitoring history response invalid')
  }
  return events
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

export type GroupMember = {
  id: string; name: string; agentId: string | null
  implementation: 'existing' | 'planned'
  state: 'catalogued' | 'configured' | 'disabled' | 'unavailable'
  reason: string
}
export type GroupWorkspace = {
  schemaVersion: '1'; registryStatus: 'ok' | 'unavailable'
  executionEnabled: false; workStatus: 'not-connected'
  groups: Array<{ id: string; name: string; members: GroupMember[] }>
}

const groupUnavailable = () => new Error('Group workspace unavailable.')
function groupObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw groupUnavailable()
  return value as Record<string, unknown>
}
function groupText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw groupUnavailable()
  return value
}
function groupId(value: unknown): string {
  const text = groupText(value, 64)
  if (text.length < 3 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(text)) throw groupUnavailable()
  return text
}
function parseGroupWorkspace(value: unknown): GroupWorkspace {
  const body = groupObject(value, ['schemaVersion', 'registryStatus', 'executionEnabled', 'workStatus', 'groups'])
  if (body.schemaVersion !== '1' || (body.registryStatus !== 'ok' && body.registryStatus !== 'unavailable') ||
      body.executionEnabled !== false || body.workStatus !== 'not-connected' ||
      !Array.isArray(body.groups) || body.groups.length !== 3) throw groupUnavailable()
  const remaining = new Set(['techtactics', 'app-builder', 'homelab'])
  const memberIds = new Set<string>()
  const groups = body.groups.map(value => {
    const group = groupObject(value, ['id', 'name', 'members'])
    const id = groupId(group.id)
    if (!remaining.delete(id) || !Array.isArray(group.members)) throw groupUnavailable()
    const members = group.members.map(value => {
      const member = groupObject(value, ['id', 'name', 'agentId', 'implementation', 'state', 'reason'])
      const id = groupId(member.id)
      if (memberIds.has(id) || memberIds.size >= 40) throw groupUnavailable()
      memberIds.add(id)
      const agentId = member.agentId === null ? null : groupId(member.agentId)
      const implementation = member.implementation
      const state = member.state
      if (agentId === null) {
        if (implementation !== 'planned' || state !== 'catalogued') throw groupUnavailable()
      } else if (implementation !== 'existing' ||
          (state !== 'configured' && state !== 'disabled' && state !== 'unavailable') ||
          (body.registryStatus === 'unavailable' && state !== 'unavailable')) throw groupUnavailable()
      return { id, name: groupText(member.name, 80), agentId, implementation, state,
        reason: groupText(member.reason, 256) } as GroupMember
    })
    return { id, name: groupText(group.name, 80), members }
  })
  return { schemaVersion: '1', registryStatus: body.registryStatus as 'ok' | 'unavailable',
    executionEnabled: false, workStatus: 'not-connected', groups }
}

export async function fetchFridayAgentGroups(signal?: AbortSignal): Promise<GroupWorkspace> {
  try {
    const response = await fetch('/api/agent-groups', { method: 'GET', signal })
    if (!response.ok) throw groupUnavailable()
    return parseGroupWorkspace(await response.json())
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error
    throw groupUnavailable()
  }
}

export type GroupAdvice = FridayAssistantResponse & {
  available: true
  groupId: string
  execution: FridayAgentExecution
}

export async function askFridayGroup(groupId: string, prompt: string, signal?: AbortSignal): Promise<GroupAdvice> {
  const failure = () => new Error('Group advice unavailable. Check the configured AI provider and try again.')
  try {
    const response = await fetch('/api/group-advisory', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId, prompt }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    })
    const body = await response.json()
    if (!response.ok || body?.available !== true || body.groupId !== groupId ||
        body.execution?.performed !== false || !['cloud-ai', 'local-ai'].includes(body.mode) ||
        typeof body.text !== 'string' || !body.text.trim() || body.text.length > 64000 ||
        typeof body.provider !== 'string' || body.provider.length > 80 ||
        (body.model != null && (typeof body.model !== 'string' || body.model.length > 256)) ||
        (body.fallbackUsed !== undefined && typeof body.fallbackUsed !== 'boolean') ||
        (body.attempts !== undefined && (!Array.isArray(body.attempts) || body.attempts.length > 10 ||
          !body.attempts.every((item: Record<string, unknown>) => item && typeof item.provider === 'string' &&
            item.provider.length <= 80 && typeof item.outcome === 'string' && item.outcome.length <= 80)))) throw failure()
    return { available: true, groupId, text: body.text, mode: body.mode, provider: body.provider,
      model: body.model, fallbackUsed: body.fallbackUsed, attempts: body.attempts,
      execution: { performed: false, reason: 'Friday group assistance is advisory only.' } }
  } catch { throw failure() }
}

export type HomeLabEvidence = {
  mode: 'mock' | 'live'
  generatedAt?: string
  services: Array<{ id: string; name: string; host: string; status: string; detail: string }>
  incidents: Array<{ id: string; title: string; detail: string; status: string; severity: string }>
}

export async function fetchHomeLabEvidence(signal?: AbortSignal): Promise<HomeLabEvidence> {
  const failure = () => new Error('HomeLab observations unavailable')
  try {
    const response = await fetch('/api/overview', {
      method: 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
    const body = await response.json()
    const text = (value: unknown, max = 2000) => typeof value === 'string' && value.length <= max
    if (!response.ok || !['mock', 'live'].includes(body?.mode) || !Array.isArray(body.services) || body.services.length > 1000 ||
        (body.incidents !== undefined && (!Array.isArray(body.incidents) || body.incidents.length > 1000)) ||
        (body.generatedAt !== undefined && (!text(body.generatedAt, 64) || !Number.isFinite(Date.parse(body.generatedAt))))) throw failure()
    const ids = new Set<string>()
    const services = body.services.map((item: Record<string, unknown>) => {
      if (!item || !text(item.id, 256) || !item.id || ids.has(item.id as string) || !text(item.name, 256) || !item.name ||
          !text(item.host, 256) || !text(item.detail) || !['online', 'degraded', 'offline', 'maintenance'].includes(item.status as string)) throw failure()
      ids.add(item.id as string)
      return { id: item.id as string, name: item.name as string, host: item.host as string, detail: item.detail as string, status: item.status as string }
    })
    ids.clear()
    const incidents = (body.incidents || []).map((item: Record<string, unknown>) => {
      if (!item || !text(item.id, 256) || !item.id || ids.has(item.id as string) || !text(item.title, 256) ||
          !text(item.detail) || !['open', 'resolved'].includes(item.status as string) || !['high', 'warning', 'info'].includes(item.severity as string)) throw failure()
      ids.add(item.id as string)
      return { id: item.id as string, title: item.title as string, detail: item.detail as string, status: item.status as string, severity: item.severity as string }
    })
    return { mode: body.mode, generatedAt: body.generatedAt, services, incidents }
  } catch { throw failure() }
}

export type WebGrowthLead = {
 id: string; businessName: string; stage: string; discoveredAt: string; updatedAt: string
 approvedForOutreach: boolean; approvedOutreachGeneratedAt: string | null
 outreachStatus: string | null; outreachSentAt: string | null; score: number | null
 auditCheckedAt: string | null; proposalAvailable: boolean; demoAvailable: boolean
}
export type WebGrowthSnapshot = {schemaVersion: '1'; projectId: 'techtactics-web-growth'; generatedAt: string; sourceRevision: string; sourceChecksum: string; leads: WebGrowthLead[]}
export async function fetchWebGrowthSnapshot(signal?: AbortSignal): Promise<WebGrowthSnapshot> {
 const failure=()=>new Error('Web Growth connection unavailable')
 const response=await fetch('/api/web-growth',{method:'GET',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})
 if(response.status===403)throw Error('Reader permission required. Ask the owner to grant access to this project.')
 if(response.status===401)throw Error('Sign in required to read this project.')
 if(!response.ok)throw failure()
 const body=await response.json()
 const text=(x:unknown,max:number)=>typeof x==='string'&&x.trim().length>0&&x.length<=max
 const date=(x:unknown)=>typeof x==='string'&&Number.isFinite(Date.parse(x))
 const optionalDate=(x:unknown)=>x===null||date(x)
 if(body?.schemaVersion!=='1'||body.projectId!=='techtactics-web-growth'||!date(body.generatedAt)||!text(body.sourceRevision,40)||! /^[a-f0-9]{7,40}$/.test(body.sourceRevision)||!text(body.sourceChecksum,64)||! /^[a-f0-9]{64}$/.test(body.sourceChecksum)||!Array.isArray(body.leads)||body.leads.length>1000)throw failure()
 const ids=new Set<string>()
 const leads=body.leads.map((lead:WebGrowthLead)=>{
  if(!lead||!text(lead.id,128)||ids.has(lead.id)||!text(lead.businessName,256)||!['new','audited','qualified','demo_ready','approved','contacted','responded','proposal','won','lost'].includes(lead.stage)||!date(lead.discoveredAt)||!date(lead.updatedAt)||typeof lead.approvedForOutreach!=='boolean'||!optionalDate(lead.approvedOutreachGeneratedAt)||!(lead.outreachStatus===null||['pending','needs_review','sent'].includes(lead.outreachStatus))||!optionalDate(lead.outreachSentAt)||!(lead.score===null||(typeof lead.score==='number'&&Number.isFinite(lead.score)&&lead.score>=0&&lead.score<=100))||!optionalDate(lead.auditCheckedAt)||typeof lead.proposalAvailable!=='boolean'||typeof lead.demoAvailable!=='boolean')throw failure()
  ids.add(lead.id)
  return {id:lead.id,businessName:lead.businessName,stage:lead.stage,discoveredAt:lead.discoveredAt,updatedAt:lead.updatedAt,approvedForOutreach:lead.approvedForOutreach,approvedOutreachGeneratedAt:lead.approvedOutreachGeneratedAt,outreachStatus:lead.outreachStatus,outreachSentAt:lead.outreachSentAt,score:lead.score,auditCheckedAt:lead.auditCheckedAt,proposalAvailable:lead.proposalAvailable,demoAvailable:lead.demoAvailable}
 })
 return {schemaVersion:'1',projectId:'techtactics-web-growth',generatedAt:body.generatedAt,sourceRevision:body.sourceRevision,sourceChecksum:body.sourceChecksum,leads}
}
