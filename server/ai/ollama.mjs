import { classifyHttpFailure, providerFailure } from './errors.mjs'
import { fridaySystemPrompt, fridayUserPrompt } from './policy.mjs'

export async function askOllama({
  providerConfig = {},
  prompt,
  overview,
  systemPrompt = fridaySystemPrompt(),
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const enabled = providerConfig.enabled === true
  const baseUrl = String(providerConfig.baseUrl || '').trim().replace(/\/+$/, '')
  const model = String(providerConfig.model || '').trim()
  const parsedContext = Number(providerConfig.context)
  const context = Number.isFinite(parsedContext) && parsedContext > 0 ? parsedContext : 8192

  if (!enabled || !baseUrl || !model || typeof fetchImpl !== 'function') {
    throw providerFailure('ollama', 'configuration')
  }

  let response
  try {
    response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fridayUserPrompt(prompt, overview) },
        ],
        options: { num_ctx: context },
      }),
    })
  } catch (error) {
    const kind = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'network'
    throw providerFailure('ollama', kind)
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw classifyHttpFailure('ollama', response.status)

  const text = typeof payload?.message?.content === 'string' ? payload.message.content.trim() : ''
  if (!text) throw providerFailure('ollama', 'invalid-response')

  return { provider: 'ollama', model, text }
}
