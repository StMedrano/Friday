import NotConnected from './NotConnected'
import { useEffect, useState } from 'react'
import { FileCode2, FolderGit2, GitBranch, GitPullRequest, ShieldCheck } from 'lucide-react'
import {
  fetchFridayRepositories,
  fetchFridayRepositoryGitHub,
  fetchFridayRepositoryFile,
  fetchFridayRepositoryFiles,
  fetchFridayRepositoryStatus,
  type FridayGitHubResult,
  type FridayGitHubSummary,
  type FridayRepository,
  type FridayRepositoryStatus,
} from '../lib/api'

const CI_LABEL: Record<FridayGitHubSummary['ci']['state'], string> = { success: 'Passing', failure: 'Failing', pending: 'Running', none: 'No checks' }
const CI_CLASS: Record<FridayGitHubSummary['ci']['state'], string> = { success: '', failure: 'critical', pending: 'warning', none: '' }

function shortDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function GitHubCells({ result }: { result?: FridayGitHubResult }) {
  if (!result) return <><td className="fx-na">…</td><td className="fx-na">…</td><td className="fx-na">…</td></>
  if (result.state === 'disabled') return <>
    <td className="fx-na" title="Pull request data is not connected">—</td>
    <td className="fx-na" title="CI status is not connected">Not connected</td>
    <td className="fx-na" title="Commit history is not connected">—</td>
  </>
  if (result.state !== 'ok') {
    const label = result.state === 'unsupported' ? 'Not on GitHub' : 'Unavailable'
    const title = result.state === 'unsupported' ? 'This repository has no GitHub remote' : 'GitHub could not be reached'
    return <><td className="fx-na" title={title}>—</td><td className="fx-na" title={title}>{label}</td><td className="fx-na" title={title}>—</td></>
  }
  const { pullRequests, ci, lastCommit } = result.summary
  const ciText = ci.state === 'failure' ? `${ci.failed} failing` : ci.state === 'pending' ? `${ci.pending} running` : CI_LABEL[ci.state]
  return <>
    <td>{pullRequests.open}{pullRequests.more ? '+' : ''}</td>
    <td>{ci.state === 'none' ? <span className="fx-na">{ciText}</span>
      : <span className={`fx-status ${CI_CLASS[ci.state]}`} title={`${CI_LABEL[ci.state]}: ${ci.total} checks`}>{ciText}</span>}</td>
    <td><code>{lastCommit.sha}</code><small className="fx-commit-line" title={lastCommit.message}>{lastCommit.message}{lastCommit.date ? ` · ${shortDate(lastCommit.date)}` : ''}</small></td>
  </>
}

