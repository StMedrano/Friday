import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentSystemPrompt, resolvePermission, runLocalAgent, validateAgentSpec } from './agent-runtime.mjs'

const agent = {
  version: '1.1',
  id: 'proxmox-observer',
  name: 'Proxmox Observer',
  description: 'Diagnoses Proxmox without making changes.',
  enabled: true,
  model: { profile: 'local-general' },
  scope: { hosts: ['proxmox'] },
  tools: ['proxmox_read', 'ssh_read'],
  permissions: { inspect: 'auto', restart_vm: 'approval', delete_vm: 'forbidden' },
  instructions: ['Inspect before proposing a repair.'],
}

const modelProfile = {
  id: 'local-general',
  provider: 'ollama',
  baseUrl: 'http://192.168.1.70:11434',
  model: 'qwen3:4b-instruct',
  context: 8192,
  maxTokens: 768,
}

test('validates a profile-based local agent spec v1.1', () => {
  assert.deepEqual(validateAgentSpec(agent), { valid: true, errors: [] })
})

test('rejects deployment-specific model fields in v1.1', () => {
  const invalid = {
    ...agent,
    model: { profile: 'local-general', provider: 'ollama', model: 'qwen3:8b', baseUrl: 'http://localhost:11434' },
  }
  const result = validateAgentSpec(invalid)
  assert.equal(result.valid, false)
  assert.match(result.errors.join(' '), /deployment-specific|provider|baseUrl|model/i)
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

test('runs through the resolved Ollama model profile', async () => {
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

  const result = await runLocalAgent({
    agent,
    modelProfile,
    prompt: 'Check Proxmox.',
    overview: '1 node online',
    fetchImpl,
  })

  assert.equal(result.provider, 'ollama')
  assert.equal(result.model, 'qwen3:4b-instruct')
  assert.equal(result.text, 'Proxmox appears healthy.')
  assert.equal(request.url, 'http://192.168.1.70:11434/api/chat')

  const body = JSON.parse(request.options.body)
  assert.match(body.messages[0].content, /Proxmox Observer/)
  assert.equal(body.model, 'qwen3:4b-instruct')
})
