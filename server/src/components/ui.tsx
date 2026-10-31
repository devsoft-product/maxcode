import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  CircleCheck,
  CircleX,
  Info,
  LoaderCircle,
  X,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useUi } from '../store/ui'

export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null)

    const timer = window.setTimeout(() => {
      const target = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0]
      ;(target ?? panel)?.focus()
    }, 30)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      restoreRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px] dark:bg-black/50"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          'modal-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-float sm:max-h-[86dvh] sm:rounded-2xl',
          wide ? 'sm:w-[min(920px,94vw)]' : 'sm:w-[min(760px,94vw)]',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function ModalHeader({
  title,
  description,
  onClose,
  id,
  actions,
}: {
  title: string
  description?: string
  onClose: () => void
  id?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cn('animate-spin text-current', className)} aria-hidden="true" />
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-40',
        checked ? 'border-accent bg-accent' : 'border-line bg-raised',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  className,
  size = 'sm',
}: {
  options: Array<{ value: T; label: string; title?: string }>
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg border border-line bg-raised/70 p-0.5',
        size === 'md' ? 'text-[12.5px]' : 'text-[11.5px]',
        disabled && 'opacity-50',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[6px] font-medium transition-all duration-150 disabled:cursor-not-allowed',
            size === 'md' ? 'px-3 py-1.5' : 'px-2.5 py-1',
            value === option.value
              ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(20,22,30,0.08)]'
              : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-sans text-[10px] font-medium text-faint">
      {children}
    </kbd>
  )
}

const toneStyles = {
  info: { icon: Info, className: 'text-accent' },
  success: { icon: CircleCheck, className: 'text-success' },
  error: { icon: CircleX, className: 'text-danger' },
}

export function ToastHost() {
  const toast = useUi((state) => state.toast)
  const dismiss = useUi((state) => state.dismissToast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => dismiss(toast.id), 4500)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])

  if (!toast) return null
  const tone = toneStyles[toast.tone]
  const Icon = tone.icon
  return createPortal(
    <div
      className="pointer-events-none fixed bottom-56 left-1/2 z-[100] flex w-[min(92vw,440px)] -translate-x-1/2 animate-rise items-start gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-3 text-[12.5px] text-ink shadow-float sm:bottom-48"
      role="status"
    >
      <Icon size={16} className={cn('mt-0.5 shrink-0', tone.className)} />
      <p className="flex-1 leading-relaxed">{toast.message}</p>
      <button type="button" className="pointer-events-auto icon-button -mr-1 -mt-1 h-6 w-6" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>,
    document.body,
  )
}

export function ConfirmDialog() {
  const confirm = useUi((state) => state.confirm)
  const resolve = useUi((state) => state.resolveConfirm)
  const danger = confirm?.tone === 'danger'

  return (
    <Modal open={Boolean(confirm)} onClose={() => resolve(false)} className="sm:w-[420px]">
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              danger ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-accent',
            )}
          >
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{confirm?.title}</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{confirm?.body}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="chip" onClick={() => resolve(false)}>
            Cancel
          </button>
          <button
            type="button"
            data-autofocus
            onClick={() => resolve(true)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-white transition-colors',
              danger ? 'bg-danger hover:bg-danger/90' : 'bg-accent hover:bg-accent/90',
            )}
          >
            <Check size={14} />
            {confirm?.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
