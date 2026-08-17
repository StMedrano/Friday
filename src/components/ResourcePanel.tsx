import { Cpu } from 'lucide-react'
import type { ResourceMetric } from '../lib/infrastructure'

type Props = { resources: ResourceMetric[] }

export default function ResourcePanel({ resources }: Props) {
  return (
    <article className="panel resource-panel">
      <div className="panel-header"><div><span className="eyebrow">VM 100</span><h3>Resource utilization</h3></div><div className="panel-icon"><Cpu size={17} /></div></div>
      <div className="resource-list">{resources.map((resource) => <div className="resource-row" key={resource.label}><div className="resource-meta"><span>{resource.label}</span><strong>{resource.value}%</strong></div><div className="progress-track" aria-label={`${resource.label} ${resource.value}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={resource.value}><span style={{ width: `${resource.value}%` }} /></div><small>{resource.helper}</small></div>)}</div>
    </article>
  )
}
