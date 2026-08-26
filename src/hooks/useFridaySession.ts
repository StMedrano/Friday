import { useRef, useState } from 'react'
import {
  askFridayAssistant,
  type FridayAssistantAttempt,
  type FridayAssistantHistoryMessage,
  type FridayAssistantMode,
} from '../lib/api'

export type FridaySessionMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: 'complete' | 'loading' | 'error'
  mode?: FridayAssistantMode
  provider?: string
  model?: string | null
  fallbackUsed?: boolean
  attempts?: FridayAssistantAttempt[]
}

export type FridaySession = {
  messages: FridaySessionMessage[]
  loading: boolean
  sendMessage(prompt: string): Promise<void>
  clearSession(): void
}

function completedHistory(messages: FridaySessionMessage[]): FridayAssistantHistoryMessage[] {
  const pairs: FridayAssistantHistoryMessage[][] = []
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index]
    const assistant = messages[index + 1]
    if (
      user.role === 'user' && user.status === 'complete' &&
      assistant.role === 'assistant' && assistant.status === 'complete'
    ) {
      pairs.push([
        { role: 'user', content: user.text },
        { role: 'assistant', content: assistant.text },
      ])
      index += 1
    }
  }
  return pairs.slice(-10).flat()
}

export function useFridaySession(): FridaySession {
  const [messages, setMessages] = useState<FridaySessionMessage[]>([])
  const [loading, setLoading] = useState(false)
  const messagesRef = useRef<FridaySessionMessage[]>([])
  const loadingRef = useRef(false)
  const idCounter = useRef(0)

  function nextId() {
    idCounter.current += 1
    return `friday-${idCounter.current}`
  }

  function replaceMessages(next: FridaySessionMessage[]) {
    messagesRef.current = next
    setMessages(next)
  }

  async function sendMessage(prompt: string) {
    const text = String(prompt || '').trim()
    if (!text || loadingRef.current) return

    const history = completedHistory(messagesRef.current)
    const userMessage: FridaySessionMessage = {
      id: nextId(),
      role: 'user',
      text,
      status: 'complete',
    }
    const assistantId = nextId()
    const assistantMessage: FridaySessionMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      status: 'loading',
    }

    loadingRef.current = true
    setLoading(true)
    replaceMessages([...messagesRef.current, userMessage, assistantMessage])

    try {
      const result = await askFridayAssistant(text, { history })
      replaceMessages(messagesRef.current.map((message) => message.id === assistantId ? {
        ...message,
        text: result.text || result.reason || 'Friday returned no response text.',
        status: 'complete',
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        fallbackUsed: result.fallbackUsed,
        attempts: result.attempts,
      } : message))
    } catch (error) {
      replaceMessages(messagesRef.current.map((message) => message.id === assistantId ? {
        ...message,
        text: error instanceof Error ? error.message : 'Friday assistant unavailable',
        status: 'error',
      } : message))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  function clearSession() {
    if (loadingRef.current) return
    replaceMessages([])
  }

  return { messages, loading, sendMessage, clearSession }
}
