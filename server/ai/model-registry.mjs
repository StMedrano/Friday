// Private ModelTarget values must remain server-side: providerConfig includes credentials.
const BILLING = new Set(['free', 'paid', 'unknown'])
const CAPABILITIES = /^[a-z][a-z0-9-]*$/

function normalize(raw, deployment, provider) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (!id || !model || !Array.isArray(raw.capabilities) || !raw.capabilities.length) return null
  if (typeof raw.billingClass !== 'string' || !BILLING.has(raw.billingClass)) return null
  if (typeof raw.supportsTools !== 'boolean' || typeof raw.supportsVision !== 'boolean') return null
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null
  if (!raw.capabilities.every((c) => typeof c === 'string' && CAPABILITIES.test(c))) return null
  if (raw.maxTokens !== undefined && (!Number.isSafeInteger(raw.maxTokens) || raw.maxTokens <= 0)) return null

  return {
    descriptor: Object.freeze({
      id,
      provider: 'nvidia',
      deployment,
      billingClass: raw.billingClass,
      capabilities: Object.freeze([...new Set(raw.capabilities)]),
      supportsTools: raw.supportsTools,
      supportsVision: raw.supportsVision,
      enabled: raw.enabled !== false && provider.enabled,
    }),
    providerConfig: {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model,
      deployment,
      ...(raw.maxTokens ? { maxTokens: raw.maxTokens } : {}),
    },
  }
}

export function buildModelTargets(config = {}) {
  const nvidia = config.nvidia || {}
  const targets = []
  const seen = new Set()
  for (const [deployment, rawModels, provider] of [
    ['hosted', nvidia.models, { enabled: nvidia.enabled === true, baseUrl: nvidia.baseUrl, apiKey: nvidia.apiKey }],
    ['local', nvidia.localModels, { enabled: nvidia.localEnabled === true, baseUrl: nvidia.localBaseUrl, apiKey: '' }],
  ]) {
    for (const raw of Array.isArray(rawModels) ? rawModels : []) {
      const target = normalize(raw, deployment, provider)
      if (!target || seen.has(target.descriptor.id)) continue
      seen.add(target.descriptor.id)
      targets.push(target)
    }
  }
  return targets
}

export function publicModelDescriptor(target) {
  const d = target.descriptor
  return {
    id: d.id, provider: d.provider, deployment: d.deployment,
    billingClass: d.billingClass, capabilities: [...d.capabilities],
    supportsTools: d.supportsTools, supportsVision: d.supportsVision, enabled: d.enabled,
  }
}