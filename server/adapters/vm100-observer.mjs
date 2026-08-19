import http from 'node:http'
import https from 'node:https'

function requestObserver(config) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/v1/containers', config.baseUrl)
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}` },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`VM100 observer ${response.statusCode}`))
          return
        }
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    request.on('error', reject)
    request.setTimeout(4000, () => request.destroy(new Error('VM100 observer timeout')))
    request.end()
  })
}

function stateToStatus(state) {
  if (state === 'running') return 'online'
  if (state === 'paused' || state === 'restarting') return 'degraded'
  return 'offline'
}

export async function getVm100ObserverServices(config, requestImpl = requestObserver) {
  if (!config.enabled || !config.baseUrl || !config.token) return []
  const payload = await requestImpl(config)
  if (!payload || !Array.isArray(payload.containers)) throw new Error('Invalid container inventory from VM100 observer')

  return payload.containers.map((container) => ({
    id: `vm100-observer-${String(container.id || 'unknown')}`,
    name: String(container.name || container.id || 'unknown'),
    category: 'container',
    host: String(container.host || config.hostName || payload.host || 'VM 100'),
    site: 'Site A',
    status: stateToStatus(container.state),
    detail: String(container.image || 'Docker container'),
    updated: String(container.status || container.observedAt || payload.observedAt || 'live'),
  }))
}
