import { useEffect, useState } from 'react'
import { AlertTriangle, Home, Menu, Server, Sparkles } from 'lucide-react'

type MobileNavigationProps = {
  active: string
  activeIncidents: number
  onNavigate: (destination: string) => void
}

const secondary = ['Applications', 'Agents', 'Tasks', 'Approvals', 'Memory', 'Audit', 'Settings']

export default function MobileNavigation({ active, activeIncidents, onNavigate }: MobileNavigationProps) {
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (!moreOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

  function navigate(destination: string) {
    setMoreOpen(false)
    onNavigate(destination)
  }

  const primary = [
    { destination: 'Overview', label: 'Home', icon: Home },
    { destination: 'FRIDAY', label: 'FRIDAY', icon: Sparkles },
    { destination: 'Infrastructure', label: 'Infrastructure', icon: Server },
    { destination: 'Incidents', label: 'Incidents', icon: AlertTriangle },
  ]

  return <>
    <nav className="v3-mobile-command-bar" aria-label="Mobile command bar">
      {primary.map(({ destination, label, icon: Icon }) => {
        const incidentLabel = destination === 'Incidents' && activeIncidents > 0 ? `Incidents, ${activeIncidents} active` : label
        return <button
          type="button"
          key={destination}
          className={`v3-mobile-nav-button ${active === destination ? 'active' : ''}`}
          aria-label={incidentLabel}
          aria-current={active === destination ? 'page' : undefined}
          onClick={() => navigate(destination)}
        >
          <span className="v3-mobile-nav-icon"><Icon size={18}/>{destination === 'Incidents' && activeIncidents > 0 && <em>{activeIncidents}</em>}</span>
          <span>{label}</span>
        </button>
      })}
      <button type="button" className={`v3-mobile-nav-button ${secondary.includes(active) ? 'active' : ''}`} aria-label="More" onClick={() => setMoreOpen(true)}>
        <span className="v3-mobile-nav-icon"><Menu size={18}/></span><span>More</span>
      </button>
    </nav>

    {moreOpen && <div className="v3-mobile-more-backdrop" onClick={() => setMoreOpen(false)}>
      <section className="v3-mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More FRIDAY views" onClick={(event) => event.stopPropagation()}>
        <div className="v3-mobile-more-handle" aria-hidden="true"/>
        <div className="v3-mobile-more-head"><span>MORE FRIDAY VIEWS</span><strong>Select a workspace</strong></div>
        <div className="v3-mobile-more-grid">{secondary.map((destination) => <button
          type="button"
          key={destination}
          aria-current={active === destination ? 'page' : undefined}
          onClick={() => navigate(destination)}
        >{destination}</button>)}</div>
      </section>
    </div>}
  </>
}
