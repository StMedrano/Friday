import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePhoneLayout } from './usePhoneLayout'

function Probe() {
  return <span>{usePhoneLayout() ? 'phone' : 'desktop'}</span>
}

afterEach(() => vi.unstubAllGlobals())

describe('usePhoneLayout', () => {
  it('uses the exact 700px media query and reacts to change events', () => {
    let matches = true
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    const matchMedia = vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia })

    render(<Probe />)
    expect(screen.getByText('phone')).toBeInTheDocument()
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 700px)')

    act(() => {
      matches = false
      listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent))
    })
    expect(screen.getByText('desktop')).toBeInTheDocument()
  })

  it('falls back to desktop when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined })
    render(<Probe />)
    expect(screen.getByText('desktop')).toBeInTheDocument()
  })
})
