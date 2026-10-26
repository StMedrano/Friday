import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const paths = new Set(['/api/health', '/api/overview', '/api/incidents', '/api/monitoring/history', '/api/repositories'])
const quote = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'

export function cloudSettings(env = process.env) {
  const url = new URL(env.FRIDAY_CLOUD_URL || '')
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('FRIDAY_CLOUD_URL must be an HTTPS origin without credentials, path or query')
  const clientId = env.FRIDAY_CLOUD_CLIENT_ID || ''
  const clientSecret = env.FRIDAY_CLOUD_CLIENT_SECRET || ''
  if (![clientId, clientSecret].every(s => s.length > 0 && s.length <= 4096 && !/[\u0000-\u0020\u007f]/.test(s)))
    throw Error('Configure cloud service credentials through environment secrets')
  return { origin: url.origin, clientId, clientSecret }
}

export function cloudRequest(settings, path, { method = 'GET', auth = true, execImpl = spawnSync } = {}) {
  if (!paths.has(path) || !['GET', 'POST'].includes(method)) throw Error('Unsupported acceptance check')
  const lines = ['silent', 'max-time = 15', 'connect-timeout = 5', 'max-filesize = 2097152',
    'proto = "=https"', 'write-out = "\\n%{http_code}"',
    `url = ${quote(settings.origin + path)}`, `request = ${quote(method)}`]
  if (auth) lines.push(`header = ${quote('CF-Access-Client-Id: ' + settings.clientId)}`,
    `header = ${quote('CF-Access-Client-Secret: ' + settings.clientSecret)}`)
  // Curl honors the managed environment proxy/CA. Secrets never enter argv,
  // files or output. No redirects; ignore user curlrc to preserve these bounds.
  const result = execImpl('curl', ['--disable', '--config', '-'], {
    input: lines.join('\n') + '\n', encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 + 1024,
  })
  if (result.status !== 0) throw Error('HTTPS request failed; check hostname allowlist, TLS and credential bindings')
  const split = result.stdout.lastIndexOf('\n')
  const status = Number(result.stdout.slice(split + 1))
  let body = null
  try { body = JSON.parse(result.stdout.slice(0, split)) } catch {}
  return { status, body }
}

export function checkConnection(request) {
  const outcomes = []
  function check(path, options, expected) {
    const result = request(path, options)
    if (result.status !== expected) throw Error(`Acceptance failed: ${options?.method || 'GET'} ${path} expected ${expected}, received ${result.status}`)
    outcomes.push({ path, method: options?.method || 'GET', authenticated: options?.auth !== false, status: result.status })
    return result.body
  }
  const health = check('/api/health', {}, 200)
  if (health?.service !== 'friday-automation' || health.mode !== 'live') throw Error('Expected the live Friday automation listener')
  const overview = check('/api/overview', {}, 200)
  if (overview?.mode !== 'live' || !Array.isArray(overview.services) || !Number.isFinite(Date.parse(overview.generatedAt)))
    throw Error('Expected a live, timestamped overview snapshot')
  check('/api/incidents', {}, 200)
  check('/api/monitoring/history', {}, 200)
  const unauthenticated = request('/api/health', { auth: false })
  if (![401, 403].includes(unauthenticated.status))
    throw Error(`Acceptance failed: GET /api/health expected 401 or 403, received ${unauthenticated.status}`)
  outcomes.push({ path: '/api/health', method: 'GET', authenticated: false, status: unauthenticated.status })
  check('/api/overview', { method: 'POST' }, 405)
  check('/api/repositories', {}, 404)
  return outcomes
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const settings = cloudSettings()
    const outcomes = checkConnection((path, options) => cloudRequest(settings, path, options))
    console.log(JSON.stringify({ connected: true, checks: outcomes }, null, 2))
  } catch {
    console.error('Cloud connection checks failed. Verify the hostname allowlist, secret bindings, Access policy, live monitoring and automation listener. No credentials or response bodies were printed.')
    process.exitCode = 1
  }
}
