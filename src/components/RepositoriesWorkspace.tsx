import { useEffect, useState } from 'react'
import { FileCode2, FolderGit2, GitBranch, ShieldCheck } from 'lucide-react'
import {
  fetchFridayRepositories,
  fetchFridayRepositoryFile,
  fetchFridayRepositoryFiles,
  fetchFridayRepositoryStatus,
  type FridayRepository,
  type FridayRepositoryStatus,
} from '../lib/api'

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
    if (!selectedId) return
    const controller = new AbortController()
    setStatus(null)
    setFiles([])
    setSelectedFile('')
    setContent(null)
    setFileError('')
    setError('')
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
  }, [selectedId])

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

  return <section className="v3-repositories-workspace" aria-label="Repositories workspace">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><FolderGit2/></div>
      <div><span className="v3-kicker">REGISTERED SOURCE</span><h2>Repositories</h2><p>Browse enabled Git checkouts through bounded, read-only tools.</p></div>
    </div>

    {loading ? <p role="status" className="v3-repository-message">Loading registered repositories…</p>
      : error && !selected ? <p role="alert" className="v3-repository-message">{error}</p>
        : repositories.length === 0 ? <div className="v3-panel v3-repository-empty"><FolderGit2/><h3>No repositories are registered</h3><p>Enable a checkout in the server-side repository registry to browse it here.</p></div>
          : <div className="v3-repository-grid">
            <section className="v3-panel v3-repository-panel" aria-label="Registered repositories">
              <div className="v3-section-head"><div><span className="v3-kicker">WORKSPACES</span><h2>{repositories.length} registered</h2></div><ShieldCheck size={16} aria-label="Read only"/></div>
              <div className="v3-repository-picker">
                {repositories.map((repository) => <button
                  type="button"
                  key={repository.id}
                  className={repository.id === selectedId ? 'selected' : ''}
                  aria-pressed={repository.id === selectedId}
                  onClick={() => setSelectedId(repository.id)}
                ><FolderGit2 size={16}/><span><b>{repository.name}</b><small>{repository.remote || repository.id}</small></span><em>{repository.mode}</em></button>)}
              </div>
            </section>

            <section className="v3-panel v3-repository-panel" aria-label="Repository files" aria-busy={!status && !error}>
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
            </section>
          </div>}
  </section>
}
