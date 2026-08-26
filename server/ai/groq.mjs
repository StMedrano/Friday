import { classifyHttpFailure, providerFailure } from './errors.mjs'
import { fridaySystemPrompt, fridayUserPrompt } from './policy.mjs'

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'

function extractGroqText(payload = {}) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

export async function askGroq({
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
    throw providerFailure('groq', 'configuration')
  }

  let response
  try {
    response = await fetchImpl(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model,
        max_completion_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fridayUserPrompt(prompt, overview, history) },
        ],
      }),
    })
  } catch (error) {
    const kind = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'network'
    throw providerFailure('groq', kind)
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw classifyHttpFailure('groq', response.status)

  const text = extractGroqText(payload)
  if (!text) throw providerFailure('groq', 'invalid-response')

  return { provider: 'groq', model, text }
}
