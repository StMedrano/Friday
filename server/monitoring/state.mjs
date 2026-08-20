export function createEmptyMonitoringState() {
  return {
    schemaVersion: 1,
    observations: {},
    incidents: [],
    history: [],
  }
}

export function appendHistory(state, event, limit = 2000) {
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 2000
  state.history.push({ ...event })
  if (state.history.length > safeLimit) {
    state.history.splice(0, state.history.length - safeLimit)
  }
  return event
}

export function incidentList(state) {
  const incidents = Array.isArray(state?.incidents) ? state.incidents : []
  return incidents
    .map((incident) => ({ ...incident }))
    .sort((a, b) => {
      if (a.status === 'open' && b.status !== 'open') return -1
      if (a.status !== 'open' && b.status === 'open') return 1
      return String(b.openedAt || '').localeCompare(String(a.openedAt || ''))
    })
}

export function monitoringSummary(state, runtimeMeta = {}) {
  const open = (Array.isArray(state?.incidents) ? state.incidents : []).filter((incident) => incident.status === 'open')
  return {
    enabled: runtimeMeta.enabled === true,
    status: runtimeMeta.status || (runtimeMeta.enabled ? 'starting' : 'disabled'),
    lastPollAt: runtimeMeta.lastPollAt ?? null,
    lastSuccessAt: runtimeMeta.lastSuccessAt ?? null,
    lastError: runtimeMeta.lastError ?? null,
    activeIncidents: open.length,
    openHigh: open.filter((incident) => incident.severity === 'high').length,
    openWarning: open.filter((incident) => incident.severity === 'warning').length,
  }
}
