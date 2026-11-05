import test from 'node:test'
import assert from 'node:assert/strict'
import { createGitHubReader, parseGitHubRemote } from './github.mjs'

const CONFIG = { enabled: true, token: 'github_pat_example_value_for_tests_only', apiUrl: 'https://api.github.com', cacheSeconds: 60 }
const REPOSITORY = { id: 'friday', name: 'Friday', remote: 'https://github.com/StMedrano/Friday.git', defaultBranch: 'main' }

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fakeGitHub(overrides = {}) {
  const calls = []
  const routes = {
    '/repos/StMedrano/Friday/pulls': () => reply([
      { number: 126, title: 'Match the remaining pages', draft: false, user: { login: 'StMedrano' }, updated_at: '2026-11-05T16:00:00Z', html_url: 'https://github.com/StMedrano/Friday/pull/126', body: 'x'.repeat(500) },
      { number: 125, title: 'Draft work', draft: true, user: { login: 'bot' }, updated_at: '2026-11-04T16:00:00Z', html_url: 'https://github.com/StMedrano/Friday/pull/125' },
    ]),
    '/repos/StMedrano/Friday/commits/main': () => reply({
      sha: '3a21f9d0123456789abcdef0123456789abcdef0',
      html_url: 'https://github.com/StMedrano/Friday/commit/3a21f9d0123456789abcdef0123456789abcdef0',
      commit: { message: 'Match the remaining pages (#126)\n\nLong body', author: { name: 'Stalin', date: '2026-11-05T17:00:00Z' } },
    }),
    '/repos/StMedrano/Friday/commits/3a21f9d0123456789abcdef0123456789abcdef0/check-runs': () => reply({
      total_count: 3,
      check_runs: [
        { name: 'verify', status: 'completed', conclusion: 'success' },
        { name: 'observer', status: 'completed', conclusion: 'skipped' },
        { name: 'trivy', status: 'completed', conclusion: 'success' },
      ],
    }),
    '/repos/StMedrano/Friday/commits/3a21f9d0123456789abcdef0123456789abcdef0/status': () => reply({ state: 'pending', total_count: 0, statuses: [] }),
    ...overrides,
  }
  const fetchImpl = async (input, init) => {
    const url = new URL(input)
    calls.push({ url, init })
    const handler = routes[url.pathname]
    return handler ? handler(url) : reply({ message: 'Not Found' }, 404)
  }
  return { fetchImpl, calls }
}

test('parses GitHub https and ssh remotes and rejects other hosts', () => {
  assert.deepEqual(parseGitHubRemote('https://github.com/StMedrano/Friday.git'), { owner: 'StMedrano', repo: 'Friday' })
  assert.deepEqual(parseGitHubRemote('https://github.com/StMedrano/Friday'), { owner: 'StMedrano', repo: 'Friday' })
  assert.deepEqual(parseGitHubRemote('git@github.com:StMedrano/friday.git'), { owner: 'StMedrano', repo: 'friday' })
  assert.deepEqual(parseGitHubRemote('ssh://git@github.com/StMedrano/Friday.git'), { owner: 'StMedrano', repo: 'Friday' })
  assert.equal(parseGitHubRemote('https://gitlab.com/StMedrano/Friday.git'), null)
  assert.equal(parseGitHubRemote('https://github.com/StMedrano'), null)
  assert.equal(parseGitHubRemote('https://github.com/StMedrano/Friday/tree/main'), null)
  assert.equal(parseGitHubRemote('https://github.com/../x.git'), null)
  assert.equal(parseGitHubRemote(undefined), null)
})

