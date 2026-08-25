import { classifyHttpFailure, providerFailure } from './errors.mjs'
import { fridaySystemPrompt, fridayUserPrompt } from './policy.mjs'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

export function extractResponseText(response = {}) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim()
  }

  const parts = []
  for (const item of response.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text)
      }
    }
  }
  return parts.join('\n').trim()
}

export async function askOpenAI({
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
    throw providerFailure('openai', 'configuration')
  }

  let response
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model,
        reasoning: { effort: 'low' },
        max_output_tokens: 1200,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fridayUserPrompt(prompt, overview, history) },
        ],
      }),
    })
  } catch (error) {
    const kind = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'network'
    throw providerFailure('openai', kind)
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw classifyHttpFailure('openai', response.status)

  const text = extractResponseText(payload)
  if (!text) throw providerFailure('openai', 'invalid-response')

  return {
    provider: 'openai',
    model,
    text,
  }
}
