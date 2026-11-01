import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from '../config.mjs'
import { buildModelTargets, publicModelDescriptor } from './model-registry.mjs'

const free = { id: 'free-general', model: 'vendor/model', billingClass: 'free',
  capabilities: ['general', 'reasoning'], supportsTools: false, supportsVision: false }

test('normalizes both deployments and never exports secrets', () => {
  const config = getConfig({ FRIDAY_NVIDIA_ENABLED: 'true', NVIDIA_API_KEY: 'test-secret',
    FRIDAY_NVIDIA_MODELS_JSON: JSON.stringify([free]),
    FRIDAY_NVIDIA_LOCAL_ENABLED: 'true',
    FRIDAY_NVIDIA_LOCAL_MODELS_JSON: JSON.stringify([{ ...free, id: 'local-free', billingClass: 'unknown' }]) })
  const targets = buildModelTargets(config.modelFabric)
  assert.deepEqual(targets.map(t => t.descriptor.deployment), ['hosted', 'local'])
  assert.deepEqual(targets.map(t => t.descriptor.billingClass), ['free', 'unknown'])
  assert.equal(targets[0].providerConfig.apiKey, 'test-secret')
  assert.equal(targets[1].providerConfig.apiKey, '')
  const publicData = JSON.stringify(targets.map(publicModelDescriptor))
  assert.equal(publicData.includes('test-secret'), false)
  assert.equal(publicData.includes('baseUrl'), false)
  assert.equal(publicData.includes('vendor/model'), false)
})

test('invalid metadata fails closed and keeps only valid targets', () => {
  const invalid = [{...free, id: ''}, {...free, model: ''},
    {...free, capabilities: []}, {...free, supportsVision: undefined},
    {...free, billingClass: undefined}, {...free, maxTokens: -1}]
  const config = getConfig({FRIDAY_NVIDIA_ENABLED: 'true',
    FRIDAY_NVIDIA_MODELS_JSON: JSON.stringify([...invalid, free, free])})
  assert.equal(buildModelTargets(config.modelFabric).length, 1)
  assert.equal(buildModelTargets(getConfig({ FRIDAY_NVIDIA_MODELS_JSON: '{oops' }).modelFabric).length, 0)
})

test('disabled modes preserve descriptors but are explicitly ineligible', () => {
  const config = getConfig({FRIDAY_NVIDIA_MODELS_JSON: JSON.stringify([free])})
  const [target] = buildModelTargets(config.modelFabric)
  assert.equal(target.descriptor.enabled, false)
})