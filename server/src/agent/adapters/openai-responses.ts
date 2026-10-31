import type { Message, ToolCall } from '../../types'
import { requestLLM } from '../../lib/daemon'
import { effortValues, normalizeEffort } from '../../lib/reasoning'
import { readSSE } from '../../lib/sse'
import { getToolSchemas } from '../tools'
import {
  assistantHistory,
  imageAttachments,
  parseToolArgs,
  toolResultText,
  userText,
  type AdapterRequest,
  type AdapterResult,
} from './shared'

function buildInput(history: Message[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []

  for (const message of history) {
    if (message.role === 'user') {
      const images = imageAttachments(message)
      const text = userText(message) || (images.length > 0 ? 'See the attached image.' : '')
      if (!text.trim() && images.length === 0) continue
      if (images.length === 0) {
        input.push({ role: 'user', content: text })
        continue
      }
      const content: Array<Record<string, unknown>> = [{ type: 'input_text', text }]
      for (const image of images) {
        content.push({ type: 'input_image', image_url: image.dataUrl, detail: 'auto' })
      }
      input.push({ role: 'user', content })
      continue
    }

    if (message.role === 'assistant') {
      if (!assistantHistory(message)) continue
      if (message.content.trim()) {
        input.push({ role: 'assistant', content: message.content })
      }
      for (const call of message.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args),
        })
      }
      continue
    }

    input.push({
      type: 'function_call_output',
      call_id: message.call.id,
      output: toolResultText(message.result, message.status),
    })
  }

  return input
}

interface PendingCall {
  id: string
  name: string
  args: string
  order: number
}

function itemRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export async function streamOpenAIResponses(request: AdapterRequest): Promise<AdapterResult> {
  const { settings, model, history, system, mode, signal, handlers } = request
  const modelId = settings.model.trim()
  if (!modelId) throw new Error('Choose a model before sending a message.')
  const tools = getToolSchemas(settings, mode)
  const availableTools = new Set<string>(tools.map((tool) => tool.name))

  const body: Record<string, unknown> = {
    model: modelId,
    instructions: system,
    input: buildInput(history),
    max_output_tokens: settings.maxTokens,
    tool_choice: 'auto',
  }
  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    }))
  }

  const efforts = effortValues(model)
  if (settings.deepThink && efforts.length > 0) {
    body.reasoning = { effort: normalizeEffort(settings.effort, model) }
  }

  const response = await requestLLM(settings.provider, 'openai-responses', modelId, body, signal)

  let content = ''
  let reasoning = ''
  let usage: AdapterResult['usage'] = {}
  const calls = new Map<string, PendingCall>()
  let order = 0

  const upsertCall = (key: string, item: Record<string, unknown>) => {
    const existing = calls.get(key)
    const id = typeof item.call_id === 'string' ? item.call_id : existing?.id || key
    const name = typeof item.name === 'string' ? item.name : existing?.name || ''
    const args = typeof item.arguments === 'string' ? item.arguments : existing?.args || ''
    calls.set(key, { id, name, args, order: existing?.order ?? order++ })
  }

  for await (const data of readSSE(response)) {
    if (data === '[DONE]') break
    let event: Record<string, unknown>
    try {
      event = JSON.parse(data) as Record<string, unknown>
    } catch {
      continue
    }
    const type = typeof event.type === 'string' ? event.type : ''

    if (type === 'error' || type === 'response.failed') {
      const detail = itemRecord(event.response).error ?? event.error ?? event.message
      const error = itemRecord(detail)
      throw new Error(
        typeof detail === 'string'
          ? detail
          : typeof error.message === 'string'
            ? error.message
            : 'The model request failed.',
      )
    }

    if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
      content += event.delta
      handlers.onText(event.delta)
      continue
    }

    if (
      (type === 'response.reasoning_summary_text.delta' ||
        type === 'response.reasoning_text.delta') &&
      typeof event.delta === 'string'
    ) {
      reasoning += event.delta
      handlers.onReasoning(event.delta)
      continue
    }

    if (type === 'response.output_item.added') {
      const item = itemRecord(event.item)
      if (item.type === 'function_call') {
        const key = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : ''
        if (key) upsertCall(key, item)
      }
      continue
    }

    if (type === 'response.function_call_arguments.delta') {
      const key = typeof event.item_id === 'string' ? event.item_id : ''
      const entry = key ? calls.get(key) : undefined
      if (entry && typeof event.delta === 'string') entry.args += event.delta
      continue
    }

    if (type === 'response.function_call_arguments.done') {
      const key = typeof event.item_id === 'string' ? event.item_id : ''
      const entry = key ? calls.get(key) : undefined
      if (entry && typeof event.arguments === 'string') entry.args = event.arguments
      continue
    }

    if (type === 'response.output_item.done') {
      const item = itemRecord(event.item)
      if (item.type === 'function_call') {
        const key = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : ''
        if (key) upsertCall(key, item)
      }
      continue
    }

    if (type === 'response.completed') {
      const done = itemRecord(event.response)
      const value = itemRecord(done.usage)
      if (typeof value.input_tokens === 'number' || typeof value.output_tokens === 'number') {
        usage = { input: Number(value.input_tokens) || undefined, output: Number(value.output_tokens) || undefined }
        handlers.onUsage(usage)
      }
    }
  }

  const toolCalls: ToolCall[] = []
  const pending = [...calls.entries()].sort((a, b) => a[1].order - b[1].order)
  for (const [key, call] of pending) {
    if (!call.name) continue
    if (!availableTools.has(call.name)) {
      throw new Error(`The model requested a tool that is not enabled: ${call.name}`)
    }
    toolCalls.push({
      id: call.id || key,
      name: call.name as ToolCall['name'],
      args: parseToolArgs(call.args, call.name),
    })
  }
  if (toolCalls.length > 0) handlers.onToolCalls(toolCalls)

  return { content, reasoning, toolCalls, usage }
}
