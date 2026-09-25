const MAX_PROMPT_CHARS = 4000
const SAFE_AGENT_ID = /^[A-Za-z0-9_.-]{1,128}$/

export function validateAgentPrompt(value) {
  const prompt = String(value ?? '').trim()
  if (!prompt) {
    return {
      ok: false,
      result: { available: false, error: 'invalid-prompt', reason: 'A prompt is required.' },
    }
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return {
      ok: false,
      result: { available: false, error: 'invalid-prompt', reason: `Prompt is too long. Maximum length is ${MAX_PROMPT_CHARS} characters.` },
    }
  }
  return { ok: true, prompt }
}

export function validateAgentId(value) {
  const id = String(value ?? '').trim()
  if (!SAFE_AGENT_ID.test(id)) return { ok: false, error: 'invalid-agent-id' }
  return { ok: true, id }
}

export function validateRegistrySyncBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'invalid-sync-request' }
  }
  if (Object.keys(value).length > 0) return { ok: false, error: 'invalid-sync-request' }
  return { ok: true }
}

export const AGENT_INPUT_LIMITS = Object.freeze({ maxPromptChars: MAX_PROMPT_CHARS, maxAgentIdChars: 128 })
