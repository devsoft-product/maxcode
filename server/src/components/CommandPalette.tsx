import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Cpu,
  FileText,
  FolderOpen,
  Globe2,
  Info,
  MessageSquare,
  Moon,
  Palette,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Sun,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useChats, exportChats } from '../store/chats'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { cn, formatRelativeTime } from '../lib/utils'

interface PaletteCommand {
  id: string
  label: string
  hint?: string
  group: string
  icon: LucideIcon
  keywords?: string
  action: () => void
}

export function CommandPalette() {
  const open = useUi((state) => state.paletteOpen)
  const setOpen = useUi((state) => state.setPaletteOpen)
  const openSettings = useUi((state) => state.openSettings)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const focusComposer = useUi((state) => state.focusComposer)
  const notify = useUi((state) => state.notify)
  const sessions = useChats((state) => state.sessions)
  const entries = useWorkspace((state) => state.entries)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previous
      restoreRef.current?.focus()
    }
  }, [open])

  const commands = useMemo<PaletteCommand[]>(() => {
    const themeIsDark = document.documentElement.classList.contains('dark')
    const close = () => setOpen(false)
    const actions: PaletteCommand[] = [
      {
        id: 'action-new-chat',
        label: 'New chat',
        hint: 'Start a clean conversation',
        group: 'Actions',
        icon: Plus,
        action: () => {
          useChats.getState().newChat()
          focusComposer()
          close()
        },
      },
      {
        id: 'action-workspace',
        label: 'Toggle workspace panel',
        hint: 'Browse and edit files in the open folder',
        group: 'Actions',
        icon: FolderOpen,
        action: () => {
          setWorkspaceOpen(!useUi.getState().workspaceOpen)
          close()
        },
      },
      {
        id: 'action-deploy',
        label: 'Deploy a page',
        hint: 'Cloudflare Pages, Netlify or Vercel',
        group: 'Actions',
        icon: Rocket,
        action: () => {
          setDeployOpen(true)
          close()
        },
      },
      {
        id: 'action-theme',
        label: themeIsDark ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        icon: themeIsDark ? Sun : Moon,
        action: () => {
          useSettings.getState().update({ theme: themeIsDark ? 'light' : 'dark' })
          close()
        },
      },
      {
        id: 'action-models',
        label: 'Model settings',
        hint: 'Providers, encrypted keys and reasoning',
        group: 'Settings',
        icon: Cpu,
        action: () => {
          openSettings('models')
          close()
        },
      },
      {
        id: 'action-tools',
        label: 'Tool permissions',
        hint: 'Approval and enablement',
        group: 'Settings',
        icon: Wrench,
        action: () => {
          openSettings('tools')
          close()
        },
      },
      {
        id: 'action-search',
        label: 'Search settings',
        hint: 'Tavily, Brave, Serper, DuckDuckGo',
        group: 'Settings',
        icon: Globe2,
        action: () => {
          openSettings('search')
          close()
        },
      },
      {
        id: 'action-skills',
        label: 'Skills',
        hint: 'Load and manage reusable instructions',
        group: 'Settings',
        icon: Sparkles,
        action: () => {
          openSettings('skills')
          close()
        },
      },
      {
        id: 'action-deploy-settings',
        label: 'Hosting credentials',
        hint: 'Cloudflare, Netlify and Vercel tokens',
        group: 'Settings',
        icon: Rocket,
        action: () => {
          openSettings('deploy')
          close()
        },
      },
      {
        id: 'action-appearance',
        label: 'Appearance',
        hint: 'Theme and token estimates',
        group: 'Settings',
        icon: Palette,
        action: () => {
          openSettings('appearance')
          close()
        },
      },
      {
        id: 'action-about',
        label: 'About MaxCode',
        hint: 'Local storage and reset controls',
        group: 'Settings',
        icon: Info,
        action: () => {
          openSettings('about')
          close()
        },
      },
      {
        id: 'action-export',
        label: 'Export conversations',
        hint: 'Download a JSON history file',
        group: 'Actions',
        icon: ArrowDownToLine,
        action: () => {
          exportChats()
          notify('Conversation history exported.', 'success')
          close()
        },
      },
    ]

    const chatCommands: PaletteCommand[] = [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => ({
        id: `chat-${session.id}`,
        label: session.title,
        hint: `${session.messages.length} messages · ${formatRelativeTime(session.updatedAt)}`,
        group: 'Conversations',
        icon: MessageSquare,
        keywords: session.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content)
          .join(' ')
          .slice(0, 1000),
        action: () => {
          useChats.getState().setActive(session.id)
          close()
        },
      }))

    const fileCommands: PaletteCommand[] = entries
      .filter((entry) => entry.type === 'file')
      .slice(0, 1500)
      .map((entry) => ({
        id: `file-${entry.path}`,
        label: entry.name,
        hint: entry.path,
        group: 'Workspace files',
        icon: FileText,
        keywords: entry.path,
        action: () => {
          useWorkspace.getState().setActiveFile(entry.path)
          setWorkspaceOpen(true)
          close()
        },
      }))

    return [...actions, ...chatCommands, ...fileCommands]
  }, [sessions, entries, focusComposer, notify, openSettings, setOpen, setWorkspaceOpen, setDeployOpen])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const limit = needle ? 40 : 18
    if (!needle) {
      const recentChats = new Set(
        [...sessions]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 2)
          .map((session) => `chat-${session.id}`),
      )
      return commands
        .filter(
          (command) => command.group !== 'Conversations' || recentChats.has(command.id),
        )
        .filter((command, index, all) => all.findIndex((item) => item.id === command.id) === index)
        .slice(0, limit)
    }
    return commands
      .filter((command) =>
        `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''} ${command.group}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, limit)
  }, [commands, query, sessions])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const node = document.querySelector<HTMLElement>(`[data-palette-index="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  useEffect(() => {
    if (activeIndex > filtered.length - 1) setActiveIndex(Math.max(0, filtered.length - 1))
  }, [filtered.length, activeIndex])

  if (!open) return null

  const run = (index: number) => {
    const command = filtered[index]
    if (!command) return
    command.action()
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-3 pt-[10vh] sm:pt-[14vh]">
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-ink/20 backdrop-blur-[2px] dark:bg-black/45"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="modal-panel relative flex max-h-[min(72dvh,560px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-float"
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                if (filtered.length > 0) {
                  setActiveIndex((index) => Math.min(index + 1, filtered.length - 1))
                }
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                run(activeIndex)
              } else if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
            placeholder="Search chats, files, settings, actions…"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={filtered[activeIndex] ? `palette-${filtered[activeIndex].id}` : undefined}
          />
          <kbd className="hidden rounded border border-line bg-raised px-1.5 py-0.5 text-[9px] text-faint sm:block">
            Esc
          </kbd>
        </div>

        <div id="palette-results" role="listbox" className="thin-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-[12px] font-medium text-muted">No matches</p>
              <p className="mt-1 text-[10.5px] text-faint">Try a chat title, a file name or “deploy”.</p>
            </div>
          )}
          {filtered.map((command, index) => {
            const Icon = command.icon
            const showGroup = index === 0 || filtered[index - 1].group !== command.group
            return (
              <Fragment key={command.id}>
                {showGroup && (
                  <p className="px-2 pb-1 pt-2 text-[9.5px] font-medium uppercase tracking-[0.08em] text-faint">
                    {command.group}
                  </p>
                )}
                <button
                  type="button"
                  id={`palette-${command.id}`}
                  data-palette-index={index}
                  role="option"
                  aria-selected={activeIndex === index}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => run(index)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                    activeIndex === index ? 'bg-raised' : 'hover:bg-raised/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel',
                      activeIndex === index ? 'text-accent' : 'text-muted',
                    )}
                  >
                    <Icon size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-ink">{command.label}</span>
                    {command.hint && (
                      <span className="mt-0.5 block truncate text-[9.5px] text-faint">{command.hint}</span>
                    )}
                  </span>
                  <ArrowUpRight
                    size={11}
                    className={cn(
                      'shrink-0 text-faint transition-opacity',
                      activeIndex === index ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </button>
              </Fragment>
            )
          })}
        </div>

        <div className="flex h-8 shrink-0 items-center justify-between border-t border-line bg-raised/30 px-3 text-[9px] text-faint">
          <span className="flex items-center gap-2">
            <span>
              <kbd className="rounded border border-line bg-panel px-1">↑</kbd>{' '}
              <kbd className="rounded border border-line bg-panel px-1">↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded border border-line bg-panel px-1">↵</kbd> open
            </span>
          </span>
          <span>MaxCode</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
