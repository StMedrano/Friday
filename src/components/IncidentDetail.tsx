import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, FileSearch, ShieldCheck } from 'lucide-react'
import {
  fetchIncidentDiagnostics,
  fetchIncidentLogs,
  type DiagnosticLogsResponse,
  type DiagnosticReport,
  type FridayIncident,
} from '../lib/api'

function displayTime(value: string | null | undefined) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function IncidentDetail({ incident, onBack }: { incident: FridayIncident; onBack?: () => void }) {
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null)
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null)
  const [logs, setLogs] = useState<DiagnosticLogsResponse | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setDiagnostic(null)
    setDiagnosticError(null)
    setLogs(null)
    setLogsError(null)
    setLogsLoading(false)

    fetchIncidentDiagnostics(incident.id, controller.signal)
      .then(setDiagnostic)
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setDiagnosticError('Diagnostics are unavailable. No infrastructure action was attempted.')
        }
      })

    return () => controller.abort()
  }, [incident.id])

  async function inspectLogs() {
    const controller = new AbortController()
    setLogsLoading(true)
    setLogsError(null)
    try {
      setLogs(await fetchIncidentLogs(incident.id, controller.signal))
    } catch {
      setLogsError('Diagnostic logs are unavailable. No infrastructure action was attempted.')
    } finally {
      setLogsLoading(false)
    }
  }

  const facts = diagnostic?.facts ?? []
  const findings = diagnostic?.findings ?? []
  const likelyCauses = diagnostic?.likelyCauses ?? []
  const recommendations = diagnostic?.recommendations ?? []
  const notSupported = diagnostic?.status === 'not-supported'
  const canInspectLogs = !diagnosticError && !notSupported && diagnostic?.logsAvailable === true

  return <section className="v3-diagnostic-detail" aria-label={`Diagnosis for ${incident.serviceName || incident.title}`}>
    <div className="v3-diagnostic-head">
      {onBack && <button className="v3-readonly-action v3-diagnostic-back" onClick={onBack}><ArrowLeft size={15}/> Back to incidents</button>}
      <div className="v3-diagnostic-title">
        <AlertTriangle size={19}/>
        <div><span className="v3-kicker">INCIDENT DIAGNOSIS / READ ONLY</span><h2>Diagnosis · {incident.serviceName || incident.title}</h2></div>
        <span className={`v3-severity ${incident.severity}`}>{incident.severity.toUpperCase()}</span>
      </div>
      <div className="v3-diagnostic-context"><span>{incident.host || incident.source}</span><span>{incident.type.replaceAll('-', ' ')}</span><span>First seen {displayTime(incident.firstSeen)}</span></div>
    </div>

    {!diagnostic && !diagnosticError && <div className="v3-diagnostic-state"><FileSearch size={17}/><span>Collecting approved read-only diagnostic metadata…</span></div>}
    {diagnosticError && <div className="v3-diagnostic-state error"><AlertTriangle size={17}/><span>{diagnosticError}</span></div>}
    {notSupported && <div className="v3-diagnostic-state"><ShieldCheck size={17}/><span>Diagnostics not supported for this incident type. No infrastructure action was attempted.</span></div>}

    {diagnostic && !notSupported && <>
      <section className="v3-diagnostic-section">
        <div className="v3-section-head"><div><span className="v3-kicker">OBSERVED</span><h3>Facts</h3></div><span>{facts.length} facts</span></div>
        {facts.length === 0 ? <p className="v3-diagnostic-empty">No additional metadata facts were available.</p> : <div className="v3-diagnostic-grid">{facts.map((fact) => <article className="v3-diagnostic-fact" key={fact.id}><span>{fact.label}</span><strong>{fact.value}</strong></article>)}</div>}
      </section>

      <section className="v3-diagnostic-section">
        <div className="v3-section-head"><div><span className="v3-kicker">DETERMINISTIC ANALYSIS</span><h3>FRIDAY Findings</h3></div></div>
        {findings.length === 0 ? <p className="v3-diagnostic-empty">No deterministic finding was produced from the available metadata.</p> : <ul className="v3-diagnostic-list">{findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}
      </section>

      {likelyCauses.length > 0 && <section className="v3-diagnostic-section">
        <div className="v3-section-head"><div><span className="v3-kicker">INFERENCE</span><h3>Likely Causes</h3></div></div>
        <ul className="v3-diagnostic-list">{likelyCauses.map((cause) => <li key={cause}>{cause}</li>)}</ul>
      </section>}

      <section className="v3-diagnostic-section">
        <div className="v3-section-head"><div><span className="v3-kicker">NEXT STEP / ADVISORY</span><h3>Recommendations</h3></div></div>
        {recommendations.length === 0 ? <p className="v3-diagnostic-empty">No additional recommendation is available.</p> : <ul className="v3-diagnostic-list">{recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}</ul>}
      </section>
    </>}

    {canInspectLogs && <section className="v3-diagnostic-section v3-diagnostic-log-section">
      <div className="v3-section-head"><div><span className="v3-kicker">EXPLICIT INSPECTION</span><h3>Sanitized Logs</h3></div><span>Not persisted</span></div>
      <button className="v3-readonly-action" disabled={logsLoading} onClick={inspectLogs}>{logsLoading ? 'Inspecting Logs…' : 'Inspect Logs · Read Only'}</button>
      {logsError && <p className="v3-diagnostic-error">{logsError}</p>}
      {logs && <>
        {logs.truncated && <p className="v3-diagnostic-truncated">Log output was truncated at the approved safety boundary.</p>}
        <pre className="v3-diagnostic-logs" style={{ whiteSpace: 'pre', overflowX: 'auto' }}>{logs.logs}</pre>
      </>}
    </section>}

    <div className="v3-diagnostic-authority"><ShieldCheck size={14}/><strong>READ ONLY · NO REMEDIATION EXECUTED</strong><span>Any infrastructure-changing action requires a separate approved workflow.</span></div>
  </section>
}
