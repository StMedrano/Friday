import {pathToFileURL} from 'node:url'

function invalidTarget() {
  const e = new Error('Invalid preflight target')
  e.kind = 'invalid-target'
  return e
}

export function normalizeSupabaseUrl(value) {
  if (typeof value !== 'string' || value.length > 512) throw invalidTarget()
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash
      || !url.hostname
      || !['', '/'].includes(url.pathname)) throw invalidTarget()
    return url.origin
  } catch {
    throw invalidTarget()
  }
}

// Read-only. No service keys, no authorization headers, no DB writes, no credentials.
export async function inspectSupabaseGateway({baseUrl, fetchImpl = globalThis.fetch} = {}) {
  const url = normalizeSupabaseUrl(baseUrl) + '/rest/v1/'
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {accept: 'application/json'},
      signal: AbortSignal.timeout(6000),
      redirect: 'error',
    })
  } catch {
    return {reachable:false, dataApiStatus:null, authenticated:false, migrationReady:false}
  }
  return {
    reachable: true,
    dataApiStatus: Number(response.status),
    authenticated: false,
    migrationReady: false,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw invalidTarget()
    const result = await inspectSupabaseGateway({baseUrl:process.argv[2]})
    console.log(JSON.stringify(result))
    if (!result.reachable) process.exitCode = 1
  } catch {
    console.error('Invalid or inaccessible Supabase gateway target. Use an origin URL only, without credentials or query parameters.')
    process.exitCode = 2
  }
}