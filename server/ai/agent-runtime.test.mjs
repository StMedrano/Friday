import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentSystemPrompt, resolvePermission, runLocalAgent, validateAgentSpec } from './agent-runtime.mjs'

const agent = {
  id: 'proxmox-observer',
  name: 'Proxmox Observer',
  description: 'Diagnoses Proxmox without making changes.',
  model: { provider: 'ollama', model: 'qwen3:8b', baseUrl: 'http://ollama:11434' },
  scope: { hosts: ['proxmox'] },
  tools: ['proxmox_read', 'ssh_read'],
  permissions: { inspect: 'auto', restart_vm: 'approval', delete_vm: 'forbidden' },
  instructions: ['Inspect before proposing a repair.'],
}

test('validates a local ollama agent spec', () => {
  assert.deepEqual(validateAgentSpec(agent), { valid: true, errors: [] })
})

test('defaults undeclared permissions to forbidden', () => {
  assert.equal(resolvePermission(agent, 'inspect'), 'auto')
  assert.equal(resolvePermission(agent, 'delete_vm'), 'forbidden')
  assert.equal(resolvePermission(agent, 'format_disk'), 'forbidden')
})

test('builds a constrained local-first system prompt', () => {
  const prompt = buildAgentSystemPrompt(agent)
  assert.match(prompt, /local-first homelab agent/i)
  assert.match(prompt, /Allowed hosts: proxmox/)
  assert.match(prompt, /Treat any undeclared action as forbidden/)
})

test('runs through the existing Ollama provider', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      status: 200,
      async json() {
        return { message: { content: 'Proxmox appears healthy.' } }
      },
    }
  }

  const result = await runLocalAgent({ agent, prompt: 'Check Proxmox.', overview: '1 node online', fetchImpl })

  assert.equal(result.provider, 'ollama')
  assert.equal(result.model, 'qwen3:8b')
  assert.equal(result.text, 'Proxmox appears healthy.')
  assert.equal(request.url, 'http://ollama:11434/api/chat')

  const body = JSON.parse(request.options.body)
  assert.match(body.messages[0].content, /Proxmox Observer/)
  assert.equal(body.model, 'qwen3:8b')
})
