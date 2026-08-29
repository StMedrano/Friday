import { useEffect, useState } from 'react'
import { GitBranch, Network, ShieldCheck } from 'lucide-react'
import { fetchFridayRepositories, type FridayRepositorySummary } from '../lib/api'

export default function RepositoriesWorkspace() {
  const [repositories, setRepositories] = useState<FridayRepositorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchFridayRepositories(controller.signal)
      .then(setRepositories)
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') setError('Repository inventory unavailable')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  return <section className="v3-detail">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><GitBranch/></div>
      <div><span className="v3-kicker">FRIDAY CONTROL PLANE</span><h2>Repositories</h2><p>Explicitly registered Git roots that Friday agents may inspect under repository policy.</p></div>
    </div>
    <div className="v3-detail-grid">
      <article><GitBranch/><strong>{repositories.length}</strong><span>Registered repositories</span></article>
      <article><ShieldCheck/><strong>{repositories.filter((repository) => repository.enabled).length}</strong><span>Enabled for agents</span></article>
      <article><Network/><strong>{repositories.filter((repository) => repository.remote).length}</strong><span>Remote-backed</span></article>
    </div>
    <div className="v3-panel v3-list">
      <div className="v3-section-head"><div><span className="v3-kicker">REPOSITORY REGISTRY</span><h2>Approved codebases</h2></div></div>
      {loading && <div className="v3-list-row"><span><b>Loading repositories…</b><small>Reading Friday's local repository registry</small></span></div>}
      {error && <div className="v3-list-row"><span><b>{error}</b><small>No filesystem paths were exposed.</small></span></div>}
      {!loading && !error && repositories.length === 0 && <div className="v3-list-row"><span><b>No repositories registered</b><small>Add approved roots to the server-side repository registry.</small></span></div>}
      {repositories.map((repository) => <article className="v3-agent-card" key={repository.id}>
        <div className="v3-agent-card-head">
          <div className="v3-node-icon"><GitBranch/></div>
          <div><span className="v3-kicker">{repository.id}</span><h3>{repository.name}</h3><p>{repository.remote || 'Local Git repository'}</p></div>
          <div className={`v3-status ${repository.enabled ? 'online' : 'offline'}`}><i/>{repository.enabled ? 'AVAILABLE' : 'DISABLED'}</div>
        </div>
        <div className="v3-agent-groups">
          <div><b>Branch</b><div className="v3-agent-badges"><span>{repository.defaultBranch}</span></div></div>
          <div><b>Access mode</b><div className="v3-agent-badges"><span>{repository.mode}</span></div></div>
        </div>
      </article>)}
    </div>
  </section>
}
