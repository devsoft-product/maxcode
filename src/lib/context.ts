/**
 * Context usage utilities.
 *
 * Estimates the number of tokens in the current session and computes the
 * percentage of the active model's context window consumed. Because we count
 * characters rather than sub-word tokens, the estimate will differ from the
 * provider's actual token count; it is intentionally conservative (we divide
 * by 3 instead of the usual ~4 chars/token) so the auto-compact threshold is
 * hit slightly before the model actually runs out of context.
 */

import type { Message, ModelInfo } from '../types'

/** Chars-per-token ratio used for the estimate. Intentionally conservative. */
const CHARS_PER_TOKEN = 3

/**
 * Rough token estimate for a single message. All roles are counted; tool
 * results tend to be verbose so they get the same treatment as text.
 */
function estimateMessageTokens(message: Message): number {
  if (message.role === 'user') {
    const attachmentChars = (message.attachments ?? []).reduce((sum, a) => sum + (a.text?.length ?? 0), 0)
    return Math.ceil((message.content.length + attachmentChars) / CHARS_PER_TOKEN) + 4
  }
  if (message.role === 'assistant') {
    const toolChars = message.toolCalls.reduce(
      (sum, call) => sum + JSON.stringify(call.args).length + call.name.length + 10,
      0,
    )
    return Math.ceil((message.content.length + message.reasoning.length + toolChars) / CHARS_PER_TOKEN) + 4
  }
  // tool message
  return Math.ceil(((message.result ?? '').length) / CHARS_PER_TOKEN) + 4
}

/** Sum of estimated tokens across all messages in a session. */
export function estimateSessionTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
}

/** Context window ceiling for a given model (falls back to a safe default). */
export function contextLimit(model: ModelInfo | null): number {
  return model?.context ?? 128_000
}

/**
 * Returns a value in [0, 1] representing how full the context window is.
 * Also accounts for the system prompt overhead (estimated at ~2 000 tokens).
 */
export function contextUsageRatio(messages: Message[], model: ModelInfo | null): number {
  const SYSTEM_OVERHEAD = 2_000
  const used = estimateSessionTokens(messages) + SYSTEM_OVERHEAD
  const limit = contextLimit(model)
  return Math.min(used / limit, 1)
}

/** Returns { used, limit, ratio, pct } for display and decision-making. */
export interface ContextUsage {
  used: number
  limit: number
  ratio: number
  pct: number
}

export function getContextUsage(messages: Message[], model: ModelInfo | null): ContextUsage {
  const SYSTEM_OVERHEAD = 2_000
  const used = estimateSessionTokens(messages) + SYSTEM_OVERHEAD
  const limit = contextLimit(model)
  const ratio = Math.min(used / limit, 1)
  return { used, limit, ratio, pct: Math.round(ratio * 100) }
}

/** The fraction at which auto-compact is triggered. */
export const AUTO_COMPACT_THRESHOLD = 0.85
