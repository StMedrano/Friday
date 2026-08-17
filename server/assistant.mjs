import { askOpenAI } from './ai/openai.mjs'

export async function answerAssistant({ config, prompt, overview, provider = askOpenAI }) {
  const ai = config?.ai || {}
  if (!ai.enabled) {
    return {
      available: false,
      reason: 'Friday AI is disabled. Set FRIDAY_AI_ENABLED=true after configuring a server-side API key.',
    }
  }

  if (!String(prompt || '').trim()) {
    return { available: false, reason: 'A prompt is required.' }
  }

  const result = await provider({
    apiKey: ai.apiKey,
    model: ai.model,
    prompt,
    overview,
  })

  return {
    available: true,
    ...result,
  }
}
