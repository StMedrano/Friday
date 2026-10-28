import { describe, expect, it } from 'vitest'
import { statusLabel, statusPriority, summarizeHealth } from '../src/lib/status'
import type { InfrastructureStatus } from '../src/lib/infrastructure'

describe('status helpers', () => {
  it('returns a readable label for degraded infrastructure', () => {
    expect(statusLabel('degraded')).toBe('Degraded')
  })

  it('prioritizes offline infrastructure above degraded infrastructure', () => {
    expect(statusPriority('offline')).toBeGreaterThan(statusPriority('degraded'))
  })
})

describe('summarizeHealth', () => {
  const svc = (id: string, status: InfrastructureStatus) => ({ id, name: id, status })

  it('reports nominal only when every service is online and nothing is open', () => {
    const health = summarizeHealth([svc('a', 'online'), svc('b', 'online')], 0)
    expect(health).toMatchObject({ level: 'nominal', label: 'Nominal', online: 2, total: 2, percent: 100, attention: [] })
  })

  it('flags a degraded service as attention even with no open incident', () => {
    const health = summarizeHealth([svc('a', 'online'), svc('umbrel', 'degraded')], 0)
    expect(health.level).toBe('attention')
    expect(health.label).toBe('Attention')
    expect(health.attention.map((s) => s.id)).toEqual(['umbrel'])
  })

  it('treats an open incident as attention even if every service reports online', () => {
    expect(summarizeHealth([svc('a', 'online')], 1).level).toBe('attention')
  })

  it('escalates to critical when a service is offline and lists it first', () => {
    const health = summarizeHealth([svc('dns', 'degraded'), svc('npm', 'offline'), svc('a', 'online')], 0)
    expect(health.level).toBe('critical')
    expect(health.label).toBe('Critical')
    expect(health.attention.map((s) => s.id)).toEqual(['npm', 'dns'])
  })

  it('does not claim nominal when no services are observed', () => {
    expect(summarizeHealth([], 0)).toMatchObject({ level: 'unknown', label: 'No data', percent: null })
  })
})
