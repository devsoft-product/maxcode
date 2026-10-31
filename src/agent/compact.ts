/**
 * Smart session compaction.
 *
 * When the context window is getting full, this module asks the AI to produce
 * a detailed summary of everything that has happened so far — tools called,
 * files changed, decisions made, open tasks — and replaces the old messages
 * with that summary plus a compact system note. The summary is intentionally
 * thorough so the AI does not lose track of ongoing work.
 *
 * The compacted session contains:
 *   1. A synthetic user message: the original FIRST user message (task framing)
 *   2. A synthetic assistant message: the AI-generated summary
 *   3. A synthetic user message: a brief handoff note telling the AI to continue
 *
 * This keeps the conversation coherent from the provider's perspective while
 * drastically reducing token consumption.
 */

import type { AssistantMessage, Message, UserMessage } from '../types'
import { useChats, createId } from '../store/chats'
import { useSettings, activeModelId } from '../store/settings'
import { findModel } from '../store/models'
import { streamModel } from './model'
import { EMPTY_HANDLERS } from './adapters/shared'

const COMPACT_SYSTEM = `You are a session compactor. Your ONLY job is to produce a detailed, structured summary of the conversation you are given. This summary will replace the original messages so the AI agent can continue the task without losing important context.

The summary MUST include, in clear sections:

## Task & Goal
What the user originally asked for. The full scope, requirements, and any constraints they stated.

## Work Completed So Far
Every meaningful action taken: files read, files created or modified (list each file path and what changed), commands run (and their output), API calls made, decisions reached, bugs found and fixed.

## Current State
What is the exact state of the workspace right now? Which files are in what state? What has been verified to work? What is broken or incomplete?

## Open Tasks & Next Steps
What remains to be done? List concrete next actions with enough detail that the agent can pick up exactly where things left off.

## Key Facts & Decisions
Important technical facts discovered during the session: library versions, APIs used, architectural decisions made, pitfalls encountered.

## Files Modified or Created
An exhaustive list of every file path that was touched and a one-line description of what was done.

Be exhaustive and precise. Do not summarize tool output vaguely — include actual file paths, function names, error messages, command outputs. The agent continuing the work must be able to act on this summary without access to the original messages.`

/** True while a compact is in progress for a given session id. */
const compacting = new Set<string>()

export function isCompacting(sessionId: string): boolean {
  return compacting.has(sessionId)
}

/**
 * Runs the compaction for `sessionId`.
 *
 * Returns true if compaction succeeded, false if it was skipped or failed.
 * Never throws — errors are surfaced via the maxcode:notice event.
 */
