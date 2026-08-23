export class ProviderUnavailableError extends Error {
  constructor(provider, kind, message = `${provider} provider unavailable`) {
    super(message)
    this.name = 'ProviderUnavailableError'
    this.provider = provider
    this.kind = kind
  }
}

export function providerFailure(provider, kind, message) {
  return new ProviderUnavailableError(provider, kind, message)
}

export function classifyHttpFailure(provider, status) {
  if (status === 401 || status === 403) return providerFailure(provider, 'authentication')
  if (status === 408) return providerFailure(provider, 'timeout')
  if (status === 429) return providerFailure(provider, 'rate-limited')
  if (status >= 500) return providerFailure(provider, 'upstream')
  return providerFailure(provider, 'invalid-response')
}
