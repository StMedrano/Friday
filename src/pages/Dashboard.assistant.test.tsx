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

  it('submits the real operator prompt and renders cloud provenance', async () => {
    askFridayAssistant.mockResolvedValue({
      available: true,
      mode: 'cloud-ai',
      provider: 'openai',
      model: 'test-model',
      text: 'All observed services are healthy.',
      fallbackUsed: false,
      attempts: [],
    })

    const user = userEvent.setup()
    render(<Dashboard />)
    const input = screen.getByPlaceholderText(/ask friday anything/i)
    await user.type(input, 'Check service health')
    await user.click(screen.getByRole('button', { name: /send command/i }))

    expect(askFridayAssistant).toHaveBeenCalledWith('Check service health')
    expect(await screen.findByText('All observed services are healthy.')).toBeInTheDocument()
    expect(screen.getByText('FRIDAY CLOUD AI')).toBeInTheDocument()
    expect(screen.getByText(/openai · test-model/i)).toBeInTheDocument()
  })

  it('disables input and send while Friday is analyzing', async () => {
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
