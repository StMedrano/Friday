import test from 'node:test'
import assert from 'node:assert/strict'
import { fridaySystemPrompt, fridayUserPrompt } from './policy.mjs'

test('shared assistant policy is explicitly read-only and state-grounded', () => {
  const prompt = fridaySystemPrompt()
  assert.match(prompt, /read-only infrastructure copilot/i)
  assert.match(prompt, /normalized infrastructure state/i)
  assert.match(prompt, /do not claim.*executed/i)
  assert.match(prompt, /do not invent/i)
  assert.match(prompt, /do not assume a fixed number of sites/i)
})

test('shared assistant policy preserves exact infrastructure identifiers and mappings', () => {
  const prompt = fridaySystemPrompt()
  assert.match(prompt, /preserve exact.*service ids/i)
  assert.match(prompt, /vm\/lxc numbers/i)
  assert.match(prompt, /service-name mappings/i)
  assert.match(prompt, /never infer.*renumber.*substitute/i)
})

test('shared assistant policy marks previous conversation as context rather than infrastructure evidence', () => {
  const prompt = fridaySystemPrompt()
  assert.match(prompt, /previous conversation is context, not infrastructure evidence/i)
  assert.match(prompt, /resolve infrastructure facts and identifiers from the current normalized friday state/i)
})

test('provider-facing prompt separates recent context current request and authoritative normalized state', () => {
  const overview = {
    services: [
      { id: 'friday-ollama', name: 'friday-ollama', host: 'LXC 108', status: 'online' },
    ],
  }
  const history = [
    { role: 'user', content: 'Check friday-ollama' },
    { role: 'assistant', content: 'friday-ollama is LXC 107' },
  ]

  const prompt = fridayUserPrompt('Compare it to VM102', overview, history)
  const contextAt = prompt.indexOf('Recent session context:')
  const requestAt = prompt.indexOf('Current operator request:')
  const stateAt = prompt.indexOf('Authoritative normalized Friday state:')

  assert.ok(contextAt >= 0)
  assert.ok(requestAt > contextAt)
  assert.ok(stateAt > requestAt)
  assert.match(prompt, /\[user\] Check friday-ollama/)
  assert.match(prompt, /\[assistant\] friday-ollama is LXC 107/)
  assert.match(prompt, /Current operator request:\nCompare it to VM102/)
  assert.match(prompt, /Authoritative normalized Friday state:/)
  assert.match(prompt, /"name":"friday-ollama"/)
  assert.match(prompt, /"host":"LXC 108"/)
})

test('provider-facing prompt makes absence of prior context explicit', () => {
  const prompt = fridayUserPrompt('Check health', { mode: 'live' }, [])
  assert.match(prompt, /Recent session context:\n\(none\)/)
  assert.match(prompt, /Current operator request:\nCheck health/)
  assert.match(prompt, /Authoritative normalized Friday state:/)
})

test('provider-facing prompt derives explicit grounding constraints from current state', () => {
  const prompt = fridayUserPrompt('Summarize health', {
    mode: 'live',
    sites: [],
    services: [
      { id: 'proxmox-qemu-100', name: 'ubuntu-docker', status: 'online', updated: 'live' },
      { id: 'vm100-observer-deadbeef', name: 'stopped-db', status: 'offline', updated: 'Exited (0) 3 days ago' },
    ],
    alerts: [],
    integrations: [
      { id: 'proxmox', enabled: true, mode: 'live' },
      { id: 'docker', enabled: false, mode: 'mock' },
    ],
  })

  assert.match(prompt, /Machine-derived current-state constraints:/)
  assert.match(prompt, /Declared sites: none; site metadata is absent/i)
  assert.match(prompt, /"online":1/)
  assert.match(prompt, /"offline":1/)
  assert.match(prompt, /"id":"vm100-observer-deadbeef"/)
  assert.match(prompt, /must not be described as fully healthy/i)
  assert.match(prompt, /incident data is absent/i)
  assert.match(prompt, /do not assign severity or business impact/i)
  assert.match(prompt, /do not generalize per-service update or uptime text/i)
  assert.doesNotMatch(prompt, /Site A/)
})

test('provider-facing prompt lists site labels carried by services when no sites are declared', () => {
  const prompt = fridayUserPrompt('Summarize health', {
    mode: 'live',
    sites: [],
    services: [
      { id: 'proxmox-qemu-100', name: 'ubuntu-docker', site: 'Site A', status: 'online' },
      { id: 'vm100-observer-1', name: 'wga-development', site: 'Site A', status: 'offline' },
    ],
  })

  assert.match(prompt, /Declared sites: none/)
  assert.match(prompt, /Service site labels: \["Site A"\]/)
})
