import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, writeFile, appendFile, chmod, rm, stat, symlink, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createActionAudit, auditActor} from './action-audit.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'friday-action-audit-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const directory = join(root, 'audit')
  let tick = 1_700_000_000_000
  const audit = await createActionAudit({directory, now: () => tick++, ...options})
  return {root, directory, audit, file: join(directory, 'actions.jsonl')}
}

const human = auditActor({subject: 'user-sub-1', email: 'Owner@Example.com'})

test('appends hash-chained records to a private create-only log and reads them newest first', async t => {
  const {directory, audit, file} = await fixture(t)
  const first = await audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  const second = await audit.record({action: 'agents.registry.sync', phase: 'succeeded', actor: human, requestId: first.requestId})
  assert.equal(first.seq, 1)
  assert.equal(second.seq, 2)
  assert.equal(second.requestId, first.requestId)
  assert.equal(first.prev, '0'.repeat(64))
  assert.equal(second.prev, first.hash)
  assert.match(first.hash, /^[a-f0-9]{64}$/)
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  const lines = (await readFile(file, 'utf8')).trim().split('\n')
  assert.equal(lines.length, 2)
  const page = await audit.list({limit: 10})
  assert.equal(page.integrity, 'verified')
  assert.deepEqual(page.events.map(event => event.seq), [2, 1])
  assert.equal(page.nextBefore, null)
})

test('actor identity is hashed and labelled, never raw subjects', () => {
  assert.equal(human.kind, 'human')
  assert.match(human.id, /^[a-f0-9]{64}$/)
  assert.equal(human.label, 'owner@example.com')
  assert.notEqual(human.id, 'user-sub-1')
  const service = auditActor({subject: 'abc.access', kind: 'service'})
  assert.deepEqual({kind: service.kind, label: service.label}, {kind: 'service', label: 'abc.access'})
  assert.deepEqual(auditActor(null), {kind: 'unauthenticated', id: null, label: null})
})

test('rejects unknown actions, phases, oversized or control-character fields', async t => {
  const {audit} = await fixture(t)
  for (const invalid of [
    {action: 'proxmox.vm.delete', phase: 'requested', actor: human},
    {action: 'agents.registry.sync', phase: 'executed', actor: human},
    {action: 'agents.registry.sync', phase: 'requested', actor: {kind: 'root', id: null, label: null}},
    {action: 'incidents.diagnostics.rerun', phase: 'requested', actor: human, target: 'x'.repeat(257)},
    {action: 'incidents.diagnostics.rerun', phase: 'requested', actor: human, target: 'bad\nline'},
    {action: 'incidents.diagnostics.rerun', phase: 'failed', actor: human, detail: 'y'.repeat(241)},
    {action: 'agents.registry.sync', phase: 'succeeded', actor: human, requestId: '../escape'},
    {action: 'agents.registry.sync', phase: 'requested', actor: human, extra: true},
  ]) await assert.rejects(audit.record(invalid), /audit-rejected/)
  assert.equal((await audit.list()).events.length, 0)
})

test('reopening continues the chain and detects tampering, failing closed for writes', async t => {
  const {directory, audit, file} = await fixture(t)
  await audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  await audit.record({action: 'agents.registry.sync', phase: 'succeeded', actor: human})
  const reopened = await createActionAudit({directory})
  const third = await reopened.record({action: 'incidents.diagnostics.rerun', phase: 'requested', actor: human, target: 'i1'})
  assert.equal(third.seq, 3)
  assert.equal((await reopened.list()).integrity, 'verified')

  const lines = (await readFile(file, 'utf8')).trim().split('\n')
  const forged = JSON.parse(lines[1]); forged.phase = 'failed'
  lines[1] = JSON.stringify(forged)
  await writeFile(file, lines.join('\n') + '\n')
  const page = await reopened.list()
  assert.equal(page.integrity, 'broken')
  await assert.rejects(reopened.record({action: 'agents.registry.sync', phase: 'requested', actor: human}), /audit-unavailable/)
  const tampered = await createActionAudit({directory})
  assert.equal((await tampered.list()).integrity, 'broken')
  await assert.rejects(tampered.record({action: 'agents.registry.sync', phase: 'requested', actor: human}), /audit-unavailable/)
})

test('a truncated trailing record is reported as broken, not silently dropped', async t => {
  const {directory, audit, file} = await fixture(t)
  await audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  await appendFile(file, '{"seq":2,')
  const reopened = await createActionAudit({directory})
  assert.equal((await reopened.list()).integrity, 'broken')
})

