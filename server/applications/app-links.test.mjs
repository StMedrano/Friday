import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAppLinks, parseAppLinks, safeAppUrl } from './app-links.mjs'

const good = { schemaVersion: 1, links: [
  { serviceId: 'vm100:jellyfin', url: 'https://jellyfin.example.com/' },
  { serviceId: 'grafana', url: 'https://grafana.example.com/d/home?orgId=1' },
] }

test('accepts https links keyed by service id', () => {
  const links = parseAppLinks(good)
  assert.deepEqual(links.map((link) => link.serviceId), ['vm100:jellyfin', 'grafana'])
  assert.ok(Object.isFrozen(links) && Object.isFrozen(links[0]))
})

test('rejects anything but plain https URLs', () => {
  for (const url of ['http://a.example.com/', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pw@a.example.com/',
    'https://u@a.example.com/', ' https://a.example.com/', 'ftp://a.example.com/', '', 'https://', 42, null]) {
    assert.equal(safeAppUrl(url), null, String(url))
  }
  assert.equal(safeAppUrl('https://a.example.com'), 'https://a.example.com/')
})

test('one bad entry rejects the whole file', () => {
  const bad = [
    null, [], { schemaVersion: 2, links: [] }, { schemaVersion: 1, links: {} }, { schemaVersion: 1, links: [], extra: 1 },
    { schemaVersion: 1, links: [...good.links, { serviceId: 'x', url: 'http://x.example.com/' }] },
    { schemaVersion: 1, links: [...good.links, { serviceId: 'grafana', url: 'https://other.example.com/' }] },
    { schemaVersion: 1, links: [{ serviceId: 'x', url: 'https://x.example.com/', label: 'extra' }] },
    { schemaVersion: 1, links: [{ serviceId: '../x', url: 'https://x.example.com/' }] },
    { schemaVersion: 1, links: Array.from({ length: 201 }, (_, i) => ({ serviceId: `s${i}`, url: 'https://x.example.com/' })) },
  ]
  for (const value of bad) assert.throws(() => parseAppLinks(value), /invalid-app-links/)
})

test('loads only a private, regular, valid file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'friday-app-links-'))
  const file = join(dir, 'app-links.json')
  writeFileSync(file, JSON.stringify(good)); chmodSync(file, 0o600)
  assert.equal((await loadAppLinks(file)).length, 2)
  chmodSync(file, 0o666)
  assert.equal(await loadAppLinks(file), null)
  chmodSync(file, 0o644)
  assert.equal((await loadAppLinks(file)).length, 2)
  const link = join(dir, 'link.json'); symlinkSync(file, link)
  assert.equal(await loadAppLinks(link), null)
  const broken = join(dir, 'broken.json'); writeFileSync(broken, '{'); chmodSync(broken, 0o600)
  assert.equal(await loadAppLinks(broken), null)
  assert.equal(await loadAppLinks(join(dir, 'missing.json')), null)
  assert.equal(await loadAppLinks(''), null)
})
