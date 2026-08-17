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

function systemPrompt() {
  return [
    'You are Friday, a read-only infrastructure copilot for a two-site homelab.',
    'Analyze only the normalized infrastructure state supplied in the request.',
    'You may explain health, summarize alerts, identify likely causes, compare sites, and propose next diagnostic steps.',
    'Do not claim that you executed, restarted, changed, deleted, deployed, reconfigured, or approved anything.',
    'Do not invent hosts, credentials, metrics, routes, VLANs, services, or events that are absent from the supplied state.',
    'If the available state is insufficient, say what additional read-only signal would be useful.',
    'Keep answers concise and operational.'
  ].join(' ')
}

export async function askOpenAI({
  apiKey,
  model = 'gpt-5.6-terra',
  prompt,
  overview,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')
  if (typeof fetchImpl !== 'function') throw new Error('Fetch implementation is unavailable')

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: 'low' },
      max_output_tokens: 1200,
      input: [
        { role: 'system', content: systemPrompt() },
        {
          role: 'user',
          content: `Operator request:\n${String(prompt || '').trim()}\n\nNormalized Friday state:\n${JSON.stringify(overview ?? {})}`,
        },
      ],
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = payload?.error?.message || `OpenAI request failed with HTTP ${response.status}`
    throw new Error(detail)
  }

  const text = extractResponseText(payload)
  if (!text) throw new Error('OpenAI response did not contain text output')

  return {
    provider: 'openai',
    model,
    text,
  }
}
