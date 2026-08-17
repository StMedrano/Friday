import { Activity, Bot, Boxes, Container, Gauge, GitBranch, Network, ScrollText, Server, Settings, Sparkles, Workflow } from 'lucide-react'

const nav = [
  { label: 'Dashboard', icon: Gauge, active: true },
  { label: 'Sites', icon: GitBranch },
  { label: 'Network', icon: Network },
  { label: 'Proxmox', icon: Server },
  { label: 'Docker', icon: Container },
  { label: 'Services', icon: Boxes },
  { label: 'Automations', icon: Workflow },
  { label: 'Agents', icon: Bot },
  { label: 'Logs', icon: ScrollText }
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={18} /></div><div><strong>FRIDAY</strong><span>Control Plane</span></div></div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        <p className="nav-label">Workspace</p>
        {nav.map((item) => { const Icon = item.icon; return <button key={item.label} className={`nav-item ${item.active ? 'active' : ''}`} type="button"><Icon size={18} /><span>{item.label}</span>{item.label === 'Agents' && <span className="nav-pill">Soon</span>}</button> })}
      </nav>
      <div className="sidebar-bottom">
        <div className="system-chip"><div className="system-chip-icon"><Activity size={15} /></div><div><strong>Control plane</strong><span><i className="status-dot online" /> Operational</span></div></div>
        <button className="nav-item" type="button"><Settings size={18} /><span>Settings</span></button>
      </div>
    </aside>
  )
}
