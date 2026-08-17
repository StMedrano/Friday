import { describe, expect, it } from 'vitest'
import { statusLabel, statusPriority } from '../src/lib/status'

describe('status helpers', () => {
  it('returns a readable label for degraded infrastructure', () => {
    expect(statusLabel('degraded')).toBe('Degraded')
  })

  it('prioritizes offline infrastructure above degraded infrastructure', () => {
    expect(statusPriority('offline')).toBeGreaterThan(statusPriority('degraded'))
  })
})
