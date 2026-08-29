import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const askFridayAssistant = vi.fn()

vi.mock('../lib/api', () => ({
  useFridayOverview: () => ({
    connected: true,
    overview: {
      mode: 'live',
      sites: [],
      services: [],
      alerts: [],
      resources: [],
      activities: [],
      incidents: [],
      monitoring: null,
    },
  }),
  fetchMonitoringHistory: vi.fn(async () => []),
  fetchFridayAgents: vi.fn(async () => []),
  fetchFridayRepositories: vi.fn(async () => []),
  askFridayAssistant: (...args: unknown[]) => askFridayAssistant(...args),
}))

vi.mock('../hooks/usePhoneLayout', () => ({
  usePhoneLayout: () => false,
}))

import Dashboard from './Dashboard'

describe('Dashboard assistant integration', () => {
  beforeEach(() => {
    askFridayAssistant.mockReset()
  })

  it('shares one session between Overview and FRIDAY and clears on remount', async () => {
    askFridayAssistant
      .mockResolvedValueOnce({
        available: true,
        mode: 'cloud-ai',
        provider: 'groq',
        model: 'test-groq',
        text: 'friday-ollama is LXC 108',
        fallbackUsed: false,
        attempts: [],
      })
      .mockResolvedValueOnce({
        available: true,
        mode: 'cloud-ai',
        provider: 'groq',
        model: 'test-groq',
        text: 'VM102 is the Friday controller.',
        fallbackUsed: false,
        attempts: [],
      })

    const user = userEvent.setup()
    const view = render(<Dashboard />)

    const overviewInput = screen.getByPlaceholderText(/ask friday anything/i)
    await user.type(overviewInput, 'Check friday-ollama')
    await user.click(screen.getByRole('button', { name: /send command/i }))

    expect(await screen.findByText('friday-ollama is LXC 108')).toBeInTheDocument()
    expect(askFridayAssistant).toHaveBeenNthCalledWith(1, 'Check friday-ollama', { history: [] })

    await user.click(screen.getByRole('button', { name: /^FRIDAY$/i }))
    expect(screen.getByText('FRIDAY / SESSION')).toBeInTheDocument()
    expect(screen.getByText('Advisory only · No actions executed')).toBeInTheDocument()
    expect(screen.getByText('Check friday-ollama')).toBeInTheDocument()
    expect(screen.getByText('friday-ollama is LXC 108')).toBeInTheDocument()

    const fridayInput = screen.getByPlaceholderText(/ask friday anything/i)
    await user.type(fridayInput, 'Compare it to VM102')
    await user.click(screen.getByRole('button', { name: /send command/i }))

    expect(await screen.findByText('VM102 is the Friday controller.')).toBeInTheDocument()
    expect(askFridayAssistant).toHaveBeenNthCalledWith(2, 'Compare it to VM102', {
      history: [
        { role: 'user', content: 'Check friday-ollama' },
        { role: 'assistant', content: 'friday-ollama is LXC 108' },
      ],
    })

    await user.click(screen.getByRole('button', { name: /^Overview$/i }))
    expect(screen.getByText('Check friday-ollama')).toBeInTheDocument()
    expect(screen.getByText('friday-ollama is LXC 108')).toBeInTheDocument()
    expect(screen.getByText('Compare it to VM102')).toBeInTheDocument()
    expect(screen.getByText('VM102 is the Friday controller.')).toBeInTheDocument()

    view.unmount()
    render(<Dashboard />)
    expect(screen.queryByText('Check friday-ollama')).not.toBeInTheDocument()
    expect(screen.queryByText('friday-ollama is LXC 108')).not.toBeInTheDocument()
  })

  it('disables the shared composer while Friday is analyzing', async () => {
    askFridayAssistant.mockImplementation(() => new Promise(() => {}))

    const user = userEvent.setup()
    render(<Dashboard />)
    const input = screen.getByPlaceholderText(/ask friday anything/i)
    const send = screen.getByRole('button', { name: /send command/i })
    await user.type(input, 'Check service health')
    await user.click(send)

    expect(await screen.findByText('FRIDAY is analyzing…')).toBeInTheDocument()
    expect(input).toBeDisabled()
    expect(send).toBeDisabled()
  })
})
