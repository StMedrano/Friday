import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NotConnected, { SETUP_SECTIONS, setupDocUrl } from './NotConnected'
import integrationsDoc from '../../docs/integrations.md?raw'

describe('NotConnected', () => {
  it('labels the capability as not connected in text', () => {
    render(<NotConnected title="Uptime history" detail="Needs stored check history."/>)
    expect(screen.getByRole('note', { name: 'Uptime history: not connected' })).toHaveTextContent('Not connected')
  })

  it('renders its designed action as an inert, disabled button', () => {
    render(<NotConnected title="Pull requests" action="Connect GitHub"/>)
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeDisabled()
  })

  it('keeps today’s text when there is no setup reference', () => {
    render(<NotConnected title="Open app" detail="Launching apps from Friday is not enabled."/>)
    const note = screen.getByRole('note', { name: 'Open app: not connected' })
    expect(note).toHaveTextContent('Open appLaunching apps from Friday is not enabled.Not connected')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('links a setup reference to its section of the integrations doc', () => {
    render(<NotConnected title="Approvals" detail="Queue is off." setup="Approvals queue"/>)
    const link = screen.getByRole('link', { name: 'How to connect: Approvals queue' })
    expect(link).toHaveAttribute('href', 'https://github.com/StMedrano/Friday/blob/main/docs/integrations.md#approvals-queue')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(screen.getByRole('note', { name: 'Approvals: not connected' })).toContainElement(link)
  })

  it('builds GitHub heading anchors for headings with punctuation', () => {
    expect(setupDocUrl('New tasks (Tasks write path)')).toMatch(/#new-tasks-tasks-write-path$/)
    expect(setupDocUrl('GitHub pull requests, CI and last commit')).toMatch(/#github-pull-requests-ci-and-last-commit$/)
  })

  it('names only headings that exist in docs/integrations.md', () => {
    const headings = integrationsDoc.split('\n')
      .filter((line) => /^#{2,3} /.test(line)).map((line) => line.replace(/^#+ /, '').trim())
    expect(SETUP_SECTIONS.length).toBeGreaterThan(0)
    for (const section of SETUP_SECTIONS) expect(headings).toContain(section)
  })
})
