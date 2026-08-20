import { appendHistory, createEmptyMonitoringState, incidentList, monitoringSummary } from './state.mjs'
import { evaluateMonitoring } from './incidents.mjs'
import { containerIdFromServiceId, getVm100ContainerDiagnostic } from '../adapters/vm100-observer-diagnostics.mjs'
import { buildDiagnosticReport } from '../diagnostics/analyze.mjs'

function sanitizeError(error) {
  return String(error?.message || error || 'unknown monitoring error')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|password)=([^\s,;]+)/gi, '$1=[redacted]')
    .slice(0, 240)
}

function incidentSummary(state) {
  const incidents = Array.isArray(state.incidents) ? state.incidents : []
  const open = incidents.filter((incident) => incident.status === 'open')
  return {
    active: open.length,
    high: open.filter((incident) => incident.severity === 'high').length,
    warning: open.filter((incident) => incident.severity === 'warning').length,
    resolved: incidents.filter((incident) => incident.status === 'resolved').length,
  }
}

function supportedDiagnosticTarget(incident) {
  if (!['service-offline', 'service-degraded', 'service-flapping'].includes(incident?.type)) return null
  const containerId = containerIdFromServiceId(incident?.serviceId)
  return containerId ? { containerId } : null
}

async function collectVm100Diagnostic({ config, incident, overview, containerId, now }) {
  const inspect = await getVm100ContainerDiagnostic(config, containerId)
  return buildDiagnosticReport({ incident, inspect, overview, now })
}

function unavailableReport(incident, timestamp, error) {
  return {
    id: `diagnostic-${incident.id}`,
    incidentId: incident.id,
    source: 'vm100-observer',
    host: incident.host || 'VM 100',
    serviceId: incident.serviceId,
    serviceName: incident.serviceName || 'unknown',
    collectedAt: timestamp,
    status: 'unavailable',
    metadata: null,
    facts: [],
    findings: [],
    likelyCauses: [],
    recommendations: ['Inspect observer connectivity and approved read-only diagnostics before considering remediation.'],
    logsAvailable: true,
    lastLogInspectionAt: null,
    error: sanitizeError(error),
  }
}

