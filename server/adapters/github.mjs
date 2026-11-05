// Read-only GitHub summary for registered repositories: open pull requests,
// CI state of the default branch head, and the last commit. GET requests only;
// the token never leaves the server and is never echoed in errors.

const MAX_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 8000
const PAGE_SIZE = 100
const LISTED_PULLS = 5
const NAME = /^[A-Za-z0-9_.-]{1,100}$/
const BRANCH = /^(?!.*\.\.)(?!\/)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<!\/)$/

class GitHubError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function validName(value) {
  return NAME.test(value) && value !== '.' && value !== '..'
}

export function parseGitHubRemote(remote) {
  if (typeof remote !== 'string' || !remote) return null
  let path
  const scp = remote.match(/^git@github\.com:(.+)$/)
  if (scp) path = scp[1]
  else {
    let url
    try { url = new URL(remote) } catch { return null }
    if (!['https:', 'ssh:', 'git:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' || url.port) return null
    path = url.pathname.replace(/^\//, '')
  }
  const parts = path.replace(/\/$/, '').replace(/\.git$/, '').split('/')
  if (parts.length !== 2 || !parts.every(validName)) return null
  return { owner: parts[0], repo: parts[1] }
}

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function timestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined
}

function githubLink(value, prefix) {
  return typeof value === 'string' && value.startsWith(prefix) && !/[\s"'<>]/.test(value) ? value : undefined
}

async function readJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new GitHubError('github-unavailable')
  const reader = response.body?.getReader()
  if (!reader) throw new GitHubError('github-unavailable')
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new GitHubError('github-unavailable')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function summarizePulls(list, base) {
  if (!Array.isArray(list)) throw new GitHubError('github-unavailable')
  const items = list
    .filter((pull) => pull && Number.isInteger(pull.number) && pull.number > 0)
    .slice(0, LISTED_PULLS)
    .map((pull) => ({
      number: pull.number,
      title: text(pull.title, 200),
      author: text(pull.user?.login, 100),
      draft: pull.draft === true,
      updatedAt: timestamp(pull.updated_at),
      url: githubLink(pull.html_url, `${base}/pull/`),
    }))
  return { open: list.length, more: list.length >= PAGE_SIZE, items }
}

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'])
const STATUS_FAILED = new Set(['failure', 'error'])

function summarizeChecks(checkRuns, statuses) {
  let total = 0
  let failed = 0
  let pending = 0
  for (const run of Array.isArray(checkRuns?.check_runs) ? checkRuns.check_runs : []) {
    if (!run || typeof run !== 'object') continue
    total += 1
    if (run.status !== 'completed') pending += 1
    else if (FAILED.has(run.conclusion)) failed += 1
  }
  for (const status of Array.isArray(statuses?.statuses) ? statuses.statuses : []) {
    if (!status || typeof status !== 'object') continue
    total += 1
    if (status.state === 'pending') pending += 1
    else if (STATUS_FAILED.has(status.state)) failed += 1
  }
  const state = total === 0 ? 'none' : failed > 0 ? 'failure' : pending > 0 ? 'pending' : 'success'
  return { state, total, failed, pending }
}

function summarizeCommit(commit, base) {
  if (!commit || typeof commit.sha !== 'string' || !/^[0-9a-f]{40}$/.test(commit.sha)) throw new GitHubError('github-unavailable')
  return {
    sha: commit.sha.slice(0, 7),
    message: text(commit.commit?.message, 2000).split('\n')[0].slice(0, 200),
    author: text(commit.commit?.author?.name, 100),
    date: timestamp(commit.commit?.author?.date),
    url: githubLink(commit.html_url, `${base}/commit/`),
  }
}

export function createGitHubReader(config, { fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map()
  const ttl = Math.max(0, Number(config?.cacheSeconds) || 0) * 1000

  function usable() {
    if (config?.enabled !== true) return null
    let origin
    try { origin = new URL(config.apiUrl || 'https://api.github.com') } catch { return null }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) return null
    const token = config.token || ''
    if (typeof token !== 'string' || /\s/.test(token)) return null
    return { origin: origin.href.replace(/\/$/, ''), token }
  }

  async function get(api, path, { optional = false } = {}) {
    let response
    try {
      response = await fetchImpl(`${api.origin}${path}`, {
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'friday-dashboard',
          ...(api.token ? { authorization: `Bearer ${api.token}` } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch { throw new GitHubError('github-unavailable') }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      if (optional) return null
      throw new GitHubError('github-unavailable')
    }
    try { return await readJson(response) } catch { throw new GitHubError('github-unavailable') }
  }

  async function load(api, { owner, repo }, branch) {
    const base = `https://github.com/${owner}/${repo}`
    const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    const [pulls, commit] = await Promise.all([
      get(api, `${root}/pulls?state=open&sort=updated&direction=desc&per_page=${PAGE_SIZE}`),
      get(api, `${root}/commits/${encodeURIComponent(branch)}`),
    ])
    const lastCommit = summarizeCommit(commit, base)
    const [checkRuns, statuses] = await Promise.all([
      get(api, `${root}/commits/${commit.sha}/check-runs?per_page=${PAGE_SIZE}`, { optional: true }),
      get(api, `${root}/commits/${commit.sha}/status`, { optional: true }),
    ])
    return {
      repository: `${owner}/${repo}`,
      url: base,
      branch,
      fetchedAt: new Date(now()).toISOString(),
      pullRequests: summarizePulls(pulls, base),
      ci: summarizeChecks(checkRuns, statuses),
      lastCommit,
    }
  }

  return {
    async summary(repository) {
      const api = usable()
      if (!api) throw new GitHubError('github-disabled')
      const target = parseGitHubRemote(repository?.remote)
      const branch = repository?.defaultBranch
      if (!target || typeof branch !== 'string' || !BRANCH.test(branch)) throw new GitHubError('github-remote-unsupported')
      const key = `${target.owner}/${target.repo}@${branch}`.toLowerCase()
      const cached = cache.get(key)
      if (cached && now() < cached.expires) return cached.value
      const value = load(api, target, branch)
      cache.set(key, { value, expires: now() + ttl })
      try {
        return await value
      } catch (error) {
        cache.delete(key)
        throw error instanceof GitHubError ? error : new GitHubError('github-unavailable')
      }
    },
  }
}
