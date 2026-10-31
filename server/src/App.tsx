import { useEffect } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { WorkspacePanel } from './components/WorkspacePanel'
import { SettingsModal } from './components/SettingsModal'
import { DeployModal } from './components/DeployModal'
import { CommandPalette } from './components/CommandPalette'
import { BrandFooter, LogoMark } from './components/Logo'
import { ConfirmDialog, Spinner, ToastHost } from './components/ui'
import { useSettings } from './store/settings'
import { useModelSync } from './store/models'
import { useUi } from './store/ui'
import { useBoot } from './lib/boot'

function BootScreen({
  phase,
  error,
  onRetry,
}: {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  onRetry: () => void
}) {
  return (
    <div className="relative flex h-dvh min-h-0 items-center justify-center overflow-hidden bg-canvas px-5">
      <div className="hero-wash pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative flex w-full max-w-[420px] flex-col items-center text-center">
        <LogoMark size={46} />
        <h1 className="mt-4 font-display text-[30px] font-medium tracking-[-0.03em] text-ink">MaxCode</h1>
        {phase === 'error' ? (
          <>
            <div className="mt-5 w-full rounded-xl border border-danger/25 bg-danger/[0.045] px-4 py-3 text-left">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                <AlertCircle size={14} className="text-danger" />
                The local daemon did not answer
              </p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted">{error}</p>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[12px] font-medium text-panel transition-opacity hover:opacity-85"
            >
              <RefreshCw size={13} />
              Try again
            </button>
            <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
              Start MaxCode with <code className="rounded bg-raised px-1 py-0.5 font-mono text-[10px]">npm start</code>{' '}
              in the MaxCode folder, then reload this page.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.18em] text-faint">by DevSoft</p>
            <p className="mt-5 flex items-center gap-2 text-[12.5px] text-muted">
              <Spinner size={13} className="text-accent" />
              Starting your local agent…
            </p>
          </>
        )}
        <div className="mt-10">
          <BrandFooter />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const phase = useBoot((state) => state.phase)
  const error = useBoot((state) => state.error)
  const boot = useBoot((state) => state.boot)
  const theme = useSettings((state) => state.theme)
  const mobileSidebarOpen = useUi((state) => state.mobileSidebarOpen)
  const setMobileSidebarOpen = useUi((state) => state.setMobileSidebarOpen)
  const setPaletteOpen = useUi((state) => state.setPaletteOpen)

  useModelSync()

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      root.classList.toggle('dark', dark)
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#1b1917' : '#faf6ef')
      try {
        localStorage.setItem('maxcode.theme', theme)
      } catch {
        // Storage can be unavailable in private mode; the theme still applies.
      }
    }
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(!useUi.getState().paletteOpen)
        return
      }
      if (event.key === 'Escape' && useUi.getState().mobileSidebarOpen) {
        setMobileSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setMobileSidebarOpen, setPaletteOpen])

  if (phase !== 'ready') {
    return (
      <>
        <BootScreen phase={phase} error={error} onRetry={() => void boot(true)} />
        <ToastHost />
      </>
    )
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-panel text-ink">
      <Sidebar />
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-ink/25 backdrop-blur-[1px] lg:hidden"
        />
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <ChatView />
        <WorkspacePanel />
      </div>
      <SettingsModal />
      <DeployModal />
      <CommandPalette />
      <ConfirmDialog />
      <ToastHost />
    </div>
  )
}
