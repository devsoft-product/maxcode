import {
  Command,
  FolderOpen,
  Menu,
  Moon,
  PanelLeftOpen,
  Rocket,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import type { ChatSession } from '../types'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { useActiveModel } from '../store/models'
import { cn } from '../lib/utils'
import { LogoMark } from './Logo'
import { ContextBar } from './ContextBar'

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function TopBar({ session }: { session: ChatSession | null }) {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const toggleSidebar = useUi((state) => state.toggleSidebar)
  const setMobileOpen = useUi((state) => state.setMobileSidebarOpen)
  const setPaletteOpen = useUi((state) => state.setPaletteOpen)
  const openSettings = useUi((state) => state.openSettings)
  const workspaceOpen = useUi((state) => state.workspaceOpen)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const workspace = useWorkspace((state) => state.info)
  const entries = useWorkspace((state) => state.entries)
  const fileCount = entries.filter((entry) => entry.type === 'file').length
  const activeModel = useActiveModel()

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line/80 bg-panel/85 px-3 backdrop-blur-sm sm:px-4">
      <button
        type="button"
        className="icon-button lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {sidebarCollapsed && (
        <button
          type="button"
          className="icon-button hidden lg:inline-flex"
          onClick={toggleSidebar}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      <div className="flex min-w-0 items-center gap-2 pl-0.5">
        {!session && <LogoMark size={21} className="lg:hidden" />}
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate font-display text-[14px] font-medium tracking-[-0.01em] text-ink">
            {session?.title ?? 'New conversation'}
          </h1>
          {session && session.messages.length > 0 && (
            <span className="hidden shrink-0 text-[10px] text-faint sm:inline">
              {session.messages.filter((message) => message.role === 'user').length} turn
              {session.messages.filter((message) => message.role === 'user').length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setWorkspaceOpen(!workspaceOpen)}
        title={workspace.available ? workspace.root : 'Choose a workspace folder'}
        className={cn(
          'ml-3 hidden min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] transition-colors sm:inline-flex',
          workspaceOpen
            ? 'border-accent/30 bg-accent-soft/60 text-accent'
            : 'border-line bg-panel/60 text-muted hover:border-faint/35 hover:text-ink',
        )}
      >
        <FolderOpen size={11} className="shrink-0" />
        <span className="max-w-[150px] truncate">
          {workspace.available ? workspace.name : 'No folder'}
        </span>
        {workspace.available && <span className="shrink-0 text-faint">{fileCount}</span>}
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* Context usage bar — only shown when a session is active */}
        {session && session.messages.length > 0 && (
          <div className="mr-1.5">
            <ContextBar
              messages={session.messages}
              model={activeModel}
              sessionId={session.id}
            />
          </div>
        )}
        <button
          type="button"
          className="hidden h-8 items-center gap-1.5 rounded-lg px-2 text-[10.5px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink sm:inline-flex"
          onClick={() => setDeployOpen(true)}
          title="Deploy the open workspace or another project"
        >
          <Rocket size={13} className="text-accent" />
          Deploy
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setPaletteOpen(true)}
          title={`Search and commands (${isApple ? '⌘' : 'Ctrl'} K)`}
          aria-label="Open search and commands"
        >
          <Search size={16} />
        </button>
        <button
          type="button"
          className={cn('icon-button hidden sm:inline-flex', workspaceOpen && 'bg-raised text-ink')}
          onClick={() => setWorkspaceOpen(!workspaceOpen)}
          title="Toggle workspace panel"
          aria-label="Toggle workspace panel"
        >
          <FolderOpen size={16} />
        </button>
        <button
          type="button"
          className="icon-button hidden sm:inline-flex"
          onClick={() => update({ theme: isDark ? 'light' : 'dark' })}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => openSettings('models')}
          title="Settings"
          aria-label="Open settings"
        >
          <Settings size={16} />
        </button>
        <span className="ml-1 hidden items-center gap-1 rounded-md border border-line px-1.5 py-1 text-[9.5px] text-faint md:inline-flex">
          <Command size={9} />K
        </span>
      </div>
    </header>
  )
}
