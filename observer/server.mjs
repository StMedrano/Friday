import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { getObserverConfig } from './config.mjs'
import {
  getSanitizedContainerInspect,
  getSanitizedContainerLogs,
  getSanitizedContainers,
  normalizeLogTail,
} from './docker.mjs'

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

function sanitizeError(error) {
  return String(error?.message || error || 'Docker unavailable')
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 160)
}

function isContainerLookupError(error) {
  return /^(unknown|ambiguous|invalid) container id$/i.test(String(error?.message || error || ''))
}

export function createObserverServer({
  config,
  getContainers = getSanitizedContainers,
  getInspect = getSanitizedContainerInspect,
  getLogs = getSanitizedContainerLogs,
}) {
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
        return json(response, 503, { error: 'docker-unavailable', detail: sanitizeError(error) })
      }
    }

    const inspectMatch = url.pathname.match(/^\/api\/v1\/containers\/([a-fA-F0-9]{12,64})\/inspect$/)
    if (request.method === 'GET' && inspectMatch) {
      if (request.headers.authorization !== `Bearer ${config.token}`) {
        return json(response, 401, { error: 'unauthorized' })
      }

      try {
        return json(response, 200, await getInspect(config, inspectMatch[1]))
      } catch (error) {
        if (isContainerLookupError(error)) {
          return json(response, 404, { error: 'container-not-found' })
        }
        return json(response, 503, { error: 'docker-unavailable', detail: sanitizeError(error) })
      }
    }

    const logsMatch = url.pathname.match(/^\/api\/v1\/containers\/([a-fA-F0-9]{12,64})\/logs$/)
    if (request.method === 'GET' && logsMatch) {
      if (request.headers.authorization !== `Bearer ${config.token}`) {
        return json(response, 401, { error: 'unauthorized' })
      }

      try {
        const tail = normalizeLogTail(url.searchParams.get('tail'))
        return json(response, 200, await getLogs(config, logsMatch[1], tail))
      } catch (error) {
        if (isContainerLookupError(error)) {
          return json(response, 404, { error: 'container-not-found' })
        }
        return json(response, 503, { error: 'docker-unavailable', detail: sanitizeError(error) })
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
