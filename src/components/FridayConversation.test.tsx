import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FridaySessionMessage } from '../hooks/useFridaySession'
import FridayConversation from './FridayConversation'

function message(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  status: FridaySessionMessage['status'] = 'complete',
): FridaySessionMessage {
  return { id, role, text, status }
}

const transcript: FridaySessionMessage[] = [
  message('u0', 'user', 'question zero'),
  message('a0', 'assistant', 'answer zero'),
  message('u1', 'user', 'question one'),
  message('a1', 'assistant', 'answer one'),
  message('u2', 'user', 'question two'),
  message('a2', 'assistant', 'answer two'),
  message('u3', 'user', 'current question'),
  message('a3', 'assistant', '', 'loading'),
]

describe('FridayConversation', () => {
  it('renders the complete supplied transcript in full mode', () => {
    render(<FridayConversation messages={transcript}/>)

    expect(screen.getByText('question zero')).toBeInTheDocument()
    expect(screen.getByText('answer zero')).toBeInTheDocument()
    expect(screen.getByText('question one')).toBeInTheDocument()
    expect(screen.getByText('answer one')).toBeInTheDocument()
    expect(screen.getByText('question two')).toBeInTheDocument()
    expect(screen.getByText('answer two')).toBeInTheDocument()
    expect(screen.getByText('current question')).toBeInTheDocument()
    expect(screen.getByText('FRIDAY is analyzing…')).toBeInTheDocument()
  })

  it('renders only the newest two completed exchanges plus the trailing active pair in compact mode', () => {
    render(<FridayConversation messages={transcript} compact/>)

    expect(screen.queryByText('question zero')).not.toBeInTheDocument()
    expect(screen.queryByText('answer zero')).not.toBeInTheDocument()
    expect(screen.getByText('question one')).toBeInTheDocument()
    expect(screen.getByText('answer one')).toBeInTheDocument()
    expect(screen.getByText('question two')).toBeInTheDocument()
    expect(screen.getByText('answer two')).toBeInTheDocument()
    expect(screen.getByText('current question')).toBeInTheDocument()
    expect(screen.getByText('FRIDAY is analyzing…')).toBeInTheDocument()
  })

  it('keeps a trailing user/error pair visible in compact mode', () => {
    const failed = [
      ...transcript.slice(0, 6),
      message('u4', 'user', 'failed question'),
      message('a4', 'assistant', 'Friday assistant unavailable', 'error'),
    ]

    render(<FridayConversation messages={failed} compact/>)

    expect(screen.queryByText('question zero')).not.toBeInTheDocument()
    expect(screen.getByText('question one')).toBeInTheDocument()
    expect(screen.getByText('question two')).toBeInTheDocument()
    expect(screen.getByText('failed question')).toBeInTheDocument()
    expect(screen.getByText('Friday assistant unavailable')).toBeInTheDocument()
  })
})
