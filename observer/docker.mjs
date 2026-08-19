import http from 'node:http'

function requestDockerContainers(socketPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath,
      path: '/containers/json?all=1',
      method: 'GET',
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`Docker API ${response.statusCode}: ${body.slice(0, 160)}`))
          return
        }
        try {
          const value = JSON.parse(body)
          resolve(Array.isArray(value) ? value : [])
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

export function sanitizeContainer(container, { hostName, allowedLabelKeys, observedAt }) {
  const labels = Object.fromEntries(
    allowedLabelKeys
      .filter((key) => Object.hasOwn(container.Labels || {}, key))
      .map((key) => [key, container.Labels[key]])
  )

  return {
    id: String(container.Id || '').slice(0, 12),
    name: String(container.Names?.[0] || container.Id || 'unknown').replace(/^\//, ''),
    image: String(container.Image || ''),
    state: String(container.State || 'unknown'),
    status: String(container.Status || 'unknown'),
    ports: Array.isArray(container.Ports) ? container.Ports.map((port) => ({
      privatePort: port.PrivatePort,
      publicPort: port.PublicPort,
      type: port.Type,
      ip: port.IP,
    })) : [],
    labels,
    host: hostName,
    observedAt,
  }
}

export async function getSanitizedContainers(config, requestImpl = requestDockerContainers) {
  const observedAt = new Date().toISOString()
  const containers = await requestImpl(config.dockerSocketPath)
  return containers.map((container) => sanitizeContainer(container, {
    hostName: config.hostName,
    allowedLabelKeys: config.allowedLabelKeys,
    observedAt,
  }))
}
