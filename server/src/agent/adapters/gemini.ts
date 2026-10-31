import type { Message, ToolCall } from '../../types'
import { requestLLM } from '../../lib/daemon'
import { budgetForEffort, effortValues, hasBudget, normalizeEffort, hasToggle } from '../../lib/reasoning'
import { readSSE } from '../../lib/sse'
import { getToolSchemas } from '../tools'
import {
  assistantHistory,
  imageAttachments,
  toolResultText,
  userText,
  type AdapterRequest,
  type AdapterResult,
} from './shared'

interface GeminiContent {
  role: 'user' | 'model'
  parts: Array<Record<string, unknown>>
}

function buildContents(history: Message[]): GeminiContent[] {
  const contents: GeminiContent[] = []
  const push = (role: 'user' | 'model', parts: Array<Record<string, unknown>>) => {
    if (parts.length === 0) return
    const last = contents[contents.length - 1]
    if (last?.role === role) last.parts.push(...parts)
    else contents.push({ role, parts })
  }

  for (const message of history) {
    if (message.role === 'user') {
      const parts: Array<Record<string, unknown>> = []
      for (const image of imageAttachments(message)) {
        const match = /^data:([^;]+);base64,(.+)$/i.exec(image.dataUrl ?? '')
        if (!match) continue
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
      }
      const text = userText(message)
      if (text.trim()) parts.push({ text })
      if (parts.length === 0) parts.push({ text: '(empty message)' })
      push('user', parts)
      continue
    }

    if (message.role === 'assistant') {
      if (!assistantHistory(message)) continue
      const parts: Array<Record<string, unknown>> = []
      if (message.content.trim()) parts.push({ text: message.content })
      for (const call of message.toolCalls) {
        parts.push({
          functionCall: { name: call.name, args: call.args },
          ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
        })
      }
      push('model', parts)
      continue
    }

    push('user', [
      {
        functionResponse: {
          name: message.call.name,
          response: {
            result: toolResultText(message.result, message.status),
            ...(message.status === 'error' || message.status === 'denied' ? { isError: true } : {}),
          },
        },
      },
    ])
  }

  return contents
}

function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'additionalProperties' || key === '$schema') continue
    result[key] = cleanSchema(entry)
  }
  return result
}

export async function streamGemini(request: AdapterRequest): Promise<AdapterResult> {
  const { settings, model, history, system, mode, signal, handlers } = request
  const modelId = settings.model.trim()
  if (!modelId) throw new Error('Choose a model before sending a message.')

  const efforts = effortValues(model)
  const selectedEffort = normalizeEffort(settings.effort, model)
  const budget = hasBudget(model) ? budgetForEffort(selectedEffort, model) : 0
  const thinkingRequested = settings.deepThink && (efforts.length > 0 || budget > 0)
  let maxOutputTokens = settings.maxTokens
  if (thinkingRequested && budget > 0) {
    maxOutputTokens = Math.max(maxOutputTokens, budget + 2048)
    if (model?.maxOutput) maxOutputTokens = Math.min(maxOutputTokens, model.maxOutput)
  }

  const tools = getToolSchemas(settings, mode)

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens,
  }
  if (model ? model.temperature : true) generationConfig.temperature = settings.temperature
  if (thinkingRequested && efforts.length > 0) {
    // Gemini API requires UPPERCASE thinking level values: MINIMAL, LOW, MEDIUM, HIGH
    generationConfig.thinkingConfig = { thinkingLevel: selectedEffort.toUpperCase(), includeThoughts: true }
  } else if (thinkingRequested && budget > 0) {
    generationConfig.thinkingConfig = {
      thinkingBudget: Math.min(budget, Math.max(1024, maxOutputTokens - 1024)),
      includeThoughts: true,
    }
  } else if (settings.deepThink && hasToggle(model)) {
    generationConfig.thinkingConfig = { includeThoughts: true }
  }

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: buildContents(history),
    generationConfig,
  }
  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: cleanSchema(tool.parameters),
        })),
      },
    ]
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
  }

  const response = await requestLLM(settings.provider, 'gemini', modelId, body, signal)

  let content = ''
  let reasoning = ''
  let usage: AdapterResult['usage'] = {}
  let finishReason = ''
  const calls: Array<{ name: string; args: Record<string, unknown>; signature?: string }> = []
  const availableTools = new Set<string>(tools.map((tool) => tool.name))
  let pendingSignature: string | undefined

  for await (const data of readSSE(response)) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      continue
    }

    const error = payload.error as { message?: string } | undefined
    if (error?.message) throw new Error(error.message)

    const feedback = payload.promptFeedback as { blockReason?: string } | undefined
    if (feedback?.blockReason) {
      throw new Error(`Gemini blocked this request (${feedback.blockReason}).`)
    }

    const usageMetadata = payload.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
      | undefined
    if (usageMetadata) {
      usage = {
        input: usageMetadata.promptTokenCount,
        output:
          (usageMetadata.candidatesTokenCount ?? 0) + (usageMetadata.thoughtsTokenCount ?? 0) ||
          usageMetadata.candidatesTokenCount,
      }
      handlers.onUsage(usage)
    }

    const candidates = payload.candidates as
      | Array<{
          content?: { parts?: Array<Record<string, unknown>> }
          finishReason?: string
        }>
      | undefined
    const candidate = candidates?.[0]
    if (candidate?.finishReason) finishReason = candidate.finishReason
    for (const part of candidate?.content?.parts ?? []) {
      const partSignature = typeof part.thoughtSignature === 'string' ? part.thoughtSignature : undefined
      if (partSignature) pendingSignature = partSignature
      if (typeof part.text === 'string' && part.text) {
        if (part.thought === true) {
          reasoning += part.text
          handlers.onReasoning(part.text)
        } else {
          content += part.text
          handlers.onText(part.text)
        }
      }
      const functionCall = part.functionCall as
        | { name?: string; args?: Record<string, unknown> }
        | undefined
      if (functionCall?.name) {
        if (!availableTools.has(functionCall.name as ToolCall['name'])) {
          throw new Error(`Gemini requested a tool that is not enabled: ${functionCall.name}`)
        }
        calls.push({
          name: functionCall.name,
          args: functionCall.args ?? {},
          signature: partSignature ?? pendingSignature,
        })
        pendingSignature = undefined
      }
    }
  }

  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    throw new Error(`Gemini stopped the response (${finishReason.toLowerCase()}).`)
  }

  const toolCalls: ToolCall[] = calls.map((call, index) => ({
    id: `gemini_${Date.now().toString(36)}_${index}`,
    name: call.name as ToolCall['name'],
    args: call.args,
    thoughtSignature: call.signature,
  }))
  if (toolCalls.length > 0) handlers.onToolCalls(toolCalls)

  return { content, reasoning, toolCalls, usage }
}