function PullRequestPanel({ summary }: { summary: FridayGitHubSummary }) {
  const { pullRequests } = summary
  return <section className="v3-panel fx-pr-panel" aria-label="Open pull requests">
    <div className="v3-section-head"><div><span className="v3-kicker">{summary.repository.toUpperCase()}</span><h2>{pullRequests.open}{pullRequests.more ? '+' : ''} open pull requests</h2></div><GitPullRequest size={16} aria-hidden="true"/></div>
    {pullRequests.items.length === 0 ? <p className="v3-repository-message">No open pull requests.</p>
      : <ul className="fx-pr-list">{pullRequests.items.map((pull) => <li key={pull.number}>
        <span className="fx-pr-number">#{pull.number}</span>
        <span className="fx-pr-body">
          {pull.url ? <a href={pull.url} target="_blank" rel="noopener noreferrer">{pull.title}</a> : <b>{pull.title}</b>}
          <small>{pull.author}{pull.updatedAt ? ` · updated ${shortDate(pull.updatedAt)}` : ''}{pull.draft ? ' · Draft' : ''}</small>
        </span>
      </li>)}</ul>}
    <p className="fx-pr-note">Read from GitHub {shortDate(summary.fetchedAt)} {new Date(summary.fetchedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. Read only.</p>
  </section>
}

export default function RepositoriesWorkspace() {
  const [repositories, setRepositories] = useState<FridayRepository[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState<FridayRepositoryStatus | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fileError, setFileError] = useState('')
  const [github, setGitHub] = useState<Record<string, FridayGitHubResult>>({})

  useEffect(() => {
    const controller = new AbortController()
    fetchFridayRepositories(controller.signal)
      .then((items) => {
        setRepositories(items)
        setSelectedId(items[0]?.id || '')
      })
      .catch((reason) => { if (reason?.name !== 'AbortError') setError('Repository registry unavailable.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (repositories.length === 0) return
    const controller = new AbortController()
    for (const repository of repositories) {
      fetchFridayRepositoryGitHub(repository.id, controller.signal)
        .catch((reason): FridayGitHubResult | null => reason?.name === 'AbortError' ? null : { state: 'unavailable' })
        .then((result) => { if (result && !controller.signal.aborted) setGitHub((current) => ({ ...current, [repository.id]: result })) })
    }
    return () => controller.abort()
  }, [repositories])

  const selectedCheckout = repositories.find((repository) => repository.id === selectedId)?.checkout !== false

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    setStatus(null)
    setFiles([])
    setSelectedFile('')
    setContent(null)
    setFileError('')
    setError('')
    // A GitHub-only repository has no checkout on the controller to read.
    if (!selectedCheckout) return
    Promise.all([
      fetchFridayRepositoryStatus(selectedId, controller.signal),
      fetchFridayRepositoryFiles(selectedId, '.', controller.signal),
    ]).then(([nextStatus, nextFiles]) => {
      setStatus(nextStatus)
      setFiles(nextFiles)
    }).catch((reason) => {
      if (reason?.name !== 'AbortError') setError('Repository contents unavailable.')
    })
    return () => controller.abort()
  }, [selectedId, selectedCheckout])

  useEffect(() => {
    if (!selectedId || !selectedFile) return
    const controller = new AbortController()
    setContent(null)
    setFileError('')
    fetchFridayRepositoryFile(selectedId, selectedFile, controller.signal)
      .then((result) => setContent(result.content))
      .catch((reason) => { if (reason?.name !== 'AbortError') setFileError('This file cannot be read.') })
    return () => controller.abort()
  }, [selectedId, selectedFile])

  const selected = repositories.find((repository) => repository.id === selectedId)
  const selectedGitHub = selected ? github[selected.id] : undefined

  return <section className="v3-repositories-workspace" aria-label="Repositories workspace">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><FolderGit2/></div>
      <div><span className="v3-kicker">REGISTERED SOURCE</span><h2>Repositories</h2><p>Browse enabled Git checkouts through bounded, read-only tools.</p></div>
    </div>

    {loading ? <p role="status" className="v3-repository-message">Loading registered repositories…</p>
      : error && !selected ? <p role="alert" className="v3-repository-message">{error}</p>
        : repositories.length === 0 ? <div className="v3-panel v3-repository-empty"><FolderGit2/><h3>No repositories are registered</h3><p>Add a repository by its GitHub URL in Settings, Repositories. A local checkout is optional and only needed to browse files.</p></div>
          : <div className="v3-repository-grid">
            <section className="v3-panel v3-repository-panel fx-repo-table" aria-label="Registered repositories">
              <div className="v3-section-head"><div><span className="v3-kicker">WORKSPACES</span><h2>{repositories.length} registered</h2></div><ShieldCheck size={16} aria-label="Read only"/></div>
              <table>
                <thead><tr><th scope="col">Repository</th><th scope="col">Default branch</th><th scope="col">Open PRs</th><th scope="col">CI status</th><th scope="col">Last commit</th><th scope="col">Access</th></tr></thead>
                <tbody>{repositories.map((repository) => <tr key={repository.id} className={repository.id === selectedId ? 'selected' : ''}>
                  <td><button
                    type="button"
                    aria-pressed={repository.id === selectedId}
                    onClick={() => setSelectedId(repository.id)}
                  ><FolderGit2 size={16}/><span><b>{repository.name}</b><small>{repository.remote || repository.id}</small></span></button></td>
                  <td><code>{repository.defaultBranch}</code></td>
                  <GitHubCells result={github[repository.id]}/>
                  <td><em>{repository.mode}</em></td>
                </tr>)}</tbody>
              </table>
            </section>

            <aside className="fx-repo-side" aria-label="Repository activity">
              {selectedGitHub?.state === 'ok' ? <PullRequestPanel summary={selectedGitHub.summary}/>
                : selectedGitHub?.state === 'unsupported' ? <p className="v3-panel v3-repository-message">{selected?.name} has no GitHub remote, so there are no pull requests or checks to show.</p>
                  : selectedGitHub?.state === 'unavailable' ? <p className="v3-panel v3-repository-message" role="status">GitHub could not be reached for {selected?.name}. Try again later.</p>
                    : <NotConnected title="Pull requests and CI" detail="Open PRs, check runs and recent PR activity need the GitHub read integration (FRIDAY_GITHUB_ENABLED) on the server." action="Connect GitHub" setup="GitHub pull requests, CI and last commit"/>}
              <NotConnected title="Repository configuration" detail="Sync strategy, auto-merge and required approvals are managed on GitHub, not in Friday." action="Edit configuration"/>
            </aside>

            {!selectedCheckout ? <section className="v3-panel v3-repository-panel" aria-label="Repository files">
              {selected && <div className="v3-repository-heading"><div><span className="v3-kicker">{selected.name.toUpperCase()}</span><h2>{selected.defaultBranch}</h2></div></div>}
              <p className="v3-repository-message">{selected?.name} is registered from GitHub only, so there is no local checkout to browse. Add a checkout path in Settings to read its files here.</p>
            </section>
            : <section className="v3-panel v3-repository-panel" aria-label="Repository files" aria-busy={!status && !error}>
              {selected && <div className="v3-repository-heading">
                <div><span className="v3-kicker">{selected.name.toUpperCase()}</span><h2>{selected.defaultBranch}</h2></div>
                {status && <span className={`v3-repository-state ${status.dirty ? 'dirty' : 'clean'}`}><GitBranch size={14}/>{status.branch}<small>{status.dirty ? 'Working tree has local changes' : 'Working tree clean'}</small></span>}
              </div>}
              {error && <p role="alert" className="v3-repository-message">{error}</p>}
              <div className="v3-repository-browser">
                  <div className="v3-repository-files" aria-label="Repository file list">
                    {files.map((path) => <button type="button" key={path} className={selectedFile === path ? 'selected' : ''} aria-pressed={selectedFile === path} onClick={() => setSelectedFile(path)}><FileCode2 size={14}/><span>{path}</span></button>)}
                    {files.length === 0 && <p className="v3-repository-message">{error ? 'File listing unavailable.' : 'No readable files found.'}</p>}
                  </div>
                  <div className="v3-repository-preview">
                    {selectedFile ? <><div className="v3-repository-file-name"><FileCode2 size={14}/><span>{selectedFile}</span></div>{fileError ? <p role="alert" className="v3-repository-message">{fileError}</p> : content === null ? <p role="status" className="v3-repository-message">Loading file…</p> : <pre tabIndex={0} aria-label={`${selectedFile} contents`}>{content}</pre>}</>
                      : <p className="v3-repository-message">Select a file to preview its text. Reads are limited to 64 KiB.</p>}
                  </div>
                </div>
            </section>}
          </div>}
  </section>
}
