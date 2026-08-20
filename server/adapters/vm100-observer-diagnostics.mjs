import http from 'node:http'
import https from 'node:https'

const CONTAINER_ID = /^[a-f0-9]{12,64}$/i
const DEFAULT_LOG_TAIL = 100
const MAX_LOG_TAIL = 200
const MAX_RESPONSE_BYTES = 512 * 1024

function requireAvailableConfig(config) {
  if (!config?.enabled || !config?.baseUrl || !config?.token) {
    throw new Error('Observer diagnostics unavailable')
  }
}

function validateContainerId(containerId) {
  const id = String(containerId || '')
  if (!CONTAINER_ID.test(id)) throw new Error('Invalid container id')
  return id
}

function normalizeTail(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LOG_TAIL
  return Math.min(parsed, MAX_LOG_TAIL)
}

function requestObserverJson({ baseUrl, path, authorization }) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(path, baseUrl)
    } catch {
      reject(new Error('Invalid VM100 observer URL'))
      return
    }
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Authorization: authorization },
    }, (response) => {
      const chunks = []
      let bytes = 0
      let overflow = false
      response.on('data', (chunk) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += value.length
        if (bytes > MAX_RESPONSE_BYTES) {
          overflow = true
          response.destroy()
          return
        }
        chunks.push(value)
      })
      response.on('end', () => {
        if (overflow) {
          reject(new Error('VM100 observer diagnostics response too large'))
          return
        }
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`VM100 observer diagnostics HTTP ${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('Invalid VM100 observer diagnostics response'))
        }
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    request.setTimeout(4000, () => request.destroy(new Error('VM100 observer diagnostics timeout')))
    request.end()
  })
}

export function containerIdFromServiceId(serviceId) {
  const match = String(serviceId || '').match(/^vm100-observer-([a-f0-9]{12,64})$/i)
  return match ? match[1] : null
}

export async function getVm100ContainerDiagnostic(config, containerId, requestImpl = requestObserverJson) {
  requireAvailableConfig(config)
  const id = validateContainerId(containerId)
  return requestImpl({
    baseUrl: config.baseUrl,
    path: `/api/v1/containers/${id}/inspect`,
    authorization: `Bearer ${config.token}`,
  })
}

export async function getVm100ContainerLogs(config, containerId, tail = DEFAULT_LOG_TAIL, requestImpl = requestObserverJson) {
  requireAvailableConfig(config)
  const id = validateContainerId(containerId)
  const safeTail = normalizeTail(tail)
  return requestImpl({
    baseUrl: config.baseUrl,
    path: `/api/v1/containers/${id}/logs?tail=${safeTail}`,
    authorization: `Bearer ${config.token}`,
  })
}
