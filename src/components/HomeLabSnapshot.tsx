import { useEffect, useState } from 'react'
import { fetchHomeLabEvidence, type HomeLabEvidence } from '../lib/api'

export default function HomeLabSnapshot() {
  const [evidence, setEvidence] = useState<HomeLabEvidence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(false); setEvidence(null)
    fetchHomeLabEvidence(controller.signal)
      .then(value => { if (!controller.signal.aborted) setEvidence(value) })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])
  const open = evidence?.incidents.filter(item => item.status === 'open') || []
  return <section className="v3-agent-detail v3-homelab-evidence" aria-label="HomeLab observations" aria-busy={loading}>
    <div className="v3-agent-detail-head">
      <div><span className="v3-kicker">READ-ONLY OBSERVATIONS</span><h3>Service and incident evidence</h3></div>
      <button type="button" className="v3-agent-primary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh observations</button>
    </div>
    {loading ? <p role="status">Loading HomeLab observations…</p> : error ? <p role="status">HomeLab observations unavailable</p> : evidence ? <>
      <p>{evidence.mode === 'mock' ? 'Demo data · not live' : 'Live observations'}</p>
      <p>{evidence.generatedAt ? 'Observed at ' + new Date(evidence.generatedAt).toLocaleString() : 'Observation timestamp unavailable'}</p>
      <div className="v3-group-evidence-list" role="region" tabIndex={0} aria-label="Observed services">
        {evidence.services.length ? evidence.services.map(service => <article key={service.id}>
          <div><strong>{service.name}</strong><small>{service.id} · {service.host}</small></div>
          <span className={'v3-agent-state ' + (service.status === 'online' ? 'configured' : 'unavailable')}>{service.status}</span>
          <p>{service.detail}</p>
        </article>) : <p>No services reported by this API response.</p>}
      </div>
      <h4>Open incidents</h4>
      {open.length ? open.map(incident => <article className="v3-group-incident" key={incident.id}>
        <strong>{incident.title}</strong><span>{incident.severity}</span><p>{incident.detail}</p>
      </article>) : <p>No open incidents reported by this API response.</p>}
      <p>Observation only. Restart and remediation require the separate approved action workflow.</p>
    </> : null}
  </section>
}
