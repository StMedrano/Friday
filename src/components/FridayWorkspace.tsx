import type { FormEventHandler } from 'react'
import type { FridaySession } from '../hooks/useFridaySession'
import FridayComposer from './FridayComposer'
import FridayConversation from './FridayConversation'

type FridayWorkspaceProps = {
  session: FridaySession
  query: string
  onQueryChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
}

export default function FridayWorkspace({ session, query, onQueryChange, onSubmit }: FridayWorkspaceProps) {
  return <section className="v3-friday-workspace">
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
        : <div className="v3-friday-empty"><span>SESSION READY</span><p>Ask FRIDAY about the current observed infrastructure state.</p></div>}
    </div>

    <FridayComposer
      value={query}
      loading={session.loading}
      placeholder="Ask FRIDAY anything…"
      onChange={onQueryChange}
      onSubmit={onSubmit}
    />
  </section>
}
