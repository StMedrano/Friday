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

test('accepts faithful drafts that use service site labels, negated health claims and non-severity critical wording', async () => {
  const draft = [
    '**Critical Observations**',
    'All services are hosted on Site A. The environment is not fully healthy: wga-development is offline.',
    'Incident data is absent, so no incident count is asserted. There are no critical alerts.',
  ].join('\n')
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response(JSON.stringify({ message: { content: draft } }), { status: 200 })
  }
  const overview = {
    mode: 'live', sites: [], alerts: [],
    services: [
      { id: 'proxmox-qemu-100', name: 'ubuntu-docker', site: 'Site A', status: 'online', updated: 'live' },
      { id: 'vm100-observer-1', name: 'wga-development', site: 'Site A', status: 'offline', updated: 'Exited (137) 2 weeks ago' },
    ],
  }

  const result = await runLocalAgent({ agent, modelProfile, prompt: 'Summarize health.', overview, fetchImpl })
  assert.equal(result.text, draft)
  assert.equal(calls, 1)
})

test('still rejects undeclared sites, affirmative health claims and asserted critical severity on live-shaped state', async () => {
  const requests = []
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ message: { content: 'Site B is fully healthy. Severity: critical. wga-development has a critical failure.' } }), { status: 200 })
  }
  const overview = {
    mode: 'live', sites: [], alerts: [],
    services: [{ id: 'vm100-observer-1', name: 'wga-development', site: 'Site A', status: 'offline', updated: 'stopped' }],
  }

  await assert.rejects(
    runLocalAgent({ agent, modelProfile, prompt: 'Summarize health.', overview, fetchImpl }),
    (error) => error?.code === 'FRIDAY_AGENT_GROUNDING_INVALID',
  )
  assert.equal(requests.length, 2)
  assert.match(requests[1].messages[1].content, /unsupported site label/)
  assert.match(requests[1].messages[1].content, /overall-health claim contradicts non-online services/)
  assert.match(requests[1].messages[1].content, /unsupported severity/)
})
test('rejects critical severity separated from its noun and incident absence folded into alerts', async () => {
  const requests = []
  const drafts = [
    'Two critical container services are offline. No active alerts or incidents are currently present.',
    'Two container services are offline. No alerts are present, and incident data is absent.',
  ]
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ message: { content: drafts[requests.length - 1] } }), { status: 200 })
  }
  const overview = {
    mode: 'live', sites: [], alerts: [],
    services: [{ id: 'vm100-observer-1', name: 'wga-development', site: 'Site A', status: 'offline', updated: 'stopped' }],
  }

  const result = await runLocalAgent({ agent, modelProfile, prompt: 'Summarize health.', overview, fetchImpl })
  assert.equal(result.text, drafts[1])
  assert.equal(requests.length, 2)
  assert.match(requests[1].messages[1].content, /unsupported severity/)
  assert.match(requests[1].messages[1].content, /incident absence was asserted without incident data/)
})

test('sends the local agent only open incidents with compact fields so the prompt fits the local context', async () => {
  const requests = []
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ message: { content: 'wga-development is offline; one high incident is open.' } }), { status: 200 })
  }
  const evidence = { raw: 'x'.repeat(4000) }
  const overview = {
    mode: 'live', sites: [], alerts: [],
    services: [{ id: 'vm100-observer-1', name: 'wga-development', site: 'Site A', status: 'offline', updated: 'stopped' }],
    incidents: [
      { id: 'open-1', fingerprint: 'fp-open', type: 'service-down', title: 'wga-development down', detail: 'Exited (137)', severity: 'high', status: 'open', source: 'monitoring', host: 'vm100', serviceId: 'vm100-observer-1', serviceName: 'wga-development', firstSeen: 't0', lastSeen: 't1', openedAt: 't0', resolvedAt: null, recommendedAction: 'Inspect logs.', evidence },
      { id: 'resolved-1', fingerprint: 'fp-r1', type: 'service-down', title: 'old outage', severity: 'warning', status: 'resolved', evidence },
      { id: 'resolved-2', fingerprint: 'fp-r2', type: 'service-down', title: 'older outage', severity: 'warning', status: 'resolved', evidence },
    ],
  }

  const result = await runLocalAgent({ agent, modelProfile, prompt: 'Summarize health.', overview, fetchImpl })
  const content = requests[0].messages[1].content
  assert.equal(result.text, 'wga-development is offline; one high incident is open.')
  assert.equal(requests.length, 1)
  assert.match(content, /"id":"open-1"/)
  assert.match(content, /"severity":"high"/)
  assert.match(content, /"resolvedIncidentCount":2/)
  assert.doesNotMatch(content, /resolved-1|resolved-2|fp-open|xxxxxxxx|recommendedAction/)
  assert.ok(content.length < 4000, `agent prompt should stay compact, got ${content.length} characters`)
  assert.equal(overview.incidents.length, 3, 'the caller overview is not mutated')
})

async function askOnce(draft, overview) {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response(JSON.stringify({ message: { content: draft } }), { status: 200 })
  }
  try {
    const result = await runLocalAgent({ agent, modelProfile, prompt: 'Summarize health.', overview, fetchImpl })
    return { accepted: true, calls, text: result.text }
  } catch (error) {
    return { accepted: false, calls, code: error?.code }
  }
}

test('accepts complete multiword declared site labels and still rejects partial or unknown ones', async () => {
  const overview = {
    mode: 'live', alerts: [],
    sites: [{ id: 'north', name: 'Site North Office', status: 'online' }],
    services: [{ id: 'svc-1', name: 'gateway', site: 'Site North Office', status: 'online' }],
  }
  assert.deepEqual(await askOnce('Site North Office is online with one service.', overview), { accepted: true, calls: 1, text: 'Site North Office is online with one service.' })
  assert.equal((await askOnce('Site South is online.', overview)).code, 'FRIDAY_AGENT_GROUNDING_INVALID')
})

test('treats a negated subject as negating a critical-severity claim', async () => {
  const overview = { mode: 'live', sites: [], alerts: [], incidents: [], services: [{ id: 'svc-1', name: 'db', site: 'Site A', status: 'offline' }] }
  assert.equal((await askOnce('No services are critical. db is offline.', overview)).accepted, true)
  assert.equal((await askOnce('db is critical.', overview)).code, 'FRIDAY_AGENT_GROUNDING_INVALID')
})

test('scopes health claims to the site or service they describe', async () => {
  const overview = {
    mode: 'live', sites: [], alerts: [], incidents: [],
    services: [
      { id: 'a-1', name: 'db', site: 'Site A', status: 'offline' },
      { id: 'b-1', name: 'web', site: 'Site B', status: 'online' },
    ],
  }
  assert.equal((await askOnce('Site B is fully healthy. Site A has an offline service.', overview)).accepted, true)
  assert.equal((await askOnce('web is fully operational. db is offline.', overview)).accepted, true)
  assert.equal((await askOnce('Site A is fully healthy.', overview)).code, 'FRIDAY_AGENT_GROUNDING_INVALID')
  assert.equal((await askOnce('The environment is fully healthy.', overview)).code, 'FRIDAY_AGENT_GROUNDING_INVALID')
})
