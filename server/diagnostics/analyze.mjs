function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value)
}

function onlineNeighbors(overview, incident) {
  return (Array.isArray(overview?.services) ? overview.services : []).filter((service) => (
    service?.host === (incident?.host || 'VM 100')
    && service?.id !== incident?.serviceId
    && service?.status === 'online'
  ))
}

export function buildDiagnosticReport({ incident, inspect, overview, now }) {
  if (!incident?.id) throw new Error('Incident id is required')
  if (!inspect || typeof inspect !== 'object') throw new Error('Diagnostic inspect metadata is required')

  const findings = []
  const likelyCauses = []
  const recommendations = []
  const restartCount = Number.isFinite(Number(inspect.restartCount)) ? Number(inspect.restartCount) : 0
  const exitCode = inspect.exitCode == null || !Number.isFinite(Number(inspect.exitCode)) ? null : Number(inspect.exitCode)
  const healthStatus = String(inspect.health?.status || 'unavailable')
  const state = String(inspect.state || 'unknown')

  if (inspect.oomKilled === true) {
    addUnique(findings, 'The container was terminated by the kernel due to memory pressure.')
    addUnique(likelyCauses, 'Memory pressure caused the container termination.')
    addUnique(recommendations, 'Inspect host/container memory pressure and recent workload changes before considering remediation.')
  } else if (state === 'exited' && exitCode !== null && exitCode !== 0) {
    addUnique(findings, 'The container exited with an application/startup failure rather than an OOM termination.')
    addUnique(likelyCauses, 'Application or startup configuration failure is likely.')
    addUnique(recommendations, 'Inspect recent sanitized application logs and recent configuration/deployment changes.')
  }

  if (restartCount >= 3) {
    addUnique(findings, 'The container has restarted multiple times.')
    addUnique(recommendations, 'Inspect recent logs and dependency/configuration health before any restart action.')
  }

  if (incident.type === 'service-flapping') {
    addUnique(findings, 'FRIDAY observed recent repeated runtime-state changes consistent with service instability.')
    addUnique(likelyCauses, 'A recurring service, dependency, or configuration instability is likely.')
    addUnique(recommendations, 'Inspect recent logs and dependency/configuration health before any restart action.')
  }

  if (state === 'running' && healthStatus === 'unhealthy') {
    addUnique(findings, 'The container process is running, but its configured health check is failing.')
    addUnique(likelyCauses, 'The application or one of its dependencies is failing its configured health criteria.')
    addUnique(recommendations, 'Inspect health-check status, service dependencies, and recent logs.')
  }

  if (onlineNeighbors(overview, incident).length >= 2) {
    addUnique(findings, 'The failure appears isolated to this service rather than a host-wide Docker outage.')
  }

  return {
    id: `diagnostic-${incident.id}`,
    incidentId: incident.id,
    source: 'vm100-observer',
    host: incident.host || inspect.host || 'VM 100',
    serviceId: incident.serviceId,
    serviceName: incident.serviceName || inspect.name || 'unknown',
    collectedAt: String(now || new Date().toISOString()),
    status: 'available',
    metadata: structuredClone(inspect),
    facts: [
      { id: 'state', label: 'State', value: state },
      { id: 'exit-code', label: 'Exit code', value: exitCode === null ? 'unavailable' : String(exitCode) },
      { id: 'oom-killed', label: 'OOM killed', value: inspect.oomKilled === true ? 'Yes' : 'No' },
      { id: 'restart-count', label: 'Restart count', value: String(restartCount) },
      { id: 'health', label: 'Health', value: healthStatus },
      { id: 'started-at', label: 'Started', value: String(inspect.startedAt || 'unavailable') },
      { id: 'finished-at', label: 'Finished', value: String(inspect.finishedAt || 'unavailable') },
    ],
    findings,
    likelyCauses,
    recommendations,
    logsAvailable: true,
    lastLogInspectionAt: null,
    error: null,
  }
}
