import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getConfig } from './config.mjs'

const rootUrl = new URL('../', import.meta.url)

async function read(path) {
  return readFile(new URL(path, rootUrl), 'utf8')
}

test('active observer examples use the verified VM100 nic1 address', async () => {
  const [rootEnv, observerEnv, observerCompose] = await Promise.all([
    read('.env.example'),
    read('observer/.env.example'),
    read('observer/compose.yaml'),
  ])

  assert.match(rootEnv, /^FRIDAY_VM100_OBSERVER_URL=http:\/\/10\.1\.10\.10:3199$/m)
  assert.match(observerEnv, /^FRIDAY_OBSERVER_BIND_ADDRESS=10\.1\.10\.10$/m)
  assert.match(observerCompose, /FRIDAY_OBSERVER_BIND_ADDRESS:-10\.1\.10\.10/)
})

test('active configuration does not introduce VLAN 80', async () => {
  const activeConfiguration = await Promise.all([
    read('.env.example'),
    read('compose.yaml'),
    read('observer/.env.example'),
    read('observer/compose.yaml'),
  ])

  for (const content of activeConfiguration) {
    assert.doesNotMatch(content, /VLAN\s*80|10\.1\.80\./i)
  }
})

test('verified CT108 nic1 address is used by every agent default', async () => {
  const [rootEnv, compose] = await Promise.all([
    read('.env.example'),
    read('compose.yaml'),
  ])

  for (const content of [rootEnv, compose]) {
    for (const profile of ['ROUTER', 'GENERAL', 'CODER']) {
      assert.match(
        content,
        new RegExp(`FRIDAY_AGENT_LOCAL_${profile}_URL[^\\n]*10\\.1\\.10\\.12:11434`),
      )
    }
    assert.doesNotMatch(
      content,
      /FRIDAY_AGENT_LOCAL_(?:ROUTER|GENERAL|CODER)_URL[^\n]*192\.168\.1\./,
    )
  }

  const profiles = getConfig({}).agents.modelProfiles
  for (const profile of ['local-router', 'local-general', 'local-coder']) {
    assert.equal(profiles[profile].baseUrl, 'http://10.1.10.12:11434')
  }
})
