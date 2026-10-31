import type { AssistantMessage, Message, ToolMessage, UserMessage } from '../types'

export type TurnSegment =
  | { kind: 'assistant'; message: AssistantMessage }
  | { kind: 'tools'; tools: ToolMessage[] }

export interface ConversationTurn {
  id: string
  user?: UserMessage
  segments: TurnSegment[]
}

function hasBody(message: AssistantMessage) {
  return Boolean(message.content.trim() || message.reasoning.trim() || message.error || message.stopped)
}

/**
 * One turn per user message. A tool round with no answer yet stays inside a single
 * `tools` segment, so consecutive rounds collapse into one Used group; the group
 * closes as soon as the model answers, and the next tool round opens a new one.
 */
export function groupConversationTurns(messages: Message[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let turn: ConversationTurn | null = null
  let pending: ToolMessage[] = []

  const flushTools = () => {
    if (pending.length > 0) turn?.segments.push({ kind: 'tools', tools: pending })
    pending = []
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      if (!turn) continue
      pending.push(message)
      continue
    }

    if (message.role === 'user') {
      flushTools()
      turn = { id: message.id, user: message, segments: [] }
      turns.push(turn)
      continue
    }

    // A round that only called tools is represented by those tool messages.
    if (!hasBody(message) && message.toolCalls.length > 0) continue

    if (!turn) {
      turn = { id: message.id, segments: [] }
      turns.push(turn)
    }
    flushTools()
    turn.segments.push({ kind: 'assistant', message })
  }

  flushTools()
  return turns
}
