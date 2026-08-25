import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import AssistantReply, { type AssistantReplyState } from './AssistantReply'

function state(overrides: Partial<AssistantReplyState> = {}): AssistantReplyState {
  return {
    text: 'Friday response.',
    loading: false,
    error: null,
    ...overrides,
  }
}

describe('AssistantReply', () => {
  it.each([
    ['cloud-ai', 'FRIDAY CLOUD AI'],
    ['local-ai', 'FRIDAY LOCAL AI'],
    ['local-analysis', 'LOCAL ANALYSIS · NO AI'],
  ] as const)('renders %s provenance as %s', (mode, label) => {
    render(<AssistantReply state={state({ mode })}/>)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('renders provider and model as secondary metadata', () => {
    render(<AssistantReply state={state({ mode: 'cloud-ai', provider: 'openai', model: 'test-model' })}/>)
    expect(screen.getByText(/openai · test-model/i)).toBeInTheDocument()
  })

  it('renders provider metadata without inventing a model', () => {
    render(<AssistantReply state={state({ mode: 'local-analysis', provider: 'deterministic', model: null })}/>)
    expect(screen.getByText('deterministic')).toBeInTheDocument()
  })

  it('announces analysis while a request is pending', () => {
    render(<AssistantReply state={state({ loading: true })}/>)
    expect(screen.getByText('FRIDAY is analyzing…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders a safe error state without claiming an infrastructure action', () => {
    render(<AssistantReply state={state({ error: 'Friday assistant unavailable' })}/>)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Friday assistant unavailable')
    expect(status).not.toHaveTextContent(/restarted|changed|deployed|executed/i)
  })

  it('supports compact rendering for the mobile home surface', () => {
    render(<AssistantReply state={state({ mode: 'local-ai', provider: 'ollama', model: 'qwen3:4b' })} compact/>)
    expect(screen.getByRole('status')).toHaveClass('v3-assistant-reply', 'compact')
    expect(screen.getByText('FRIDAY LOCAL AI')).toBeInTheDocument()
  })

  it('does not show fallback disclosure when fallback was not used', () => {
    const { rerender } = render(<AssistantReply state={state({ fallbackUsed: false })}/>)
    expect(screen.queryByRole('button', { name: /fallback used/i })).not.toBeInTheDocument()

    rerender(<AssistantReply state={state()}/>)
    expect(screen.queryByRole('button', { name: /fallback used/i })).not.toBeInTheDocument()
  })

  it('expands only returned fallback attempts in original order', async () => {
    const user = userEvent.setup()
    render(<AssistantReply state={state({
      mode: 'local-ai',
      provider: 'ollama',
      model: 'qwen3:4b',
      fallbackUsed: true,
      attempts: [
        { provider: 'groq', outcome: 'rate-limited' },
        { provider: 'gemini', outcome: 'network' },
      ],
    })}/>)

    const button = screen.getByRole('button', { name: /fallback used/i })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('groq — rate-limited')).not.toBeInTheDocument()

    await user.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    const details = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(details).toEqual(['groq — rate-limited', 'gemini — network'])
    expect(details).not.toContain('ollama — success')
  })
})
