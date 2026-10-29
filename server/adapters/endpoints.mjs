function deriveName(url) {
  try { return new URL(url).hostname } catch { return url }
}

function legacyChecks(urls = [], site = 'Site A') {
  return urls.map((url,index)=>({
    id:String(index),name:deriveName(url),site,url,expectedStatuses:null,
  }))
}

export async function getEndpointServices(config,{fetchImpl=fetch,now=Date.now}={}) {
  if (!config?.enabled) return []
  if (config.configurationError) throw Error('Invalid endpoint configuration')
  const checks=Array.isArray(config.checks)&&config.checks.length?config.checks:legacyChecks(config.urls,config.site||'Site A')
  if (!checks.length) return []
  return Promise.all(checks.map(async (check) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const started=now()
    try {
      const response = await fetchImpl(check.url, {
        method: 'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,
      })
      const status=response.status
      try { await response.body?.cancel() } catch {}
      controller.abort()
      const latencyMs=Math.max(0,Math.round(now()-started))
      const accepted=check.expectedStatuses===null
        ? status>=200&&status<300
        : check.expectedStatuses.includes(status)
      return {
        id: `endpoint-${check.id}`,
        name: check.name,
        category: 'monitoring',
        host: deriveName(check.url),
        site: check.site,
        status: accepted ? 'online' : 'degraded',
        detail: `HTTP ${status} · ${latencyMs} ms`,
        updated: new Date().toISOString(),
        latencyMs,
      }
    } catch (error) {
      return {
        id: `endpoint-${check.id}`,
        name: check.name,
        category: 'monitoring',
        host: deriveName(check.url),
        site: check.site,
        status: 'offline',
        detail: ['AbortError','TimeoutError'].includes(error?.name) ? 'Timeout' : 'Unreachable',
        updated: new Date().toISOString(),
        latencyMs: Math.max(0,Math.round(now()-started)),
      }
    } finally {
      controller.abort()
      clearTimeout(timer)
    }
  }))
}
