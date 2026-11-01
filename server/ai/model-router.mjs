// Deterministic, read-only routing. Billing eligibility is not configurable.
export function rankEligibleModelTargets({ targets = [], requirements = {}, policy = {}, healthById = {} } = {}) {
  const needs = requirements?.capabilities
  if (!Array.isArray(needs) || !needs.every(c => typeof c === 'string')) return []
  if (requirements.privacy !== undefined && !['cloud-ok','local-only'].includes(requirements.privacy)) return []
  if (requirements.multimodal !== undefined && typeof requirements.multimodal !== 'boolean') return []
  return targets.filter(target => {
    const d = target?.descriptor
    if (!d || d.enabled !== true || d.billingClass !== 'free') return false
    if (!['local','hosted'].includes(d.deployment) || typeof d.provider !== 'string') return false
    if (!Array.isArray(d.capabilities) || typeof d.supportsTools !== 'boolean' || typeof d.supportsVision !== 'boolean') return false
    if (healthById[d.id] === 'unhealthy') return false
    if (requirements.privacy === 'local-only' && d.deployment !== 'local') return false
    if (requirements.multimodal && !d.supportsVision) return false
    return needs.every(c => c === 'tool-use' ? d.supportsTools : d.capabilities.includes(c))
  }).map((target, index) => ({ target, index }))
    .sort((a,b) => {
      if (policy.preferLocal !== false) {
        const order = x => x.target.descriptor.deployment === 'local' ? 0 : 1
        if (order(a) !== order(b)) return order(a)-order(b)
      }
      if (policy.preferNvidiaFree === true && a.target.descriptor.provider !== b.target.descriptor.provider) {
        return (a.target.descriptor.provider === 'nvidia' ? 0 : 1) -
          (b.target.descriptor.provider === 'nvidia' ? 0 : 1)
      }
      return a.index-b.index
    }).map(({target}) => target)
}