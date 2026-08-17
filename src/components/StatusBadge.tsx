import { Circle } from 'lucide-react'
import type { InfrastructureStatus } from '../lib/infrastructure'
import { statusLabel } from '../lib/status'

type Props = { status: InfrastructureStatus; compact?: boolean }

export default function StatusBadge({ status, compact = false }: Props) {
  return (
    <span className={`status-badge status-${status} ${compact ? 'status-compact' : ''}`}>
      <Circle aria-hidden="true" size={8} fill="currentColor" strokeWidth={0} />
      {statusLabel(status)}
    </span>
  )
}
