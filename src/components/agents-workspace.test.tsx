import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchFridayAgents = vi.fn()
const fetchFridayRepositories = vi.fn()

vi.mock('../lib/api', () => ({
  fetchFridayAgents: (...args: unknown[]) => fetchFridayAgents(...args),
  fetchFridayRepositories: (...args: unknown[]) => fetchFridayRepositories(...args),
}))

import AgentsWorkspace from './AgentsWorkspace'
import RepositoriesWorkspace from './RepositoriesWorkspace'

describe('agent platform workspaces', () => {
  beforeEach(() => {
    fetchFridayAgents.mockReset()
    fetchFridayRepositories.mockReset()
  })

  it('shows real agents, tools and permission states without internal prompts', async () => {
    fetchFridayAgents.mockResolvedValue([{ id: 'codebase-explorer', name: 'Codebase Explorer', description: 'Maps code safely', model: { provider: 'ollama', model: 'qwen3:4b-instruct' }, tools: ['repo.read', 'repo.search'], permissions: { inspect_repository: 'auto', git_push: 'forbidden' }, scope: {} }])
    render(<AgentsWorkspace />)
    expect(screen.getByText(/loading agents/i)).toBeInTheDocument()
    expect(await screen.findByText('Codebase Explorer')).toBeInTheDocument()
    expect(screen.getByText('repo.read')).toBeInTheDocument()
    expect(screen.getByText(/inspect_repository · auto/i)).toBeInTheDocument()
    expect(screen.queryByText(/internal prompt/i)).not.toBeInTheDocument()
  })

  it('shows repository identity and policy without filesystem paths', async () => {
    fetchFridayRepositories.mockResolvedValue([{ id: 'friday', name: 'Friday', remote: 'https://github.com/StMedrano/Friday.git', defaultBranch: 'main', mode: 'development', enabled: true }])
    render(<RepositoriesWorkspace />)
    expect(await screen.findByText('Friday')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('development')).toBeInTheDocument()
    expect(screen.getByText('https://github.com/StMedrano/Friday.git')).toBeInTheDocument()
    expect(screen.queryByText(/\/srv\//i)).not.toBeInTheDocument()
  })

  it('renders readable error states', async () => {
    fetchFridayAgents.mockRejectedValue(new Error('offline'))
    fetchFridayRepositories.mockRejectedValue(new Error('offline'))
    render(<><AgentsWorkspace /><RepositoriesWorkspace /></>)
    expect(await screen.findByText(/agent inventory unavailable/i)).toBeInTheDocument()
    expect(await screen.findByText(/repository inventory unavailable/i)).toBeInTheDocument()
  })
})
