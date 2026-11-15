import http from 'node:http'
import { timingSafeEqual, createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Friday homelab executor. Runs on a Docker host, owned by the owner, and is the
// only thing that holds that host's Docker socket for changes. It does exactly
// three things to containers the owner lists in its own allowlist file: start,
// stop (SIGTERM, then kill after 30 s) and restart. No exec, no create, no
// delete, no images, volumes or networks. Every request needs the bearer token.
// Friday's own catalog and approvals come first; this allowlist is the second,
// independent lock on the host itself.

export const OPERATIONS = Object.freeze(['start', 'stop', 'restart'])
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const STOP_SECONDS = 30

const digest = (value) => createHash('sha256').update(String(value)).digest()
const sameToken = (header, token) => typeof header === 'string' && header.startsWith('Bearer ')
  && timingSafeEqual(digest(header.slice(7)), digest(token))

/** {"schemaVersion":1,"containers":[{"name":"plex","operations":["restart"]}]}. Any bad entry rejects the file. */
export function parseAllowlist(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
    || Object.keys(value).length !== 2 || !Array.isArray(value.containers) || value.containers.length > 100) throw Error('invalid-allowlist')
  const map = new Map()
  for (const entry of value.containers) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).length !== 2 || !NAME.test(entry.name) || map.has(entry.name)
      || !Array.isArray(entry.operations) || entry.operations.length === 0 || new Set(entry.operations).size !== entry.operations.length
      || !entry.operations.every((op) => OPERATIONS.includes(op))) throw Error('invalid-allowlist')
    map.set(entry.name, new Set(entry.operations))
  }
  return map
}

export function loadAllowlist(path) {
  const info = lstatSync(path)
  // Owner-written: refuse symlinks and group/world-writable files.
  if (!info.isFile() || (info.mode & 0o022) !== 0) throw Error('insecure-allowlist')
  return parseAllowlist(JSON.parse(readFileSync(path, 'utf8')))
}

export function getExecutorConfig(env = process.env) {
  return {
    port: Number(env.FRIDAY_EXECUTOR_PORT || 3198),
    bindAddress: env.FRIDAY_EXECUTOR_BIND_ADDRESS || '127.0.0.1',
    token: env.FRIDAY_EXECUTOR_TOKEN || '',
    allowlistPath: env.FRIDAY_EXECUTOR_ALLOWLIST_PATH || '/config/allowlist.json',
    dockerSocketPath: env.FRIDAY_EXECUTOR_DOCKER_SOCKET || '/var/run/docker.sock',
  }
}

/** Docker Engine API over the UNIX socket. Only the two calls below are ever made. */
export function createDockerEngine(socketPath) {
  const request = (method, path, timeoutMs) => new Promise((resolve, reject) => {
    const call = http.request({ socketPath, method, path }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) call.destroy(Error('docker-reply-too-large')) })
      response.on('end', () => resolve({ status: response.statusCode ?? 500, body }))
    })
    call.on('error', reject)
    call.setTimeout(timeoutMs, () => call.destroy(Error('docker-timeout')))
    call.end()
  })
  return Object.freeze({
    async state(name) {
      const reply = await request('GET', `/containers/${encodeURIComponent(name)}/json`, 5000)
      if (reply.status === 404) return 'missing'
      if (reply.status !== 200) throw Error('docker-unavailable')
      const status = JSON.parse(reply.body)?.State?.Status
      return typeof status === 'string' ? status : 'unknown'
    },
    async act(name, operation) {
      if (!OPERATIONS.includes(operation)) throw Error('operation-not-allowed')
      const query = operation === 'start' ? '' : `?t=${STOP_SECONDS}`
      const reply = await request('POST', `/containers/${encodeURIComponent(name)}/${operation}${query}`, (STOP_SECONDS + 15) * 1000)
      // 304: already in that state, which is fine.
      if (reply.status !== 204 && reply.status !== 304) throw Error(reply.status === 404 ? 'container-missing' : 'docker-refused')
    },
  })
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(body))
}

export function createExecutorServer({ config, allowlist, engine, log = (line) => console.log(JSON.stringify(line)), now = () => new Date() }) {
  if (typeof config?.token !== 'string' || config.token.length < 32) throw Error('FRIDAY_EXECUTOR_TOKEN must be at least 32 characters')
  let busy = Promise.resolve()
  return http.createServer(async (request, response) => {
    // A malformed request target must never crash the process.
    let url
    try { url = new URL(request.url || '/', 'http://executor') } catch { return json(response, 400, { ok: false, error: 'invalid-request' }) }
    if (request.method === 'GET' && url.pathname === '/health' && !url.search) return json(response, 200, { status: 'ok', service: 'friday-executor' })
    const match = url.pathname.match(/^\/v1\/containers\/([^/]+)(?:\/(start|stop|restart))?$/)
    if (!match || url.search) return json(response, 404, { ok: false, error: 'not-found' })
    if (!sameToken(request.headers.authorization, config.token)) return json(response, 401, { ok: false, error: 'unauthorized' })
    let name
    try { name = decodeURIComponent(match[1]) } catch { return json(response, 400, { ok: false, error: 'invalid-name' }) }
    const operation = match[2]
    if (!NAME.test(name)) return json(response, 400, { ok: false, error: 'invalid-name' })
    const allowed = allowlist.get(name)
    if (!operation) {
      if (request.method !== 'GET') return json(response, 405, { ok: false, error: 'method-not-allowed' })
      if (!allowed) return json(response, 403, { ok: false, error: 'not-allowlisted' })
      try { return json(response, 200, { ok: true, name, state: await engine.state(name) }) }
      catch { return json(response, 503, { ok: false, error: 'docker-unavailable' }) }
    }
    if (request.method !== 'POST') return json(response, 405, { ok: false, error: 'method-not-allowed' })
    if (!allowed?.has(operation)) {
      log({ at: now().toISOString(), event: 'refused', name, operation, reason: 'not-allowlisted' })
      return json(response, 403, { ok: false, error: 'not-allowlisted' })
    }
    // One change at a time on this host.
    const run = async () => {
      log({ at: now().toISOString(), event: 'requested', name, operation })
      try {
        await engine.act(name, operation)
        log({ at: now().toISOString(), event: 'succeeded', name, operation })
        return json(response, 200, { ok: true, name, operation })
      } catch (error) {
        const reason = ['container-missing', 'docker-refused'].includes(error?.message) ? error.message : 'docker-unavailable'
        log({ at: now().toISOString(), event: 'failed', name, operation, reason })
        return json(response, reason === 'container-missing' ? 404 : 502, { ok: false, error: reason })
      }
    }
    const result = busy.then(run, run)
    busy = result.catch(() => {})
    return result
  })
}

export function startExecutor(config = getExecutorConfig()) {
  const allowlist = loadAllowlist(config.allowlistPath)
  const server = createExecutorServer({ config, allowlist, engine: createDockerEngine(config.dockerSocketPath) })
  server.listen(config.port, config.bindAddress, () => {
    console.log(`Friday executor listening on ${config.bindAddress}:${config.port} (${allowlist.size} containers)`)
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startExecutor()
