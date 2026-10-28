import { describe, expect, it } from 'vitest'
import { greeting } from '../src/lib/greeting'

describe('greeting', () => {
  it('follows the local time of day', () => {
    expect(greeting(new Date(2026, 9, 27, 6, 0))).toBe('Good morning.')
    expect(greeting(new Date(2026, 9, 27, 12, 0))).toBe('Good afternoon.')
    expect(greeting(new Date(2026, 9, 27, 18, 0))).toBe('Good evening.')
    expect(greeting(new Date(2026, 9, 27, 2, 0))).toBe('Good evening.')
  })
})
