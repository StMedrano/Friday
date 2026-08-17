import { Bell, Command, Search, ShieldCheck } from 'lucide-react'

export default function Topbar() {
  return (
    <header className="topbar">
      <div className="global-search"><Search size={17} /><input aria-label="Search Friday" placeholder="Search infrastructure, services, commands…" /><kbd><Command size={12} /> K</kbd></div>
      <div className="topbar-actions"><div className="secure-pill"><ShieldCheck size={15} /> Private network</div><button className="icon-button notification-button" aria-label="Notifications" type="button"><Bell size={18} /><span className="notification-dot" /></button><div className="avatar" aria-label="Signed in operator">SM</div></div>
    </header>
  )
}
