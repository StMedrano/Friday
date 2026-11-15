import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'
import { getConfig } from './config.mjs'
import { parseAppLinks } from './applications/app-links.mjs'

const config = getConfig({ FRIDAY_MODE: 'live' })
const links = parseAppLinks({ schemaVersion: 1, links: [{ serviceId: 'grafana', url: 'https://grafana.example.com/' }] })

async function run(appLinks, check) {
  const server = createFridayServer({
    config, appLinks,
    accessGateImpl: async () => ({ status: 200, identity: { subject: 'reader', email: 'reader@example.test' } }),
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try { await check(`http://127.0.0.1:${server.address().port}`) } finally { await new Promise((resolve) => server.close(resolve)) }
}

test('Open app links answer 503 when off', async () => {
  await run(null, async (base) => {
    const response = await fetch(`${base}/api/applications/links`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'app-links-disabled' })
  })
})

test('Open app links return only service id and URL, read only', async () => {
  await run(links, async (base) => {
    const response = await fetch(`${base}/api/applications/links`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { links: [{ serviceId: 'grafana', url: 'https://grafana.example.com/' }] })
    assert.equal((await fetch(`${base}/api/applications/links?x=1`)).status, 400)
    assert.equal((await fetch(`${base}/api/applications/links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404)
  })
})

test('Open app links still need a verified viewer', async () => {
  const server = createFridayServer({ config, appLinks: links, accessGateImpl: async () => ({ status: 403 }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/applications/links`)
    assert.equal(response.status, 403)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
