import { classifyHttpFailure, providerFailure } from './errors.mjs'
import { fridaySystemPrompt, fridayUserPrompt } from './policy.mjs'

function extractGeminiText(payload = {}) {
  const parts = []
  for (const candidate of payload.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === 'string') parts.push(part.text)
    }
  }
  return parts.join('\n').trim()
}

export async function askGemini({
  providerConfig = {},
  prompt,
  overview,
  systemPrompt = fridaySystemPrompt(),
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const apiKey = String(providerConfig.apiKey || '').trim()
  const model = String(providerConfig.model || '').trim()
  if (!apiKey || !model || typeof fetchImpl !== 'function') {
    throw providerFailure('gemini', 'configuration')
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: fridayUserPrompt(prompt, overview) }] }],
        generationConfig: { maxOutputTokens: 1200 },
      }),
    })
  } catch (error) {
    const kind = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'network'
    throw providerFailure('gemini', kind)
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw classifyHttpFailure('gemini', response.status)

  const text = extractGeminiText(payload)
  if (!text) throw providerFailure('gemini', 'invalid-response')

  return { provider: 'gemini', model, text }
}
