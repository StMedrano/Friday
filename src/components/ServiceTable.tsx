import { ArrowUpRight, Boxes } from 'lucide-react'
import type { Service } from '../lib/infrastructure'
import StatusBadge from './StatusBadge'

type Props = { services: Service[] }

export default function ServiceTable({ services }: Props) {
  return (
    <article className="panel service-panel">
      <div className="panel-header service-header"><div><span className="eyebrow">Live inventory</span><h3>Infrastructure services</h3></div><button type="button" className="text-button">View all <ArrowUpRight size={14} /></button></div>
      <div className="service-table" role="table" aria-label="Infrastructure services">
        <div className="service-row service-table-head" role="row"><span>Service</span><span>Location</span><span>Status</span><span>Updated</span></div>
        {services.map((service) => <div className="service-row" role="row" key={service.id}><div className="service-name-cell"><div className="service-icon"><Boxes size={16} /></div><div><strong>{service.name}</strong><small>{service.detail}</small></div></div><span className="service-location">{service.site}</span><StatusBadge status={service.status} compact /><span className="service-updated">{service.updated}</span></div>)}
      </div>
    </article>
  )
}
