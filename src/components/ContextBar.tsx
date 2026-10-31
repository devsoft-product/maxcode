/**
 * ContextBar — compact context-usage indicator shown in the TopBar.
 *
 * Displays a segmented progress bar and a token estimate. When the session
 * is being compacted it shows a pulsing "Compacting…" state. Colour grades
 * from neutral → amber → red as the context fills up.
 */

import { useMemo } from 'react'
import { Zap, AlertTriangle } from 'lucide-react'
import type { ModelInfo, Message } from '../types'
import { getContextUsage, AUTO_COMPACT_THRESHOLD } from '../lib/context'
import { isCompacting } from '../agent/compact'
import { cn } from '../lib/utils'

interface ContextBarProps {
  messages: Message[]
  model: ModelInfo | null
  sessionId: string | null
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

export function ContextBar({ messages, model, sessionId }: ContextBarProps) {
  const usage = useMemo(() => getContextUsage(messages, model), [messages, model])
  const compacting = sessionId ? isCompacting(sessionId) : false

  if (messages.length === 0) return null

  const { pct, used, limit } = usage

  // Colour thresholds
  const isWarning = pct >= 70 && pct < AUTO_COMPACT_THRESHOLD * 100
  const isDanger = pct >= AUTO_COMPACT_THRESHOLD * 100
  const isCritical = pct >= 95

  const barColor = isCritical
    ? 'bg-red-500'
    : isDanger
      ? 'bg-orange-500'
      : isWarning
        ? 'bg-amber-400'
        : 'bg-accent'

  const textColor = isCritical
    ? 'text-red-400'
    : isDanger
      ? 'text-orange-400'
      : isWarning
        ? 'text-amber-400'
        : 'text-faint'

  return (
    <div
      className={cn(
        'hidden items-center gap-2 sm:flex',
        'h-7 rounded-md border border-line/60 bg-base/40 px-2.5 text-[9.5px]',
        isDanger && 'border-orange-500/30 bg-orange-500/5',
        isCritical && 'border-red-500/40 bg-red-500/8',
      )}
      title={`Context: ~${formatTokens(used)} / ${formatTokens(limit)} tokens (${pct}%)`}
    >
      {compacting ? (
        <span className="flex items-center gap-1.5 animate-pulse text-accent">
          <Zap size={9} className="shrink-0" />
          Compacting…
        </span>
      ) : (
        <>
          {/* Icon */}
          {isDanger ? (
            <AlertTriangle size={9} className={cn('shrink-0', textColor)} />
          ) : (
            <Zap size={9} className={cn('shrink-0', textColor)} />
          )}

          {/* Progress bar */}
          <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-raised/80">
            <div
              className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', barColor)}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>

          {/* Percentage label */}
          <span className={cn('tabular-nums', textColor)}>
            {pct}%
          </span>

          {/* Token estimate */}
          <span className="text-faint/60">
            {formatTokens(used)}/{formatTokens(limit)}
          </span>
        </>
      )}
    </div>
  )
}
