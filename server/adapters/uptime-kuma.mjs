const MAX_BODY_BYTES = 512 * 1024
class UptimeKumaError extends Error {}
const fail = message => { throw new UptimeKumaError(`Uptime Kuma ${message}`) }
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)

function validateConfig(config) {
  try {
    const url = new URL(config.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !text(config.apiKey, 4096) || !text(config.site, 80)) throw Error()
    return url.origin
  } catch { throw new UptimeKumaError('Invalid Uptime Kuma configuration') }
}

async function readMetrics(response) {
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
    await response.body?.cancel()
    fail('response too large')
  }
  if (!response.body) fail('invalid metrics response')
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
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) }
  catch { fail('invalid metrics response') }
}

function parseStatusSample(line) {
  if (!line.startsWith('monitor_status{')) fail('invalid metrics response')
  // Prometheus text label escapes are limited to backslash, double quote, and newline.
  const pair = /\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\\r\n]|\\[\\n"])*)"\s*([,}])/y
  pair.lastIndex = 'monitor_status{'.length
  const labels = new Map()
  while (true) {
    const match = pair.exec(line)
    if (!match || labels.size >= 64 || match[1].length > 128 || labels.has(match[1])) fail('invalid metrics response')
    const value = match[2].replace(/\\([\\n"])/g, (_match, escaped) => escaped === 'n' ? '\n' : escaped)
    if (value.length > 2048) fail('invalid metrics response')
    labels.set(match[1], value)
    if (match[3] === '}') break
  }
  const sample = /^\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s+([+-]?\d+))?\s*$/.exec(line.slice(pair.lastIndex))
  if (!sample || !Number.isSafeInteger(Number(sample[1])) || Number(sample[1]) < 0 ||
    (sample[2] !== undefined && !Number.isSafeInteger(Number(sample[2])))) fail('invalid metrics response')
  return { labels, status: Number(sample[1]) }
}

function normalizeMetrics(body, config, origin, observedAt) {
  const services = []
  const ids = new Set()
  let hasFamily = false
  let declared = false
  const display = value => value.split(config.apiKey).join('[redacted]').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (/^#\s*TYPE\s+monitor_status(?:\s|$)/.test(line)) {
      if (declared || !/^#\s*TYPE\s+monitor_status\s+gauge$/.test(line)) fail('invalid metrics response')
      declared = true
      hasFamily = true
      continue
    }
    if (!/^monitor_status(?:\s|\{|$)/.test(line)) continue
    hasFamily = true
    if (services.length >= 200) fail('inventory limit exceeded')
    const { labels, status } = parseStatusSample(line)
    const monitorId = labels.get('monitor_id')
    const name = labels.get('monitor_name')
    const type = labels.get('monitor_type')
    if (!/^[1-9]\d{0,15}$/.test(monitorId || '') || !Number.isSafeInteger(Number(monitorId)) || ids.has(monitorId) ||
      typeof name !== 'string' || !name.trim() || name.length > 160 || !text(type, 80)) fail('invalid metrics response')
    ids.add(monitorId)
    const states = { 0: ['offline', 'Monitor down'], 1: ['online', 'Monitor up'], 2: ['degraded', 'Check pending'], 3: ['maintenance', 'Maintenance'] }
    const [normalized, detail] = states[status] || ['degraded', 'Unknown monitor status']
    services.push({
      id: `uptime-kuma-${monitorId}`, name: `Uptime Kuma · ${display(name)}`, category: 'monitoring',
      host: new URL(origin).hostname, site: display(config.site), status: normalized,
      detail: `${detail} · ${display(type)}`, updated: observedAt,
    })
  }
  if (!hasFamily) fail('invalid metrics response')
  return services
}

export async function getUptimeKumaServices(config, { fetchImpl = fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  if (!config?.enabled) return []
  const origin = validateConfig(config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Kuma metrics keys use Basic auth with an empty username; no admin login or Socket.IO access.
    const response = await fetchImpl(`${origin}/metrics`, {
      method: 'GET', headers: { Accept: 'text/plain; version=0.0.4', Authorization: `Basic ${Buffer.from(`:${config.apiKey}`, 'utf8').toString('base64')}` },
      signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    })
    if (!response.ok) {
      await response.body?.cancel()
      fail([401, 403].includes(response.status) ? 'authentication failed' : 'unavailable')
    }
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/plain') {
      await response.body?.cancel()
      fail('invalid metrics response')
    }
    const body = await readMetrics(response)
    return normalizeMetrics(body, config, origin, new Date(now()).toISOString())
  } catch (error) {
    if (controller.signal.aborted) fail('timeout')
    if (error instanceof UptimeKumaError) throw error
    fail('unavailable')
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}
