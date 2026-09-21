import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

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

test('unverified CT108 nic1 address is not substituted into agent defaults', async () => {
  const [rootEnv, compose, serverConfig] = await Promise.all([
    read('.env.example'),
    read('compose.yaml'),
    read('server/config.mjs'),
  ])

  for (const content of [rootEnv, compose, serverConfig]) {
    assert.doesNotMatch(content, /FRIDAY_AGENT_LOCAL_(?:ROUTER|GENERAL|CODER)_URL[^\n]*10\.1\.10\.12/)
  }
})
