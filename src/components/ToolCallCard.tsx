import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  Copy,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderTree,
  GitBranch,
  Globe2,
  Link2,
  Search,
  ShieldQuestion,
  SquareTerminal,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ToolMessage, ToolName } from '../types'
import { toolLabel, toolSummary } from '../agent/tools'
import { resolveApproval } from '../agent/approval'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'
import { Spinner } from './ui'

const TOOL_ICONS: Record<ToolName, LucideIcon> = {
  shell: SquareTerminal,
  read_file: FileText,
  list_files: FolderTree,
  write_file: FilePlus2,
  edit_file: FilePenLine,
  rewrite_file: FilePenLine,
  grep: Search,
  web_search: Globe2,
  read_url: Link2,
  git: GitBranch,
  subagent: Bot,
}

function statusMeta(status: ToolMessage['status']) {
  switch (status) {
    case 'awaiting':
      return { label: 'Needs approval', className: 'text-warning', dot: 'bg-warning' }
    case 'running':
      return { label: 'Running', className: 'text-accent', dot: 'bg-accent' }
    case 'done':
      return { label: 'Done', className: 'text-success', dot: 'bg-success' }
    case 'denied':
      return { label: 'Denied', className: 'text-muted', dot: 'bg-faint' }
    default:
      return { label: 'Failed', className: 'text-danger', dot: 'bg-danger' }
  }
}

function durationLabel(ms?: number) {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function approvalCopy(name: ToolName) {
  switch (name) {
    case 'shell':
      return 'MaxCode wants to run this command in the open workspace.'
    case 'write_file':
      return 'MaxCode wants to create or overwrite this file on disk.'
    case 'edit_file':
    case 'rewrite_file':
      return 'MaxCode wants to change this file on disk.'
    case 'git':
      return 'MaxCode wants to change the Git state of this repository.'
    case 'subagent':
      return 'MaxCode wants to start a read-only subagent to investigate.'
    case 'web_search':
      return 'MaxCode wants to search the web.'
    case 'read_url':
      return 'MaxCode wants to read this public page.'
    default:
      return 'MaxCode wants to use this tool.'
  }
}

export function ToolCallCard({ message, compact = false }: { message: ToolMessage; compact?: boolean }) {
  const [open, setOpen] = useState((!compact && message.status === 'awaiting') || message.status === 'error')
  const [copied, setCopied] = useState(false)
  const notify = useUi((state) => state.notify)
  const status = statusMeta(message.status)
  const Icon = TOOL_ICONS[message.call.name] ?? SquareTerminal
  const summary = toolSummary(message.call.name, message.call.args)
  const args = message.call.args
  const command = typeof args.command === 'string' ? args.command : ''
  const content =
    typeof args.content === 'string'
      ? args.content
      : typeof args.newText === 'string'
        ? args.newText
        : typeof args.oldText === 'string'
          ? args.oldText
          : ''

  useEffect(() => {
    if (message.status === 'awaiting' || message.status === 'error') setOpen(true)
  }, [message.status])

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(message.result ?? '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-panel transition-colors',
        message.status === 'awaiting' ? 'border-warning/40' : 'border-line',
        message.status === 'error' && 'border-danger/30',
      )}
    >
      <div className="flex items-center gap-1.5 pr-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
          aria-expanded={open}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-raised text-muted">
            <Icon size={13} strokeWidth={1.8} />
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 text-[12px] font-medium text-ink">{toolLabel(message.call.name)}</span>
            <span className="truncate font-mono text-[11px] text-muted">{summary || '—'}</span>
          </span>
        </button>
        <span className={cn('flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium', status.className)}>
          {message.status === 'running' ? (
            <Spinner size={11} />
          ) : (
            <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          )}
          <span className="hidden sm:inline">
            {status.label}
            {message.status === 'done' && message.durationMs !== undefined
              ? ` · ${durationLabel(message.durationMs)}`
              : ''}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="icon-button h-7 w-7"
          aria-label={open ? 'Collapse tool details' : 'Expand tool details'}
        >
          <ChevronDown size={14} className={cn('transition-transform duration-150', open && 'rotate-180')} />
        </button>
      </div>

      {message.status === 'running' && (
        <div className="h-px w-full overflow-hidden bg-line">
          <div className="h-full w-1/3 animate-shimmer bg-[linear-gradient(90deg,transparent,rgb(var(--accent)),transparent)] bg-[length:200%_100%]" />
        </div>
      )}

      {message.status === 'awaiting' && (
        <div className="border-t border-warning/25 bg-warning/[0.045] px-3 py-2.5">
          <div className="flex items-start gap-2">
            <ShieldQuestion size={15} className="mt-0.5 shrink-0 text-warning" />
            <p className="flex-1 text-[11.5px] leading-relaxed text-muted">{approvalCopy(message.call.name)}</p>
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => resolveApproval(message.call.id, false)}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-panel px-2.5 text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
            >
              <X size={12} />
              Deny
            </button>
            <button
              type="button"
              onClick={() => resolveApproval(message.call.id, true)}
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-ink px-2.5 text-[11.5px] font-medium text-panel transition-opacity hover:opacity-85"
            >
              <Check size={12} />
              Allow once
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-line">
          {(command || content) && (
            <div className="px-3 pt-2.5">
              {command && <pre className="thin-scroll max-h-40 overflow-auto rounded-lg border border-line bg-raised/60 p-2.5 font-mono text-[11.5px] leading-relaxed text-ink">$ {command}</pre>}
              {content && (
                <pre className="thin-scroll mt-2 max-h-48 overflow-auto rounded-lg border border-line bg-raised/60 p-2.5 font-mono text-[11px] leading-relaxed text-muted">
                  {content.length > 4000 ? `${content.slice(0, 4000)}\n… ${content.length - 4000} more characters` : content}
                </pre>
              )}
            </div>
          )}

          {message.result !== undefined && (
            <div className="px-3 pb-3 pt-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="soft-label">{message.status === 'error' ? 'Error' : 'Output'}</span>
                <button
                  type="button"
                  onClick={copyOutput}
                  className="inline-flex items-center gap-1 text-[10.5px] font-medium text-faint transition-colors hover:text-ink"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre
                className={cn(
                  'thin-scroll max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-2.5 font-mono text-[11.5px] leading-[1.65]',
                  message.status === 'error'
                    ? 'border-danger/20 bg-danger/[0.04] text-danger'
                    : 'border-line bg-raised/50 text-muted',
                )}
              >
                {message.result || '(no output)'}
              </pre>
            </div>
          )}

          {message.result === undefined && !command && !content && message.status !== 'awaiting' && (
            <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-muted">
              {message.status === 'running' ? <Spinner size={12} /> : <AlertCircle size={12} />}
              {message.status === 'running' ? 'Working…' : 'No result was recorded.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
