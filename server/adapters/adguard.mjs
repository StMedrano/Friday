// Read-only AdGuard Home adapter. AdGuard Home has no read-only API role, so the
// configured credential is administrator-capable: this module issues exactly two
// fixed GET requests and forwards only aggregate counts. Client addresses, queried
// domains, and upstream names never leave this module.
const MAX_BODY_BYTES = 256 * 1024
const VERSION = /^v?\d{1,4}(?:\.\d{1,6}){1,3}(?:-[0-9A-Za-z.]{1,24})?$/
const count = new Intl.NumberFormat('en-US')

class ApiError extends Error {}

function hostOf(url) {
  try { return new URL(url).hostname } catch { return 'AdGuard Home' }
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

async function readBoundedJson(response) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new ApiError('Invalid API response')
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError('Invalid API response')
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      try { await reader.cancel() } catch {}
      throw new ApiError('Invalid API response')
    }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ApiError('Invalid API response') }
}

async function getJson(config, path, { fetchImpl, signal }) {
  const response = await fetchImpl(new URL(path, config.baseUrl).toString(), {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
    },
  })
  if (response.status < 200 || response.status >= 300) {
    try { await response.body?.cancel() } catch {}
    throw new ApiError([401, 403].includes(response.status) ? 'API authentication failed' : `API HTTP ${response.status}`)
  }
  return readBoundedJson(response)
}

function parseStatus(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    typeof payload.running !== 'boolean' || typeof payload.protection_enabled !== 'boolean') {
    throw new ApiError('Invalid API response')
  }
  // Version is the only provider string forwarded, and only in a strict shape.
  const version = typeof payload.version === 'string' && VERSION.test(payload.version) ? payload.version : null
  return { running: payload.running, protectionEnabled: payload.protection_enabled, version }
}

function parseStats(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError('Invalid API response')
  const { num_dns_queries: queries, num_blocked_filtering: blocked, avg_processing_time: avgSeconds } = payload
  if (!nonNegativeInteger(queries) || !nonNegativeInteger(blocked) || blocked > queries ||
    typeof avgSeconds !== 'number' || !Number.isFinite(avgSeconds) || avgSeconds < 0) {
    throw new ApiError('Invalid API response')
  }
  return { queries, blocked, avgMs: Math.round(avgSeconds * 1000), lastDay: payload.time_units === 'hours' }
}

function describe(status, stats) {
  const state = !status.running ? 'DNS server not running' : status.protectionEnabled ? 'Protection on' : 'Protection disabled'
  const blockedPercent = stats.queries ? (stats.blocked / stats.queries) * 100 : 0
  return [
    state,
    `${count.format(stats.queries)} queries${stats.lastDay ? '/24h' : ''}`,
    `${blockedPercent.toFixed(1)}% blocked`,
    `${stats.avgMs} ms avg`,
    ...(status.version ? [status.version] : []),
  ].join(' · ')
}

export async function getAdGuardServices(config, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  if (!config?.enabled) return []
  if (config.configurationError || !config.baseUrl) throw new Error('Invalid AdGuard configuration')

  const service = (status, detail) => ({
    id: 'adguard-home',
    name: 'AdGuard Home',
    category: 'dns',
    host: hostOf(config.baseUrl),
    site: config.site || 'Site A',
    status,
    detail,
    updated: new Date().toISOString(),
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const options = { fetchImpl, signal: controller.signal }
    const [statusPayload, statsPayload] = await Promise.all([
      getJson(config, 'control/status', options),
      getJson(config, 'control/stats', options),
    ])
    const status = parseStatus(statusPayload)
    const stats = parseStats(statsPayload)
    const health = !status.running ? 'offline' : status.protectionEnabled ? 'online' : 'degraded'
    return [service(health, describe(status, stats))]
  } catch (error) {
    // Fixed details only: provider bodies and transport errors may echo URLs or credentials.
    if (error instanceof ApiError) return [service('degraded', error.message)]
    if (controller.signal.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)) return [service('offline', 'Timeout')]
    return [service('offline', 'Unreachable')]
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
