import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Dashboard from '../src/pages/Dashboard'

describe('Friday dashboard', () => {
  it('presents both sites and the core homelab control surfaces', () => {
    render(<Dashboard />)
    expect(screen.getByRole('heading', { name: /infrastructure overview/i })).toBeInTheDocument()
    expect(screen.getAllByText('Site A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Site B').length).toBeGreaterThan(0)
    expect(screen.getByText('Proxmox VE')).toBeInTheDocument()
    expect(screen.getByText('Omada Controller')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ask friday/i)).toBeInTheDocument()
  })
})
