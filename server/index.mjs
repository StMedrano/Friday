import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { getConfig } from './config.mjs'
import { previewCommand } from './core.mjs'
import { buildOverview } from './overview.mjs'
import { answerAssistant } from './assistant.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'dist')
const config = getConfig()

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 32_768) request.destroy(new Error('Request body too large'))
    })
    request.on('end', () => {
      if (!body) return resolve({})
      try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid JSON')) }
    })
    request.on('error', reject)
  })
}

function serveStatic(requestPath, response) {
  const clean = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.(\/|\\|$))+/, '')
  let path = join(publicDir, clean === '/' ? 'index.html' : clean)
  if (!path.startsWith(publicDir)) return false
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(publicDir, 'index.html')
  if (!existsSync(path)) return false
  response.writeHead(200, {
    'content-type': mime[extname(path)] || 'application/octet-stream',
    'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  })
  createReadStream(path).pipe(response)
  return true
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  if (request.method === 'GET' && url.pathname === '/healthz') {
    return json(response, 200, { status: 'ok', service: 'friday', mode: config.mode })
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(response, 200, { status: 'ok', mode: config.mode, ai: config.ai.enabled, time: new Date().toISOString() })
  }

  if (request.method === 'GET' && url.pathname === '/api/overview') {
    try { return json(response, 200, await buildOverview(config)) }
    catch (error) { return json(response, 500, { error: 'overview-failed', detail: error.message }) }
  }

  if (request.method === 'POST' && url.pathname === '/api/commands/preview') {
    try {
      const result = previewCommand(await readBody(request))
      return json(response, result.accepted ? 200 : 400, result)
    } catch (error) {
      return json(response, 400, { accepted: false, mode: 'preview', reason: error.message })
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/assistant') {
    try {
      const body = await readBody(request)
      const overview = await buildOverview(config)
      const result = await answerAssistant({ config, prompt: body.prompt, overview })
      return json(response, result.available ? 200 : 503, result)
    } catch (error) {
      return json(response, 502, { available: false, error: 'assistant-failed', detail: error.message })
    }
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    if (serveStatic(url.pathname, response)) return
  }

  json(response, 404, { error: 'not-found' })
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Friday listening on 0.0.0.0:${config.port} (${config.mode} mode)`)
})
