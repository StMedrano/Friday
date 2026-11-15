import test from 'node:test'
import assert from 'node:assert/strict'
import { webGrowthContext } from './web-growth-context.mjs'
import { projectWebGrowthStore } from '../adapters/web-growth-schema.mjs'

test('AI context counts every stage but bounds records, preserves provenance and excludes private source fields', () => {
  const generatedAt = new Date().toISOString()
  const leads = Array.from({ length: 100 }, (_, i) => ({
    id: 'lead-' + i, businessName: 'Business ' + i, stage: i < 30 ? 'qualified' : 'audited',
    discoveredAt: generatedAt, updatedAt: generatedAt, approvedForOutreach: false,
    score: { total: i }, contactEmail: 'private@example.test', notes: 'private note',
  }))
  const snapshot = projectWebGrowthStore({ version: 1, leads }, { generatedAt, sourceRevision: 'abcdef0', sourceChecksum: 'a'.repeat(64) })
  const context = webGrowthContext(snapshot)
  assert.equal(context.totalLeads, 100)
  assert.equal(context.stages.qualified, 30)
  assert.equal(context.stages.audited, 70)
  assert.equal(context.leads.length, 25)
  assert.equal(context.omittedLeads, 75)
  assert.equal(context.leads[0].id, 'lead-99')
  assert.doesNotMatch(JSON.stringify(context), /private@example|private note|contactEmail/)
  assert.equal(snapshot.leads[0].id, 'lead-0')
  assert.throws(() => webGrowthContext({ ...snapshot, generatedAt: new Date(Date.now() + 120000).toISOString() }))
})