export function createMonitoringRuntime({
  config,
  collectOverview,
  store,
  collectDiagnosticImpl = collectVm100Diagnostic,
  now = () => new Date(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  const monitoringConfig = config.monitoring || { enabled: false }
  const diagnosticsConfig = config.diagnostics || { enabled: false }
  let monitoringState = createEmptyMonitoringState()
  let latestOverview = null
  let inFlight = null
  let timer = null
  let saveQueue = Promise.resolve()
  let meta = {
    enabled: monitoringConfig.enabled === true,
    status: monitoringConfig.enabled ? 'starting' : 'disabled',
    lastPollAt: null,
    lastSuccessAt: null,
    lastError: null,
  }

  function recordPollFailure(timestamp, detail) {
    appendHistory(monitoringState, {
      id: `monitoring-poll-failed-${timestamp.replace(/[^0-9A-Za-z_.-]+/g, '-')}`,
      type: 'monitoring-poll-failed',
      at: timestamp,
      source: 'monitoring',
      detail,
    }, monitoringConfig.historyLimit || 2000)
  }

  function persistState() {
    const snapshot = structuredClone(monitoringState)
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => store.save(snapshot))
    return saveQueue
  }

  async function collectMissingDiagnostics(overview, timestamp) {
    if (!diagnosticsConfig.enabled) return
    if (!monitoringState.diagnostics || typeof monitoringState.diagnostics !== 'object' || Array.isArray(monitoringState.diagnostics)) {
      monitoringState.diagnostics = {}
    }

    const openIncidents = (monitoringState.incidents || []).filter((incident) => incident.status === 'open')
    for (const incident of openIncidents) {
      const target = supportedDiagnosticTarget(incident)
      if (!target || monitoringState.diagnostics[incident.id]) continue

      monitoringState.diagnostics[incident.id] = {
        id: `diagnostic-${incident.id}`,
        incidentId: incident.id,
        source: 'vm100-observer',
        host: incident.host || 'VM 100',
        serviceId: incident.serviceId,
        serviceName: incident.serviceName || 'unknown',
        collectedAt: timestamp,
        status: 'pending',
        metadata: null,
        facts: [],
        findings: [],
        likelyCauses: [],
        recommendations: [],
        logsAvailable: false,
        lastLogInspectionAt: null,
        error: null,
      }

      try {
        const report = await collectDiagnosticImpl({
          config: config.vm100Observer || {},
          incident: structuredClone(incident),
          overview: structuredClone(overview),
          containerId: target.containerId,
          now: timestamp,
        })
        if (!report || typeof report !== 'object' || report.incidentId !== incident.id) {
          throw new Error('Invalid diagnostic report')
        }
        monitoringState.diagnostics[incident.id] = structuredClone(report)
      } catch (error) {
        monitoringState.diagnostics[incident.id] = unavailableReport(incident, timestamp, error)
      }
    }
  }

  function poll() {
    if (!monitoringConfig.enabled) return Promise.resolve()
    if (inFlight) return inFlight

    inFlight = (async () => {
      const timestamp = now().toISOString()
      meta.lastPollAt = timestamp
      try {
        const overview = await collectOverview(config)
        const priorDiagnostics = structuredClone(monitoringState.diagnostics || {})
        const evaluated = evaluateMonitoring({
          state: monitoringState,
          overview,
          config: monitoringConfig,
          now: timestamp,
        })
        monitoringState = {
          ...evaluated.state,
          schemaVersion: 2,
          diagnostics: priorDiagnostics,
        }
        latestOverview = overview
        meta.lastSuccessAt = timestamp
        meta.lastError = null
        meta.status = 'ok'

        await collectMissingDiagnostics(overview, timestamp)

        try {
          await persistState()
        } catch (error) {
          const detail = sanitizeError(error)
          recordPollFailure(timestamp, `Monitoring state persistence failed: ${detail}`)
          meta.status = 'degraded'
          meta.lastError = detail
        }
      } catch (error) {
        const detail = sanitizeError(error)
        recordPollFailure(timestamp, `Monitoring poll failed: ${detail}`)
        meta.status = 'degraded'
        meta.lastError = detail
        try { await persistState() } catch {}
      }
    })().finally(() => {
      inFlight = null
    })

    return inFlight
  }

  async function start() {
    if (!monitoringConfig.enabled) return
    try {
      monitoringState = await store.load()
    } catch (error) {
      meta.status = 'degraded'
      meta.lastError = sanitizeError(error)
      monitoringState = createEmptyMonitoringState()
    }
    await poll()
    if (!timer) {
      timer = setIntervalImpl(() => { void poll() }, monitoringConfig.pollSeconds * 1000)
    }
  }

  function stop() {
    if (timer) clearIntervalImpl(timer)
    timer = null
  }

  function getDiagnostic(incidentId) {
    const incident = (monitoringState.incidents || []).find((item) => item.id === incidentId)
    if (!incident) return { statusCode: 404, body: { error: 'incident-not-found' } }
    if (!diagnosticsConfig.enabled) {
      return { statusCode: 200, body: { incidentId, status: 'not-supported', reason: 'diagnostics-disabled' } }
    }
    if (!supportedDiagnosticTarget(incident)) {
      return { statusCode: 200, body: { incidentId, status: 'not-supported', reason: 'incident-not-supported' } }
    }
    return {
      statusCode: 200,
      body: structuredClone(monitoringState.diagnostics?.[incidentId] || { incidentId, status: 'pending' }),
    }
  }

  return {
    start,
    stop,
    poll,
    getOverview() { return latestOverview },
    getIncidents() { return { summary: incidentSummary(monitoringState), incidents: incidentList(monitoringState) } },
    getHistory() { return { events: [...(monitoringState.history || [])].reverse().map((event) => ({ ...event })) } },
    getSummary() { return monitoringSummary(monitoringState, meta) },
    getDiagnostic,
  }
}
