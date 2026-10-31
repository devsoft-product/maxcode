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

type OpenAIMessage = Record<string, unknown>

function buildMessages(history: Message[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []

  for (const message of history) {
    if (message.role === 'user') {
      const images = imageAttachments(message)
      if (images.length > 0) {
        const content: Array<Record<string, unknown>> = [
          { type: 'text', text: userText(message) || 'See the attached image.' },
        ]
        for (const image of images) {
          content.push({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } })
        }
        messages.push({ role: 'user', content })
      } else {
        const text = userText(message)
        if (text.trim()) messages.push({ role: 'user', content: text })
      }
      continue
    }

    if (message.role === 'assistant') {
      if (!assistantHistory(message)) continue
      const item: OpenAIMessage = {
        role: 'assistant',
        content: message.content || null,
      }
      if (message.toolCalls.length > 0) {
        item.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        }))
      }
      messages.push(item)
      continue
    }

    messages.push({
      role: 'tool',
      tool_call_id: message.call.id,
      content: toolResultText(message.result, message.status),
    })
  }

  return messages
}

function usesCompletionTokens(provider: string, modelId: string) {
  if (provider !== 'openai') return false
  return /^(gpt-5|o[1-9]|codex)/i.test(modelId)
}

export async function streamOpenAI(request: AdapterRequest): Promise<AdapterResult> {
  const { settings, model, history, system, mode, signal, handlers } = request
  const modelId = settings.model.trim()
  if (!modelId) throw new Error('Choose a model before sending a message.')
  const tools = getToolSchemas(settings, mode)
  const availableTools = new Set<string>(tools.map((tool) => tool.name))
  const modelTools = tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [{ role: 'system', content: system }, ...buildMessages(history)],
    stream: true,
  }
  if (modelTools.length > 0) {
    body.tools = modelTools
    body.tool_choice = 'auto'
  }
  if (settings.provider === 'openai' || settings.provider === 'openrouter') {
    body.stream_options = { include_usage: true }
  }
  if (usesCompletionTokens(settings.provider, modelId)) {
    body.max_completion_tokens = settings.maxTokens
  } else {
    body.max_tokens = settings.maxTokens
  }

  const efforts = effortValues(model)
  let reasoningEffort = ''
  if (settings.deepThink && efforts.length > 0) {
    reasoningEffort = normalizeEffort(settings.effort, model)
    if (settings.provider === 'openrouter') body.reasoning = { effort: reasoningEffort }
    else body.reasoning_effort = reasoningEffort
  }

  const supportsTemperature = model ? model.temperature : !usesCompletionTokens(settings.provider, modelId)
  if (!reasoningEffort && supportsTemperature) body.temperature = settings.temperature

  const response = await requestLLM(settings.provider, 'openai-chat', modelId, body, signal)

  let content = ''
  let reasoning = ''
  let usage: AdapterResult['usage'] = {}
  const toolAccumulator = new Map<number, { id: string; name: string; arguments: string }>()

  for await (const data of readSSE(response)) {
    if (data === '[DONE]') break
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      continue
    }

    if (payload.error) {
      const error = payload.error as { message?: string } | string
      throw new Error(typeof error === 'string' ? error : (error.message ?? 'The provider returned an error.'))
    }

    if (payload.usage && typeof payload.usage === 'object') {
      const value = payload.usage as { prompt_tokens?: number; completion_tokens?: number }
      usage = { input: value.prompt_tokens, output: value.completion_tokens }
      handlers.onUsage(usage)
    }

    const choices = payload.choices as
      | Array<{
          delta?: {
            content?: string
            reasoning?: string
            reasoning_content?: string
            reasoning_details?: Array<{ text?: string }>
            tool_calls?: Array<{
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
      | undefined
    const delta = choices?.[0]?.delta
    if (!delta) continue

    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      handlers.onText(delta.content)
    }
    const reasoningDelta =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : (delta.reasoning_details ?? []).map((item) => item.text ?? '').join('')
    if (reasoningDelta) {
      reasoning += reasoningDelta
      handlers.onReasoning(reasoningDelta)
    }

    for (const [fallbackIndex, call] of (delta.tool_calls ?? []).entries()) {
      const index = typeof call.index === 'number' ? call.index : fallbackIndex
      const existing = toolAccumulator.get(index) ?? { id: '', name: '', arguments: '' }
      if (call.id) existing.id = call.id
      if (call.function?.name) existing.name = call.function.name
      if (call.function?.arguments) existing.arguments += call.function.arguments
      toolAccumulator.set(index, existing)
    }
  }

  const toolCalls: ToolCall[] = []
  for (const [index, call] of [...toolAccumulator.entries()].sort((a, b) => a[0] - b[0])) {
    if (!call.name) continue
    if (!availableTools.has(call.name)) {
      throw new Error(`The model requested a tool that is not enabled: ${call.name}`)
    }
    toolCalls.push({
      id: call.id || `call_${Date.now().toString(36)}_${index}`,
      name: call.name as ToolCall['name'],
      args: parseToolArgs(call.arguments, call.name),
    })
  }
  if (toolCalls.length > 0) handlers.onToolCalls(toolCalls)

  return { content, reasoning, toolCalls, usage }
}
