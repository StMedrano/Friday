import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NotConnected from './NotConnected'

describe('NotConnected', () => {
  it('labels the capability as not connected in text', () => {
    render(<NotConnected title="Uptime history" detail="Needs stored check history."/>)
    expect(screen.getByRole('note', { name: 'Uptime history: not connected' })).toHaveTextContent('Not connected')
  })

  it('renders its designed action as an inert, disabled button', () => {
    render(<NotConnected title="Pull requests" action="Connect GitHub"/>)
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeDisabled()
  })
})
