import catalogData from './group-catalog.json' with { type: 'json' }

const invalid = () => { throw new Error('Invalid group catalog') }
function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== expected.length ||
      expected.some(key => !Object.hasOwn(value, key))) invalid()
}
function id(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 64 ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) invalid()
}
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) invalid()
}
function unique(value, seen) {
  id(value)
  if (seen.has(value)) invalid()
  seen.add(value)
}
export function validateGroupCatalog(value) {
  keys(value, ['schemaVersion', 'groups'])
  if (value.schemaVersion !== '1' || !Array.isArray(value.groups) || value.groups.length > 8) invalid()
  const groupIds = new Set()
  const memberIds = new Set()
  for (const group of value.groups) {
    keys(group, ['id', 'name', 'members'])
    unique(group.id, groupIds)
    name(group.name)
    if (!Array.isArray(group.members)) invalid()
    for (const member of group.members) {
      keys(member, ['id', 'name', 'agentId', 'implementation'])
      unique(member.id, memberIds)
      name(member.name)
      if (member.agentId === null) {
        if (member.implementation !== 'planned') invalid()
      } else {
        id(member.agentId)
        if (member.implementation !== 'existing') invalid()
      }
    }
  }
  if (memberIds.size > 40) invalid()
  return value
}
function freeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freeze(child)
  }
  return Object.freeze(value)
}
export const groupCatalog = freeze(validateGroupCatalog(catalogData))

export async function getGroupWorkspace({ catalog = groupCatalog, registryService } = {}) {
  validateGroupCatalog(catalog)
  let registryStatus = 'ok'
  let agents = []
  try {
    agents = await registryService.list()
    if (!Array.isArray(agents)) throw new Error('Invalid registry list')
  } catch {
    registryStatus = 'unavailable'
    agents = []
  }
  return {
    schemaVersion: '1',
    registryStatus,
    executionEnabled: false,
    workStatus: 'not-connected',
    groups: catalog.groups.map(group => ({
      id: group.id,
      name: group.name,
      members: group.members.map(member => {
        let state = 'catalogued'
        let reason = 'Planned role; runtime integration is not configured.'
        if (member.agentId !== null) {
          const agent = agents.find(agent => agent?.id === member.agentId)
          if (registryStatus === 'unavailable') {
            state = 'unavailable'
            reason = 'Agent registry is unavailable.'
          } else if (!agent) {
            state = 'unavailable'
            reason = 'Bound agent is absent from the registry.'
          } else if (agent.enabled === false) {
            state = 'disabled'
            reason = 'Registered agent is disabled.'
          } else {
            state = 'configured'
            reason = 'Registered agent is configured; worker readiness is not connected.'
          }
        }
        return { id: member.id, name: member.name, agentId: member.agentId,
          implementation: member.implementation, state, reason }
      }),
    })),
  }
}
