import type { FormEventHandler } from 'react'
import type { FridaySession } from '../hooks/useFridaySession'
import type { FridayIncident } from '../lib/api'
import type { Service } from '../lib/infrastructure'
import { statusLabel, statusPriority } from '../lib/status'
import FridayComposer from './FridayComposer'
import FridayConversation from './FridayConversation'

const suggestions = [
  'What needs attention right now?',
  'Summarize the health of each site.',
  'Which services changed status recently?',
  'Explain the open incidents.',
]

type FridayWorkspaceProps = {
  session: FridaySession
  query: string
  onQueryChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
  /** What Friday's normalized state shows right now; the rail is hidden without it. */
  context?: { live: boolean; incidents: FridayIncident[]; services: Service[] }
}

export default function FridayWorkspace({ session, query, onQueryChange, onSubmit, context }: FridayWorkspaceProps) {
  const chat = <section className="v3-friday-workspace">
    <div className="v3-friday-workspace-head">
      <div>
        <span className="v3-kicker">FRIDAY / SESSION</span>
        <h2>Current conversation</h2>
        <p>Advisory only · No actions executed</p>
      </div>
      <div className="v3-friday-session-tools">
        <span>Context: up to 10 recent exchanges</span>
        <button type="button" onClick={session.clearSession} disabled={session.loading}>Clear session</button>
      </div>
    </div>

    <div className="v3-friday-workspace-body">
      {session.messages.length > 0
        ? <FridayConversation messages={session.messages}/>
        : <div className="v3-friday-empty"><span>SESSION READY</span><p>Ask FRIDAY about the current observed infrastructure state.</p>
          <div className="v3-friday-suggestions">{suggestions.map((prompt) => <button key={prompt} type="button" disabled={session.loading} onClick={() => session.sendMessage(prompt)}>{prompt}</button>)}</div>
        </div>}
    </div>

    <FridayComposer
      value={query}
      loading={session.loading}
      placeholder="Ask FRIDAY anything…"
      onChange={onQueryChange}
      onSubmit={onSubmit}
    />
  </section>

  if (!context) return chat
  const open = context.incidents.filter((incident) => incident.status === 'open')
  const services = context.services.slice().sort((a, b) => statusPriority(b.status) - statusPriority(a.status))
  return <div className="fx-chat-layout">
    {chat}
    <aside className="fx-chat-context" aria-label="Active context">
      <div className="fx-chat-context-head"><h2>Active context</h2><span className={context.live ? 'live' : ''}>{context.live ? 'Live' : 'Sample'}</span></div>
      <section>
        <h3>Open incidents <b>{open.length}</b></h3>
        {open.length ? open.slice(0, 3).map((incident) => <article key={incident.id} className={`fx-chat-incident ${incident.severity}`}>
          <strong>{incident.serviceName || incident.title}</strong>
          <small>{incident.severity.toUpperCase()} · {incident.host || incident.source} · {incident.title}</small>
        </article>) : <p>No open incidents.</p>}
      </section>
      <section>
        <h3>Visible services <b>{services.length}</b></h3>
        <ul>{services.slice(0, 8).map((service) => <li key={service.id}><span>{service.name}<small>{service.host}</small></span><em className={service.status}>{statusLabel(service.status)}</em></li>)}</ul>
      </section>
      <section>
        <h3>Suggested questions</h3>
        <div className="fx-chat-actions">{suggestions.map((prompt) => <button key={prompt} type="button" disabled={session.loading} onClick={() => session.sendMessage(prompt)}>{prompt}</button>)}</div>
      </section>
    </aside>
  </div>
}
