import { cn } from '../lib/utils'

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[31%] bg-accent text-[#f8ecdd] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(74,44,26,0.22)]',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_18%_0%,rgba(255,255,255,0.24),transparent_55%)]" />
      <svg viewBox="0 0 32 32" width={size} height={size} fill="none" className="relative">
        <path
          d="M7.5 23.4V10.7c0-.6.72-.92 1.16-.52L16 17.1l7.34-6.92c.44-.4 1.16-.08 1.16.52v12.7"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="23.9" cy="23.7" r="1.55" fill="currentColor" opacity="0.75" />
      </svg>
    </span>
  )
}

export function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={30} />
      {!compact && (
        <div className="flex flex-col leading-none">
          <span className="font-display text-[18px] font-semibold tracking-[-0.025em] text-ink">MaxCode</span>
          <span className="mt-[4px] text-[9px] font-medium uppercase tracking-[0.16em] text-faint">by DevSoft</span>
        </div>
      )}
    </div>
  )
}

export function BrandFooter() {
  return (
    <p className="text-[10.5px] tracking-[0.01em] text-faint">
      MaxCode <span className="px-1 text-line">/</span> a DevSoft product
    </p>
  )
}
