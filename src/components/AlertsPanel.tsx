import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import type { AlertItem } from '../lib/infrastructure'

type Props = { items: AlertItem[] }

export default function AlertsPanel({ items }: Props) {
  return (
    <article className="panel alerts-panel">
      <div className="panel-header"><div><span className="eyebrow">Needs attention</span><h3>Alerts</h3></div><span className="count-pill">{items.length}</span></div>
      <div className="alert-list">{items.map((item) => { const Icon = item.severity === 'critical' ? ShieldAlert : item.severity === 'warning' ? AlertTriangle : Info; return <div className={`alert-item alert-${item.severity}`} key={item.id}><div className="alert-icon"><Icon size={17} /></div><div><strong>{item.title}</strong><span>{item.detail}</span><small>{item.source}</small></div></div> })}</div>
    </article>
  )
}
