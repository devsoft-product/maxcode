import type { AssistantMessage, ToolMessage } from '../types'
import { activeModelId } from '../store/settings'
import { createId, useChats } from '../store/chats'
import { findModel } from '../store/models'
import { useRuntime } from '../store/ui'
import { useSettings } from '../store/settings'
import { getProviderName } from '../data/providers'
import { describeRequestError } from '../lib/sse'
import { buildSystemPrompt } from './prompt'
import { executeTool } from './tools'
import { waitForApproval } from './approval'
import { runSubagent } from './subagent'
import { streamModel } from './model'
import type { AdapterResult } from './adapters/shared'

const MAX_ROUNDS = 16
const controllers = new Map<string, AbortController>()

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function stopRun(sessionId: string) {
  controllers.get(sessionId)?.abort()
}

export function stopAllRuns() {
  controllers.forEach((controller) => controller.abort())
}

function truncate(value: string, limit = 40_000) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… truncated (${value.length - limit} more characters)`
}

export async function runAgent(sessionId: string): Promise<void> {
  if (controllers.has(sessionId)) return
  const session = useChats.getState().sessions.find((item) => item.id === sessionId)
  if (!session) return

  const controller = new AbortController()
  controllers.set(sessionId, controller)
  useRuntime.getState().setStreaming(sessionId, true)
  const settings = useSettings.getState()
  const providerName = getProviderName(settings.provider)
  const mode = session.mode ?? settings.mode
  const startedAt = Date.now()

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      if (controller.signal.aborted) break
      const current = useChats.getState().sessions.find((item) => item.id === sessionId)
      if (!current) break

      const history = current.messages.slice()
      const assistantId = createId('msg')
      const assistant: AssistantMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        reasoning: '',
        toolCalls: [],
        round,
        model: activeModelId(settings),
        provider: settings.provider,
        createdAt: Date.now(),
      }
      useChats.getState().addMessage(sessionId, assistant)

      let streamedContent = ''
      let streamedReasoning = ''
      let flushTimer: number | undefined
      let usage: AdapterResult['usage'] = {}

      const flush = () => {
        if (flushTimer !== undefined) return
        flushTimer = window.setTimeout(() => {
          flushTimer = undefined
          useChats.getState().updateMessage(sessionId, assistantId, {
            content: streamedContent,
            reasoning: streamedReasoning,
          })
        }, 40)
      }

      let result: AdapterResult
      try {
        result = await streamModel({
          settings,
          model: findModel(settings.provider, activeModelId(settings)),
          history,
          system: buildSystemPrompt(settings, mode),
          mode,
          signal: controller.signal,
          handlers: {
            onText: (delta) => {
              streamedContent += delta
              flush()
            },
            onReasoning: (delta) => {
              streamedReasoning += delta
              flush()
            },
            onToolCalls: () => undefined,
            onUsage: (value) => {
              usage = value
            },
          },
        })
      } catch (error) {
        if (flushTimer !== undefined) window.clearTimeout(flushTimer)
        const stopped = isAbortError(error) || controller.signal.aborted
        useChats.getState().updateMessage(sessionId, assistantId, {
          content: streamedContent,
          reasoning: streamedReasoning,
          stopped,
          durationMs: Date.now() - startedAt,
          error: stopped ? undefined : describeRequestError(error, providerName),
        })
        break
      }

      if (flushTimer !== undefined) window.clearTimeout(flushTimer)
      useChats.getState().updateMessage(sessionId, assistantId, {
        content: result.content,
        reasoning: result.reasoning,
        thinkingBlocks: result.thinkingBlocks,
        toolCalls: result.toolCalls,
        usage: usage.input || usage.output ? usage : result.usage,
        durationMs: Date.now() - startedAt,
        stopped: controller.signal.aborted || undefined,
      })
      useChats.getState().updateSession(sessionId, {
        provider: settings.provider,
        model: activeModelId(settings),
        mode,
      })

      if (controller.signal.aborted) break
      if (result.toolCalls.length === 0) break

      for (const call of result.toolCalls) {
        if (controller.signal.aborted) break
        const toolSetting = settings.tools[call.name]
        if (!toolSetting?.enabled) {
          const message: ToolMessage = {
            id: createId('tool'),
            role: 'tool',
            call,
            status: 'error',
            result: 'This tool is disabled in Settings → Tools.',
            round,
            createdAt: Date.now(),
          }
          useChats.getState().addMessage(sessionId, message)
          continue
        }

        const toolMessageId = createId('tool')
        const awaiting = toolSetting.approval === 'ask'
        const toolMessage: ToolMessage = {
          id: toolMessageId,
          role: 'tool',
          call,
          status: awaiting ? 'awaiting' : 'running',
          round,
          createdAt: Date.now(),
        }
        useChats.getState().addMessage(sessionId, toolMessage)

        if (awaiting) {
          const approved = await waitForApproval(call.id, controller.signal)
          if (!approved) {
            useChats.getState().updateMessage(sessionId, toolMessageId, {
              status: controller.signal.aborted ? 'error' : 'denied',
              result: controller.signal.aborted ? 'Stopped before the tool ran.' : 'You denied this tool call.',
              durationMs: 0,
            })
            if (controller.signal.aborted) break
            continue
          }
          useChats.getState().updateMessage(sessionId, toolMessageId, { status: 'running' })
        }

        const toolStarted = Date.now()
        try {
          const output =
            call.name === 'subagent'
              ? {
                  output: truncate(
                    await runSubagent(
                      typeof call.args.task === 'string' ? call.args.task : '',
                      typeof call.args.context === 'string' ? call.args.context : '',
                      controller.signal,
                    ),
                  ),
                  isError: false,
                }
              : await executeTool(call.name, call.args, settings, mode, controller.signal)
          useChats.getState().updateMessage(sessionId, toolMessageId, {
            status: output.isError ? 'error' : 'done',
            result: output.output,
            durationMs: Date.now() - toolStarted,
          })
        } catch (error) {
          const stopped = isAbortError(error)
          useChats.getState().updateMessage(sessionId, toolMessageId, {
            status: 'error',
            result: stopped ? 'Stopped.' : error instanceof Error ? error.message : 'The tool failed.',
            durationMs: Date.now() - toolStarted,
          })
          if (stopped) break
        }
      }

      // A stopped run must not leave an assistant tool call without a matching
      // tool result, or the next request would be rejected by the provider.
      if (controller.signal.aborted) {
        const latest = useChats.getState().sessions.find((item) => item.id === sessionId)
        if (latest) {
          const recorded = new Set(
            latest.messages
              .filter((message): message is ToolMessage => message.role === 'tool')
              .map((message) => message.call.id),
          )
          for (const call of result.toolCalls) {
            if (recorded.has(call.id)) continue
            useChats.getState().addMessage(sessionId, {
              id: createId('tool'),
              role: 'tool',
              call,
              status: 'error',
              result: 'Stopped before the tool ran.',
              round,
              createdAt: Date.now(),
            })
          }
        }
        break
      }
    }

    const finalSession = useChats.getState().sessions.find((item) => item.id === sessionId)
    if (!controller.signal.aborted && finalSession) {
      const last = finalSession.messages[finalSession.messages.length - 1]
      if (last?.role === 'tool') {
        const message: AssistantMessage = {
          id: createId('msg'),
          role: 'assistant',
          content: '',
          reasoning: '',
          toolCalls: [],
          round: MAX_ROUNDS,
          createdAt: Date.now(),
          error: `Stopped after ${MAX_ROUNDS} tool rounds. Send another message to continue.`,
        }
        useChats.getState().addMessage(sessionId, message)
      }
    }
  } finally {
    controllers.delete(sessionId)
    useRuntime.getState().setStreaming(sessionId, false)
  }
}

export function regenerateLastTurn(sessionId: string): boolean {
  const session = useChats.getState().sessions.find((item) => item.id === sessionId)
  if (!session || controllers.has(sessionId)) return false
  let lastUser = -1
  session.messages.forEach((message, index) => {
    if (message.role === 'user') lastUser = index
  })
  if (lastUser === -1) return false
  const kept = session.messages.slice(0, lastUser + 1)
  useChats.getState().updateSession(sessionId, { messages: kept })
  void runAgent(sessionId)
  return true
}