export async function compactSession(sessionId: string): Promise<boolean> {
  if (compacting.has(sessionId)) return false
  compacting.add(sessionId)

  try {
    const session = useChats.getState().sessions.find((s) => s.id === sessionId)
    if (!session || session.messages.length < 4) return false

    const settings = useSettings.getState()
    const modelId = activeModelId(settings)
    if (!modelId) return false

    const model = findModel(settings.provider, modelId)

    // Build a full conversation transcript for the summariser.
    // We include assistant text and tool results so the summariser has the
    // complete picture of what happened.
    const transcript = buildTranscript(session.messages)

    // The summariser request is sent as a plain user message so we don't have
    // to worry about tool call parsing or streaming UI updates.
    const summaryHistory: Message[] = [
      {
        id: createId('msg'),
        role: 'user',
        content: `Below is a complete transcript of a coding session. Produce the detailed summary as instructed.\n\n${transcript}`,
        createdAt: Date.now(),
      },
    ]

    let summaryContent = ''

    try {
      const result = await streamModel({
        settings,
        model,
        history: summaryHistory,
        system: COMPACT_SYSTEM,
        mode: 'build',
        signal: new AbortController().signal,
        handlers: {
          ...EMPTY_HANDLERS,
          onText: (delta) => {
            summaryContent += delta
          },
        },
      })
      if (result.content.trim()) summaryContent = result.content
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent('maxcode:notice', {
          detail: {
            message: `Auto-compact failed: ${error instanceof Error ? error.message : 'Unknown error'}. Continuing with full context.`,
            tone: 'error',
          },
        }),
      )
      return false
    }

    if (!summaryContent.trim()) return false

    // Find the first user message to preserve the original task framing.
    const firstUser = session.messages.find((m): m is UserMessage => m.role === 'user')
    const now = Date.now()

    // Build the replacement message set.
    const compactedMessages: Message[] = []

    // 1. Original task (first user message, preserved exactly).
    if (firstUser) {
      compactedMessages.push({ ...firstUser })
    }

    // 2. AI-generated summary of all the work done.
    const summaryMessage: AssistantMessage = {
      id: createId('msg'),
      role: 'assistant',
      content: summaryContent.trim(),
      reasoning: '',
      toolCalls: [],
      round: 0,
      model: modelId,
      provider: settings.provider,
      createdAt: now,
      durationMs: 0,
    }
    compactedMessages.push(summaryMessage)

    // 3. Handoff note telling the AI to resume work.
    const handoffNote = buildHandoffNote(session.messages)
    const handoffMessage: UserMessage = {
      id: createId('msg'),
      role: 'user',
      content: handoffNote,
      createdAt: now,
    }
    compactedMessages.push(handoffMessage)

    // Atomically replace the session's messages with the compacted set.
    useChats.getState().updateSession(sessionId, {
      messages: compactedMessages,
    })

    window.dispatchEvent(
      new CustomEvent('maxcode:notice', {
        detail: {
          message: '✦ Context compacted — session summary saved, continuing with fresh context.',
          tone: 'success',
        },
      }),
    )

    return true
  } finally {
    compacting.delete(sessionId)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTranscript(messages: Message[]): string {
  const parts: string[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const attachmentNote =
        message.attachments && message.attachments.length > 0
          ? `\n[Attachments: ${message.attachments.map((a) => a.name).join(', ')}]`
          : ''
      parts.push(`[USER]\n${message.content}${attachmentNote}`)
    } else if (message.role === 'assistant') {
      const lines: string[] = []
      if (message.reasoning.trim()) lines.push(`<thinking>\n${message.reasoning.trim()}\n</thinking>`)
      if (message.content.trim()) lines.push(message.content.trim())
      for (const call of message.toolCalls) {
        lines.push(`<tool_call name="${call.name}">\n${JSON.stringify(call.args, null, 2)}\n</tool_call>`)
      }
      if (lines.length > 0) parts.push(`[ASSISTANT]\n${lines.join('\n\n')}`)
    } else if (message.role === 'tool') {
      const status = message.status === 'done' ? 'OK' : message.status.toUpperCase()
      const result = (message.result ?? '').slice(0, 8_000)
      const truncated = (message.result ?? '').length > 8_000 ? '\n… (truncated)' : ''
      parts.push(`[TOOL: ${message.call.name} — ${status}]\n${result}${truncated}`)
    }
  }
  return parts.join('\n\n---\n\n')
}

function buildHandoffNote(messages: Message[]): string {
  // Find the last user message to understand what was most recently requested.
  const reversed = [...messages].reverse()
  const lastUser = reversed.find((m): m is UserMessage => m.role === 'user')
  const lastUserContent = lastUser?.content?.trim() ?? ''

  // Count completed tool calls for context.
  const toolCalls = messages.filter((m) => m.role === 'tool').length
  const userTurns = messages.filter((m) => m.role === 'user').length

  return [
    `[CONTEXT COMPACTED — ${userTurns} user turns, ${toolCalls} tool calls summarised above]`,
    '',
    'The summary above contains the full record of work done so far. Please:',
    '1. Read the summary carefully before acting — it contains critical state information.',
    '2. Continue exactly where you left off.',
    '3. Do not repeat work already marked as completed in the summary.',
    lastUserContent ? `\nThe most recent task/request was:\n${lastUserContent}` : '',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}
