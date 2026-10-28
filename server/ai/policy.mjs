export function fridaySystemPrompt() {
  return [
    'You are Friday, a read-only infrastructure copilot for the managed homelab.',
    'Analyze only the normalized infrastructure state supplied in the request.',
    'Do not assume a fixed number of sites; describe only sites present in the current normalized state.',
    'Preserve exact infrastructure identifiers from the supplied state, including service IDs, VM/LXC numbers, host names, and service-name mappings; never infer, renumber, merge, or substitute them.',
    'Previous conversation is context, not infrastructure evidence. Resolve infrastructure facts and identifiers from the current normalized Friday state.',
    'You may explain health, summarize alerts, identify likely causes, compare sites, and propose next read-only diagnostic steps.',
    'Do not claim that you executed, restarted, changed, deleted, deployed, reconfigured, remediated, or approved anything.',
    'Do not invent hosts, credentials, metrics, routes, VLANs, services, or events that are absent from the supplied state.',
    'If the available state is insufficient, say what additional read-only signal would be useful.',
    'Keep answers concise and operational.',
  ].join(' ')
}

function formatHistory(history = []) {
  if (!history.length) return 'Recent session context:\n(none)'
  return `Recent session context:\n${history.map(({ role, content }) => `[${role}] ${content}`).join('\n')}`
}

function groundingConstraints(overview) {
  const state = overview && typeof overview === 'object' && !Array.isArray(overview) ? overview : {}
  const sites = Array.isArray(state.sites) ? state.sites : []
  const services = Array.isArray(state.services) ? state.services : []
  const integrations = Array.isArray(state.integrations) ? state.integrations : []
  const statusCounts = Object.fromEntries([...services.reduce((counts, service) => {
    const status = String(service?.status || 'unknown').toLowerCase()
    counts.set(status, (counts.get(status) || 0) + 1)
    return counts
  }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)))
  const nonOnline = services
    .filter((service) => service?.status !== 'online')
    .map(({ id, name, status, updated }) => ({ id, name, status, updated }))
  const serviceSiteLabels = [...new Set(services.map((service) => service?.site).filter((site) => typeof site === 'string' && site.trim()))].sort()
  const siteSummary = sites.length
    ? JSON.stringify(sites.map(({ id, name, status }) => ({ id, name, status })))
    : 'none; site metadata is absent, so do not invent site names or labels'
  const incidentSummary = Array.isArray(state.incidents)
    ? JSON.stringify(Object.fromEntries([...state.incidents.reduce((counts, incident) => {
      const status = String(incident?.status || 'unknown').toLowerCase()
      counts.set(status, (counts.get(status) || 0) + 1)
      return counts
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right))))
    : 'incident data is absent; do not claim that there are no incidents'

  return [
    'Machine-derived current-state constraints:',
    `Declared sites: ${siteSummary}.`,
    `Service site labels: ${JSON.stringify(serviceSiteLabels)}; mention a site only by one of these labels or a declared site.`,
    `Service status counts: ${JSON.stringify(statusCounts)}.`,
    `Non-online services: ${JSON.stringify(nonOnline)}.`,
    nonOnline.length
      ? 'Overall health constraint: one or more services are non-online, so the environment must not be described as fully healthy, fully operational, or all running.'
      : 'Overall health constraint: no non-online service is present in the supplied service collection.',
    `Incident state: ${incidentSummary}.`,
    `Integration states: ${JSON.stringify(integrations.map(({ id, enabled, mode }) => ({ id, enabled, mode })))}.`,
    'Do not assign severity or business impact unless that exact severity or impact is present in the state.',
    'Do not generalize per-service update or uptime text across other services.',
    'Do not contradict these machine-derived constraints.',
  ].join('\n')
}

export function fridayUserPrompt(prompt, overview, history = []) {
  return [
    formatHistory(history),
    `Current operator request:\n${String(prompt || '').trim()}`,
    groundingConstraints(overview),
    `Authoritative normalized Friday state:\n${JSON.stringify(overview ?? {})}`,
  ].join('\n\n')
}
