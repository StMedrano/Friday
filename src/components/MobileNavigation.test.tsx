import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import MobileNavigation from './MobileNavigation'

describe('MobileNavigation', () => {
  it('renders five primary destinations and maps Home to Overview', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<MobileNavigation active="Overview" activeIncidents={0} onNavigate={onNavigate}/>)

    const navigation = screen.getByRole('navigation', { name: /mobile command bar/i })
    expect(navigation).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(onNavigate).toHaveBeenCalledWith('Overview')
  })

  it('includes active incident count in the accessible Incidents label only when non-zero', () => {
    const { rerender } = render(<MobileNavigation active="Overview" activeIncidents={2} onNavigate={() => {}}/>)
    expect(screen.getByRole('button', { name: /incidents, 2 active/i })).toBeInTheDocument()
    rerender(<MobileNavigation active="Overview" activeIncidents={0} onNavigate={() => {}}/>)
    expect(screen.getByRole('button', { name: 'Incidents' })).toBeInTheDocument()
  })

  it('opens an accessible More dialog with all secondary views and navigates while closing', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<MobileNavigation active="Overview" activeIncidents={1} onNavigate={onNavigate}/>)

    await user.click(screen.getByRole('button', { name: 'More' }))
    const dialog = screen.getByRole('dialog', { name: /more friday views/i })
    expect(dialog).toBeInTheDocument()
    for (const name of ['Applications', 'Agents', 'Tasks', 'Approvals', 'Memory', 'Audit', 'Settings']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }

    await user.click(screen.getByRole('button', { name: 'Applications' }))
    expect(onNavigate).toHaveBeenCalledWith('Applications')
    expect(screen.queryByRole('dialog', { name: /more friday views/i })).not.toBeInTheDocument()
  })

  it('closes the More dialog on Escape without navigating', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<MobileNavigation active="Overview" activeIncidents={0} onNavigate={onNavigate}/>)
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('dialog', { name: /more friday views/i })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /more friday views/i })).not.toBeInTheDocument()
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
