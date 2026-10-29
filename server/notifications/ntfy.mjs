// Push incident open/resolve events to an ntfy topic. Server-side only: the
// topic URL and optional access token never reach the browser. Messages carry
// the incident's already-sanitised title, service, host and severity.
const MAX_PER_BATCH = 5
const PRIORITY = {high: '4', critical: '5', warning: '3'}

const ascii = value => String(value || '').replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
const text = value => String(value || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, 400)

export function ntfyTopicUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return ''
    if (!/^\/[A-Za-z0-9_-]{1,64}$/.test(url.pathname)) return ''
    return url.href
  } catch { return '' }
}

function message(kind, incident) {
  const subject = incident.serviceName || incident.title || 'Monitoring incident'
  const where = [incident.host, incident.severity].filter(Boolean).join(' · ')
  return kind === 'opened'
    ? {title: `Friday: ${incident.title || 'Incident'} - ${subject}`, body: text([incident.detail, where].filter(Boolean).join('\n')), priority: PRIORITY[incident.severity] || '3', tags: 'warning'}
    : {title: `Friday resolved: ${subject}`, body: text([incident.title, where].filter(Boolean).join('\n')), priority: '2', tags: 'white_check_mark'}
}

export function createNtfyNotifier({url, token = '', fetchImpl = globalThis.fetch, timeoutMs = 5000} = {}) {
  const topic = ntfyTopicUrl(url)
  if (!topic || typeof fetchImpl !== 'function') return null

  async function send({title, body, priority, tags}) {
    const headers = {'content-type': 'text/plain; charset=utf-8', title: ascii(title), priority, tags}
    if (token) headers.authorization = `Bearer ${token}`
    const response = await fetchImpl(topic, {method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs)})
    if (!response.ok) throw new Error(`ntfy HTTP ${response.status}`)
  }

  return {
    async notify({opened = [], resolved = []} = {}) {
      const events = [...opened.map(incident => message('opened', incident)), ...resolved.map(incident => message('resolved', incident))]
      if (!events.length) return {sent: 0, failed: 0}
      const batch = events.slice(0, MAX_PER_BATCH)
      if (events.length > MAX_PER_BATCH) {
        batch[MAX_PER_BATCH - 1] = {title: `Friday: ${events.length - MAX_PER_BATCH + 1} more incident changes`, body: 'Open Friday to review all incident changes.', priority: '3', tags: 'warning'}
      }
      let sent = 0
      let failed = 0
      for (const event of batch) {
        try { await send(event); sent += 1 } catch { failed += 1 }
      }
      if (failed) console.warn(`Friday notifications: ${failed} of ${batch.length} ntfy deliveries failed`)
      return {sent, failed}
    },
    async test() {
      await send({title: 'Friday: test notification', body: 'Notifications from Friday are working.', priority: '3', tags: 'bell'})
    },
  }
}

/** Incidents that opened or resolved between two monitoring states. */
export function incidentChanges(before = [], after = []) {
  const prior = new Map(before.map(incident => [incident.id, incident.status]))
  return {
    opened: after.filter(incident => incident.status === 'open' && !prior.has(incident.id)),
    resolved: after.filter(incident => incident.status === 'resolved' && prior.get(incident.id) === 'open'),
  }
}
