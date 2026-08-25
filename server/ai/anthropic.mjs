import { classifyHttpFailure, providerFailure } from './errors.mjs'
import { fridaySystemPrompt, fridayUserPrompt } from './policy.mjs'

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

function extractAnthropicText(payload = {}) {
  return (payload.content || [])
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim()
}

export async function askAnthropic({
  providerConfig = {},
  prompt,
  history = [],
  overview,
  systemPrompt = fridaySystemPrompt(),
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const apiKey = String(providerConfig.apiKey || '').trim()
  const model = String(providerConfig.model || '').trim()
  if (!apiKey || !model || typeof fetchImpl !== 'function') {
    throw providerFailure('anthropic', 'configuration')
  }

  let response
  try {
    response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: fridayUserPrompt(prompt, overview, history) }],
      }),
    })
  } catch (error) {
    const kind = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'network'
    throw providerFailure('anthropic', kind)
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw classifyHttpFailure('anthropic', response.status)

  const text = extractAnthropicText(payload)
  if (!text) throw providerFailure('anthropic', 'invalid-response')

  return { provider: 'anthropic', model, text }
}
