function deriveName(url) {
  try { return new URL(url).hostname } catch { return url }
}

export async function getEndpointServices(config) {
  if (!config.enabled || config.urls.length === 0) return []
  return Promise.all(config.urls.map(async (url, index) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal })
      return {
        id: `endpoint-${index}`,
        name: deriveName(url),
        category: 'monitoring',
        host: deriveName(url),
        site: 'Site A',
        status: response.ok ? 'online' : 'degraded',
        detail: `HTTP ${response.status}`,
        updated: 'live',
      }
    } catch (error) {
      return {
        id: `endpoint-${index}`,
        name: deriveName(url),
        category: 'monitoring',
        host: deriveName(url),
        site: 'Site A',
        status: 'offline',
        detail: error.name === 'AbortError' ? 'Timeout' : 'Unreachable',
        updated: 'live',
      }
    } finally {
      clearTimeout(timer)
    }
  }))
}
