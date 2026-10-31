import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  RefreshCw,
  Settings2,
  Square,
  Wrench,
} from 'lucide-react'
import type { AssistantMessage, Message, ToolMessage, UserMessage } from '../types'
import { useUi } from '../store/ui'
import { useSettings } from '../store/settings'
import { useModelCatalog } from '../store/models'
import { regenerateLastTurn } from '../agent'
import { toolLabel } from '../agent/tools'
import { formatBytes, cn } from '../lib/utils'
import { LogoMark } from './Logo'
import { Markdown } from './Markdown'
import { ToolCallCard } from './ToolCallCard'
import { Spinner } from './ui'

function formatTokens(value?: number) {
  if (!value) return ''
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function UserBubble({ message }: { message: UserMessage }) {
  const images = (message.attachments ?? []).filter((attachment) => attachment.kind === 'image')
  const files = (message.attachments ?? []).filter((attachment) => attachment.kind === 'text')
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] sm:max-w-[82%]">
        {images.length > 0 && (
          <div className={cn('mb-2 grid gap-2', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
            {images.map((image) => (
              <img
                key={image.id}
                src={image.dataUrl}
                alt={image.name}
                className="max-h-52 w-full rounded-xl border border-line object-cover"
              />
            ))}
          </div>
        )}
        <div className="rounded-2xl rounded-br-md border border-line/70 bg-raised px-4 py-2.5">
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {files.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[10.5px] text-muted"
                >
                  <FileText size={11} />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  <span className="text-faint">{formatBytes(file.size)}</span>
                </span>
              ))}
            </div>
          )}
          {message.content && (
            <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.65] text-ink">{message.content}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function UsedGroup({ tools }: { tools: ToolMessage[] }) {
  const [open, setOpen] = useState(false)
  const autoOpened = useRef(false)
  const active = tools.some((tool) => tool.status === 'running' || tool.status === 'awaiting')

  useEffect(() => {
    if (active) {
      autoOpened.current = true
      setOpen(true)
    } else if (autoOpened.current) {
      autoOpened.current = false
      setOpen(false)
    }
  }, [active])

  if (tools.length === 0) return null
  const labels = [...new Set(tools.map((tool) => toolLabel(tool.call.name)))]
  const failed = tools.filter((tool) => tool.status === 'error' || tool.status === 'denied').length
  const summary = labels.length <= 2 ? labels.join(' · ') : `${labels.slice(0, 2).join(' · ')} +${labels.length - 2}`

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line/80 bg-raised/30">
      <button
        type="button"
        onClick={() => {
          autoOpened.current = false
          setOpen((value) => !value)
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <Wrench size={12} className="shrink-0 text-faint" />
        <span className="text-[11.5px] font-medium text-muted">Used {tools.length} tool{tools.length === 1 ? '' : 's'}</span>
        <span className="min-w-0 truncate text-[10.5px] text-faint">{summary}</span>
        {failed > 0 && <span className="shrink-0 text-[10px] text-danger">{failed} failed</span>}
        {active ? (
          <Spinner size={11} className="ml-auto shrink-0 text-accent" />
        ) : (
          <ChevronDown
            size={13}
            className={cn('ml-auto shrink-0 text-faint transition-transform', open && 'rotate-180')}
          />
        )}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-line/70 p-1.5">
          {tools.map((tool) => (
            <ToolCallCard key={tool.id} message={tool} compact />
          ))}
        </div>
      )}
    </div>
  )
}

