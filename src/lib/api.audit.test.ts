import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFridayAuditEvents, FridayAuditError } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('audit events response', () => {
  it('treats a 200 response without an events list as unavailable instead of crashing the workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    await expect(fetchFridayAuditEvents()).rejects.toBeInstanceOf(FridayAuditError)
  })

  it('returns a well-formed page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ events: [], nextBefore: null, integrity: 'verified' }), { status: 200 })))
    await expect(fetchFridayAuditEvents()).resolves.toEqual({ events: [], nextBefore: null, integrity: 'verified' })
  })
})
