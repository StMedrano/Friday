import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FridaySession } from '../hooks/useFridaySession'
import FridayWorkspace from './FridayWorkspace'

function session(overrides: Partial<FridaySession> = {}): FridaySession {
  return {
    messages: [
      { id: 'u1', role: 'user', text: 'Check friday-ollama', status: 'complete' },
      {
        id: 'a1',
        role: 'assistant',
        text: 'friday-ollama is LXC 108',
        status: 'complete',
        mode: 'cloud-ai',
        provider: 'groq',
        model: 'test-groq',
        fallbackUsed: false,
        attempts: [],
      },
    ],
    loading: false,
    sendMessage: vi.fn(async () => {}),
    clearSession: vi.fn(),
    ...overrides,
  }
}

describe('FridayWorkspace', () => {
  it('renders the full current session with explicit advisory boundaries', () => {
    render(<FridayWorkspace
      session={session()}
      query=""
      onQueryChange={vi.fn()}
      onSubmit={vi.fn()}
    />)

    expect(screen.getByText('FRIDAY / SESSION')).toBeInTheDocument()
    expect(screen.getByText('Advisory only · No actions executed')).toBeInTheDocument()
    expect(screen.getByText('Context: up to 10 recent exchanges')).toBeInTheDocument()
    expect(screen.getByText('Check friday-ollama')).toBeInTheDocument()
    expect(screen.getByText('friday-ollama is LXC 108')).toBeInTheDocument()
  })

  it('clears only the client session while idle', async () => {
    const clearSession = vi.fn()
    const user = userEvent.setup()
    render(<FridayWorkspace
      session={session({ clearSession })}
      query=""
      onQueryChange={vi.fn()}
      onSubmit={vi.fn()}
    />)

    await user.click(screen.getByRole('button', { name: /clear session/i }))
    expect(clearSession).toHaveBeenCalledTimes(1)
  })

  it('disables Clear session while a request is in flight', () => {
    render(<FridayWorkspace
      session={session({ loading: true })}
      query=""
      onQueryChange={vi.fn()}
      onSubmit={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: /clear session/i })).toBeDisabled()
  })
})
