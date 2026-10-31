import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  Cpu,
  KeyRound,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react'
import { PROVIDERS, PROVIDER_MAP, effortLabel } from '../data/providers'
import type { Effort, ModelInfo, ProviderId } from '../types'
import {
  activeModelId,
  providerHasCredentials,
  useSettings,
} from '../store/settings'
import { useModelCatalog } from '../store/models'
import { useUi } from '../store/ui'
import { useClickOutside } from '../lib/hooks'
import { defaultEffort, effortOptions, reasoningSummary } from '../lib/reasoning'
import { cn } from '../lib/utils'
import { Spinner } from './ui'

const NO_MODELS: ModelInfo[] = []

interface PickerPosition {
  placement: 'top' | 'bottom'
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

function connected(providerId: ProviderId) {
  return providerHasCredentials(useSettings.getState(), providerId)
}

function contextLabel(context?: number) {
  if (!context) return ''
  if (context >= 1_000_000) return `${(context / 1_000_000).toFixed(context % 1_000_000 ? 1 : 0)}M`
  return `${Math.round(context / 1000)}k`
}

export function ModelPicker({
  open,
  onClose,
  triggerRef,
}: {
  open: boolean
  onClose: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}) {
  const settings = useSettings()
  const selectModel = useSettings((state) => state.selectModel)
  const update = useSettings((state) => state.update)
  const openSettings = useUi((state) => state.openSettings)
  const panelRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)

  const provider = settings.provider
  const models = useModelCatalog((state) => state.byProvider[provider]) ?? NO_MODELS
  const loading = useModelCatalog((state) => Boolean(state.loading[provider]))
  const error = useModelCatalog((state) => state.errors[provider] ?? '')
  const note = useModelCatalog((state) => state.notes[provider] ?? '')
  const source = useModelCatalog((state) => state.source[provider] ?? '')
  const fetchModels = useModelCatalog((state) => state.fetchModels)

  useClickOutside(panelRef, onClose, open, triggerRef)

  const [position, setPosition] = useState<PickerPosition | null>(null)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const panelWidth = Math.min(viewportWidth - 24, 440)

    let left = rect.left
    if (left + panelWidth > viewportWidth - 12) {
      left = Math.max(12, viewportWidth - panelWidth - 12)
    }
    if (left < 12) left = 12

    const spaceAbove = rect.top - 16
    const spaceBelow = viewportHeight - rect.bottom - 16

    const openAbove = spaceAbove >= 320 || spaceAbove >= spaceBelow

