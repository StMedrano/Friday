import { classifyHttpFailure, providerFailure } from './errors.mjs'

function endpoint(providerConfig, path) {
  const { baseUrl, model, deployment, apiKey } = providerConfig ?? {}
  if (!['hosted', 'local'].includes(deployment) || !String(model || '').trim()) throw providerFailure('nvidia', 'configuration')
  if (deployment === 'hosted' && !String(apiKey || '').trim()) throw providerFailure('nvidia', 'configuration')
  try {
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('invalid url')
    // Never send a hosted API key to an env-supplied hostname or an insecure
    // endpoint. The catalog API uses a single immutable HTTPS origin and /v1 root.
    if (deployment === 'hosted' && (url.origin !== 'https://integrate.api.nvidia.com' || !['/v1','/v1/'].includes(url.pathname))) {
      throw Error('untrusted hosted endpoint')
    }
    // Local/NIM endpoints are operator-configured, but a URL path must remain
    // an API root rather than allowing caller-controlled cross-route requests.
    if (deployment === 'local' && !['/v1','/v1/'].includes(url.pathname)) throw Error('invalid local API root')
    return new URL('/v1' + path, url.origin).toString()
  } catch {
    throw providerFailure('nvidia', 'configuration')
  }
}

function headers(providerConfig) {
  return {
    'Content-Type': 'application/json',
    ...(providerConfig.deployment === 'hosted' ? { Authorization: `Bearer ${providerConfig.apiKey}` } : {}),
  }
}

function extractText(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((p) => typeof p?.text === 'string' ? p.text : '').filter(Boolean).join('\n').trim()
  return ''
}

function normalizeThrown(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return providerFailure('nvidia', 'timeout')
  return providerFailure('nvidia', 'network')
}

async function send(fetchImpl, url, init) {
  let response
  try { response = await fetchImpl(url, init) } catch (e) { throw normalizeThrown(e) }
  if (!response?.ok) throw classifyHttpFailure('nvidia', response?.status ?? 500)
  try { return await response.json() } catch { throw providerFailure('nvidia', 'invalid-response') }
}

export function createNvidiaProvider({ fetchImpl = globalThis.fetch } = {}) {
  return Object.freeze({
    id: 'nvidia',
    async health({ providerConfig, signal } = {}) {
      const url = endpoint(providerConfig, '/models')
      const payload = await send(fetchImpl, url, { method: 'GET', headers: headers(providerConfig), signal, redirect:'error' })
      if (!Array.isArray(payload?.data) || !payload.data.some(m => m?.id === providerConfig.model)) {
        throw providerFailure('nvidia', 'model-unavailable')
      }
      return {healthy:true}
    },
    async generate({ providerConfig, request, signal } = {}) {
      const url = endpoint(providerConfig, '/chat/completions')
      if (!Array.isArray(request?.messages) || !request.messages.length ||
        !request.messages.every(m => ['system', 'user', 'assistant'].includes(m?.role) && typeof m?.content === 'string')) {
        throw providerFailure('nvidia', 'configuration')
      }
      const requested = Number.isSafeInteger(request.maxTokens) && request.maxTokens > 0 ? request.maxTokens : 768
      const configured = Number.isSafeInteger(providerConfig.maxTokens) && providerConfig.maxTokens > 0 ? providerConfig.maxTokens : 768
      const payload = await send(fetchImpl, url, {
        method: 'POST', headers: headers(providerConfig), signal, redirect:'error',
        body: JSON.stringify({model:providerConfig.model, messages:request.messages, max_tokens: Math.min(requested,configured)}),
      })
      const text = extractText(payload)
      if (!text) throw providerFailure('nvidia', 'invalid-response')
      return {provider:'nvidia', model:providerConfig.model, text}
    },
  })
}