import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { getObserverConfig } from './config.mjs'
import { getSanitizedContainers } from './docker.mjs'

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

export function createObserverServer({ config, getContainers = getSanitizedContainers }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(response, 200, {
        status: 'ok',
        service: 'friday-observer',
        host: config.hostName,
        time: new Date().toISOString(),
      })
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/containers') {
      if (request.headers.authorization !== `Bearer ${config.token}`) {
        return json(response, 401, { error: 'unauthorized' })
      }

      try {
        const containers = await getContainers(config)
        const observedAt = new Date().toISOString()
        return json(response, 200, { host: config.hostName, observedAt, containers })
      } catch (error) {
        return json(response, 503, { error: 'docker-unavailable', detail: error.message })
      }
    }

    return json(response, 404, { error: 'not-found' })
  })
}

export function startObserverServer(config = getObserverConfig()) {
  if (!config.token) throw new Error('FRIDAY_OBSERVER_TOKEN is required')
  const server = createObserverServer({ config })
  server.listen(config.port, config.bindAddress, () => {
    console.log(`Friday observer listening on ${config.bindAddress}:${config.port} (${config.hostName})`)
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startObserverServer()
}
