import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PushControls, { serializeSubscription } from './PushControls'

afterEach(() => vi.unstubAllGlobals())

const key = 'BJ1Ap-Example_PublicKeyValue0123456789abcdefghijklmnopqrstuvwxyzAB'
const subscription = {
  endpoint: 'https://push.example.test/abc',
  toJSON: () => ({ endpoint: 'https://push.example.test/abc', keys: { p256dh: 'BKp256dhValue_0123456789abcdefghij', auth: 'AuthValue_01234567' } }),
  unsubscribe: vi.fn(async () => true),
}

function stubBrowser({ existing = null, granted = true } = {}) {
  const pushManager = { getSubscription: vi.fn(async () => existing), subscribe: vi.fn(async () => subscription) }
  const registration = { pushManager }
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration), getRegistration: async () => registration } })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('PushManager', function PushManagerStub() {})
  vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => granted ? 'granted' : 'denied') })
  return pushManager
}

describe('PushControls', () => {
  it('subscribes this device and posts the subscription to Friday', async () => {
    const pushManager = stubBrowser()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Response(JSON.stringify({ subscribed: true }), { status: 200 })
      : new Response(JSON.stringify({ enabled: true, publicKey: key }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PushControls />)

    fireEvent.click(await screen.findByRole('button', { name: /Notify this device/ }))
    expect(await screen.findByText(/will receive Friday incident notifications/)).toBeInTheDocument()
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/notifications/web-push')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual(serializeSubscription(subscription as unknown as PushSubscription))
  })

  it('re-registers an existing browser subscription before showing notifications as on', async () => {
    stubBrowser({ existing: subscription as never })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Response(JSON.stringify({ subscribed: true }), { status: 200 })
      : new Response(JSON.stringify({ enabled: true, publicKey: key }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PushControls />)
    expect(await screen.findByRole('button', { name: /Turn off notifications/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true)
  })

  it('shows notifications as off when an existing subscription cannot be registered', async () => {
    stubBrowser({ existing: subscription as never })
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'web-push-unavailable' }), { status: 503 })
      : new Response(JSON.stringify({ enabled: true, publicKey: key }), { status: 200 })))
    render(<PushControls />)
    expect(await screen.findByRole('button', { name: /Notify this device/ })).toBeInTheDocument()
  })

  it('rolls back the browser subscription when Friday cannot store it', async () => {
    subscription.unsubscribe.mockClear()
    stubBrowser()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'web-push-unavailable' }), { status: 503 })
      : new Response(JSON.stringify({ enabled: true, publicKey: key }), { status: 200 })))
    render(<PushControls />)
    fireEvent.click(await screen.findByRole('button', { name: /Notify this device/ }))
    expect(await screen.findByText(/could not be subscribed/)).toBeInTheDocument()
    expect(subscription.unsubscribe).toHaveBeenCalled()
  })

  it('explains a blocked permission without subscribing', async () => {
    const pushManager = stubBrowser({ granted: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: true, publicKey: key }), { status: 200 })))
    render(<PushControls />)
    fireEvent.click(await screen.findByRole('button', { name: /Notify this device/ }))
    expect(await screen.findByText(/blocked notifications for Friday/)).toBeInTheDocument()
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('reports when the controller has no push keys', async () => {
    stubBrowser()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: false, publicKey: null }), { status: 200 })))
    render(<PushControls />)
    expect(await screen.findByText(/not configured on this controller/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
