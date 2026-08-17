import http from 'node:http'

function requestJson(socketPath, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path, method: 'GET' }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`Docker API ${response.statusCode}: ${body.slice(0, 160)}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('error', reject)
    request.setTimeout(4000, () => request.destroy(new Error('Docker API timeout')))
    request.end()
  })
}

function stateToStatus(state) {
  if (state === 'running') return 'online'
  if (state === 'paused' || state === 'restarting') return 'degraded'
  return 'offline'
}

export async function getDockerServices(config) {
  if (!config.enabled) return []
  const containers = await requestJson(config.socketPath, '/containers/json?all=1')
  return containers.map((container) => ({
    id: `docker-${container.Id.slice(0, 12)}`,
    name: String(container.Names?.[0] || container.Id).replace(/^\//, ''),
    category: 'container',
    host: 'VM 100',
    site: 'Site A',
    status: stateToStatus(container.State),
    detail: container.Image || 'Docker container',
    updated: container.Status || 'unknown',
  }))
}
