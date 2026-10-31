import type {
  AgentMode,
  AppSettings,
  AssistantMessage,
  Message,
  ModelInfo,
  StreamHandlers,
  ToolCall,
  Usage,
} from '../../types'

export interface AdapterRequest {
  settings: AppSettings
  model: ModelInfo | null
  history: Message[]
  system: string
  mode: AgentMode
  signal: AbortSignal
  handlers: StreamHandlers
}

export interface AdapterResult {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  thinkingBlocks?: Array<{ text: string; signature?: string }>
  usage: Usage
}

export const EMPTY_HANDLERS: StreamHandlers = {
  onText: () => undefined,
  onReasoning: () => undefined,
  onToolCalls: () => undefined,
  onUsage: () => undefined,
}

export function userText(message: Extract<Message, { role: 'user' }>): string {
  const parts = [message.content]
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === 'text' && attachment.text) {
      parts.push(`\n\n--- Attached file: ${attachment.name} ---\n${attachment.text}`)
    }
  }
  return parts.filter(Boolean).join('')
}

export function assistantHistory(message: AssistantMessage): boolean {
  return Boolean(message.content.trim() || message.toolCalls.length > 0)
}

export function imageAttachments(message: Extract<Message, { role: 'user' }>) {
  return (message.attachments ?? []).filter(
    (attachment) => attachment.kind === 'image' && attachment.dataUrl,
  )
}

export function parseToolArgs(raw: string, toolName: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('arguments must be a JSON object')
  } catch (error) {
    throw new Error(`The model returned invalid arguments for ${toolName}: ${(error as Error).message}`)
  }
}

export function toolResultText(result: string | undefined, status: string): string {
  if (status === 'done') return result ?? '(no output)'
  if (status === 'denied') return 'The user denied this tool call.'
  if (status === 'error') return `Tool error: ${result ?? 'unknown error'}`
  if (status === 'awaiting') return 'The tool call was interrupted before approval.'
  return result ?? '(no output)'
}

export function collectToolCalls(
  candidates: Array<{ id: string; name: string; args: Record<string, unknown>; thoughtSignature?: string }>,
  available: Set<string>,
): ToolCall[] {
  const calls: ToolCall[] = []
  for (const candidate of candidates) {
    if (!candidate.name) continue
    if (!available.has(candidate.name)) {
      throw new Error(`The model requested a tool that is not enabled: ${candidate.name}`)
    }
    calls.push({
      id: candidate.id,
      name: candidate.name as ToolCall['name'],
      args: candidate.args,
      ...(candidate.thoughtSignature ? { thoughtSignature: candidate.thoughtSignature } : {}),
    })
  }
  return calls
}
