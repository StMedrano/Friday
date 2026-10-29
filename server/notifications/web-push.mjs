import {createHash} from 'node:crypto'
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

// Browser push for the installed Friday PWA. Subscriptions are per device and
// stored server-side; the VAPID private key never reaches the browser. Payloads
// carry the same sanitised incident fields as the ntfy channel.
const BASE64URL = /^[A-Za-z0-9_-]{8,512}$/
const MAX_SUBSCRIPTIONS = 32
const MAX_PER_BATCH = 5
const GONE = new Set([404, 410])

// Endpoints are only ever browser push services, so the controller never POSTs
// to an arbitrary (possibly internal) host a signed-in user supplies.
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'])
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com']

const digest = endpoint => createHash('sha256').update(endpoint).digest('hex').slice(0, 32)
const knownPushService = url => !url.port && (PUSH_HOSTS.has(url.hostname) || PUSH_HOST_SUFFIXES.some(suffix => url.hostname.endsWith(suffix)))

/** Validate a browser PushSubscription; returns null when unusable. */
export function normalizeSubscription(input) {
  const endpoint = String(input?.endpoint || '')
  if (endpoint.length > 1024) return null
  let url
  try { url = new URL(endpoint) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || !knownPushService(url)) return null
  const p256dh = String(input?.keys?.p256dh || '')
  const auth = String(input?.keys?.auth || '')
  if (!BASE64URL.test(p256dh) || !BASE64URL.test(auth)) return null
  return {id: digest(endpoint), endpoint, keys: {p256dh, auth}}
}

export function vapidKeys(config = {}) {
  const publicKey = String(config.publicKey || '').trim()
  const privateKey = String(config.privateKey || '').trim()
  const subject = String(config.subject || '').trim()
  if (!BASE64URL.test(publicKey) || !BASE64URL.test(privateKey)) return null
  if (!/^(?:mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return null
  return {publicKey, privateKey, subject}
}

export async function createPushSubscriptionStore({path, fs = {mkdir, readFile, rename, writeFile}} = {}) {
  let current = []
  if (path) {
    try {
      const parsed = JSON.parse(await fs.readFile(path, 'utf8'))
      current = (Array.isArray(parsed) ? parsed : []).map(normalizeSubscription).filter(Boolean).slice(0, MAX_SUBSCRIPTIONS)
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('Friday push subscriptions could not be loaded; starting empty')
    }
  }

  // Memory changes only once the file is written, so a failed save can be retried.
  async function persist(next) {
    if (path) {
      await fs.mkdir(dirname(path), {recursive: true})
      const temporary = `${path}.tmp-${digest(String(Date.now()) + Math.random())}`
      await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {mode: 0o600})
      await fs.rename(temporary, path)
    }
    current = next
  }

  let queue = Promise.resolve()
  const serialize = work => {
    const run = queue.then(work)
    queue = run.catch(() => {})
    return run
  }

  return {
    list() { return current.map(subscription => ({...subscription, keys: {...subscription.keys}})) },
    has(id) { return current.some(subscription => subscription.id === id) },
    async add(input) {
      const subscription = normalizeSubscription(input)
      if (!subscription) throw Object.assign(new Error('invalid-subscription'), {code: 'invalid-subscription'})
      return serialize(async () => {
        await persist([...current.filter(item => item.id !== subscription.id), subscription].slice(-MAX_SUBSCRIPTIONS))
        return subscription
      })
    },
    remove(id) {
      return serialize(async () => {
        const next = current.filter(subscription => subscription.id !== id)
        if (next.length !== current.length) await persist(next)
      })
    },
  }
}

/** Load the optional web-push library; a missing library must never stop Friday from starting. */
async function loadWebPush() {
  try {
    const module = await import('web-push')
    return (module.default ?? module).sendNotification
  } catch {
    console.warn('Friday notifications: the web-push library is unavailable; browser push is disabled')
    return null
  }
}

export function createWebPushNotifier({keys, store, sendImpl = null, loadSendImpl = loadWebPush, timeoutMs = 5000} = {}) {
  const vapid = vapidKeys(keys)
  if (!vapid || !store) return null
  const options = {vapidDetails: vapid, TTL: 900, timeout: timeoutMs}
  let sender = sendImpl ? Promise.resolve(sendImpl) : null
  const send = () => (sender ??= loadSendImpl())

  async function deliver(subscription, payload) {
    try {
      const sendNotification = await send()
      if (typeof sendNotification !== 'function') return false
      await sendNotification({endpoint: subscription.endpoint, keys: subscription.keys}, JSON.stringify(payload), options)
      return true
    } catch (error) {
      // A browser that unsubscribed or expired is removed rather than retried.
      if (GONE.has(Number(error?.statusCode))) await store.remove(subscription.id).catch(() => {})
      return false
    }
  }

  async function broadcast(payload) {
    let sent = 0
    let failed = 0
    for (const subscription of store.list()) {
      if (await deliver(subscription, payload)) sent += 1
      else failed += 1
    }
    return {sent, failed}
  }

  return {
    publicKey: vapid.publicKey,
    async notify({opened = [], resolved = []} = {}) {
      const events = [
        ...opened.map(incident => ({kind: 'opened', title: `${incident.title || 'Incident'}`, body: incident.detail || '', severity: incident.severity || 'warning', service: incident.serviceName || '', host: incident.host || ''})),
        ...resolved.map(incident => ({kind: 'resolved', title: `Resolved: ${incident.serviceName || incident.title || 'Incident'}`, body: incident.title || '', severity: 'info', service: incident.serviceName || '', host: incident.host || ''})),
      ]
      if (!events.length) return {sent: 0, failed: 0}
      const batch = events.slice(0, MAX_PER_BATCH)
      if (events.length > MAX_PER_BATCH) {
        batch[MAX_PER_BATCH - 1] = {kind: 'summary', title: `${events.length - MAX_PER_BATCH + 1} more incident changes`, body: 'Open Friday to review all incident changes.', severity: 'warning', service: '', host: ''}
      }
      let sent = 0
      let failed = 0
      for (const event of batch) {
        const result = await broadcast(event)
        sent += result.sent
        failed += result.failed
      }
      if (failed) console.warn(`Friday notifications: ${failed} browser push deliveries failed`)
      return {sent, failed}
    },
    async test() {
      const result = await broadcast({kind: 'test', title: 'Friday test notification', body: 'Browser notifications from Friday are working.', severity: 'info', service: '', host: ''})
      if (!result.sent) throw new Error('no-subscription-reachable')
      return result
    },
  }
}
