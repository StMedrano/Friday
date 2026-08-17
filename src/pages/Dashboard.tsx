import { AlertTriangle, Boxes, GitBranch, Server } from 'lucide-react'
import ActivityFeed from '../components/ActivityFeed'
import AlertsPanel from '../components/AlertsPanel'
import FridayCommandBar from '../components/FridayCommandBar'
import MetricCard from '../components/MetricCard'
import ResourcePanel from '../components/ResourcePanel'
import ServiceTable from '../components/ServiceTable'
import Sidebar from '../components/Sidebar'
import SiteCard from '../components/SiteCard'
import Topbar from '../components/Topbar'
import { activities, alerts, resources, services, sites } from '../data/mock'

export default function Dashboard() {
  const onlineServices = services.filter((service) => service.status === 'online').length

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-content-shell">
        <Topbar />
        <main className="dashboard">
          <section className="hero-row">
            <div><div className="hero-kicker"><span className="live-pulse" /> Two-site fabric connected</div><h1>Infrastructure Overview</h1><p>Unified visibility across your homelab, network, services, and automation plane.</p></div>
            <div className="hero-actions"><button className="secondary-button" type="button">Run health check</button><button className="primary-button" type="button">Ask Friday</button></div>
          </section>

          <section className="metrics-grid" aria-label="Infrastructure summary">
            <MetricCard label="Sites" value="2" helper="Both connected" icon={GitBranch} />
            <MetricCard label="Virtual machines" value="8" helper="7 running · 1 idle" icon={Server} />
            <MetricCard label="Services" value={`${onlineServices}/${services.length}`} helper="Core services healthy" icon={Boxes} />
            <MetricCard label="Active alerts" value={`${alerts.length}`} helper="No critical alerts" icon={AlertTriangle} accent="warning" />
          </section>

          <section className="section-block"><div className="section-heading"><div><span className="eyebrow">Network fabric</span><h2>Sites</h2></div><span className="section-note">Last synchronized moments ago</span></div><div className="sites-grid">{sites.map((site) => <SiteCard site={site} key={site.id} />)}</div></section>
          <section className="content-grid"><div className="content-main"><ServiceTable services={services} /></div><div className="content-side"><ResourcePanel resources={resources} /></div></section>
          <section className="content-grid lower-grid"><div className="content-main"><ActivityFeed items={activities} /></div><div className="content-side"><AlertsPanel items={alerts} /></div></section>
          <FridayCommandBar />
        </main>
      </div>
    </div>
  )
}