test('summarizes open pull requests, CI and the last commit from read-only GETs', async () => {
  const { fetchImpl, calls } = fakeGitHub()
  const reader = createGitHubReader(CONFIG, { fetchImpl, now: () => Date.parse('2026-11-05T18:00:00Z') })
  const result = await reader.summary(REPOSITORY)

  assert.deepEqual(result, {
    repository: 'StMedrano/Friday',
    url: 'https://github.com/StMedrano/Friday',
    branch: 'main',
    fetchedAt: '2026-11-05T18:00:00.000Z',
    pullRequests: {
      open: 2,
      more: false,
      items: [
        { number: 126, title: 'Match the remaining pages', author: 'StMedrano', draft: false, updatedAt: '2026-11-05T16:00:00Z', url: 'https://github.com/StMedrano/Friday/pull/126' },
        { number: 125, title: 'Draft work', author: 'bot', draft: true, updatedAt: '2026-11-04T16:00:00Z', url: 'https://github.com/StMedrano/Friday/pull/125' },
      ],
    },
    ci: { state: 'success', total: 3, failed: 0, pending: 0 },
    lastCommit: {
      sha: '3a21f9d',
      message: 'Match the remaining pages (#126)',
      author: 'Stalin',
      date: '2026-11-05T17:00:00Z',
      url: 'https://github.com/StMedrano/Friday/commit/3a21f9d0123456789abcdef0123456789abcdef0',
    },
  })
  assert.ok(calls.every(({ init }) => (init.method || 'GET') === 'GET'))
  assert.ok(calls.every(({ init }) => init.headers.authorization === `Bearer ${CONFIG.token}`))
  assert.ok(calls.every(({ init }) => init.redirect === 'error'))
  assert.ok(calls.every(({ url }) => url.origin === 'https://api.github.com'))
})

test('reports failures and in-progress checks, counting legacy commit statuses too', async () => {
  const { fetchImpl } = fakeGitHub({
    '/repos/StMedrano/Friday/commits/3a21f9d0123456789abcdef0123456789abcdef0/check-runs': () => reply({
      total_count: 2,
      check_runs: [
        { name: 'verify', status: 'completed', conclusion: 'failure' },
        { name: 'e2e', status: 'in_progress', conclusion: null },
      ],
    }),
    '/repos/StMedrano/Friday/commits/3a21f9d0123456789abcdef0123456789abcdef0/status': () => reply({
      state: 'failure', total_count: 1, statuses: [{ context: 'codex', state: 'error' }],
    }),
  })
  const result = await createGitHubReader(CONFIG, { fetchImpl }).summary(REPOSITORY)
  assert.deepEqual(result.ci, { state: 'failure', total: 3, failed: 2, pending: 1 })
})

test('reports pending while checks run and none when no checks exist', async () => {
  const running = fakeGitHub({
    '/repos/StMedrano/Friday/commits/3a21f9d0123456789abcdef0123456789abcdef0/check-runs': () => reply({
      total_count: 1, check_runs: [{ name: 'verify', status: 'queued', conclusion: null }],
    }),
  })
  assert.deepEqual((await createGitHubReader(CONFIG, { fetchImpl: running.fetchImpl }).summary(REPOSITORY)).ci,
    { state: 'pending', total: 1, failed: 0, pending: 1 })

  const empty = fakeGitHub({
    '/repos/StMedrano/Friday/commits/3a21f9d0123456789abcdef0123456789abcdef0/check-runs': () => reply({ total_count: 0, check_runs: [] }),
  })
  assert.deepEqual((await createGitHubReader(CONFIG, { fetchImpl: empty.fetchImpl }).summary(REPOSITORY)).ci,
    { state: 'none', total: 0, failed: 0, pending: 0 })
})

test('falls back to commit statuses when check runs are not readable with the token', async () => {
  const { fetchImpl } = fakeGitHub({
    '/repos/StMedrano/Friday/commits/3a21f9d0123456789abcdef0123456789abcdef0/check-runs': () => reply({ message: 'Resource not accessible' }, 403),
    '/repos/StMedrano/Friday/commits/3a21f9d0123456789abcdef0123456789abcdef0/status': () => reply({
      state: 'success', total_count: 1, statuses: [{ context: 'ci', state: 'success' }],
    }),
  })
  const result = await createGitHubReader(CONFIG, { fetchImpl }).summary(REPOSITORY)
  assert.deepEqual(result.ci, { state: 'success', total: 1, failed: 0, pending: 0 })
})

