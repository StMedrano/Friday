import { appendHistory, createEmptyMonitoringState } from './state.mjs'

const FLAP_WINDOW_MS = 15 * 60 * 1000

function iso(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid monitoring timestamp')
  return date.toISOString()
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '-')
}

function eventId(type, key, at) {
  return safeId(`${type}:${key}:${at}`)
}

function cloneState(state) {
  const base = state || createEmptyMonitoringState()
  return {
    schemaVersion: base.schemaVersion || 1,
    observations: structuredClone(base.observations || {}),
    incidents: structuredClone(base.incidents || []),
    history: structuredClone(base.history || []),
  }
}

function sanitizeDetail(value) {
  return String(value || '')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|password)=([^\s,;]+)/gi, '$1=[redacted]')
    .slice(0, 240)
}

function addHistory(state, config, event) {
  appendHistory(state, event, config.historyLimit || 2000)
}

function openIncident(state, config, now, fields) {
  const existing = state.incidents.find((incident) => incident.status === 'open' && incident.fingerprint === fields.fingerprint)
  if (existing) {
    existing.lastSeen = now
    if (fields.evidence) existing.evidence = [...fields.evidence]
    return { incident: existing, opened: false }
  }

  const incident = {
    id: safeId(`${fields.fingerprint}:${now}`),
    fingerprint: fields.fingerprint,
    type: fields.type,
    title: fields.title,
    detail: fields.detail,
    severity: fields.severity,
    status: 'open',
    source: fields.source || 'monitoring',
    host: fields.host || '',
    serviceId: fields.serviceId,
    serviceName: fields.serviceName,
    firstSeen: fields.firstSeen || now,
    lastSeen: now,
    openedAt: now,
    resolvedAt: null,
    recommendedAction: fields.recommendedAction,
    evidence: fields.evidence || [],
  }
  state.incidents.push(incident)
  addHistory(state, config, {
    id: eventId('incident-opened', incident.id, now),
    type: 'incident-opened',
    at: now,
    source: incident.source,
    host: incident.host || undefined,
    serviceId: incident.serviceId,
    serviceName: incident.serviceName,
    detail: `${incident.severity.toUpperCase()} ${incident.title}`,
  })
  return { incident, opened: true }
}

function resolveFingerprint(state, config, fingerprint, now) {
  const incident = state.incidents.find((item) => item.status === 'open' && item.fingerprint === fingerprint)
  if (!incident) return false
  incident.status = 'resolved'
  incident.resolvedAt = now
  incident.lastSeen = now
  addHistory(state, config, {
    id: eventId('incident-resolved', incident.id, now),
    type: 'incident-resolved',
    at: now,
    source: incident.source,
    host: incident.host || undefined,
    serviceId: incident.serviceId,
    serviceName: incident.serviceName,
    detail: `Resolved ${incident.title}`,
  })
  return true
}

function observeService(state, config, service, now) {
  const key = String(service.id || '')
  if (!key) return
  const prior = state.observations[key]
  const nowMs = new Date(now).getTime()
  if (!prior) {
    state.observations[key] = {
      serviceId: key,
      serviceName: String(service.name || key),
      host: String(service.host || ''),
      status: String(service.status || 'unknown'),
      firstObservedAt: now,
      lastObservedAt: now,
      statusChangedAt: now,
      consecutive: 1,
      transitions: [],
    }
    return
  }

  prior.serviceName = String(service.name || prior.serviceName || key)
  prior.host = String(service.host || prior.host || '')
  prior.lastObservedAt = now
  prior.transitions = Array.isArray(prior.transitions) ? prior.transitions : []

  if (prior.status !== service.status) {
    const previousStatus = prior.status
    prior.status = String(service.status || 'unknown')
    prior.statusChangedAt = now
    prior.consecutive = 1
    prior.transitions.push(now)
    addHistory(state, config, {
      id: eventId('service-status-changed', key, now),
      type: 'service-status-changed',
      at: now,
      source: 'monitoring',
      host: prior.host,
      serviceId: key,
      serviceName: prior.serviceName,
      detail: `${previousStatus} -> ${prior.status}`,
    })
  } else {
    prior.consecutive = Number(prior.consecutive || 0) + 1
  }

  prior.transitions = prior.transitions.filter((timestamp) => nowMs - new Date(timestamp).getTime() <= FLAP_WINDOW_MS)
}

