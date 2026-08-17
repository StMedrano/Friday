import { ArrowUpRight, Cable, Gauge, Router, Wifi } from 'lucide-react'
import type { Site } from '../lib/infrastructure'
import StatusBadge from './StatusBadge'

type Props = { site: Site }

export default function SiteCard({ site }: Props) {
  return (
    <article className="site-card">
      <div className="site-card-head"><div><div className="eyebrow">{site.location}</div><h3>{site.name}</h3></div><StatusBadge status={site.status} compact /></div>
      <div className="site-network"><div className="network-glyph"><Router size={20} /></div><div className="network-line"><span /><span /><span /></div><div className="network-glyph secondary"><Wifi size={20} /></div></div>
      <div className="site-stats">
        <div><span><Cable size={14} /> VPN</span><strong>{site.vpn === 'online' ? 'Connected' : 'Attention'}</strong></div>
        <div><span><Gauge size={14} /> Latency</span><strong>{site.latencyMs} ms</strong></div>
        <div><span>Devices</span><strong>{site.devicesOnline}/{site.devicesTotal}</strong></div>
      </div>
      <div className="site-footer"><div><span>{site.gateway}</span><small>{site.network}</small></div><button type="button" className="text-button">Open site <ArrowUpRight size={14} /></button></div>
    </article>
  )
}
