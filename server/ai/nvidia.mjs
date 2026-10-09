import { classifyHttpFailure, providerFailure } from './errors.mjs'

function endpoint(providerConfig, path) {
  const { baseUrl, model, deployment, apiKey } = providerConfig ?? {}
  if (!['hosted', 'local'].includes(deployment) || !String(model || '').trim()) throw providerFailure('nvidia', 'configuration')
  if (deployment === 'hosted' && !String(apiKey || '').trim()) throw providerFailure('nvidia', 'configuration')
  try {
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('invalid url')
    // Only accept absolute configured API roots; do not let a provider-supplied relative path change origin.
    return new URL(url.pathname.replace(/\/$/, '') + path, url.origin).toString()
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
      const payload = await send(fetchImpl, url, { method: 'GET', headers: headers(providerConfig), signal })
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
        method: 'POST', headers: headers(providerConfig), signal,
        body: JSON.stringify({model:providerConfig.model, messages:request.messages, max_tokens: Math.min(requested,configured)}),
      })
      const text = extractText(payload)
      if (!text) throw providerFailure('nvidia', 'invalid-response')
      return {provider:'nvidia', model:providerConfig.model, text}
    },
  })
}