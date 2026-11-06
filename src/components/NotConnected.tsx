import { Plug } from 'lucide-react'

/**
 * A designed control for a capability the Friday backend does not provide yet.
 * It is always inert and says so in text, so the layout can match the design
 * without implying that anything ran or that the numbers are real.
 */
export default function NotConnected({ title, detail, action }: { title: string; detail?: string; action?: string }) {
  return <div className="fx-not-connected" role="note" aria-label={`${title}: not connected`}>
    <span className="fx-not-connected-icon" aria-hidden="true"><Plug size={15}/></span>
    <span className="fx-not-connected-body"><b>{title}</b>{detail && <small>{detail}</small>}</span>
    {action ? <button type="button" disabled title="Not connected">{action}</button> : <em>Not connected</em>}
  </div>
}
