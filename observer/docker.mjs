import http from 'node:http'

const MAX_LOG_TAIL = 200
const DEFAULT_LOG_TAIL = 100
const MAX_LOG_BYTES = 64 * 1024
const MAX_RAW_LOG_BYTES = 256 * 1024
const CONTAINER_ID = /^[a-f0-9]{12,64}$/i

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

function requestDockerJson(socketPath, path) {
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
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    request.on('error', reject)
    request.setTimeout(4000, () => request.destroy(new Error('Docker API timeout')))
    request.end()
  })
}

function requestDockerBuffer(socketPath, path, maxBytes = MAX_RAW_LOG_BYTES) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path, method: 'GET' }, (response) => {
      const chunks = []
      let keptBytes = 0
      let truncated = false
      response.on('data', (chunk) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (keptBytes >= maxBytes) {
          truncated = true
          return
        }
        const remaining = maxBytes - keptBytes
        if (value.length > remaining) {
          chunks.push(value.subarray(0, remaining))
          keptBytes += remaining
          truncated = true
          return
        }
        chunks.push(value)
        keptBytes += value.length
      })
      response.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`Docker API ${response.statusCode}: ${buffer.toString('utf8', 0, 160)}`))
          return
        }
        resolve({ buffer, truncated })
      })
    })
    request.on('error', reject)
    request.setTimeout(4000, () => request.destroy(new Error('Docker API timeout')))
    request.end()
  })
}

function requestDockerInspect(socketPath, fullId) {
  return requestDockerJson(socketPath, `/containers/${encodeURIComponent(fullId)}/json`)
}

function requestDockerLogs(socketPath, fullId, tail) {
  return requestDockerBuffer(
    socketPath,
    `/containers/${encodeURIComponent(fullId)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`,
    MAX_RAW_LOG_BYTES,
  )
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

export function normalizeLogTail(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LOG_TAIL
  return Math.min(parsed, MAX_LOG_TAIL)
}

export async function resolveKnownContainer(config, requestedId, requestContainersImpl = requestDockerContainers) {
  const id = String(requestedId || '')
  if (!CONTAINER_ID.test(id)) throw new Error('Invalid container id')
  const raw = await requestContainersImpl(config.dockerSocketPath)
  const matches = raw.filter((container) => String(container.Id || '').toLowerCase().startsWith(id.toLowerCase()))
  if (matches.length === 0) throw new Error('Unknown container id')
  if (matches.length !== 1) throw new Error('Ambiguous container id')
  const observedAt = new Date().toISOString()
  return {
    fullId: String(matches[0].Id),
    inventory: sanitizeContainer(matches[0], {
      hostName: config.hostName,
      allowedLabelKeys: config.allowedLabelKeys,
      observedAt,
    }),
  }
}

function normalizeInspectPorts(value) {
  const ports = []
  for (const [key, bindings] of Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const [containerPort = '', protocol = ''] = String(key).split('/')
    if (!Array.isArray(bindings) || bindings.length === 0) {
      ports.push({ containerPort, protocol, hostIp: '', hostPort: '' })
      continue
    }
    for (const binding of bindings) {
      ports.push({
        containerPort,
        protocol,
        hostIp: String(binding?.HostIp || ''),
        hostPort: String(binding?.HostPort || ''),
      })
    }
  }
  return ports
}

export function sanitizeContainerInspect(raw, { hostName, observedAt }) {
  const health = raw?.State?.Health
  return {
    id: String(raw?.Id || '').slice(0, 12),
    name: String(raw?.Name || raw?.Id || 'unknown').replace(/^\//, ''),
    image: String(raw?.Config?.Image || ''),
    imageId: String(raw?.Image || ''),
    state: String(raw?.State?.Status || 'unknown'),
    exitCode: Number.isFinite(Number(raw?.State?.ExitCode)) ? Number(raw.State.ExitCode) : null,
    oomKilled: raw?.State?.OOMKilled === true,
    restartCount: Number.isFinite(Number(raw?.RestartCount)) ? Number(raw.RestartCount) : 0,
    startedAt: String(raw?.State?.StartedAt || ''),
    finishedAt: String(raw?.State?.FinishedAt || ''),
    health: health ? {
      status: String(health.Status || 'unknown'),
      recent: Array.isArray(health.Log) ? health.Log.slice(-3).map((entry) => ({
        start: String(entry?.Start || ''),
        end: String(entry?.End || ''),
        exitCode: Number.isFinite(Number(entry?.ExitCode)) ? Number(entry.ExitCode) : null,
      })) : [],
    } : null,
    restartPolicy: {
      name: String(raw?.HostConfig?.RestartPolicy?.Name || ''),
      maximumRetryCount: Number.isFinite(Number(raw?.HostConfig?.RestartPolicy?.MaximumRetryCount))
        ? Number(raw.HostConfig.RestartPolicy.MaximumRetryCount)
        : 0,
    },
    ports: normalizeInspectPorts(raw?.NetworkSettings?.Ports),
    compose: {
      project: String(raw?.Config?.Labels?.['com.docker.compose.project'] || ''),
      service: String(raw?.Config?.Labels?.['com.docker.compose.service'] || ''),
    },
    networks: Object.keys(raw?.NetworkSettings?.Networks || {}).sort(),
    host: hostName,
    observedAt,
  }
}

function decodeDockerLogBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return Buffer.from(buffer || '').toString('utf8')
  const chunks = []
  let offset = 0
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset]
    if (![0, 1, 2, 3].includes(streamType) || buffer[offset + 1] !== 0 || buffer[offset + 2] !== 0 || buffer[offset + 3] !== 0) {
      return buffer.toString('utf8')
    }
    const length = buffer.readUInt32BE(offset + 4)
    const start = offset + 8
    const end = start + length
    if (end > buffer.length) return buffer.toString('utf8')
    chunks.push(buffer.subarray(start, end))
    offset = end
  }
  if (offset !== buffer.length || chunks.length === 0) return buffer.toString('utf8')
  return Buffer.concat(chunks).toString('utf8')
}

