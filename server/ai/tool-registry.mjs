const VALID_PERMISSION_LEVELS = new Set(['auto', 'approval', 'forbidden'])

export class ToolRegistry {
  constructor() {
    this.tools = new Map()
  }

  register(tool) {
    if (!tool || typeof tool !== 'object') throw new TypeError('tool is required')
    const name = String(tool.name || '').trim()
    const permission = String(tool.permission || '').trim()
    if (!name) throw new TypeError('tool.name is required')
    if (!permission) throw new TypeError(`tool.permission is required: ${name}`)
    if (this.tools.has(name)) throw new Error(`tool already registered: ${name}`)
    if (typeof tool.execute !== 'function') throw new TypeError(`tool.execute is required: ${name}`)

    this.tools.set(name, Object.freeze({
      name,
      permission,
      description: String(tool.description || '').trim(),
      risk: String(tool.risk || 'observe').trim(),
      execute: tool.execute,
    }))
    return this
  }

  get(name) {
    return this.tools.get(name)
  }

  list() {
    return [...this.tools.values()].map(({ execute, ...metadata }) => metadata)
  }
}

export function permissionFor(agent, permissionName) {
  const value = agent?.permissions?.[permissionName]
  return VALID_PERMISSION_LEVELS.has(value) ? value : 'forbidden'
}

export async function executeAgentTool({
  registry,
  agent,
  request,
  approved = false,
  audit = () => {},
  context = {},
} = {}) {
  if (!(registry instanceof ToolRegistry)) throw new TypeError('registry is required')
  const toolName = String(request?.tool || '').trim()
  if (!toolName) throw new TypeError('request.tool is required')

  const declaredTools = Array.isArray(agent?.tools) ? agent.tools : []
  if (!declaredTools.includes(toolName)) {
    const result = { ok: false, status: 'forbidden', tool: toolName, reason: 'tool-not-declared' }
    await audit(result)
    return result
  }

  const tool = registry.get(toolName)
  if (!tool) {
    const result = { ok: false, status: 'unavailable', tool: toolName, reason: 'tool-not-registered' }
    await audit(result)
    return result
  }

  const permission = permissionFor(agent, tool.permission)
  if (permission === 'forbidden') {
    const result = {
      ok: false,
      status: 'forbidden',
      tool: toolName,
      permission: tool.permission,
      reason: 'permission-forbidden',
    }
    await audit(result)
    return result
  }

  if (permission === 'approval' && approved !== true) {
    const result = { ok: false, status: 'approval-required', tool: toolName, permission: tool.permission }
    await audit(result)
    return result
  }

  const startedAt = new Date().toISOString()
  try {
    const output = await tool.execute({ args: request?.args || {}, context, agent })
    const result = {
      ok: true,
      status: 'completed',
      tool: toolName,
      permission: tool.permission,
      startedAt,
      output,
    }
    await audit(result)
    return result
  } catch (error) {
    const result = {
      ok: false,
      status: 'failed',
      tool: toolName,
      permission: tool.permission,
      startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
    await audit(result)
    return result
  }
}
