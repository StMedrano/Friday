import { useEffect, useRef, useState } from 'react'
import { askFridayGroup, type GroupAdvice } from '../lib/api'
import AssistantReply from './AssistantReply'

const examples: Record<string, string> = {
  techtactics: 'Draft a website audit checklist and an outreach proposal. Keep all customer communication as a draft.',
  'app-builder': 'Plan a small booking app: clarify requirements, propose architecture, outline implementation and define QA acceptance checks.',
  homelab: 'Summarize the current observed service issues and propose read-only diagnostic steps. Do not perform any actions.',
}

export default function GroupAdvisory({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GroupAdvice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => { pending.current?.abort() }, [])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!prompt.trim() || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setLoading(true); setError(null); setResult(null)
    try {
      const reply = await askFridayGroup(groupId, prompt.trim(), controller.signal)
      if (!controller.signal.aborted) setResult(reply)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Group advice unavailable.')
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setLoading(false) }
    }
  }
  return <section className="v3-agent-detail v3-group-advisory" aria-label={groupName + ' Friday advisory'}>
    <span className="v3-kicker">FRIDAY ADVISORY</span>
    <h3>Work through a task with {groupName}</h3>
    <p>Friday can propose a plan or draft from your brief. This is not a running specialist and does not execute work.</p>
    <p className="v3-group-privacy">Use non-sensitive task context. Existing AI provider settings apply; private records are not included in proposals and shared memory is not connected.</p>
    <form className="v3-agent-ask" onSubmit={submit}>
      <label htmlFor="v3-group-brief">Describe the task</label>
      <textarea id="v3-group-brief" value={prompt} onChange={event => setPrompt(event.target.value)}
        maxLength={4000} disabled={loading} placeholder={examples[groupId] || 'Describe a task for Friday to advise on.'}/>
      <div className="v3-agent-ask-foot">
        <button type="button" className="v3-agent-primary" disabled={loading} onClick={() => setPrompt(examples[groupId] || '')}>Use example</button>
        <button type="submit" className="v3-agent-primary" disabled={loading || !prompt.trim()}>{loading ? 'Generating…' : 'Generate proposal'}</button>
      </div>
    </form>
    {(loading || result || error) ? <AssistantReply state={{
      loading, error, text: result?.text || '', mode: result?.mode, provider: result?.provider,
      model: result?.model, fallbackUsed: result?.fallbackUsed, attempts: result?.attempts,
    }}/> : null}
    {result ? <p>Proposal only · No actions executed · Not saved to shared work</p> : null}
  </section>
}
