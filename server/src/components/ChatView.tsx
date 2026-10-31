import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUp,
  Bug,
  FolderOpen,
  FolderSearch,
  Globe2,
  KeyRound,
  ListChecks,
  Sparkles,
} from 'lucide-react'
import type { Attachment, Message, ToolMessage } from '../types'
import { createId, useChats } from '../store/chats'
import { activeModelId, hasCredentials, useSettings } from '../store/settings'
import { useRuntime, useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { getProviderName } from '../data/providers'
import { stopRun, runAgent } from '../agent'
import { TopBar } from './TopBar'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { BrandFooter, LogoMark } from './Logo'

const STARTERS = [
  {
    icon: FolderSearch,
    label: 'Audit this folder',
    prompt:
      'Audit this workspace. Read the key files first, then list the three most important improvements with file references and a short plan.',
  },
  {
    icon: Bug,
    label: 'Trace a bug',
    prompt:
      'Inspect this workspace for a real bug. Explain the root cause, make the smallest correct fix, and run the project checks.',
  },
  {
    icon: ListChecks,
    label: 'Plan a feature',
    prompt:
      'Plan a small feature for this project. Inspect the current structure, then propose the smallest implementation with the files involved and how to verify it.',
  },
  {
    icon: Globe2,
    label: 'Research with sources',
    prompt:
      'Search the web for the current release notes of the main framework in this project, then summarise what matters and cite the pages you read.',
  },
]

function groupTools(messages: Message[]) {
  const grouped = new Map<string, ToolMessage[]>()
  const seen = new Set<string>()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const tools: ToolMessage[] = []
    let cursor = index + 1
    while (cursor < messages.length && messages[cursor].role === 'tool') {
      const tool = messages[cursor] as ToolMessage
      tools.push(tool)
      seen.add(tool.id)
      cursor += 1
    }
    if (tools.length > 0) grouped.set(message.id, tools)
  }
  return { grouped, seen }
}

