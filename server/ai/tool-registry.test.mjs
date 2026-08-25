import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolRegistry, executeAgentTool, permissionFor } from './tool-registry.mjs'

function agent(overrides = {}) {
  return {
    name: 'test-agent',
    tools: ['health.check', 'service.restart'],
    permissions: {
      inspect: 'auto',
      restart_service: 'approval',
    },
    ...overrides,
  }
}

test('undeclared permissions default to forbidden', () => {
  assert.equal(permissionFor(agent(), 'delete_vm'), 'forbidden')
})

test('auto tools execute without approval', async () => {
  const registry = new ToolRegistry().register({
    name: 'health.check',
    permission: 'inspect',
    execute: async ({ args }) => ({ healthy: true, target: args.target }),
  })
  const result = await executeAgentTool({
    registry,
    agent: agent(),
    request: { tool: 'health.check', args: { target: 'proxmox' } },
  })
  assert.equal(result.ok, true)
  assert.equal(result.permission, 'inspect')
  assert.deepEqual(result.output, { healthy: true, target: 'proxmox' })
})

test('approval tools do not execute before approval', async () => {
  let called = false
  const registry = new ToolRegistry().register({
    name: 'service.restart',
    permission: 'restart_service',
    execute: async () => { called = true },
  })
  const result = await executeAgentTool({ registry, agent: agent(), request: { tool: 'service.restart' } })
  assert.equal(result.status, 'approval-required')
  assert.equal(called, false)
})

test('approval tools execute after explicit approval', async () => {
  const registry = new ToolRegistry().register({
    name: 'service.restart',
    permission: 'restart_service',
    execute: async () => 'restarted',
  })
  const result = await executeAgentTool({ registry, agent: agent(), approved: true, request: { tool: 'service.restart' } })
  assert.equal(result.ok, true)
  assert.equal(result.output, 'restarted')
})

test('tools not declared by the agent are forbidden', async () => {
  const registry = new ToolRegistry().register({
    name: 'vm.delete',
    permission: 'delete_vm',
    execute: async () => 'should-not-run',
  })
  const result = await executeAgentTool({ registry, agent: agent(), request: { tool: 'vm.delete' } })
  assert.equal(result.status, 'forbidden')
  assert.equal(result.reason, 'tool-not-declared')
})

test('audit receives completed and blocked outcomes', async () => {
  const events = []
  const registry = new ToolRegistry().register({ name: 'health.check', permission: 'inspect', execute: async () => 'ok' })
  await executeAgentTool({ registry, agent: agent(), request: { tool: 'health.check' }, audit: async e => events.push(e) })
  await executeAgentTool({ registry, agent: agent(), request: { tool: 'unknown.tool' }, audit: async e => events.push(e) })
  assert.equal(events.length, 2)
  assert.equal(events[0].status, 'completed')
  assert.equal(events[1].status, 'forbidden')
})
