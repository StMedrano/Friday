export function resolveModelProfile(config, profileId) {
  const id = String(profileId || '').trim()
  if (!id) return null
  const profile = config?.agents?.modelProfiles?.[id]
  if (!profile || profile.provider !== 'ollama') return null
  if (!String(profile.baseUrl || '').trim() || !String(profile.model || '').trim()) return null

  return {
    id,
    provider: 'ollama',
    baseUrl: profile.baseUrl,
    model: profile.model,
    context: profile.context,
    maxTokens: profile.maxTokens,
  }
}
