import { createHash } from 'node:crypto'

const MAX_BODY_BYTES = 512 * 1024
const MAX_RULES = 200
class GrafanaError extends Error {}
const fail = message => { throw new GrafanaError(`Grafana ${message}`) }
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value)
const RULE_NOTE = 'Alert rule state, not service health'

function validateConfig(config) {
  try {
    const url = new URL(config.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !text(config.token, 4096) || !text(config.site, 80)) throw Error()
    return url
  } catch { throw new GrafanaError('Invalid Grafana configuration') }
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

function ruleStatus(rule) {
  if (rule.health === 'error') return { status: 'degraded', label: 'Rule evaluation error' }
  if (rule.health === 'nodata') return { status: 'degraded', label: 'Rule has no data' }
  if (rule.health !== 'ok') return { status: 'degraded', label: 'Alert state unknown' }
  if (rule.state === 'firing') return { status: 'degraded', label: 'Alert firing' }
  if (['inactive', 'normal', 'pending', 'recovering'].includes(rule.state)) return { status: 'online', label: `Alert ${rule.state}` }
  return { status: 'degraded', label: 'Alert state unknown' }
}

function normalizeRules(payload, config, collectedAt, publicText) {
  if (payload?.status !== 'success') fail('request rejected')
  const groups = payload.data?.groups
  if (!Array.isArray(groups)) fail('invalid response')
  const seen = new Set()
  const services = []
  for (const group of groups) {
    if (!plainObject(group) || !text(group.name, 190) || !text(group.file, 190) || !Array.isArray(group.rules)) fail('invalid response')
    for (const rule of group.rules) {
      if (!plainObject(rule) || !text(rule.name, 190) || !text(rule.type, 32)) fail('invalid response')
      if (rule.type !== 'alerting') continue
      if (!text(rule.state, 32) || !text(rule.health, 32) || (rule.labels !== undefined && !plainObject(rule.labels))) fail('invalid response')
      if (services.length >= MAX_RULES) fail('inventory limit exceeded')
      // Folder, group and rule name identify a Grafana-managed rule; state is not identity.
      const id = `grafana-rule-${createHash('sha256').update(JSON.stringify([group.file, group.name, rule.name])).digest('hex')}`
      if (seen.has(id)) fail('invalid response')
      seen.add(id)
      const { status, label } = ruleStatus(rule)
      const severity = text(rule.labels?.severity, 32) ? rule.labels.severity : null
      const evaluated = typeof rule.lastEvaluation === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(rule.lastEvaluation) ? Date.parse(rule.lastEvaluation) : NaN
      services.push({
        id, name: `Grafana alert · ${publicText(rule.name)}`, category: 'monitoring',
        host: publicText(`${group.file} / ${group.name}`), site: config.site.trim(), status,
        detail: [label, severity && publicText(severity), RULE_NOTE].filter(Boolean).join(' · '),
        updated: Number.isFinite(evaluated) && evaluated > 0 ? new Date(evaluated).toISOString() : collectedAt,
        firing: rule.health === 'ok' && rule.state === 'firing',
      })
    }
  }
  return services
}

export async function getGrafanaServices(config, { fetchImpl = fetch, timeoutMs = 5000, now = () => new Date() } = {}) {
  if (!config?.enabled) return []
  const url = validateConfig(config)
  const publicText = value => value.split(config.token).join('[redacted]')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // Only these two fixed reads. No dashboards, queries, datasource proxy, silences or rule edits.
  const get = async path => {
    const response = await fetchImpl(`${url.origin}${path}`, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${config.token}` },
      signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    })
    if (!response.ok) {
      await response.body?.cancel()
      fail([401, 403].includes(response.status) ? 'authentication failed' : 'unavailable')
    }
    return readJson(response)
  }
  try {
    const health = await get('/api/health')
    if (!plainObject(health) || !text(health.database, 32) || (health.version !== undefined && !text(health.version, 40))) fail('invalid response')
    const collectedAt = now().toISOString()
    const rules = normalizeRules(await get('/api/prometheus/grafana/api/v1/rules'), config, collectedAt, publicText)
    const firing = rules.filter(rule => rule.firing).length
    const databaseOk = health.database === 'ok'
    const grafana = {
      id: 'grafana', name: 'Grafana', category: 'monitoring', host: url.hostname, site: config.site.trim(),
      status: databaseOk ? 'online' : 'degraded',
      detail: [databaseOk ? 'Database ok' : 'Database not ok', health.version && `v${publicText(health.version)}`,
        `${firing} firing of ${rules.length} alert rules`].filter(Boolean).join(' · '),
      updated: collectedAt,
    }
    return [grafana, ...rules.map(({ firing: _firing, ...service }) => service)]
  } catch (error) {
    if (controller.signal.aborted) fail('timeout')
    if (error instanceof GrafanaError) throw error
    fail('unavailable')
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}
