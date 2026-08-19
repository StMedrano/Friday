import test from 'node:test'
import assert from 'node:assert/strict'
import { integrationSummary, normalizeOverview, previewCommand, resolveCommandIntent } from './core.mjs'

test('normalizeOverview defaults to safe mock mode', () => {
  const result = normalizeOverview({})
  assert.equal(result.mode, 'mock')
  assert.deepEqual(result.sites, [])
  assert.deepEqual(result.services, [])
})

test('resolveCommandIntent only resolves supported read-only command families', () => {
  assert.equal(resolveCommandIntent('check system health'), 'health-check')
  assert.equal(resolveCommandIntent('restart vm 100'), null)
})

test('previewCommand never marks commands destructive', () => {
  const result = previewCommand({ message: 'show service status' })
  assert.equal(result.accepted, true)
  assert.equal(result.destructive, false)
  assert.equal(result.mode, 'preview')
})

test('integrationSummary keeps integrations disabled unless explicitly true', () => {
  const result = integrationSummary({ docker: true, vm100Observer: true })
  assert.equal(result.find((item) => item.id === 'docker').enabled, true)
  assert.equal(result.find((item) => item.id === 'proxmox').enabled, false)
  assert.equal(result.find((item) => item.id === 'vm100-observer').enabled, true)
  assert.equal(result.find((item) => item.id === 'endpoints').enabled, false)
})
