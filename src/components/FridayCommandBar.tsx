import { ArrowUp, Mic, Sparkles } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { previewFridayCommand } from '../lib/api'

export default function FridayCommandBar() {
  const [command, setCommand] = useState('')
  const [message, setMessage] = useState('Preview mode · No infrastructure actions are executed')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = command.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const result = await previewFridayCommand(trimmed)
      setMessage(result.message)
      setCommand('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Command preview failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="friday-console" aria-label="Friday command console">
      <div className="console-orb"><Sparkles size={18} /></div>
      <form onSubmit={submit}>
        <input placeholder="Ask Friday to check both sites, inspect a service, or plan a change…" aria-label="Ask Friday" value={command} onChange={(event) => setCommand(event.target.value)} />
        <button type="button" className="console-action" aria-label="Voice input"><Mic size={17} /></button>
        <button type="submit" className="console-send" aria-label="Send command" disabled={busy}><ArrowUp size={17} /></button>
      </form>
      <div className="console-meta"><span><i className="status-dot online" /> Friday ready</span><span>{message}</span></div>
    </section>
  )
}
