import { useMemo, useState } from 'react'
import {
  Download,
  FolderCode,
  GitBranch,
  KeyRound,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useChats } from '../store/chats'
import { hasCredentials, useSettings } from '../store/settings'
import { useRuntime, useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { stopRun } from '../agent'
import { getProviderName } from '../data/providers'
import { cn, downloadText, formatRelativeTime, groupChatsByDate } from '../lib/utils'
import { LogoLockup } from './Logo'

function shortTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

interface ChatMenu {
  id: string
  x: number
  y: number
}

export function Sidebar() {
  const sessions = useChats((state) => state.sessions)
  const activeId = useChats((state) => state.activeId)
  const setActive = useChats((state) => state.setActive)
  const newChat = useChats((state) => state.newChat)
  const renameSession = useChats((state) => state.renameSession)
  const deleteSession = useChats((state) => state.deleteSession)
  const settings = useSettings()
  const workspace = useWorkspace((state) => state.info)
  const entries = useWorkspace((state) => state.entries)
  const git = useWorkspace((state) => state.git)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const toggleSidebar = useUi((state) => state.toggleSidebar)
  const mobileOpen = useUi((state) => state.mobileSidebarOpen)
  const setMobileOpen = useUi((state) => state.setMobileSidebarOpen)
  const openSettings = useUi((state) => state.openSettings)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const workspaceOpen = useUi((state) => state.workspaceOpen)
  const askConfirm = useUi((state) => state.askConfirm)
  const notify = useUi((state) => state.notify)
  const focusComposer = useUi((state) => state.focusComposer)
  const streaming = useRuntime((state) => state.streaming)

  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<ChatMenu | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((session) => session.title.toLowerCase().includes(needle))
  }, [sessions, query])
  const groups = useMemo(() => groupChatsByDate(filtered), [filtered])
  const activeSkills = settings.skills.filter((skill) => skill.enabled).length
  const fileCount = entries.filter((entry) => entry.type === 'file').length
  const workspaceName = workspace.available ? workspace.name : 'Choose a folder'
  const connected = hasCredentials(settings)

  const startNewChat = () => {
    newChat()
    setMobileOpen(false)
    setMenu(null)
    focusComposer()
  }

  const openChat = (id: string) => {
    setActive(id)
    setMobileOpen(false)
    setMenu(null)
  }

  const beginRename = (id: string, title: string) => {
    setEditingId(id)
    setDraftTitle(title)
    setMenu(null)
  }

  const commitRename = () => {
    if (!editingId) return
    if (draftTitle.trim()) renameSession(editingId, draftTitle)
    setEditingId(null)
    setDraftTitle('')
  }

  const removeChat = async (id: string, title: string) => {
    setMenu(null)
    const confirmed = await askConfirm({
      title: 'Delete this conversation?',
      body: `“${title}” and its messages will be removed from this computer. This cannot be undone.`,
      confirmLabel: 'Delete conversation',
      tone: 'danger',
    })
    if (!confirmed) return
    stopRun(id)
    deleteSession(id)
  }

  const exportChat = (id: string) => {
    const session = sessions.find((item) => item.id === id)
    if (!session) return
    setMenu(null)
    downloadText(
      `maxcode-${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'conversation'}.json`,
      JSON.stringify({ app: 'MaxCode', exportedAt: new Date().toISOString(), session }, null, 2),
      'application/json',
    )
    notify('Conversation exported.', 'success')
  }

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-dvh w-[276px] shrink-0 flex-col border-r border-line bg-canvas transition-transform duration-200 lg:static lg:z-auto',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        sidebarCollapsed && 'lg:hidden',
      )}
    >
      <div className="flex h-14 items-center justify-between pl-4 pr-2.5">
        <LogoLockup />
        <button
          type="button"
          className="icon-button hidden lg:inline-flex"
          onClick={toggleSidebar}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
        <button
          type="button"
          className="icon-button lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X size={17} />
        </button>
      </div>

      <div className="px-3 pb-2 pt-2">
        <button
          type="button"
          onClick={startNewChat}
          className="group flex h-9 w-full items-center gap-2 rounded-full border border-line bg-panel px-3 text-[12.5px] font-medium text-ink shadow-pill transition-all duration-150 hover:border-faint/40 hover:bg-panel active:scale-[0.99]"
        >
          <Plus size={14} className="text-accent" />
          New chat
          <span aria-hidden="true" className="ml-auto text-[9px] font-normal text-faint opacity-0 transition-opacity group-hover:opacity-100">
            fresh page
          </span>
        </button>
      </div>

      <div className="px-3 pb-1">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            className="h-8 w-full rounded-lg border border-transparent bg-raised/60 pl-8 pr-2.5 text-[11.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-line focus:bg-panel"
            aria-label="Search conversations"
          />
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
        {groups.length === 0 && (
          <div className="px-2 py-8 text-center">
            <p className="text-[12px] font-medium text-muted">
              {query ? 'No conversations match' : 'No conversations yet'}
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
              {query ? 'Try a shorter search.' : 'Start with a task, a question or a file.'}
            </p>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((session) => (
                <div key={session.id} className="group/item relative">
                  {editingId === session.id ? (
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename()
                        if (event.key === 'Escape') {
                          setEditingId(null)
                          setDraftTitle('')
                        }
                      }}
                      autoFocus
                      className="h-9 w-full rounded-lg border border-accent/40 bg-panel px-2.5 text-[12.5px] text-ink outline-none"
                      aria-label="Rename conversation"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openChat(session.id)}
                        onDoubleClick={() => beginRename(session.id, session.title)}
                        className={cn(
                          'sidebar-item pr-8',
                          activeId === session.id && 'sidebar-item-active',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{session.title}</span>
                        {streaming[session.id] ? (
                          <span
                            className="flex shrink-0 items-center gap-1 text-[9px] font-medium text-accent"
                            title="Agent is running"
                          >
                            <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" />
                            running
                          </span>
                        ) : (
                          <span className="shrink-0 text-[9.5px] tabular-nums text-faint group-hover/item:hidden">
                            {formatRelativeTime(session.updatedAt)}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (menu?.id === session.id) {
                            setMenu(null)
                            return
                          }
                          const rect = event.currentTarget.getBoundingClientRect()
                          const width = 176
                          const height = 138
                          const x = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
                          const y =
                            rect.bottom + height + 8 > window.innerHeight
                              ? Math.max(8, rect.top - height - 4)
                              : rect.bottom + 4
                          setMenu({ id: session.id, x, y })
                        }}
                        className={cn(
                          'absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-all hover:bg-panel hover:text-ink',
                          menu?.id === session.id
                            ? 'flex bg-panel text-ink opacity-100'
                            : 'opacity-0 group-hover/item:opacity-100 focus:opacity-100',
                        )}
                        aria-label={`Actions for ${session.title}`}
                        title="Conversation actions"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-2.5">
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false)
            setWorkspaceOpen(!workspaceOpen)
          }}
          className={cn(
            'mb-1 flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors',
            workspaceOpen
              ? 'border-accent/30 bg-accent-soft/45'
              : 'border-line bg-panel/60 hover:border-faint/35 hover:bg-panel',
          )}
          title={workspace.available ? workspace.root : 'Choose a project folder'}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
            <FolderCode size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-medium text-ink">{workspaceName}</span>
            <span className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-faint">
              {workspace.available ? (
                <>
                  {fileCount} file{fileCount === 1 ? '' : 's'}
                  {git.available && git.branch ? (
                    <>
                      <span className="text-line">·</span>
                      <GitBranch size={8} />
                      {git.branch}
                    </>
                  ) : null}
                </>
              ) : (
                'Open a real folder to start'
              )}
            </span>
          </span>
        </button>

        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false)
              setDeployOpen(true)
            }}
            className="sidebar-item"
          >
            <Rocket size={14} className="text-faint" />
            <span className="flex-1">Deploy page</span>
            <span className="text-[9px] text-faint">Cloudflare · Netlify · Vercel</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false)
              openSettings('skills')
            }}
            className="sidebar-item"
          >
            <Sparkles size={14} className="text-faint" />
            <span className="flex-1">Skills</span>
            {activeSkills > 0 && (
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9.5px] font-medium text-accent">
                {activeSkills}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false)
              openSettings('models')
            }}
            className="sidebar-item"
          >
            <Settings size={14} className="text-faint" />
            <span className="flex-1">Settings</span>
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <UserRound size={14} />
          </div>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false)
              openSettings('models')
            }}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-[11.5px] font-medium text-ink">Local session</p>
            <p className="flex items-center gap-1 truncate text-[9.5px] text-faint">
              <KeyRound size={9} />
              {connected
                ? `${getProviderName(settings.provider)}${settings.provider === 'ollama' ? ' · local' : ' · BYOK'}`
                : 'Add a provider key'}
            </p>
          </button>
          <button
            type="button"
            className="icon-button h-7 w-7"
            onClick={() => {
              setMobileOpen(false)
              openSettings('appearance')
            }}
            title="Preferences"
            aria-label="Preferences"
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      {menu && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close conversation menu"
            className="fixed inset-0 z-[60] cursor-default bg-transparent"
            onClick={() => setMenu(null)}
          />
          <div
            className="fixed z-[70] w-[176px] overflow-hidden rounded-lg border border-line bg-panel p-1 shadow-float"
            style={{ left: menu.x, top: menu.y }}
          >
            {(() => {
              const session = sessions.find((item) => item.id === menu.id)
              if (!session) return null
              return (
                <>
                  <button
                    type="button"
                    onClick={() => beginRename(session.id, session.title)}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-muted hover:bg-raised hover:text-ink"
                  >
                    <Pencil size={12} /> Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => exportChat(session.id)}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-muted hover:bg-raised hover:text-ink"
                  >
                    <Download size={12} /> Export
                  </button>
                  <div className="my-1 border-t border-line" />
                  <button
                    type="button"
                    onClick={() => void removeChat(session.id, session.title)}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-danger hover:bg-danger/[0.06]"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                  <p className="px-2 pb-1 pt-1.5 text-[9px] text-faint">Updated {shortTime(session.updatedAt)}</p>
                </>
              )
            })()}
          </div>
        </>
      )}
    </aside>
  )
}