    if (openAbove) {
      const maxHeight = Math.min(560, Math.max(220, spaceAbove))
      setPosition({
        placement: 'top',
        bottom: viewportHeight - rect.top + 8,
        left,
        width: panelWidth,
        maxHeight,
      })
    } else {
      const maxHeight = Math.min(560, Math.max(220, spaceBelow))
      setPosition({
        placement: 'bottom',
        top: rect.bottom + 8,
        left,
        width: panelWidth,
        maxHeight,
      })
    }
  }, [triggerRef])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  const modelId = activeModelId(settings)
  const active = models.find((model) => model.id === modelId) ?? null
  const connectedNow = connected(provider)

  useEffect(() => {
    if (!open) return
    if (connectedNow || provider === 'custom' || PROVIDER_MAP[provider]?.keyless) {
      void fetchModels(provider)
    }
  }, [open, provider, connectedNow, fetchModels])

  useEffect(() => {
    if (!open) {
      setProviderOpen(false)
      setShowManual(false)
      setQuery('')
    }
  }, [open])

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase()
    if (!clean) return models
    return models.filter(
      (model) => model.name.toLowerCase().includes(clean) || model.id.toLowerCase().includes(clean),
    )
  }, [models, query])

  const efforts = effortOptions(active)

  const choose = (model: ModelInfo) => {
    const effort = efforts.length > 0 ? defaultEffort(model) : settings.effort
    selectModel(provider, model.id, effort)
    onClose()
  }

  const chooseManual = (event?: FormEvent) => {
    event?.preventDefault()
    const id = manual.trim()
    if (!id) return
    selectModel(provider, id, settings.effort)
    setManual('')
    setShowManual(false)
    onClose()
  }

  const chooseProvider = (next: ProviderId) => {
    update({ provider: next, model: '' })
    setProviderOpen(false)
    setQuery('')
    void fetchModels(next)
  }

  if (!open || !position) return null

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: `${position.left}px`,
        width: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`,
        ...(position.placement === 'top'
          ? { bottom: `${position.bottom}px` }
          : { top: `${position.top}px` }),
      }}
      className="z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-float"
      role="dialog"
      aria-label="Choose a model"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Cpu size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-ink">Model</p>
          <p className="text-[9.5px] text-faint">
            {models.length > 0 ? `${models.length} live models` : 'Load models from this provider'}
            {source === 'catalog' ? ' · catalog fallback' : ''}
          </p>
        </div>
        <button
          type="button"
          className="icon-button h-7 w-7"
          onClick={() => void fetchModels(provider, true)}
          disabled={loading}
          title="Refresh live models"
          aria-label="Refresh live models"
        >
          <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
        </button>
        <button
          type="button"
          className="icon-button h-7 w-7"
          onClick={() => {
            onClose()
            openSettings('models')
          }}
          title="Provider settings"
          aria-label="Provider settings"
        >
          <Settings2 size={13} />
        </button>
      </div>

      <div className="shrink-0 border-b border-line">
        <button
          type="button"
          onClick={() => setProviderOpen((value) => !value)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
          aria-expanded={providerOpen}
        >
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Provider</span>
          <span className="text-[11.5px] font-medium text-ink">{PROVIDER_MAP[provider]?.name ?? provider}</span>
          {connectedNow ? (
            <span className="flex items-center gap-1 text-[9.5px] text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[9.5px] text-warning">
              <KeyRound size={9} /> key needed
            </span>
          )}
          <ChevronDown
            size={12}
            className={cn('ml-auto text-faint transition-transform', providerOpen && 'rotate-180')}
          />
        </button>
        {providerOpen && (
          <div className="thin-scroll max-h-44 overflow-y-auto border-t border-line/70 px-1.5 py-1.5">
            {PROVIDERS.map((entry) => {
              const ready = connected(entry.id) || entry.keyless || entry.id === 'custom'
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => chooseProvider(entry.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors',
                    entry.id === provider ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-ink',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {!ready && <span className="text-[9px] text-warning">key</span>}
                  {entry.id === provider && <Check size={11} />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {!connectedNow && provider !== 'custom' && !PROVIDER_MAP[provider]?.keyless ? (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/10 text-warning">
            <KeyRound size={16} />
          </span>
          <p className="text-[12px] font-medium text-ink">Connect {PROVIDER_MAP[provider]?.name ?? provider}</p>
          <p className="max-w-[280px] text-[10.5px] leading-relaxed text-muted">
            Keys are encrypted by the local daemon before they are written to disk. They never enter this page after
            saving.
          </p>
          <button
            type="button"
            onClick={() => {
              onClose()
              openSettings('models')
            }}
            className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-lg bg-ink px-3 text-[11px] font-medium text-panel"
          >
            Add API key
          </button>
        </div>
      ) : (
        <>
          <div className="shrink-0 px-3 py-2">
            <div className="relative">
              <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models"
                className="h-7 w-full rounded-md border border-transparent bg-raised/60 pl-7 pr-2 text-[10.5px] text-ink outline-none focus:border-line focus:bg-panel"
                aria-label="Search models"
              />
            </div>
            {loading && models.length === 0 && (
              <p className="flex items-center gap-1.5 px-1 pt-2 text-[10.5px] text-faint">
                <Spinner size={11} /> Loading live models…
              </p>
            )}
            {error && (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-danger/20 bg-danger/[0.04] px-2 py-1.5">
                <AlertCircle size={11} className="mt-0.5 shrink-0 text-danger" />
                <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-danger">{error}</p>
                <button type="button" onClick={() => void fetchModels(provider, true)} className="text-[10px] font-medium text-danger">
                  Retry
                </button>
              </div>
            )}
            {note && !error && <p className="mt-1.5 px-1 text-[9.5px] leading-relaxed text-faint">{note}</p>}
          </div>

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {filtered.map((model) => {
              const selected = model.id === modelId
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => choose(model)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                    selected ? 'bg-accent-soft' : 'hover:bg-raised',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                      selected ? 'bg-accent text-on-accent' : 'bg-raised text-faint',
                    )}
                  >
                    {selected ? <Check size={11} /> : <Cpu size={10} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'truncate text-[11.5px] font-medium',
                          selected ? 'text-accent' : 'text-ink',
                        )}
                      >
                        {model.name || model.id}
                      </span>
                      {model.free && (
                        <span className="rounded-full border border-success/25 px-1.5 py-px text-[8.5px] font-medium text-success">
                          free
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-faint">
                      <span className="truncate font-mono">{model.id}</span>
                      {model.context ? <span>{contextLabel(model.context)} ctx</span> : null}
                      {model.reasoningOptions.length > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-accent/80">
                          <Brain size={8} /> reasoning
                        </span>
                      ) : null}
                      {model.vision ? <span>vision</span> : null}
                      {!model.toolCall ? <span className="text-warning">no tools</span> : null}
                    </span>
                  </span>
                </button>
              )
            })}
            {!loading && filtered.length === 0 && models.length > 0 && (
              <p className="px-2 py-4 text-center text-[10.5px] text-faint">No model matches “{query}”.</p>
            )}
            {!loading && models.length === 0 && !error && (
              <div className="px-2 py-4 text-center">
                <p className="text-[10.5px] text-faint">This provider returned no usable chat models.</p>
                <button
                  type="button"
                  onClick={() => setShowManual(true)}
                  className="mt-1.5 text-[10.5px] font-medium text-accent hover:underline"
                >
                  Enter a model ID manually
                </button>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-line px-3 py-2.5">
            {active ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-medium text-muted">
                    <Brain size={11} />
                    Effort
                  </span>
                  {efforts.length > 0 ? (
                    <select
                      value={settings.effort}
                      onChange={(event) => {
                        selectModel(provider, active.id, event.target.value as Effort)
                      }}
                      className="h-6 rounded-md border border-line bg-panel px-1.5 text-[10px] text-ink outline-none"
                      aria-label="Reasoning effort"
                    >
                      {efforts.map((effort) => (
                        <option key={effort} value={effort}>
                          {effortLabel(effort)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <p className="mt-1 text-[9.5px] leading-relaxed text-faint">{reasoningSummary(active)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-faint">
                  {active.maxOutput ? <span>max output {contextLabel(active.maxOutput)}</span> : null}
                  {active.family ? <span>{active.family}</span> : null}
                  <span className="rounded border border-line px-1 py-px font-mono">{active.apiKind}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-faint">Select a model to see live reasoning controls.</p>
                <button
                  type="button"
                  onClick={() => setShowManual((value) => !value)}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-accent"
                >
                  <SlidersHorizontal size={10} /> ID
                </button>
              </div>
            )}

            {(showManual || (active && modelId !== active.id)) && (
              <form onSubmit={chooseManual} className="mt-2 flex items-center gap-1.5">
                <input
                  value={manual}
                  onChange={(event) => setManual(event.target.value)}
                  placeholder="model-id"
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 font-mono text-[10.5px] outline-none"
                  aria-label="Model ID"
                />
                <button
                  type="submit"
                  disabled={!manual.trim()}
                  className="inline-flex h-7 items-center rounded-md bg-ink px-2.5 text-[10px] font-medium text-panel disabled:opacity-40"
                >
                  Use
                </button>
              </form>
            )}
            {active && (
              <button
                type="button"
                onClick={() => setShowManual((value) => !value)}
                className="mt-1.5 text-[9.5px] font-medium text-faint hover:text-ink"
              >
                {showManual ? 'Hide manual ID' : 'Use a model ID that is not listed'}
              </button>
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
