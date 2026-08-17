import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Dashboard from '../src/pages/Dashboard'

describe('Friday v3 command center', () => {
  it('presents the authoritative Friday command surface and live infrastructure data', () => {
    render(<Dashboard />)
    expect(screen.getByRole('heading', { name: /good afternoon/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /what would you like me to handle/i })).toBeInTheDocument()
    expect(screen.getByText('Proxmox VE')).toBeInTheDocument()
    expect(screen.getByText('Omada Controller')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ask friday anything/i)).toBeInTheDocument()
    expect(screen.getByText(/safe read-only interface/i)).toBeInTheDocument()
  })
})
