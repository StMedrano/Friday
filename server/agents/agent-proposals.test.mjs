import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentDefinition, createAgentProposer } from './agent-proposals.mjs'

const profiles = ['local-general', 'local-coder']
const input = {
  id: 'dns-watcher', name: 'DNS Watcher', description: 'Watches AdGuard health and explains DNS problems.',
  profile: 'local-general', hosts: ['adguard'], tools: ['dns_read'],
  permissions: { inspect: 'auto', read_logs: 'auto', restart_service: 'approval', delete_config: 'forbidden' },
  instructions: ['Inspect before proposing a repair.'],
}

test('builds a v1.1 definition with no deployment fields', () => {
  const definition = buildAgentDefinition(input, { profiles })
  assert.deepEqual(definition, {
    version: '1.1', id: 'dns-watcher', name: 'DNS Watcher', description: input.description, enabled: true,
    model: { profile: 'local-general' }, scope: { hosts: ['adguard'] }, tools: ['dns_read'],
    permissions: input.permissions, instructions: input.instructions,
  })
  assert.equal(buildAgentDefinition({ ...input, enabled: false, hosts: undefined }, { profiles }).enabled, false)
})

test('rejects bad input, unknown profiles, secrets, extra fields and unsafe auto permissions', () => {
  const bad = [
    { ...input, id: 'Bad Id' }, { ...input, id: 'a' }, { ...input, id: '../x' }, { ...input, name: '' }, { ...input, name: ' padded' },
    { ...input, description: 'x'.repeat(501) }, { ...input, profile: 'gpt-4' }, { ...input, tools: ['Shell Exec'] },
    { ...input, tools: ['a_b', 'a_b'] }, { ...input, hosts: ['bad host'] }, { ...input, permissions: [] },
    { ...input, permissions: { restart_vm: 'auto' } }, { ...input, permissions: { delete_vm: 'sometimes' } },
    { ...input, instructions: ['Use api_key=abc123'] }, { ...input, instructions: ['line\nbreak'] },
    { ...input, instructions: 'not a list' }, { ...input, enabled: 'yes' }, { ...input, model: { provider: 'ollama' } },
    { ...input, baseUrl: 'http://x' }, null, [],
  ]
  for (const value of bad) assert.throws(() => buildAgentDefinition(value, { profiles }), (error) => error.code === 'invalid', JSON.stringify(value))
  assert.throws(() => buildAgentDefinition(input, { profiles, existingIds: ['dns-watcher'] }), (error) => error.code === 'exists')
})

function github(responses) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers, redirect: options.redirect })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status: next.status })
  }
  return { calls, fetchImpl }
}
const sha = 'a'.repeat(40)
const proposer = (fetchImpl, extra = {}) => createAgentProposer({
  enabled: true, token: 'ghp_secrettokenvalue0000000000', repository: 'StMedrano/Friday', fetchImpl, now: () => 1700000000000, ...extra,
})

test('opens a pull request that adds one new agent file on a new branch', async () => {
  const definition = buildAgentDefinition(input, { profiles })
  const fake = github([
    { status: 200, body: { object: { sha } } },
    { status: 404, body: { message: 'Not Found' } },
    { status: 201, body: { ref: 'x' } },
    { status: 201, body: { content: {} } },
    { status: 201, body: { number: 42, html_url: 'https://github.com/StMedrano/Friday/pull/42' } },
  ])
  const result = await proposer(fake.fetchImpl).propose(definition)
  const branch = 'friday/agent-dns-watcher-' + (1700000000000).toString(36)
  assert.deepEqual(result, { number: 42, url: 'https://github.com/StMedrano/Friday/pull/42', branch, path: 'agents/dns-watcher.json' })
  assert.deepEqual(fake.calls.map((call) => [call.method, call.url.replace('https://api.github.com/repos/StMedrano/Friday', '')]), [
    ['GET', '/git/ref/heads/main'],
    ['GET', '/contents/agents/dns-watcher.json?ref=main'],
    ['POST', '/git/refs'],
    ['PUT', '/contents/agents/dns-watcher.json'],
    ['POST', '/pulls'],
  ])
  assert.deepEqual(fake.calls[2].body, { ref: `refs/heads/${branch}`, sha })
  assert.equal(fake.calls[3].body.branch, branch)
  assert.equal(Object.hasOwn(fake.calls[3].body, 'sha'), false)
  assert.deepEqual(JSON.parse(Buffer.from(fake.calls[3].body.content, 'base64').toString('utf8')), definition)
  assert.deepEqual([fake.calls[4].body.head, fake.calls[4].body.base], [branch, 'main'])
  for (const call of fake.calls) {
    assert.equal(call.headers.authorization, 'Bearer ghp_secrettokenvalue0000000000')
    assert.equal(call.redirect, 'error')
  }
  assert.doesNotMatch(JSON.stringify(fake.calls.map((call) => call.body)), /ghp_|@/)
})

test('never replaces an agent that is already in Git', async () => {
  const fake = github([{ status: 200, body: { object: { sha } } }, { status: 200, body: { sha: 'b'.repeat(40) } }])
  await assert.rejects(proposer(fake.fetchImpl).propose(buildAgentDefinition(input, { profiles })), (error) => error.code === 'exists')
  assert.equal(fake.calls.length, 2)
})

test('GitHub failures are sanitized and stop before later steps', async () => {
  for (const [responses, code] of [
    [[{ status: 401, body: { message: 'Bad credentials ghp_x' } }], 'github-denied'],
    [[{ status: 200, body: { object: { sha } } }, { status: 404 }, { status: 422, body: { message: 'Reference already exists' } }], 'github-rejected'],
    [[{ status: 500, body: {} }], 'github-unavailable'],
    [[new Error('socket ghp_x')], 'github-unavailable'],
    [[{ status: 200, body: { object: { sha: 'nope' } } }], 'github-unavailable'],
    [[{ status: 200, body: { object: { sha } } }, { status: 404 }, { status: 201 }, { status: 201 }, { status: 201, body: { number: 1, html_url: 'https://evil.example/pull/1' } }], 'github-unavailable'],
  ]) {
    const fake = github(responses)
    await assert.rejects(proposer(fake.fetchImpl).propose(buildAgentDefinition(input, { profiles })), (error) => error.code === code && !/ghp_/.test(error.message))
  }
})

test('stays disabled without the flag, a token, a valid repository or an https API', async () => {
  for (const extra of [{ enabled: false }, { token: '' }, { repository: 'not-a-repo' }, { repository: 'a/b/c' }, { apiUrl: 'http://api.github.com' }]) {
    const fake = github([])
    const disabled = proposer(fake.fetchImpl, extra)
    assert.equal(disabled.enabled, false)
    assert.equal(disabled.repository, null)
    await assert.rejects(disabled.propose(buildAgentDefinition(input, { profiles })), (error) => error.code === 'disabled')
    assert.equal(fake.calls.length, 0)
  }
})
