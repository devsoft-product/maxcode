import { create } from 'zustand'
import type { AgentMode, ChatSession, Message, ProviderId } from '../types'
import { csrfToken, saveChats } from '../lib/daemon'

function createId(prefix: string) {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  return `${prefix}_${raw}`
}

export { createId }

function isSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') return false
  const session = value as ChatSession
  return typeof session.id === 'string' && typeof session.title === 'string' && Array.isArray(session.messages)
}

function normalizeSession(session: ChatSession): ChatSession {
  let round = 0
  const messages = session.messages
    .filter((message): message is Message => Boolean(message && typeof message === 'object'))
    .map((message, index) => {
      if (message.role === 'user') {
        if (index > 0) round += 1
        return message
      }
      const existing = typeof message.round === 'number' ? message.round : round
      if (message.role === 'assistant') {
        return {
          ...message,
          content: typeof message.content === 'string' ? message.content : '',
          reasoning: typeof message.reasoning === 'string' ? message.reasoning : '',
          toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : [],
          round: existing,
        }
      }
      return { ...message, round: existing }
    })
  return {
    ...session,
    title: session.title.trim() || 'New conversation',
    messages,
    createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
    updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
    mode: session.mode === 'plan' ? 'plan' : session.mode === 'build' ? 'build' : undefined,
  }
}

interface PersistedChats {
  sessions: ChatSession[]
  activeId: string | null
}

interface ChatsState {
  sessions: ChatSession[]
  activeId: string | null
  hydrated: boolean
  hydrate: (payload: PersistedChats) => void
  setActive: (id: string | null) => void
  newChat: () => void
  createSession: (provider: ProviderId, model: string, mode?: AgentMode) => string
  addMessage: (sessionId: string, message: Message) => void
  updateMessage: (
    sessionId: string,
    messageId: string,
    patch: Partial<Message> | ((message: Message) => Partial<Message>),
  ) => void
  updateSession: (sessionId: string, patch: Partial<ChatSession>) => void
  renameSession: (sessionId: string, title: string) => void
  deleteSession: (sessionId: string) => void
  clearAll: () => void
  persistNow: () => Promise<void>
}

function titleFromText(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'New conversation'
  return clean.length > 56 ? `${clean.slice(0, 56).trim()}…` : clean
}

export const useChats = create<ChatsState>()((set, get) => ({
  sessions: [],
  activeId: null,
  hydrated: false,
  hydrate: (payload) => {
    const sessions = (payload.sessions ?? [])
      .filter(isSession)
      .map(normalizeSession)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const activeId =
      typeof payload.activeId === 'string' && sessions.some((session) => session.id === payload.activeId)
        ? payload.activeId
        : sessions[0]?.id ?? null
    set({ sessions, activeId, hydrated: true })
  },
  setActive: (id) => set({ activeId: id }),
  newChat: () => set({ activeId: null }),
  createSession: (provider, model, mode) => {
    const id = createId('chat')
    const now = Date.now()
    const session: ChatSession = {
      id,
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
      messages: [],
      provider,
      model,
      mode,
    }
    set((state) => ({ sessions: [session, ...state.sessions], activeId: id }))
    return id
  },
  addMessage: (sessionId, message) => {
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.id !== sessionId) return session
        const patch: Partial<ChatSession> = {
          messages: [...session.messages, message],
          updatedAt: Date.now(),
        }
        if (message.role === 'user' && session.messages.length === 0) {
          patch.title = titleFromText(message.content)
        }
        return { ...session, ...patch }
      }),
    }))
  },
  updateMessage: (sessionId, messageId, patch) => {
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.id !== sessionId) return session
        let changed = false
        const messages = session.messages.map((message) => {
          if (message.id !== messageId) return message
          const next = typeof patch === 'function' ? patch(message) : patch
          if (!next || Object.keys(next).length === 0) return message
          changed = true
          return { ...message, ...next } as Message
        })
        return changed ? { ...session, messages, updatedAt: Date.now() } : session
      }),
    }))
  },
  updateSession: (sessionId, patch) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, ...patch, updatedAt: Date.now() } : session,
      ),
    }))
  },
  renameSession: (sessionId, title) => {
    const clean = title.trim()
    if (!clean) return
    get().updateSession(sessionId, { title: clean })
  },
  deleteSession: (sessionId) => {
    set((state) => {
      const sessions = state.sessions.filter((session) => session.id !== sessionId)
      return {
        sessions,
        activeId: state.activeId === sessionId ? sessions[0]?.id ?? null : state.activeId,
      }
    })
  },
  clearAll: () => set({ sessions: [], activeId: null }),
  persistNow: async () => {
    const { sessions, activeId } = get()
    await saveChats({ sessions, activeId })
  },
}))

let persistenceEnabled = false
let saveTimer: number | undefined
let maxTimer: number | undefined

export function enableChatPersistence() {
  persistenceEnabled = true
}

function scheduleSave() {
  if (!persistenceEnabled || typeof window === 'undefined') return
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined
    void persistChats()
  }, 900)
  if (maxTimer === undefined) {
    maxTimer = window.setTimeout(() => {
      maxTimer = undefined
      void persistChats()
    }, 6000)
  }
}

async function persistChats() {
  if (!persistenceEnabled) return
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer)
    saveTimer = undefined
  }
  if (maxTimer !== undefined) {
    window.clearTimeout(maxTimer)
    maxTimer = undefined
  }
  const { sessions, activeId } = useChats.getState()
  try {
    await saveChats({ sessions, activeId })
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent('maxcode:notice', {
        detail: {
          message: error instanceof Error ? error.message : 'Could not save conversations to the local daemon.',
          tone: 'error',
        },
      }),
    )
  }
}

useChats.subscribe(scheduleSave)

if (typeof window !== 'undefined') {
  const unload = () => {
    if (!persistenceEnabled) return
    const { sessions, activeId } = useChats.getState()
    try {
      void fetch('/api/chats', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'x-maxcode-csrf': csrfToken() },
        body: JSON.stringify({ sessions, activeId }),
      })
    } catch {
      // The daemon will keep the last saved snapshot.
    }
  }
  window.addEventListener('beforeunload', unload)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') unload()
  })
}

export function exportChats() {
  const data = useChats.getState().sessions
  const blob = new Blob(
    [JSON.stringify({ app: 'MaxCode', exportedAt: new Date().toISOString(), sessions: data }, null, 2)],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `maxcode-history-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function importChats(file: File): Promise<number> {
  return file.text().then((text) => {
    const parsed = JSON.parse(text) as { sessions?: unknown[] }
    if (!Array.isArray(parsed.sessions)) throw new Error('This file does not contain a MaxCode history.')
    const sessions = parsed.sessions.filter(isSession).map(normalizeSession)
    if (sessions.length === 0) throw new Error('No valid conversations were found in this file.')
    const existing = new Set(useChats.getState().sessions.map((session) => session.id))
    const added = sessions.filter((session) => !existing.has(session.id))
    useChats.setState((state) => ({
      sessions: [...added, ...state.sessions],
      activeId: added[0]?.id ?? state.activeId,
    }))
    return added.length
  })
}
