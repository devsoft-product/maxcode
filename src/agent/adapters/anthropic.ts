import type { Message, ToolCall } from '../../types'
import { requestLLM } from '../../lib/daemon'
import { budgetForEffort, effortValues, hasBudget, normalizeEffort } from '../../lib/reasoning'
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

type AnthropicBlock = Record<string, unknown>
type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] }

function buildMessages(history: Message[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = []
  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return
    const last = messages[messages.length - 1]
    if (last?.role === role) last.content.push(...blocks)
    else messages.push({ role, content: blocks })
  }

  for (const message of history) {
    if (message.role === 'user') {
      const blocks: AnthropicBlock[] = []
      for (const image of imageAttachments(message)) {
        const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(image.dataUrl ?? '')
        if (!match) continue
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: match[1], data: match[2] },
        })
      }
      const text = userText(message)
      if (text.trim()) blocks.push({ type: 'text', text })
      if (blocks.length === 0) blocks.push({ type: 'text', text: '(empty message)' })
      push('user', blocks)
      continue
    }

    if (message.role === 'assistant') {
      if (!assistantHistory(message)) continue
      const blocks: AnthropicBlock[] = []
      for (const thinking of message.thinkingBlocks ?? []) {
        if (thinking.signature) {
          blocks.push({ type: 'thinking', thinking: thinking.text, signature: thinking.signature })
        }
      }
      if (message.content.trim()) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args })
      }
      push('assistant', blocks)
      continue
    }

    push('user', [
      {
        type: 'tool_result',
        tool_use_id: message.call.id,
        content: toolResultText(message.result, message.status),
        is_error: message.status === 'error' || message.status === 'denied',
      },
    ])
  }

  return messages
}

export async function streamAnthropic(request: AdapterRequest): Promise<AdapterResult> {
  const { settings, model, history, system, mode, signal, handlers } = request
  const modelId = settings.model.trim()
  if (!modelId) throw new Error('Choose a model before sending a message.')

  const efforts = effortValues(model)
  const selectedEffort = normalizeEffort(settings.effort, model)
  const thinkingRequested = selectedEffort !== 'none' && (efforts.length > 0 || hasBudget(model))

  let maxTokens = settings.maxTokens
  let budget = 0
  if (thinkingRequested && efforts.length === 0 && hasBudget(model)) {
    budget = budgetForEffort(selectedEffort, model)
    maxTokens = Math.max(settings.maxTokens, budget + 1024)
    if (model?.maxOutput) maxTokens = Math.min(maxTokens, model.maxOutput)
    budget = Math.min(budget, maxTokens - 1024)
    if (budget < 1024) budget = 0
  }

  const tools = getToolSchemas(settings, mode).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: maxTokens,
    system,
    messages: buildMessages(history),
    stream: true,
  }
  if (tools.length > 0) body.tools = tools
  if (thinkingRequested && efforts.length > 0) {
    // Anthropic output_config.effort only accepts: low, medium, high, xhigh, max
    // Map unsupported values (none, minimal) to the closest valid value.
    const anthropicEffort: string = selectedEffort === 'minimal' ? 'low' : selectedEffort
    body.output_config = { effort: anthropicEffort }
  } else if (budget > 0) {
    body.thinking = { type: 'enabled', budget_tokens: budget }
  } else if (!thinkingRequested) {
    const supportsTemperature = model ? model.temperature : true
    if (supportsTemperature) body.temperature = settings.temperature
  }

  const response = await requestLLM(settings.provider, 'anthropic', modelId, body, signal)

  let content = ''
  let reasoning = ''
  let usage: AdapterResult['usage'] = {}
  const blocks = new Map<
    number,
    {
      type: string
      text: string
      signature: string
      id: string
      name: string
      json: string
      input: unknown
    }
  >()

  for await (const data of readSSE(response)) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      continue
    }
    const type = payload.type

    if (type === 'error') {
      const error = payload.error as { message?: string } | string | undefined
      throw new Error(typeof error === 'string' ? error : (error?.message ?? 'Anthropic returned an error.'))
    }

    if (type === 'message_start') {
      const message = payload.message as { usage?: { input_tokens?: number } } | undefined
      usage = { ...usage, input: message?.usage?.input_tokens }
      continue
    }

    if (type === 'content_block_start') {
      const index = Number(payload.index ?? blocks.size)
      const block = payload.content_block as Record<string, unknown>
      blocks.set(index, {
        type: String(block.type ?? ''),
        text: typeof block.text === 'string' ? block.text : typeof block.thinking === 'string' ? block.thinking : '',
        signature: typeof block.signature === 'string' ? block.signature : '',
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : '',
        json: '',
        input: block.input,
      })
      continue
    }

    if (type === 'content_block_delta') {
      const index = Number(payload.index ?? 0)
      const entry = blocks.get(index)
      const delta = payload.delta as Record<string, unknown> | undefined
      if (!entry || !delta) continue
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        entry.text += delta.text
        content += delta.text
        handlers.onText(delta.text)
      } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        entry.text += delta.thinking
        reasoning += delta.thinking
        handlers.onReasoning(delta.thinking)
      } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
        entry.signature += delta.signature
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        entry.json += delta.partial_json
      }
      continue
    }

    if (type === 'message_delta') {
      const deltaUsage = payload.usage as { output_tokens?: number } | undefined
      usage = { ...usage, output: deltaUsage?.output_tokens ?? usage.output }
      handlers.onUsage(usage)
      continue
    }

    if (type === 'message_stop') break
  }

  const availableTools = new Set<string>(tools.map((tool) => tool.name))
  const toolCalls: ToolCall[] = []
  const thinkingBlocks: Array<{ text: string; signature?: string }> = []
  for (const [, block] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    if (block.type === 'tool_use' && block.name) {
      if (!availableTools.has(block.name)) {
        throw new Error(`The model requested a tool that is not enabled: ${block.name}`)
      }
      const args = block.json
        ? parseToolArgs(block.json, block.name)
        : block.input && typeof block.input === 'object'
          ? (block.input as Record<string, unknown>)
          : {}
      toolCalls.push({
        id: block.id || `call_${Date.now().toString(36)}_${toolCalls.length}`,
        name: block.name as ToolCall['name'],
        args,
      })
    }
    if (block.type === 'thinking' && block.text) {
      thinkingBlocks.push({
        text: block.text,
        signature: block.signature || undefined,
      })
    }
  }
  if (toolCalls.length > 0) handlers.onToolCalls(toolCalls)

  return { content, reasoning, toolCalls, thinkingBlocks, usage }
}
