import { useEffect, useState } from 'react'
import { UserCheck } from 'lucide-react'
import { fetchMyAccess, type FridayMyAccess, type FridaySettings } from '../lib/api'

type Provider = FridaySettings['access']['operatorProvider']

/** The signed-in person's own access, and whether operator sign-in must use Authentik. */
export default function MyAccessPanel({ provider }: { provider?: Provider }) {
  const [access, setAccess] = useState<FridayMyAccess | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetchMyAccess(controller.signal).then(setAccess).catch((reason) => { if (reason?.name !== 'AbortError') setFailed(true) })
    return () => controller.abort()
  }, [])

  const rule = !provider ? 'Operators may sign in with any Access login method.'
    : provider.state === 'invalid' ? 'Operator sign-in rule is misconfigured, so every operator action is denied. Set both FRIDAY_ACCESS_OPERATOR_IDP_CLAIM and FRIDAY_ACCESS_OPERATOR_IDP_VALUE.'
      : `Operators must sign in with ${provider.value} (signed claim ${provider.claim}).`
  return <div className="v3-settings-form" aria-label="Your access">
    <p className="v3-settings-message"><UserCheck size={14} aria-hidden="true"/> {rule}</p>
    {failed ? <p role="status" className="v3-settings-message">Your access could not be checked.</p>
      : !access ? <p role="status" className="v3-settings-message">Checking your access…</p>
        : !access.signedIn ? <p className="v3-settings-message">Not signed in through Cloudflare Access (mock mode).</p>
          : <p className="v3-settings-message">
            Signed in as {access.email || 'an account without an email'}: {access.operator ? 'operator' : 'viewer'}.
            {access.providerVerified === false && ' This sign-in did not come through the required provider, so operator actions are off for it.'}
            {access.providerVerified === true && provider?.state === 'required' && ` Verified through ${provider.value}.`}
          </p>}
  </div>
}
