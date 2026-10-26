import { createHash } from 'node:crypto'

const MAX_BODY_BYTES = 512 * 1024
class PrometheusError extends Error {}
const fail = message => { throw new PrometheusError(`Prometheus ${message}`) }
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)

function validateConfig(config) {
  try {
    const url = new URL(config.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !text(config.username, 256) || config.username.includes(':') || !text(config.password, 4096) || !text(config.site, 80)) throw Error()
    return url.origin
  } catch { throw new PrometheusError('Invalid Prometheus configuration') }
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

function instanceHost(instance) {
  try {
    const url = new URL(instance.includes('://') ? instance : `http://${instance}`)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw Error()
    // Blackbox-exporter instances can be URLs with userinfo/query secrets. Display only host/port.
    return url.host
  } catch { fail('invalid response') }
}

function normalizeTargets(targets, config) {
  if (!Array.isArray(targets)) fail('invalid response')
  if (targets.length > 200) fail('inventory limit exceeded')
  const seen = new Set()
  const publicText = value => [config.password, config.username].reduce((result, secret) => result.split(secret).join('[redacted]'), value)
  return targets.map(target => {
    const labels = target?.labels
    if (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.keys(labels).length > 64 ||
      Object.entries(labels).some(([key, value]) => key.length > 128 || typeof value !== 'string' || value.length > 2048) ||
      !text(labels.job, 160) || !text(labels.instance, 2048) || !text(target.scrapePool, 256) || !text(target.health, 32) ||
      (labels.site !== undefined && labels.site !== '' && !text(labels.site, 80))) fail('invalid response')
    // Label order and scrape outcome are not identity. Other labels distinguish replicas.
    const identity = JSON.stringify([target.scrapePool, Object.keys(labels).sort().map(key => [key, labels[key]])])
    const id = `prometheus-${createHash('sha256').update(identity).digest('hex')}`
    if (seen.has(id)) fail('invalid response')
    seen.add(id)

    const known = ['up', 'down'].includes(target.health)
    const timestamp = typeof target.lastScrape === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(target.lastScrape) ? Date.parse(target.lastScrape) : NaN
    const neverScraped = target.lastScrape === '0001-01-01T00:00:00Z'
    if (!Number.isFinite(timestamp) || (timestamp <= 0 && (!neverScraped || known))) fail('invalid response')
    const state = target.health === 'up' ? 'successful' : target.health === 'down' ? 'failed' : 'health unknown'
    return {
      id, name: `Prometheus · ${publicText(labels.job)}`, category: 'monitoring',
      host: publicText(instanceHost(labels.instance)), site: publicText(labels.site || config.site).trim(),
      status: target.health === 'up' ? 'online' : target.health === 'down' ? 'offline' : 'degraded',
      detail: `Scrape ${state} · Application health not assessed`,
      updated: neverScraped ? 'Not yet scraped' : new Date(timestamp).toISOString(),
    }
  })
}

export async function getPrometheusServices(config, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!config?.enabled) return []
  const origin = validateConfig(config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // No query evaluator, scrape, target URL follow, configuration, or admin API access.
    const response = await fetchImpl(`${origin}/api/v1/targets?state=active`, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}` },
      signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    })
    if (!response.ok) {
      await response.body?.cancel()
      fail([401, 403].includes(response.status) ? 'authentication failed' : 'unavailable')
    }
    const payload = await readJson(response)
    if (payload?.status !== 'success') fail('request rejected')
    return normalizeTargets(payload.data?.activeTargets, config)
  } catch (error) {
    if (controller.signal.aborted) fail('timeout')
    if (error instanceof PrometheusError) throw error
    fail('unavailable')
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}
