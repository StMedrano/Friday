import { Activity, Clock3 } from 'lucide-react'
import type { ActivityItem } from '../lib/infrastructure'

type Props = { items: ActivityItem[] }

export default function ActivityFeed({ items }: Props) {
  return (
    <article className="panel activity-panel">
      <div className="panel-header"><div><span className="eyebrow">Friday</span><h3>Recent activity</h3></div><div className="panel-icon"><Activity size={17} /></div></div>
      <div className="activity-list">{items.map((item) => <div className="activity-item" key={item.id}><div className={`activity-status status-${item.status}`}><span /></div><div className="activity-copy"><strong>{item.title}</strong><span>{item.detail}</span><small><Clock3 size={12} /> {item.time}</small></div></div>)}</div>
    </article>
  )
}
