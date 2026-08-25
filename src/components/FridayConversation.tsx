import type { FridaySessionMessage } from '../hooks/useFridaySession'
import AssistantReply, { type AssistantReplyState } from './AssistantReply'

function compactMessages(messages: FridaySessionMessage[]) {
  const pairs: Array<{ user: FridaySessionMessage; assistant: FridaySessionMessage; assistantIndex: number }> = []

  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index]
    const assistant = messages[index + 1]
    if (
      user.role === 'user' && user.status === 'complete' &&
      assistant.role === 'assistant' && assistant.status === 'complete'
    ) {
      pairs.push({ user, assistant, assistantIndex: index + 1 })
      index += 1
    }
  }

  const completed = pairs.slice(-2).flatMap(({ user, assistant }) => [user, assistant])
  const trailingStart = pairs.length ? pairs[pairs.length - 1].assistantIndex + 1 : 0
  return [...completed, ...messages.slice(trailingStart)]
}

function assistantState(message: FridaySessionMessage): AssistantReplyState {
  return {
    text: message.text,
    mode: message.mode,
    provider: message.provider,
    model: message.model,
    fallbackUsed: message.fallbackUsed,
    attempts: message.attempts,
    loading: message.status === 'loading',
    error: message.status === 'error' ? message.text : null,
  }
}

export default function FridayConversation({ messages, compact = false }: { messages: FridaySessionMessage[]; compact?: boolean }) {
  const visible = compact ? compactMessages(messages) : messages

  if (!visible.length) return null

  return <div className={`v3-friday-conversation${compact ? ' compact' : ''}`} aria-label="Friday conversation">
    {visible.map((message) => message.role === 'user' ? <div className="v3-friday-turn user" key={message.id}>
      <span className="v3-friday-turn-label">YOU</span>
      <p>{message.text}</p>
    </div> : <div className="v3-friday-turn assistant" key={message.id}>
      <span className="v3-friday-turn-label">FRIDAY</span>
      <AssistantReply state={assistantState(message)} compact={compact}/>
    </div>)}
  </div>
}
