import { useEffect, useRef, useState } from 'react'
import { askFridayGroup, type FridayGroupAdvice } from '../lib/api'
import AssistantReply from './AssistantReply'

const EXAMPLES: Record<string, string> = {
  techtactics: 'Draft a website audit checklist and an outreach proposal. Keep every customer message a draft.',
  'app-builder': 'Plan a small booking app: clarify requirements, propose an architecture, outline the work and define acceptance checks.',
  homelab: 'Summarize the current service issues and propose read-only diagnostic steps. Perform no actions.',
}

export default function GroupAdvisory({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [advice, setAdvice] = useState<FridayGroupAdvice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [useProject, setUseProject] = useState(false)
  const pending = useRef<AbortController | null>(null)

  useEffect(() => () => pending.current?.abort(), [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!prompt.trim() || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setError(null)
    setAdvice(null)
    try {
      const reply = await askFridayGroup(groupId, prompt.trim(), controller.signal, groupId === 'techtactics' && useProject)
      if (!controller.signal.aborted) setAdvice(reply)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Group advice is unavailable.')
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setLoading(false) }
    }
  }

  return <section className="v3-panel v3-group-advisory" aria-label={`${groupName} advisory`}>
    <div className="v3-section-head"><div><span className="v3-kicker">FRIDAY ADVISORY</span><h3>Plan a task with {groupName}</h3></div></div>
    <p className="v3-settings-message">Friday drafts a plan from your brief. It is not a running specialist, and nothing here is executed or saved.</p>
    <form className="v3-settings-form" onSubmit={submit}>
      <label htmlFor={`brief-${groupId}`}>Describe the task
        <textarea id={`brief-${groupId}`} value={prompt} maxLength={4000} disabled={loading}
          placeholder={EXAMPLES[groupId] || 'Describe a task for Friday to advise on.'}
          onChange={(event) => setPrompt(event.target.value)}/>
      </label>
      {groupId === 'techtactics' && <>
        <label className="v3-project-context-toggle"><input type="checkbox" checked={useProject} disabled={loading} onChange={event => setUseProject(event.target.checked)}/>Use my Web Growth project and pipeline</label>
        <p className="v3-settings-message">Uses project goals and current lead statuses to answer questions and plan work. Project access is required. Selected lead details are shared with Friday’s configured AI provider; contact details, notes and messages stay private.</p>
      </>}
      <button type="button" disabled={loading} onClick={() => setPrompt(EXAMPLES[groupId] || '')}>Use example</button>
      <button type="submit" disabled={loading || !prompt.trim()}>{loading ? 'Generating…' : 'Generate proposal'}</button>
    </form>
    {(loading || advice || error) && <AssistantReply state={{
      loading, error, text: advice?.text || '', mode: advice?.mode, provider: advice?.provider,
      model: advice?.model, fallbackUsed: advice?.fallbackUsed, attempts: advice?.attempts,
    }}/>}
    {advice && <p className="v3-settings-message">Proposal only · nothing was executed · not saved to Friday</p>}
    {advice?.projectContext && <p className="v3-settings-message">Web Growth project · {advice.projectContext.includedLeads} of {advice.projectContext.totalLeads} lead records included; stage counts cover all leads. Read at {new Date(advice.projectContext.generatedAt).toLocaleString()} · source {advice.projectContext.sourceRevision}.</p>}
  </section>
}
