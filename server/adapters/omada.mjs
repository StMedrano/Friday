// Omada Open API v1 only. The sole POST obtains an OAuth token; inventory is GET-only.
const ID = /^[a-zA-Z0-9_-]{1,128}$/
const MAC = /^(?:[a-fA-F0-9]{2}[:-]){5}[a-fA-F0-9]{2}$/
const PAGE_SIZE = 100
const MAX_BODY_BYTES = 512 * 1024

class OmadaError extends Error {}
const fail = message => { throw new OmadaError(`Omada ${message}`) }

function validateConfig(config) {
  try {
    const url = new URL(config.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      typeof config.controllerId !== 'string' || !ID.test(config.controllerId) ||
      ![config.clientId, config.clientSecret].every(value => typeof value === 'string' && value.trim() && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value))) throw Error()
    return url.origin
  } catch { throw new OmadaError('Invalid Omada configuration') }
}

async function readJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
    await response.body?.cancel()
    fail('response too large')
  }
  if (!response.body) fail('invalid response')
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
  catch { fail('invalid response') }
}

function safeText(value, fallback, secrets) {
  if (typeof value !== 'string' || !value.trim()) return fallback
  let text = value
  for (const secret of secrets) text = text.split(secret).join('[redacted]')
  return text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || fallback
}

export function createOmadaAdapter({ fetchImpl = fetch, now = Date.now, timeoutMs = 10000 } = {}) {
  // Tokens never leave server memory. A changed configuration or upstream failure invalidates them.
  const tokens = new WeakMap()
  return async function getOmadaServices(config) {
    if (!config?.enabled) return []
    const origin = validateConfig(config)
    const credentials = JSON.stringify([origin, config.controllerId, config.clientId, config.clientSecret])
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let requests = 0
    try {
      async function request(path, { body, accessToken } = {}) {
        if (++requests > 50) fail('inventory limit exceeded')
        const response = await fetchImpl(`${origin}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `AccessToken=${accessToken}` } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        })
        if (!response.ok) {
          await response.body?.cancel()
          fail([401, 403].includes(response.status) ? 'authentication failed' : 'unavailable')
        }
        const payload = await readJson(response)
        if (payload?.errorCode !== 0) fail('request rejected')
        if (!payload.result || typeof payload.result !== 'object') fail('invalid response')
        return payload.result
      }

      let cached = tokens.get(config)
      if (!cached || cached.credentials !== credentials || cached.expiresAt <= now()) {
        const result = await request('/openapi/authorize/token?grant_type=client_credentials', {
          body: { omadacId: config.controllerId, client_id: config.clientId, client_secret: config.clientSecret },
        })
        if (typeof result.accessToken !== 'string' || !result.accessToken || result.accessToken.length > 4096 ||
          /\s/.test(result.accessToken) || !Number.isFinite(result.expiresIn) || result.expiresIn <= 0) fail('invalid response')
        cached = { credentials, value: result.accessToken, expiresAt: now() + Math.max(0, Math.min(result.expiresIn, 7200) - 30) * 1000 }
        tokens.set(config, cached)
      }
      const secrets = [config.clientSecret, config.clientId, cached.value]
      const text = (value, fallback) => safeText(value, fallback, secrets)
      const root = `/openapi/v1/${config.controllerId}/sites`

      async function list(path, limit, identify) {
        const items = []
        const ids = new Set()
        let total
        for (let page = 1; ; page++) {
          const result = await request(`${path}?page=${page}&pageSize=${PAGE_SIZE}`, { accessToken: cached.value })
          if (!Array.isArray(result.data) || !Number.isSafeInteger(result.totalRows) || result.totalRows < 0 ||
            result.data.length > PAGE_SIZE || (total !== undefined && total !== result.totalRows)) fail('invalid response')
          total = result.totalRows
          if (total > limit) fail('inventory limit exceeded')
          for (const item of result.data) {
            const id = identify(item)
            if (!id || ids.has(id)) fail('invalid response')
            ids.add(id)
            items.push(item)
          }
          if (items.length > total) fail('invalid response')
          if (items.length === total) return items
          if (!result.data.length) fail('invalid response')
        }
      }

      const sites = await list(root, 16, item => typeof item?.siteId === 'string' && ID.test(item.siteId) ? item.siteId : null)
      const services = []
      const updated = new Date(now()).toISOString()
      const host = new URL(origin).hostname
      let deviceCount = 0
      for (const site of sites) {
        const devices = await list(`${root}/${site.siteId}/devices`, 200, item => typeof item?.mac === 'string' && MAC.test(item.mac) ? item.mac.toLowerCase().replaceAll(':', '-') : null)
        deviceCount += devices.length
        if (deviceCount > 1000) fail('inventory limit exceeded')
        const siteName = text(site.name, site.siteId)
        const online = devices.filter(device => device.status === 1).length
        services.push({
          id: `omada-site-${site.siteId}`, name: `Omada · ${siteName}`, category: 'network', host, site: siteName,
          status: devices.length && online === devices.length ? 'online' : 'degraded',
          detail: devices.length ? `${online}/${devices.length} devices connected` : 'No devices observed', updated,
        })
        for (const device of devices) {
          const mac = device.mac.toLowerCase().replaceAll(':', '-')
          const status = device.status === 1 ? 'online' : device.status === 0 ? 'offline' : 'degraded'
          const state = device.status === 1 ? 'Connected' : device.status === 0 ? 'Disconnected' : 'Unknown device status'
          services.push({
            id: `omada-device-${site.siteId}-${mac}`, name: text(device.name, mac), category: 'network', host, site: siteName,
            status, detail: `${text(device.model, 'Omada device')} · ${state}`, updated,
          })
        }
      }
      return services
    } catch (error) {
      tokens.delete(config)
      if (controller.signal.aborted) fail('timeout')
      if (error instanceof OmadaError) throw error
      fail('unavailable')
    } finally {
      controller.abort()
      clearTimeout(timer)
    }
  }
}

export const getOmadaServices = createOmadaAdapter()
