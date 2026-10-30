import { useEffect, useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { fetchWorkIdentity, type FridayWorkIdentity } from '../lib/api'

export default function WorkIdentityPanel() {
  const [identity, setIdentity] = useState<FridayWorkIdentity | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchWorkIdentity(controller.signal)
      .then(setIdentity)
      .catch((reason) => { if (reason?.name !== 'AbortError') setFailed(true) })
    return () => controller.abort()
  }, [])

  if (failed) return <p role="status" className="v3-settings-message">Your work identity is unavailable.</p>
  if (!identity) return <p role="status" className="v3-settings-message">Loading your work identity…</p>

  return <div className="v3-settings-form">
    <p className="v3-settings-message">
      <Fingerprint size={14} aria-hidden="true"/> Work identity{' '}
      <code>{identity.subjectHash}</code>
    </p>
    <p className="v3-settings-message">
      {identity.granted
        ? 'This account can read its granted project tasks.'
        : 'No project access yet. An operator adds this identity to the work grant file on the controller.'}
    </p>
  </div>
}