export function sanitizeLogText(value) {
  let logs = String(value || '')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:password|passwd|pwd|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(Password\s*=\s*)[^;\s]+/gi, '$1[redacted]')
  const bytes = Buffer.from(logs, 'utf8')
  const truncated = bytes.length > MAX_LOG_BYTES
  if (truncated) {
    logs = bytes.subarray(0, MAX_LOG_BYTES).toString('utf8').replace(/\uFFFD$/u, '')
  }
  return { logs, truncated }
}

export async function getSanitizedContainerInspect(config, requestedId, deps = {}) {
  const requestContainers = deps.requestContainers || requestDockerContainers
  const requestInspect = deps.requestInspect || requestDockerInspect
  const now = deps.now || (() => new Date())
  const resolved = await resolveKnownContainer(config, requestedId, requestContainers)
  const raw = await requestInspect(config.dockerSocketPath, resolved.fullId)
  return sanitizeContainerInspect(raw, {
    hostName: config.hostName,
    observedAt: now().toISOString(),
  })
}

export async function getSanitizedContainerLogs(config, requestedId, tail, deps = {}) {
  const requestContainers = deps.requestContainers || requestDockerContainers
  const requestLogs = deps.requestLogs || requestDockerLogs
  const now = deps.now || (() => new Date())
  const safeTail = normalizeLogTail(tail)
  const resolved = await resolveKnownContainer(config, requestedId, requestContainers)
  const response = await requestLogs(config.dockerSocketPath, resolved.fullId, safeTail)
  const buffer = Buffer.isBuffer(response) ? response : response?.buffer || Buffer.alloc(0)
  const rawTruncated = Buffer.isBuffer(response) ? false : response?.truncated === true
  const sanitized = sanitizeLogText(decodeDockerLogBuffer(buffer))
  return {
    id: resolved.inventory.id,
    logs: sanitized.logs,
    tail: safeTail,
    truncated: rawTruncated || sanitized.truncated,
    observedAt: now().toISOString(),
  }
}