test('marks the open pull request count as a lower bound when a full page comes back', async () => {
  const pulls = Array.from({ length: 100 }, (_, index) => ({ number: index + 1, title: `PR ${index + 1}`, draft: false, user: { login: 'a' }, updated_at: '2026-11-05T00:00:00Z', html_url: `https://github.com/StMedrano/Friday/pull/${index + 1}` }))
  const { fetchImpl } = fakeGitHub({ '/repos/StMedrano/Friday/pulls': () => reply(pulls) })
  const result = await createGitHubReader(CONFIG, { fetchImpl }).summary(REPOSITORY)
  assert.equal(result.pullRequests.open, 100)
  assert.equal(result.pullRequests.more, true)
  assert.equal(result.pullRequests.items.length, 5)
})

test('drops malformed pull requests and non-GitHub links instead of passing them through', async () => {
  const { fetchImpl } = fakeGitHub({
    '/repos/StMedrano/Friday/pulls': () => reply([
      { number: 'x', title: 'bad' },
      { number: 7, title: 'Phish', draft: false, user: { login: 'a' }, updated_at: '2026-11-05T00:00:00Z', html_url: 'https://evil.example/pull/7' },
      { number: 8, title: 'y'.repeat(400), draft: false, user: { login: 'a' }, updated_at: '2026-11-05T00:00:00Z', html_url: 'https://github.com/StMedrano/Friday/pull/8' },
    ]),
  })
  const result = await createGitHubReader(CONFIG, { fetchImpl }).summary(REPOSITORY)
  assert.equal(result.pullRequests.open, 3)
  assert.deepEqual(result.pullRequests.items.map((item) => [item.number, item.url, item.title.length]), [
    [7, undefined, 5],
    [8, 'https://github.com/StMedrano/Friday/pull/8', 200],
  ])
})

test('caches a summary for the configured time and refetches after it expires', async () => {
  let time = 0
  const { fetchImpl, calls } = fakeGitHub()
  const reader = createGitHubReader(CONFIG, { fetchImpl, now: () => time })
  await reader.summary(REPOSITORY)
  const first = calls.length
  time = 59_000
  await reader.summary(REPOSITORY)
  assert.equal(calls.length, first)
  time = 61_000
  await reader.summary(REPOSITORY)
  assert.equal(calls.length, first * 2)
})

test('fails closed with stable error codes and never leaks the token', async () => {
  await assert.rejects(createGitHubReader({ ...CONFIG, enabled: false }).summary(REPOSITORY), { code: 'github-disabled' })
  await assert.rejects(createGitHubReader({ ...CONFIG, apiUrl: 'http://api.github.com' }).summary(REPOSITORY), { code: 'github-disabled' })
  await assert.rejects(createGitHubReader({ ...CONFIG, token: 'has space' }).summary(REPOSITORY), { code: 'github-disabled' })
  await assert.rejects(createGitHubReader(CONFIG).summary({ ...REPOSITORY, remote: 'https://gitlab.com/a/b.git' }), { code: 'github-remote-unsupported' })
  await assert.rejects(createGitHubReader(CONFIG).summary({ ...REPOSITORY, defaultBranch: '../x' }), { code: 'github-remote-unsupported' })

  const { fetchImpl } = fakeGitHub({ '/repos/StMedrano/Friday/commits/main': () => reply({ message: 'Bad credentials' }, 401) })
  await assert.rejects(createGitHubReader(CONFIG, { fetchImpl }).summary(REPOSITORY), (error) => {
    assert.equal(error.code, 'github-unavailable')
    assert.doesNotMatch(String(error.message), new RegExp(CONFIG.token))
    return true
  })

  const throwing = async () => { throw new Error(`network ${CONFIG.token}`) }
  await assert.rejects(createGitHubReader(CONFIG, { fetchImpl: throwing }).summary(REPOSITORY), (error) => {
    assert.equal(error.code, 'github-unavailable')
    assert.doesNotMatch(String(error.message), /github_pat/)
    return true
  })
})

test('works without a token for public repositories', async () => {
  const { fetchImpl, calls } = fakeGitHub()
  await createGitHubReader({ ...CONFIG, token: '' }, { fetchImpl }).summary(REPOSITORY)
  assert.ok(calls.every(({ init }) => init.headers.authorization === undefined))
})
