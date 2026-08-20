import { appendHistory, createEmptyMonitoringState, incidentList, monitoringSummary } from './state.mjs'
import { evaluateMonitoring } from './incidents.mjs'

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

export function createMonitoringRuntime({
  config,
  collectOverview,
  store,
  now = () => new Date(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  const monitoringConfig = config.monitoring || { enabled: false }
  let monitoringState = createEmptyMonitoringState()
  let latestOverview = null
  let inFlight = null
  let timer = null
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

  function poll() {
    if (!monitoringConfig.enabled) return Promise.resolve()
    if (inFlight) return inFlight

    inFlight = (async () => {
      const timestamp = now().toISOString()
      meta.lastPollAt = timestamp
      try {
        const overview = await collectOverview(config)
        const evaluated = evaluateMonitoring({
          state: monitoringState,
          overview,
          config: monitoringConfig,
          now: timestamp,
        })
        monitoringState = evaluated.state
        latestOverview = overview
        meta.lastSuccessAt = timestamp
        meta.lastError = null
        meta.status = 'ok'
        try {
          await store.save(monitoringState)
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
        try { await store.save(monitoringState) } catch {}
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

  return {
    start,
    stop,
    poll,
    getOverview() { return latestOverview },
    getIncidents() { return { summary: incidentSummary(monitoringState), incidents: incidentList(monitoringState) } },
    getHistory() { return { events: [...(monitoringState.history || [])].reverse().map((event) => ({ ...event })) } },
    getSummary() { return monitoringSummary(monitoringState, meta) },
  }
}
