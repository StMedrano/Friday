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
  assert.match(prompt, /analyze only the normalized infrastructure state/i)
  assert.match(prompt, /do not infer uptime, incident timelines, routes, ip addresses, or resource values/i)
  assert.match(prompt, /do not state totals or counts unless the operator asks/i)
  assert.match(prompt, /treat entries in incidents as history unless their status is open/i)
  assert.match(prompt, /do not describe resolved incidents as current problems/i)
  assert.match(prompt, /no tools are executed in Phase 1/i)
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
    overview: { mode: 'live', services: [{ id: 'proxmox-qemu-100', name: 'ubuntu-docker', status: 'online' }] },
    fetchImpl,
  })

  assert.equal(result.provider, 'ollama')
  assert.equal(result.model, 'qwen3:4b-instruct')
  assert.equal(result.text, 'Proxmox appears healthy.')
  assert.equal(request.url, 'http://192.168.1.70:11434/api/chat')

  const body = JSON.parse(request.options.body)
  assert.match(body.messages[0].content, /Proxmox Observer/)
  assert.match(body.messages[1].content, /Authoritative normalized Friday state:/)
  assert.match(body.messages[1].content, /"id":"proxmox-qemu-100"/)
  assert.equal(body.model, 'qwen3:4b-instruct')
})

test('retries one ungrounded local draft with exact machine-state feedback', async () => {
  const requests = []
  const drafts = [
    'Site A is fully healthy. All services are running and there are no incidents. Two critical services are offline.',
    'One service is online and stopped-db is offline. Site and incident data are absent, so no site label or incident count is asserted.',
  ]
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ message: { content: drafts[requests.length - 1] } }), { status: 200 })
  }
  const overview = {
    mode: 'live', sites: [], alerts: [],
    services: [
      { id: 'proxmox-qemu-100', name: 'ubuntu-docker', status: 'online', updated: 'live' },
      { id: 'vm100-observer-deadbeef', name: 'stopped-db', status: 'offline', updated: 'Exited (0) 3 days ago' },
    ],
  }

  const result = await runLocalAgent({ agent, modelProfile, prompt: 'Summarize health.', overview, fetchImpl })

  assert.equal(result.text, drafts[1])
  assert.equal(requests.length, 2)
  assert.match(requests[1].messages[1].content, /prior draft was rejected/i)
  assert.match(requests[1].messages[1].content, /unsupported site label/i)
  assert.match(requests[1].messages[1].content, /unsupported severity/i)
})

test('fails closed after two ungrounded local drafts', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response(JSON.stringify({ message: { content: 'Site A is fully healthy with no incidents.' } }), { status: 200 })
  }
  const overview = {
    mode: 'live', sites: [], alerts: [],
    services: [{ id: 'proxmox-qemu-100', name: 'ubuntu-docker', status: 'offline', updated: 'stopped' }],
  }

  await assert.rejects(
    runLocalAgent({ agent, modelProfile, prompt: 'Summarize health.', overview, fetchImpl }),
    (error) => error?.code === 'FRIDAY_AGENT_GROUNDING_INVALID',
  )
  assert.equal(calls, 2)
})

test('one inference deadline spans the original and corrective attempts', async () => {
  let calls = 0
  const fetchImpl = async (_url, options) => {
    calls += 1
    if (calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 70))
      return new Response(JSON.stringify({ message: { content: 'Site A is fully healthy.' } }), { status: 200 })
    }
    return new Promise((resolve, reject) => {
      // Ref'd fallback keeps the event loop alive; it answers only if the deadline never fires.
      const fallback = setTimeout(() => resolve(new Response(JSON.stringify({ message: { content: 'late' } }), { status: 200 })), 1000)
      const abort = () => { clearTimeout(fallback); reject(options.signal.reason ?? new Error('aborted')) }
      if (options.signal.aborted) abort()
      else options.signal.addEventListener('abort', abort, { once: true })
    })
  }
  const overview = { mode: 'live', sites: [], alerts: [], services: [{ id: 'proxmox-qemu-100', name: 'ubuntu-docker', status: 'offline', updated: 'stopped' }] }
  const started = Date.now()

  await assert.rejects(
    runLocalAgent({ agent, modelProfile: { ...modelProfile, timeoutMs: 100 }, prompt: 'Summarize health.', overview, fetchImpl }),
    (error) => error?.code !== 'FRIDAY_AGENT_GROUNDING_INVALID',
  )
  assert.equal(calls, 2)
  assert.ok(Date.now() - started < 150, 'the corrective attempt must not receive a fresh timeout budget')
})
