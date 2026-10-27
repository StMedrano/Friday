import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CommandPalette, { type PaletteItem } from './CommandPalette'

function items(run = vi.fn()): PaletteItem[] {
  return [
    { id: 'go-overview', group: 'Go to', label: 'Overview', run },
    { id: 'go-incidents', group: 'Go to', label: 'Incidents', hint: '1 active', run },
    { id: 'svc-umbrel', group: 'Services', label: 'VM 110 · Umbrel', hint: 'umbrel · degraded', run },
  ]
}

describe('CommandPalette', () => {
  it('filters by label and hint and runs the selected item on Enter', async () => {
    const run = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<CommandPalette open items={items(run)} onAsk={vi.fn()} onClose={onClose}/>)
    const input = screen.getByRole('combobox', { name: /search or command/i })
    expect(input).toHaveFocus()
    await user.type(input, 'degraded')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: /umbrel/i })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(run).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('moves selection with arrow keys', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open items={items()} onAsk={vi.fn()} onClose={vi.fn()}/>)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /incidents/i })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('option', { name: /overview/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('offers to ask FRIDAY with the typed text', async () => {
    const onAsk = vi.fn()
    const user = userEvent.setup()
    render(<CommandPalette open items={items()} onAsk={onAsk} onClose={vi.fn()}/>)
    await user.type(screen.getByRole('combobox'), 'why is dns slow')
    await user.click(screen.getByRole('option', { name: /ask friday: why is dns slow/i }))
    expect(onAsk).toHaveBeenCalledWith('why is dns slow')
  })

  it('closes on Escape and renders nothing when closed', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<CommandPalette open items={items()} onAsk={vi.fn()} onClose={onClose}/>)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    rerender(<CommandPalette open={false} items={items()} onAsk={vi.fn()} onClose={onClose}/>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