export function ChatView() {
  const sessions = useChats((state) => state.sessions)
  const activeId = useChats((state) => state.activeId)
  const session = sessions.find((item) => item.id === activeId) ?? null
  const streaming = useRuntime((state) => (activeId ? Boolean(state.streaming[activeId]) : false))
  const settings = useSettings()
  const setMode = useSettings((state) => state.setMode)
  const update = useSettings((state) => state.update)
  const notify = useUi((state) => state.notify)
  const openSettings = useUi((state) => state.openSettings)
  const focusComposer = useUi((state) => state.focusComposer)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const askConfirm = useUi((state) => state.askConfirm)
  const workspace = useWorkspace((state) => state.info)
  const workspaceRoot = useWorkspace((state) => state.root)
  const entries = useWorkspace((state) => state.entries)
  const git = useWorkspace((state) => state.git)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const lastSessionRef = useRef<string | null>(activeId)
  const lastMessageIdRef = useRef<string | null>(null)

  const messages = session?.messages ?? []
  const lastMessage = messages[messages.length - 1]
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const connected = hasCredentials(settings)
  const selectedModel = activeModelId(settings)
  const activeSkills = settings.skills.filter((skill) => skill.enabled).length
  const fileCount = entries.filter((entry) => entry.type === 'file').length
  const { grouped, seen } = groupTools(messages)

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior })
  }

  useEffect(() => {
    if (lastSessionRef.current !== activeId) {
      lastSessionRef.current = activeId
      setAtBottom(true)
      requestAnimationFrame(() => scrollToBottom('auto'))
      const current = useChats.getState().sessions.find((item) => item.id === activeId)
      if (current?.mode) setMode(current.mode)
    }
  }, [activeId, setMode])

  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessage.id
      if (lastMessage.role === 'user') {
        setAtBottom(true)
        requestAnimationFrame(() => scrollToBottom('auto'))
      } else if (atBottom) {
        requestAnimationFrame(() => scrollToBottom('auto'))
      }
    } else if (atBottom) {
      scrollToBottom('auto')
    }
  }, [lastMessage, atBottom])

  useEffect(() => {
    if (!atBottom) return
    const timer = window.setTimeout(() => scrollToBottom('auto'), 40)
    return () => window.clearTimeout(timer)
  }, [messages, atBottom])

  const send = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    const current = useSettings.getState()
    if (!hasCredentials(current)) {
      notify(
        current.provider === 'custom'
          ? 'Add a base URL for your custom endpoint in Settings → Models.'
          : `Add an API key for ${getProviderName(current.provider)} in Settings → Models.`,
        'error',
      )
      openSettings('models')
      return false
    }
    const modelId = activeModelId(current)
    if (!modelId) {
      notify('Choose a model before sending a message.', 'error')
      openSettings('models')
      return false
    }

    let sessionId = activeId
    if (!sessionId || !useChats.getState().sessions.some((item) => item.id === sessionId)) {
      sessionId = useChats.getState().createSession(current.provider, modelId, current.mode)
    }
    const content = text.trim()
    useChats.getState().addMessage(sessionId, {
      id: createId('msg'),
      role: 'user',
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: Date.now(),
    })
    useChats.getState().updateSession(sessionId, { mode: current.mode })
    setDraft('')
    setAtBottom(true)
    window.setTimeout(() => {
      void runAgent(sessionId)
    }, 0)
    return true
  }

  const useStarter = (prompt: string) => {
    setDraft(prompt)
    focusComposer()
  }

  const handleCommand = async (command: string, args: string): Promise<boolean> => {
    switch (command) {
      case 'search': {
        if (!args.trim()) {
          setDraft('/search ')
          notify('Type what you want MaxCode to research.', 'info')
          focusComposer()
          return false
        }
        update({ webSearchEnabled: true })
        return send(
          `Use the web to research this: ${args.trim()}\n\nRead the most useful sources, cite the URLs you actually opened, and answer for this workspace.`,
          [],
        )
      }
      case 'plan': {
        setMode('plan')
        if (!args.trim()) {
          notify('Plan mode is on: investigation only until you switch to Build.', 'info')
          focusComposer()
          return true
        }
        return send(args.trim(), [])
      }
      case 'build': {
        setMode('build')
        if (!args.trim()) {
          notify('Build mode is on: MaxCode can edit files and run commands.', 'info')
          focusComposer()
          return true
        }
        return send(args.trim(), [])
      }
      case 'new': {
        useChats.getState().newChat()
        focusComposer()
        return true
      }
      case 'workspace': {
        setWorkspaceOpen(true)
        return true
      }
      case 'deploy': {
        setDeployOpen(true)
        return true
      }
      case 'settings': {
        openSettings('models')
        return true
      }
      case 'clear': {
        const current = useChats.getState().sessions.find((item) => item.id === activeId)
        if (!current || current.messages.length === 0) return true
        const confirmed = await askConfirm({
          title: 'Clear this conversation?',
          body: 'The messages in this conversation will be removed from your local history. The workspace files are not touched.',
          confirmLabel: 'Clear conversation',
          tone: 'danger',
        })
        if (!confirmed) return true
        stopRun(current.id)
        useChats.getState().updateSession(current.id, { messages: [] })
        useChats.getState().updateSession(current.id, { title: 'New conversation' })
        notify('Conversation cleared.', 'success')
        return true
      }
      default:
        return false
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <TopBar session={session} />

      {!session || messages.length === 0 ? (
        <div className="thin-scroll relative min-h-0 flex-1 overflow-y-auto">
          <div className="hero-wash pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto flex min-h-full w-full max-w-[820px] flex-col justify-center px-4 pb-10 pt-8 sm:px-6 sm:pb-14">
            <div className="animate-rise">
              <div className="flex flex-col items-center gap-3 text-center">
                <LogoMark size={44} />
                <p className="eyebrow">A DevSoft product</p>
                <h1 className="max-w-[620px] font-display text-[30px] font-medium leading-[1.14] tracking-[-0.028em] text-ink sm:text-[38px]">
                  Where would you like to begin?
                </h1>
                <p className="max-w-[460px] text-[13px] leading-relaxed text-muted">
                  MaxCode works in your real folder through a local daemon. Read files, run commands, edit and
                  deploy — with your own model key.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {workspace.available ? (
                  <button
                    type="button"
                    onClick={() => setWorkspaceOpen(true)}
                    className="inline-flex h-8 max-w-[340px] items-center gap-1.5 rounded-full border border-line bg-panel/80 px-3 text-[11px] font-medium text-muted transition-colors hover:border-faint/40 hover:text-ink"
                    title={workspaceRoot}
                  >
                    <FolderOpen size={12} className="shrink-0 text-accent" />
                    <span className="truncate">{workspace.name}</span>
                    <span className="shrink-0 text-faint">{fileCount} files</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setWorkspaceOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-3 text-[11px] font-medium text-accent transition-colors hover:bg-accent-soft/70"
                  >
                    <FolderOpen size={12} />
                    Choose a workspace folder
                    <ArrowRight size={11} />
                  </button>
                )}
                {(!connected || !selectedModel) && (
                  <button
                    type="button"
                    onClick={() => openSettings('models')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-3 text-[11px] font-medium text-accent transition-colors hover:bg-accent-soft/70"
                  >
                    <KeyRound size={12} />
                    {connected ? 'Choose a model' : 'Connect a provider'}
                    <ArrowRight size={11} />
                  </button>
                )}
              </div>
            </div>

            <div className="mx-auto mt-7 w-full max-w-[780px] animate-rise [animation-delay:80ms]">
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={send}
                onStop={() => undefined}
                onCommand={handleCommand}
                streaming={false}
                hints
                autoFocus
                placeholder={connected ? 'Message MaxCode' : 'Add a provider key to start'}
              />
            </div>

            <div className="mx-auto mt-5 flex max-w-[780px] flex-wrap items-center justify-center gap-1.5 animate-rise [animation-delay:140ms]">
              {STARTERS.map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  onClick={() => useStarter(starter.prompt)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-panel/80 px-2.5 text-[10.5px] font-medium text-muted transition-colors hover:border-faint/40 hover:bg-panel hover:text-ink"
                >
                  <starter.icon size={12} className="text-faint" />
                  {starter.label}
                </button>
              ))}
            </div>

            <div className="mt-10 flex flex-col items-center gap-2 text-center">
              <p className="text-[9.5px] tracking-[0.01em] text-faint">
                {workspace.available ? (
                  <>
                    {workspace.name}
                    {git.available && git.branch ? (
                      <>
                        <span className="px-1.5 text-line">·</span>
                        {git.branch}
                      </>
                    ) : null}
                  </>
                ) : (
                  'No folder open'
                )}
                <span className="px-1.5 text-line">·</span>
                {activeSkills} skill{activeSkills === 1 ? '' : 's'} loaded
                <span className="px-1.5 text-line">·</span>
                {!connected ? 'Provider needed' : !selectedModel ? 'Model needed' : 'Ready'}
              </p>
              <BrandFooter />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={(event) => {
                const node = event.currentTarget
                const distance = node.scrollHeight - node.scrollTop - node.clientHeight
                setAtBottom(distance < 90)
              }}
              className="thin-scroll h-full overflow-y-auto"
            >
              <div className="mx-auto w-full max-w-[800px] px-3 pb-10 pt-7 sm:px-6 sm:pt-9">
                {messages.map((message, index) => {
                  if (message.role === 'tool' && seen.has(message.id)) return null
                  const gap =
                    index === 0 ? '' : message.role === 'user' ? 'mt-9' : message.role === 'assistant' ? 'mt-6' : 'mt-2.5'
                  const isStreaming =
                    streaming &&
                    index === messages.length - 1 &&
                    message.role === 'assistant'
                  return (
                    <div key={message.id} className={gap}>
                      <MessageItem
                        message={message}
                        sessionId={session.id}
                        streaming={Boolean(isStreaming)}
                        isLastAssistant={message.role === 'assistant' && message.id === lastAssistant?.id}
                        tools={message.role === 'assistant' ? grouped.get(message.id) : undefined}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {!atBottom && (
              <button
                type="button"
                onClick={() => {
                  setAtBottom(true)
                  scrollToBottom('smooth')
                }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-line bg-panel px-3 py-1.5 text-[10.5px] font-medium text-muted shadow-pill transition-colors hover:text-ink"
              >
                <span className="inline-flex items-center gap-1.5">
                  <ArrowUp size={11} />
                  Jump to latest
                </span>
              </button>
            )}
          </div>

          <div className="shrink-0 bg-panel px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
            <div className="mx-auto w-full max-w-[780px]">
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={send}
                onStop={() => session && stopRun(session.id)}
                onCommand={handleCommand}
                streaming={streaming}
                placeholder={connected ? 'Message MaxCode' : 'Add a provider key to start'}
              />
              <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[9.5px] text-faint">
                <span className="flex items-center gap-1">
                  {settings.mode === 'plan' ? <ListChecks size={10} /> : <Sparkles size={10} />}
                  {settings.mode === 'plan'
                    ? 'Plan mode · read-only tools'
                    : activeSkills > 0
                      ? `${activeSkills} skill${activeSkills === 1 ? '' : 's'} loaded`
                      : 'Build mode · full tools'}
                </span>
                <span className="hidden sm:inline">
                  {workspace.available ? `Working in ${workspace.name}` : 'No workspace open'}
                </span>
                <span className="sm:hidden">
                  {settings.tools.shell.approval === 'ask' ? 'Shell asks first' : 'Shell auto-runs'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
