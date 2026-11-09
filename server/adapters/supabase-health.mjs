// Read-only liveness probe for the self-hosted Supabase on VM132. One bounded
// GET through PostgREST also exercises PostgreSQL, so a database that cannot
// read its own files (the 2026-09-19 ownership incident) reports offline.
// Never returns URLs, keys or response bodies.
//
// A single lost request must not report an outage: the path to VM132 drops one
// probe near the top of most hours, and one dropped probe writes two state
// transitions, which is enough for incidents.mjs to open a flapping warning.
// So an offline result is confirmed by a second attempt before it is reported.
// The attempts share the caller's budget, so the worst case is unchanged, and a
// real outage still fails both attempts and is reported on the same poll.
async function probeOnce(fetchImpl, baseUrl, key, timeoutMs) {
  try {
    const response = await fetchImpl(`${baseUrl}/rest/v1/friday_agents?select=id&limit=1`, {
      method: 'GET',
      headers: {apikey: key, authorization: `Bearer ${key}`, accept: 'application/json'},
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 200) {
      const rows = await response.json().catch(() => null)
      return Array.isArray(rows)
        ? {status: 'online', detail: 'PostgREST and PostgreSQL answering'}
        : {status: 'degraded', detail: 'Unexpected response body'}
    }
    return {status: response.status >= 500 ? 'offline' : 'degraded', detail: `HTTP ${response.status}`}
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    return {status: 'offline', detail: timedOut ? 'Timed out' : 'Unreachable'}
  }
}

export async function getSupabaseHealthServices(config, {fetchImpl = globalThis.fetch, timeoutMs = 5000, attempts = 2} = {}) {
  const baseUrl = String(config?.supabaseUrl || '').replace(/\/+$/, '')
  const key = String(config?.serviceKey || '')
  if (!config?.enabled || !baseUrl || !key) return []

  const total = Math.max(1, Number(attempts) || 1)
  const perAttemptMs = Math.max(1, Math.floor(timeoutMs / total))
  let outcome = {status: 'offline', detail: 'Unreachable'}
  for (let attempt = 1; attempt <= total; attempt += 1) {
    outcome = await probeOnce(fetchImpl, baseUrl, key, perAttemptMs)
    // Only an outage is worth confirming. A 4xx is a stable configuration
    // problem, and retrying it would just double the load for the same answer.
    if (outcome.status !== 'offline') break
  }

  return [{
    id: 'vm132-supabase',
    name: 'Supabase database (VM132)',
    category: 'database',
    host: 'supabase-prod',
    site: config.site || 'Site A',
    status: outcome.status,
    detail: outcome.detail,
    updated: 'live',
  }]
}
