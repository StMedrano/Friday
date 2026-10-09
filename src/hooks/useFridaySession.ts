import { useRef, useState } from 'react'
import {
  askFridayAssistant,
  type FridayAgentExecution,
  type FridayAgentRoutingProvenance,
  type FridayAssistantAttempt,
  type FridayAssistantHistoryMessage,
  type FridayAssistantMode,
  type FridayAssistantResponse,
} from '../lib/api'

export type FridaySessionMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: 'complete' | 'loading' | 'error'
  mode?: FridayAssistantMode
  provider?: string
  model?: string | null
  modelProfile?: string
  agentId?: string
  agentName?: string
  routing?: FridayAgentRoutingProvenance
  execution?: FridayAgentExecution
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

function assistantFailureResponse(error: unknown): FridayAssistantResponse | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined
  const response = (error as { response?: unknown }).response
  if (!response || typeof response !== 'object') return undefined
  return response as FridayAssistantResponse
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

  function updateAssistant(assistantId: string, update: Partial<FridaySessionMessage>) {
    replaceMessages(messagesRef.current.map((message) => message.id === assistantId ? {
      ...message,
      ...update,
    } : message))
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
      updateAssistant(assistantId, {
        text: result.text || result.reason || 'Friday returned no response text.',
        status: 'complete',
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        modelProfile: result.modelProfile,
        agentId: result.agentId,
        agentName: result.agentName,
        routing: result.routing,
        execution: result.execution,
        fallbackUsed: result.fallbackUsed,
        attempts: result.attempts,
      })
    } catch (error) {
      const response = assistantFailureResponse(error)
      updateAssistant(assistantId, {
        text: error instanceof Error ? error.message : 'Friday assistant unavailable',
        status: 'error',
        mode: response?.mode,
        provider: response?.provider,
        model: response?.model,
        modelProfile: response?.modelProfile,
        agentId: response?.agentId,
        agentName: response?.agentName,
        routing: response?.routing,
        execution: response?.execution,
        fallbackUsed: response?.fallbackUsed,
        attempts: response?.attempts,
      })
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
