export const MAX_PROMPT_CHARS = 4000
export const MAX_HISTORY_MESSAGES = 20
export const MAX_HISTORY_MESSAGE_CHARS = 2000
export const MAX_HISTORY_TOTAL_CHARS = 12000

function invalidPrompt(reason) {
  return {
    ok: false,
    result: {
      available: false,
      error: 'invalid-prompt',
      reason,
    },
  }
}

export function validateAssistantPrompt(value) {
  const prompt = String(value ?? '').trim()
  if (!prompt) return invalidPrompt('A prompt is required.')
  if (prompt.length > MAX_PROMPT_CHARS) {
    return invalidPrompt(`Prompt is too long. Maximum length is ${MAX_PROMPT_CHARS} characters.`)
  }
  return { ok: true, prompt }
}

export function normalizeAssistantHistory(value) {
  if (!Array.isArray(value)) return []

  let messages = value.flatMap((entry) => {
    if (entry?.role !== 'user' && entry?.role !== 'assistant') return []
    const content = String(entry?.content ?? '').trim()
    if (!content) return []
    return [{
      role: entry.role,
      content: content.slice(0, MAX_HISTORY_MESSAGE_CHARS),
    }]
  }).slice(-MAX_HISTORY_MESSAGES)

  let total = messages.reduce((sum, item) => sum + item.content.length, 0)
  while (messages.length > 0 && total > MAX_HISTORY_TOTAL_CHARS) {
    total -= messages[0].content.length
    messages = messages.slice(1)
  }

  return messages
}
