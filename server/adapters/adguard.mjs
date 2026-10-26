const MAX_BODY_BYTES = 512 * 1024
class AdguardError extends Error {}
const fail = message => { throw new AdguardError(`AdGuard ${message}`) }

function validateConfig(config) {
  try {
    const url = new URL(config.baseUrl)
    const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !text(config.username, 256) || config.username.includes(':') || !text(config.password, 4096) || !text(config.site, 80)) throw Error()
    return url.origin
  } catch { throw new AdguardError('Invalid AdGuard configuration') }
}

async function readJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
    await response.body?.cancel()
    fail('response too large')
  }
  if (!response.body) fail('invalid JSON response')
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        fail('response too large')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { fail('invalid JSON response') }
}

export async function getAdguardServices(config, { fetchImpl = fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  if (!config?.enabled) return []
  const origin = validateConfig(config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`
    async function get(path) {
      const response = await fetchImpl(`${origin}${path}`, {
        method: 'GET', headers: { Accept: 'application/json', Authorization: authorization },
        signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      })
      if (!response.ok) {
        await response.body?.cancel()
        fail([401, 403].includes(response.status) ? 'authentication failed' : 'unavailable')
      }
      return readJson(response)
    }

    // Fixed reads only: no query log, client listing, configuration, reset, or toggle endpoint.
    const status = await get('/control/status')
    if (typeof status?.running !== 'boolean' || typeof status?.protection_enabled !== 'boolean') fail('invalid status response')
    const stats = await get('/control/stats')
    if (!Number.isSafeInteger(stats?.num_dns_queries) || stats.num_dns_queries < 0 ||
      !Number.isSafeInteger(stats.num_blocked_filtering) || stats.num_blocked_filtering < 0 || stats.num_blocked_filtering > stats.num_dns_queries ||
      !Number.isFinite(stats.avg_processing_time) || stats.avg_processing_time < 0 || stats.avg_processing_time > Number.MAX_SAFE_INTEGER / 1000) fail('invalid statistics response')

    // Upstream timing is seconds. Only aggregate counts/timing enter normalized Friday state.
    const averageMs = Number((stats.avg_processing_time * 1000).toFixed(2))
    return [{
      id: 'adguard', name: 'AdGuard Home', category: 'dns', host: new URL(origin).hostname, site: config.site.trim(),
      status: !status.running ? 'offline' : status.protection_enabled ? 'online' : 'degraded',
      detail: [
        status.running ? 'DNS running' : 'DNS stopped',
        status.protection_enabled ? 'Protection enabled' : 'Protection disabled',
        `${stats.num_dns_queries} queries`, `${stats.num_blocked_filtering} filtered`,
        `${averageMs} ms avg (configured statistics window)`,
      ].join(' · '),
      updated: new Date(now()).toISOString(),
    }]
  } catch (error) {
    if (controller.signal.aborted) fail('timeout')
    if (error instanceof AdguardError) throw error
    fail('unavailable')
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}
