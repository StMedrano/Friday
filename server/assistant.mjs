import { previewCommand } from './core.mjs'
import { ProviderUnavailableError } from './ai/errors.mjs'
import { fridaySystemPrompt } from './ai/policy.mjs'
import { defaultProviders } from './ai/providers.mjs'

function configured(providerId, providerConfig = {}) {
  if (providerId === 'ollama') {
    return providerConfig.enabled === true
      && Boolean(String(providerConfig.baseUrl || '').trim())
      && Boolean(String(providerConfig.model || '').trim())
  }
  return Boolean(String(providerConfig.apiKey || '').trim())
    && Boolean(String(providerConfig.model || '').trim())
}

function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs)
}

function providerTimeoutMs(ai = {}, providerId) {
  if (providerId === 'ollama') {
    return ai.localTimeoutMs || ai.timeoutMs || 30000
  }
  return ai.cloudTimeoutMs || ai.timeoutMs || 15000
}

export async function answerAssistant({
  config,
  prompt,
  history = [],
  overview,
  providers = defaultProviders,
  previewImpl = previewCommand,
  signalFactory = timeoutSignal,
} = {}) {
  const text = String(prompt || '').trim()
  if (!text) {
    return { available: false, error: 'invalid-prompt', reason: 'A prompt is required.' }
  }

  const ai = config?.ai || {}
  const attempts = []

  if (ai.enabled) {
    const order = Array.isArray(ai.providerOrder) ? ai.providerOrder : []
    const providerConfigs = ai.providers || {}
    const systemPrompt = fridaySystemPrompt()

    for (const providerId of order) {
      const provider = providers?.[providerId]
      const providerConfig = providerConfigs?.[providerId] || {}
      if (typeof provider !== 'function' || !configured(providerId, providerConfig)) continue

      try {
        const result = await provider({
          providerConfig,
          prompt: text,
          history,
          overview,
          systemPrompt,
          signal: signalFactory(providerTimeoutMs(ai, providerId)),
        })
        return {
          available: true,
          mode: providerId === 'ollama' ? 'local-ai' : 'cloud-ai',
          provider: result.provider || providerId,
          model: result.model ?? providerConfig.model ?? null,
          text: result.text,
          fallbackUsed: attempts.length > 0,
          attempts,
        }
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error
        attempts.push({ provider: providerId, outcome: error.kind })
      }
    }
  }

  const preview = previewImpl({ message: text })
  if (preview?.accepted) {
    return {
      available: true,
      mode: 'local-analysis',
      provider: 'deterministic',
      model: null,
      text: preview.message,
      fallbackUsed: attempts.length > 0 || Boolean(ai.enabled),
      attempts,
    }
  }

  return {
    available: false,
    mode: 'local-analysis',
    provider: 'deterministic',
    model: null,
    reason: 'No configured AI provider was available and the request did not map to a supported local analysis command.',
    fallbackUsed: true,
    attempts,
  }
}
