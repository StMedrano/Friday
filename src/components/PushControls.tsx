import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { fetchWebPushStatus, subscribeWebPush, unsubscribeWebPush } from '../lib/api'

type State = 'loading' | 'unsupported' | 'unavailable' | 'off' | 'on' | 'busy'

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function serializeSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  return { endpoint: json.endpoint ?? subscription.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } }
}

export default function PushControls() {
  const [state, setState] = useState<State>('loading')
  const [publicKey, setPublicKey] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext
    if (!supported) { setState('unsupported'); return }
    fetchWebPushStatus(controller.signal)
      .then(async (status) => {
        if (!status.enabled || !status.publicKey) { setState('unavailable'); return }
        setPublicKey(status.publicKey)
        const registration = await navigator.serviceWorker.getRegistration()
        const existing = await registration?.pushManager.getSubscription()
        if (!existing) { setState('off'); return }
        // The browser can hold a subscription Friday never stored (a failed save, a lost
        // subscriptions file), so register it again before reporting this device as on.
        try { await subscribeWebPush(serializeSubscription(existing)); setState('on') }
        catch { setState('off') }
      })
      .catch((reason) => { if (reason?.name !== 'AbortError') setState('unavailable') })
    return () => controller.abort()
  }, [])

  const enable = async () => {
    setState('busy')
    setMessage('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setMessage('Your browser blocked notifications for Friday. Allow them in site settings, then try again.')
        setState('off')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })
      try { await subscribeWebPush(serializeSubscription(subscription)) }
      catch (error) {
        // Do not leave a browser subscription Friday will never send to.
        await subscription.unsubscribe().catch(() => false)
        throw error
      }
      setMessage('This device will receive Friday incident notifications.')
      setState('on')
    } catch {
      setMessage('This device could not be subscribed. On iPhone, add Friday to the Home Screen first.')
      setState('off')
    }
  }

  const disable = async () => {
    setState('busy')
    setMessage('')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await unsubscribeWebPush(serializeSubscription(subscription)).catch(() => {})
        await subscription.unsubscribe()
      }
      setMessage('This device will no longer receive Friday notifications.')
      setState('off')
    } catch {
      setMessage('This device could not be unsubscribed.')
      setState('on')
    }
  }

  if (state === 'loading') return <p role="status" className="v3-settings-message">Checking notifications…</p>
  if (state === 'unsupported') return <p role="status" className="v3-settings-message">This browser cannot receive Friday notifications.</p>
  if (state === 'unavailable') return <p role="status" className="v3-settings-message">Browser notifications are not configured on this controller.</p>

  return <div className="v3-settings-form">
    {state === 'on'
      ? <button type="button" onClick={disable}><BellOff size={14} aria-hidden="true"/>Turn off notifications on this device</button>
      : <button type="button" onClick={enable} disabled={state === 'busy'}><Bell size={14} aria-hidden="true"/>{state === 'busy' ? 'Working…' : 'Notify this device'}</button>}
    {message && <p role="status" className="v3-settings-message">{message}</p>}
  </div>
}
