import { useRef, useState } from 'react'
import {
  askFridayAgent,
  askFridayAssistant,
  routeFridayAgent,
  type FridayAgentRouting,
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
  modelProfile?: string
  agentId?: string
  agentName?: string
  routing?: FridayAgentRouting
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
      let route = null
      try {
        route = await routeFridayAgent(text)
      } catch {
        route = null
      }

      if (route?.matched === true && route.agentId) {
        try {
          const result = await askFridayAgent(route.agentId, text)
          updateAssistant(assistantId, {
            text: result.text || result.reason || 'Friday agent returned no response text.',
            status: 'complete',
            mode: 'local-agent',
            provider: result.provider,
            model: result.model,
            modelProfile: result.modelProfile,
            agentId: result.agentId || route.agentId,
            agentName: result.agentName || route.agentName,
            routing: route.routing,
            fallbackUsed: false,
            attempts: [],
          })
        } catch (error) {
          updateAssistant(assistantId, {
            text: error instanceof Error ? error.message : 'Local agent inference unavailable',
            status: 'error',
            mode: 'local-agent',
            agentId: route.agentId,
            agentName: route.agentName,
            routing: route.routing,
          })
        }
        return
      }

      const result = await askFridayAssistant(text, { history })
      updateAssistant(assistantId, {
        text: result.text || result.reason || 'Friday returned no response text.',
        status: 'complete',
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        fallbackUsed: result.fallbackUsed,
        attempts: result.attempts,
      })
    } catch (error) {
      updateAssistant(assistantId, {
        text: error instanceof Error ? error.message : 'Friday assistant unavailable',
        status: 'error',
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
