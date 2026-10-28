// Read-only liveness probe for the self-hosted Supabase on VM132. One bounded
// GET through PostgREST also exercises PostgreSQL, so a database that cannot
// read its own files (the 2026-09-19 ownership incident) reports offline.
// Never returns URLs, keys or response bodies.
export async function getSupabaseHealthServices(config, {fetchImpl = globalThis.fetch, timeoutMs = 5000} = {}) {
  const baseUrl = String(config?.supabaseUrl || '').replace(/\/+$/, '')
  const key = String(config?.serviceKey || '')
  if (!config?.enabled || !baseUrl || !key) return []

  let status = 'offline'
  let detail = 'Unreachable'
  try {
    const response = await fetchImpl(`${baseUrl}/rest/v1/friday_agents?select=id&limit=1`, {
      method: 'GET',
      headers: {apikey: key, authorization: `Bearer ${key}`, accept: 'application/json'},
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 200) {
      const rows = await response.json().catch(() => null)
      status = Array.isArray(rows) ? 'online' : 'degraded'
      detail = Array.isArray(rows) ? 'PostgREST and PostgreSQL answering' : 'Unexpected response body'
    } else {
      status = response.status >= 500 ? 'offline' : 'degraded'
      detail = `HTTP ${response.status}`
    }
  } catch (error) {
    detail = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'Timed out' : 'Unreachable'
  }

  return [{
    id: 'vm132-supabase',
    name: 'Supabase database (VM132)',
    category: 'database',
    host: 'supabase-prod',
    site: config.site || 'Site A',
    status,
    detail,
    updated: 'live',
  }]
}
