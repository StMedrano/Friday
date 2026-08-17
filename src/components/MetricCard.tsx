import type { LucideIcon } from 'lucide-react'

type Props = { label: string; value: string; helper: string; icon: LucideIcon; accent?: 'default' | 'warning' }

export default function MetricCard({ label, value, helper, icon: Icon, accent = 'default' }: Props) {
  return (
    <article className={`metric-card metric-${accent}`}>
      <div className="metric-icon"><Icon size={18} /></div>
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{helper}</small></div>
    </article>
  )
}