test('pagination is bounded and filterable by action', async t => {
  const {audit} = await fixture(t)
  for (let i = 0; i < 5; i++) await audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  await audit.record({action: 'incidents.diagnostics.rerun', phase: 'requested', actor: human, target: 'i9'})
  const first = await audit.list({limit: 2})
  assert.deepEqual(first.events.map(e => e.seq), [6, 5])
  assert.equal(first.nextBefore, 5)
  const second = await audit.list({limit: 2, before: first.nextBefore})
  assert.deepEqual(second.events.map(e => e.seq), [4, 3])
  const filtered = await audit.list({action: 'incidents.diagnostics.rerun'})
  assert.deepEqual(filtered.events.map(e => e.target), ['i9'])
  for (const invalid of [{limit: 0}, {limit: 201}, {limit: 1.5}, {before: -1}, {action: 'nope'}])
    await assert.rejects(audit.list(invalid), /audit-rejected/)
})

test('size cap fails closed instead of rotating or truncating history', async t => {
  const probe = await fixture(t)
  await probe.audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  const lineBytes = (await stat(probe.file)).size
  const {audit} = await fixture(t, {maxBytes: lineBytes * 2 + 10})
  await audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  await audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  await assert.rejects(audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human}), /audit-full/)
  assert.equal((await audit.list()).events.length, 2)
})

test('concurrent records serialize into one consistent chain', async t => {
  const {directory, audit} = await fixture(t)
  await Promise.all(Array.from({length: 20}, () => audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})))
  const reopened = await createActionAudit({directory})
  const page = await reopened.list({limit: 50})
  assert.equal(page.integrity, 'verified')
  assert.deepEqual(page.events.map(e => e.seq).reverse(), Array.from({length: 20}, (_, i) => i + 1))
})

test('relative, permissive or symlinked locations are refused', async t => {
  const {root, directory} = await fixture(t)
  await assert.rejects(createActionAudit({directory: 'relative/audit'}), /audit-unavailable/)
  await chmod(directory, 0o755)
  await assert.rejects(createActionAudit({directory}), /audit-unavailable/)
  await chmod(directory, 0o700)
  const other = join(root, 'other'); await mkdir(other, {mode: 0o700})
  const linked = join(root, 'linked'); await symlink(other, linked)
  await assert.rejects(createActionAudit({directory: linked}), /audit-unavailable/)
  const fileLinkDir = join(root, 'filelink'); await mkdir(fileLinkDir, {mode: 0o700})
  await writeFile(join(root, 'target.jsonl'), '', {mode: 0o600})
  await symlink(join(root, 'target.jsonl'), join(fileLinkDir, 'actions.jsonl'))
  await assert.rejects(createActionAudit({directory: fileLinkDir}), /audit-unavailable/)
})

test('exposes no update or delete operations', async t => {
  const {audit} = await fixture(t)
  assert.deepEqual(Object.keys(audit).sort(), ['list', 'record', 'status'])
  assert.ok(Object.isFrozen(audit))
})

test('a same-length in-place edit is detected before the next append', async t => {
  const {audit, file} = await fixture(t)
  await audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  const raw = await readFile(file, 'utf8')
  // 'requested' and 'succeeded' have the same length, so the file size is unchanged.
  await writeFile(file, raw.replace('"phase":"requested"', '"phase":"succeeded"'))
  await assert.rejects(audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human}), /audit-unavailable/)
  assert.equal(audit.status().integrity, 'broken')
  assert.equal((await audit.list()).integrity, 'broken')
})

test('truncation to a record boundary or deletion is reported as broken while running', async t => {
  const {audit, file} = await fixture(t)
  await audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  await audit.record({action: 'agents.registry.sync', phase: 'succeeded', actor: human})
  const [first] = (await readFile(file, 'utf8')).split('\n')
  await writeFile(file, first + '\n')
  assert.equal((await audit.list()).integrity, 'broken')
  assert.equal(audit.status().integrity, 'broken')

  const other = await fixture(t)
  await other.audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human})
  await rm(other.file)
  assert.equal((await other.audit.list()).integrity, 'broken')
  await assert.rejects(other.audit.record({action: 'agents.registry.sync', phase: 'requested', actor: human}), /audit-unavailable/)
})
