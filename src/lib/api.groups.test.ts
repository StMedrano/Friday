import { afterEach, expect, it, vi } from 'vitest'
import { fetchFridayAgentGroups } from './api'
const payload = () => ({
  schemaVersion: '1', registryStatus: 'ok', executionEnabled: false, workStatus: 'not-connected',
  groups: ['techtactics', 'app-builder', 'homelab'].map(id => ({ id, name: id, members: [{
    id: id + '-role', name: 'Role', agentId: null, implementation: 'planned', state: 'catalogued', reason: 'Planned role.',
  }] })),
})
afterEach(() => vi.unstubAllGlobals())
function respond(body: unknown, status = 200) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', mock)
  return mock
}
it('returns validated contract and propagates AbortSignal', async () => {
  const body = payload()
  const mock = respond(body)
  const signal = new AbortController().signal
  expect(await fetchFridayAgentGroups(signal)).toEqual(body)
  expect(mock).toHaveBeenCalledWith('/api/agent-groups', { method: 'GET', signal })
})
it.each([401, 503])('rejects %s with bounded message and no fallback', async status => {
  const mock = respond({ error: 'SECRET'.repeat(1000) }, status)
  await expect(fetchFridayAgentGroups()).rejects.toThrow('Group workspace unavailable.')
  expect(mock).toHaveBeenCalledTimes(1)
})
it.each([
  (b: any) => { b.schemaVersion = '2' },
  (b: any) => { b.executionEnabled = true },
  (b: any) => { b.workStatus = 'connected' },
  (b: any) => { b.registryStatus = 'busy' },
  (b: any) => { b.groups[0].id = 'unknown' },
  (b: any) => { b.groups[0].id = 'homelab' },
  (b: any) => { b.groups[0].members[0].state = 'active' },
  (b: any) => { b.groups[0].members[0].id = '../private' },
  (b: any) => { b.groups[0].members[0].agentId = 'agent/one' },
  (b: any) => { b.groups[0].members[0].state = 'configured' },
  (b: any) => { b.groups[0].members[0].reason = null },
  (b: any) => { b.groups[0].members[0].instructions = 'private' },
  (b: any) => { b.groups[1].members[0].id = b.groups[0].members[0].id },
])('rejects malformed protocol', async mutate => {
  const body = payload()
  mutate(body)
  respond(body)
  await expect(fetchFridayAgentGroups()).rejects.toThrow('Group workspace unavailable.')
})
it('rejects non-JSON and network failures safely', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>')))
  await expect(fetchFridayAgentGroups()).rejects.toThrow('Group workspace unavailable.')
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('secret endpoint') }))
  await expect(fetchFridayAgentGroups()).rejects.toThrow('Group workspace unavailable.')
})
it('preserves request cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError') }))
  await expect(fetchFridayAgentGroups()).rejects.toMatchObject({ name: 'AbortError' })
})