function evaluateService(state, config, service, now) {
  const serviceId = String(service.id || '')
  const observation = state.observations[serviceId]
  if (!observation) return false
  const graceMs = Math.max(0, Number(config.offlineGraceSeconds ?? 300)) * 1000
  const unhealthyForMs = new Date(now).getTime() - new Date(observation.statusChangedAt).getTime()
  let changed = false

  const offlineFingerprint = `service-offline:${serviceId}`
  const degradedFingerprint = `service-degraded:${serviceId}`
  const flappingFingerprint = `service-flapping:${serviceId}`

  if (service.status === 'offline' && unhealthyForMs >= graceMs) {
    const { opened } = openIncident(state, config, now, {
      fingerprint: offlineFingerprint,
      type: 'service-offline',
      title: 'Service offline',
      detail: `${service.name} is offline on ${service.host}`,
      severity: 'high',
      source: 'monitoring',
      host: String(service.host || ''),
      serviceId,
      serviceName: String(service.name || serviceId),
      firstSeen: observation.statusChangedAt,
      recommendedAction: 'Inspect service status and approved diagnostics; any restart or repair must go through the approval workflow before execution.',
      evidence: [String(service.updated || 'offline'), String(service.detail || 'service unavailable')],
    })
    changed ||= opened
  }

  if (service.status === 'degraded' && unhealthyForMs >= graceMs) {
    const { opened } = openIncident(state, config, now, {
      fingerprint: degradedFingerprint,
      type: 'service-degraded',
      title: 'Service degraded',
      detail: `${service.name} is degraded on ${service.host}`,
      severity: 'warning',
      source: 'monitoring',
      host: String(service.host || ''),
      serviceId,
      serviceName: String(service.name || serviceId),
      firstSeen: observation.statusChangedAt,
      recommendedAction: 'Inspect the service through approved read-only diagnostics; any corrective action requires approval before execution.',
      evidence: [String(service.updated || 'degraded'), String(service.detail || 'service degraded')],
    })
    changed ||= opened
  }

  if (service.status === 'online') {
    changed = resolveFingerprint(state, config, offlineFingerprint, now) || changed
    changed = resolveFingerprint(state, config, degradedFingerprint, now) || changed
  }

  if ((observation.transitions || []).length >= 3) {
    const { opened } = openIncident(state, config, now, {
      fingerprint: flappingFingerprint,
      type: 'service-flapping',
      title: 'Service flapping',
      detail: `${service.name} changed state repeatedly within 15 minutes`,
      severity: 'warning',
      source: 'monitoring',
      host: String(service.host || ''),
      serviceId,
      serviceName: String(service.name || serviceId),
      firstSeen: observation.transitions[0] || now,
      recommendedAction: 'Inspect recent state transitions and deployment context. Any remediation requires approval before execution.',
      evidence: [`${observation.transitions.length} state transitions in 15 minutes`],
    })
    changed ||= opened
  } else {
    changed = resolveFingerprint(state, config, flappingFingerprint, now) || changed
  }

  return changed
}

function integrationAlertParts(alert) {
  if (alert?.title !== 'Integration degraded') return null
  const detail = String(alert.detail || '')
  const separator = detail.indexOf(':')
  if (separator <= 0) return null
  const source = detail.slice(0, separator).trim()
  if (!source) return null
  return { source, detail: sanitizeDetail(detail.slice(separator + 1).trim()) }
}

function evaluateIntegrations(state, config, overview, now) {
  const current = new Set()
  let changed = false
  for (const alert of overview.alerts || []) {
    const parts = integrationAlertParts(alert)
    if (!parts) continue
    current.add(parts.source)
    const fingerprint = `integration-unavailable:${parts.source}`
    const { opened } = openIncident(state, config, now, {
      fingerprint,
      type: 'integration-unavailable',
      title: 'Integration unavailable',
      detail: parts.detail ? `${parts.source} is unavailable: ${parts.detail}` : `${parts.source} is unavailable`,
      severity: 'high',
      source: parts.source,
      host: '',
      firstSeen: now,
      recommendedAction: 'Inspect the read-only integration and connectivity. Any infrastructure-changing remediation requires approval before execution.',
      evidence: parts.detail ? [parts.detail] : [],
    })
    if (opened) {
      addHistory(state, config, {
        id: eventId('integration-degraded', parts.source, now),
        type: 'integration-degraded',
        at: now,
        source: parts.source,
        detail: `${parts.source} integration unavailable`,
      })
      changed = true
    }
  }

  for (const incident of state.incidents.filter((item) => item.status === 'open' && item.type === 'integration-unavailable')) {
    if (current.has(incident.source)) continue
    if (resolveFingerprint(state, config, incident.fingerprint, now)) {
      addHistory(state, config, {
        id: eventId('integration-recovered', incident.source, now),
        type: 'integration-recovered',
        at: now,
        source: incident.source,
        detail: `${incident.source} integration recovered`,
      })
      changed = true
    }
  }
  return changed
}

export function evaluateMonitoring({ state, overview = {}, config = {}, now = new Date() }) {
  const next = cloneState(state)
  const timestamp = iso(now)
  let changed = false

  for (const service of overview.services || []) {
    const before = JSON.stringify(next.observations[String(service.id || '')] || null)
    observeService(next, config, service, timestamp)
    changed ||= before !== JSON.stringify(next.observations[String(service.id || '')] || null)
    changed = evaluateService(next, config, service, timestamp) || changed
  }

  changed = evaluateIntegrations(next, config, overview, timestamp) || changed
  return { state: next, changed }
}
