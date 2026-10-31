import type { Message, UserMessage } from '../types'

/** Provider history for one turn: everything through its submitted user message. */
export function historyUpTo(messages: Message[], userMessageId: string): Message[] | null {
  const end = messages.findIndex((message) => message.id === userMessageId)
  if (end === -1) return null
  return messages.slice(0, end + 1)
}

/**
 * History for a turn mid-run. A prompt submitted while this turn is streaming is
 * already in the store, so the slice stops before the next user message.
 */
export function turnHistory(messages: Message[], userMessageId: string): Message[] | null {
  const start = messages.findIndex((message) => message.id === userMessageId)
  if (start === -1) return null
  for (let index = start + 1; index < messages.length; index += 1) {
    if (messages[index].role === 'user') return messages.slice(0, index)
  }
  return messages.slice()
}

export function lastUserMessageId(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') return (message as UserMessage).id
  }
  return null
}

export interface TurnQueue {
  /** Runs after every turn already queued for this session. */
  push(sessionId: string, userMessageId: string): Promise<void>
  /** Drops turns that have not started yet; the running one keeps its abort signal. */
  clear(sessionId: string): void
  isBusy(sessionId: string): boolean
  isIdle(): boolean
}

interface Lane {
  chain: Promise<void>
  /** Bumped by clear(); a queued run whose token is stale never starts. */
  token: object
}

/**
 * One run per session at a time, in submission order. A prompt sent mid-turn is
 * queued instead of dropped, and each run only sees history up to its own turn.
 */
export function createTurnQueue(run: (sessionId: string, userMessageId: string) => Promise<void>): TurnQueue {
  const lanes = new Map<string, Lane>()

  return {
    isBusy: (sessionId) => lanes.has(sessionId),
    isIdle: () => lanes.size === 0,
    clear(sessionId) {
      const lane = lanes.get(sessionId)
      if (!lane) return
      lanes.set(sessionId, { chain: lane.chain, token: {} })
    },
    push(sessionId, userMessageId) {
      const lane = lanes.get(sessionId) ?? { chain: Promise.resolve(), token: {} }
      const token = lane.token
      const next = lane.chain.then(
        () => (lanes.get(sessionId)?.token === token ? run(sessionId, userMessageId) : undefined),
        () => (lanes.get(sessionId)?.token === token ? run(sessionId, userMessageId) : undefined),
      )
      const done = next.then(
        () => undefined,
        () => undefined,
      )
      lanes.set(sessionId, { chain: done, token })
      void done.then(() => {
        if (lanes.get(sessionId)?.chain === done) lanes.delete(sessionId)
      })
      return done
    },
  }
}