function AssistantBlock({
  message,
  sessionId,
  streaming,
  isLastAssistant,
  tools,
}: {
  message: AssistantMessage
  sessionId: string
  streaming: boolean
  isLastAssistant: boolean
  tools: ToolMessage[]
}) {
  const notify = useUi((state) => state.notify)
  const openSettings = useUi((state) => state.openSettings)
  const showTokenEstimate = useSettings((state) => state.showTokenEstimate)
  const providerModels = useModelCatalog((state) =>
    message.provider ? state.byProvider[message.provider] : undefined,
  )
  const [copied, setCopied] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(streaming)
  const hasBody = Boolean(message.content.trim() || message.reasoning.trim() || message.error || tools.length > 0)
  const modelName =
    providerModels?.find((model) => model.id === message.model)?.name ?? message.model ?? ''
  const needsConfig = Boolean(message.error && /api key|base url|settings|credential|403|401/i.test(message.error))
  const tokenBits: string[] = []
  if (message.usage?.input) tokenBits.push(`${formatTokens(message.usage.input)} in`)
  if (message.usage?.output) tokenBits.push(`${formatTokens(message.usage.output)} out`)
  else if (showTokenEstimate && message.content.trim()) {
    tokenBits.push(`~${formatTokens(Math.ceil(message.content.length / 4))} out`)
  }
  const metaLine = [
    modelName,
    ...tokenBits,
    message.durationMs ? `${(message.durationMs / 1000).toFixed(1)}s` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  useEffect(() => {
    if (streaming) setReasoningOpen(true)
  }, [streaming])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  if (!hasBody && !streaming) {
    return (
      <div className="group flex gap-3">
        <LogoMark size={25} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
            MaxCode
            {modelName && <span className="font-normal text-faint">{modelName}</span>}
          </div>
          <p className="mt-2 text-[13px] text-muted">The model returned an empty response.</p>
          {isLastAssistant && (
            <button
              type="button"
              onClick={() => regenerateLastTurn(sessionId)}
              className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent hover:underline"
            >
              <RefreshCw size={12} /> Try again
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="group flex gap-3">
      <LogoMark size={25} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-[25px] items-center gap-2 text-[12px]">
          <span className="font-semibold text-ink">MaxCode</span>
          {modelName && <span className="truncate font-normal text-faint">{modelName}</span>}
          {message.stopped && (
            <span className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[9.5px] font-medium text-muted">
              <Square size={7} fill="currentColor" />
              Stopped
            </span>
          )}
        </div>

        {message.reasoning.trim() && (
          <div className="mt-1.5 overflow-hidden rounded-lg border border-line/70 bg-raised/40">
            <button
              type="button"
              onClick={() => setReasoningOpen((value) => !value)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
              aria-expanded={reasoningOpen}
            >
              <Brain size={12} className="text-faint" />
              <span className="text-[11.5px] font-medium text-faint">
                {streaming ? 'Thinking' : 'Reasoning'}
              </span>
              {streaming && <span className="animate-pulse text-accent">…</span>}
              <ChevronDown
                size={12}
                className={cn('ml-auto text-faint transition-transform', reasoningOpen && 'rotate-180')}
              />
            </button>
            {reasoningOpen && (
              <div className="thin-scroll max-h-72 overflow-y-auto border-t border-line/60 px-3 py-2.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.65] text-muted">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {message.content && (
          <div className="mt-2">
            <Markdown content={message.content} streaming={streaming} />
          </div>
        )}

        {streaming && !message.content && !message.reasoning && (
          <div className="mt-2 flex items-center gap-2 text-[13px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" />
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent [animation-delay:160ms]" />
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent [animation-delay:320ms]" />
            </span>
            Working
          </div>
        )}

        <UsedGroup tools={tools} />

        {message.error && (
          <div className="mt-3 rounded-xl border border-danger/25 bg-danger/[0.045] px-3.5 py-3">
            <div className="flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-ink">The request did not finish</p>
                <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{message.error}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {needsConfig && (
                    <button
                      type="button"
                      onClick={() => openSettings('models')}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[11.5px] font-medium text-ink hover:bg-raised"
                    >
                      <Settings2 size={12} />
                      Open model settings
                    </button>
                  )}
                  {isLastAssistant && (
                    <button
                      type="button"
                      onClick={() => regenerateLastTurn(sessionId)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[11.5px] font-medium text-ink hover:bg-raised"
                    >
                      <RefreshCw size={12} />
                      Try again
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {hasBody && !streaming && (
          <div className="mt-1.5 flex min-h-[24px] flex-wrap items-center gap-0.5 text-[10.5px] text-faint">
            {message.content && (
              <button
                type="button"
                onClick={copy}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-raised hover:text-muted"
                aria-label="Copy response"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            {isLastAssistant && (
              <button
                type="button"
                onClick={() => regenerateLastTurn(sessionId)}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-raised hover:text-muted"
                aria-label="Regenerate response"
              >
                <RefreshCw size={11} />
                Regenerate
              </button>
            )}
            <span className="ml-1.5">{metaLine}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function MessageItem({
  message,
  sessionId,
  streaming,
  isLastAssistant,
  tools = [],
}: {
  message: Message
  sessionId: string
  streaming: boolean
  isLastAssistant: boolean
  tools?: ToolMessage[]
}) {
  if (message.role === 'user') return <UserBubble message={message} />
  if (message.role === 'tool') {
    return (
      <div className="sm:ml-[37px]">
        <ToolCallCard message={message} />
      </div>
    )
  }
  return (
    <AssistantBlock
      message={message}
      sessionId={sessionId}
      streaming={streaming}
      isLastAssistant={isLastAssistant}
      tools={tools}
    />
  )
}
