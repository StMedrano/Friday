import test from 'node:test'
import assert from 'node:assert/strict'
import { groupCatalog, validateGroupCatalog, getGroupWorkspace } from './group-workspace.mjs'

const project = (rows = []) => getGroupWorkspace({ registryService: { list: async () => rows } })
const bound = dto => dto.groups.flatMap(group => group.members).find(member => member.agentId)
const copy = () => structuredClone(groupCatalog)

test('catalog_contains_three_requested_groups', async () => {
  const dto = await project()
  assert.deepEqual(dto.groups.map(group => group.id), ['techtactics', 'app-builder', 'homelab'])
  assert.deepEqual(dto.groups.map(group => group.members.length), [7, 5, 7])
  assert.equal(dto.schemaVersion, '1')
  assert.equal(dto.executionEnabled, false)
  assert.equal(dto.workStatus, 'not-connected')
  assert.deepEqual(dto.groups.map(group => group.members.map(member => member.name)), [
    ['Manager', 'Scout', 'Auditor', 'Designer', 'Sales', 'Accounting/Tax', 'Legal'],
    ['Coordinator', 'Planner', 'Developer', 'Reviewer', 'QA'],
    ['Coordinator', 'Proxmox Observer', 'Container Operations', 'Network Observer', 'Backup/Storage', 'Security', 'Service Health'],
  ])
})
test('only_proxmox_has_runtime_binding', async () => {
  const dto = await project([{id: 'proxmox-observer', enabled: true, instructions: ['private'], source: {path: 'private'}, credentials: 'private'}])
  assert.equal(dto.registryStatus, 'ok')
  const members = dto.groups.flatMap(group => group.members)
  assert.deepEqual(members.filter(member => member.agentId).map(member => [member.name, member.agentId, member.implementation, member.state]),
    [['Proxmox Observer', 'proxmox-observer', 'existing', 'configured']])
  for (const member of members) assert.deepEqual(Object.keys(member).sort(), ['agentId', 'id', 'implementation', 'name', 'reason', 'state'])
  assert.equal(JSON.stringify(dto).includes('private'), false)
  assert.deepEqual(Object.keys(dto).sort(), ['executionEnabled', 'groups', 'registryStatus', 'schemaVersion', 'workStatus'])
  for (const group of dto.groups) assert.deepEqual(Object.keys(group).sort(), ['id', 'members', 'name'])
  assert.ok(members.filter(member => !member.agentId).every(member => member.implementation === 'planned' && member.state === 'catalogued'))
})
test('unknown_fields_or_duplicate_ids_reject', () => {
  const mutations = [
    c => { c.extra = true },
    c => { c.groups[0].extra = true },
    c => { c.groups[0].members[0].extra = true },
    c => { c.groups[1].id = c.groups[0].id },
    c => { c.groups[1].members[0].id = c.groups[0].members[0].id },
    c => { c.schemaVersion = 1 },
    c => { c.groups[0].id = 'Bad' },
    c => { c.groups[0].name = ' ' },
    c => { c.groups[0].members[0].name = 'x'.repeat(81) },
    c => { c.groups[0].members[0].implementation = 'existing' },
    c => { c.groups[0].members[0].agentId = 'manager' },
    c => { c.groups[2].members[1].agentId = 'Bad' },
    c => { c.groups = Array.from({length: 9}, (_, i) => ({id: 'group-' + i, name: 'Group', members: []})) },
    c => { c.groups[0].members = Array.from({length: 41}, (_, i) => ({id: 'member-' + i, name: 'Member', agentId: null, implementation: 'planned'})) },
  ]
  for (const mutate of mutations) { const c = copy(); mutate(c); assert.throws(() => validateGroupCatalog(c)) }
})
test('proposed_role_does_not_bind_by_name', async () => {
  const dto = await project([{id: 'techtactics-manager', name: 'Manager', enabled: true}])
  assert.equal(dto.groups[0].members[0].state, 'catalogued')
  assert.equal(dto.groups[0].members[0].agentId, null)
})
test('registry_failure_marks_bound_member_unavailable', async () => {
  const dto = await getGroupWorkspace({registryService: {list: async () => {throw new Error('private failure')}}})
  assert.equal(dto.registryStatus, 'unavailable')
  assert.equal(bound(dto).state, 'unavailable')
  assert.equal(dto.groups.length, 3)
  assert.equal(JSON.stringify(dto).includes('private failure'), false)
  assert.equal(bound(await project()).state, 'unavailable')
  const invalidList = await getGroupWorkspace({registryService: {list: async () => null}})
  assert.equal(invalidList.registryStatus, 'unavailable')
  assert.equal(bound(invalidList).state, 'unavailable')
})
test('disabled_registry_member_is_disabled', async () => {
  assert.equal(bound(await project([{id: 'proxmox-observer', enabled: false}])).state, 'disabled')
})
