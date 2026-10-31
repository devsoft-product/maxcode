import { create } from 'zustand'

interface RuntimeState {
  streaming: Record<string, boolean>
  setStreaming: (sessionId: string, active: boolean) => void
}

export const useRuntime = create<RuntimeState>()((set) => ({
  streaming: {},
  setStreaming: (sessionId, active) =>
    set((state) => {
      if (Boolean(state.streaming[sessionId]) === active) return state
      const streaming = { ...state.streaming }
      if (active) streaming[sessionId] = true
      else delete streaming[sessionId]
      return { streaming }
    }),
}))

type ToastTone = 'info' | 'success' | 'error'

interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface ConfirmOptions {
  title: string
  body: string
  confirmLabel?: string
  tone?: 'danger' | 'default'
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

interface UiState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
  workspaceOpen: boolean
  setWorkspaceOpen: (open: boolean) => void
  settingsOpen: boolean
  settingsTab: 'models' | 'tools' | 'search' | 'skills' | 'plugins' | 'deploy' | 'appearance' | 'about'
  openSettings: (tab?: UiState['settingsTab']) => void
  closeSettings: () => void
  deployOpen: boolean
  setDeployOpen: (open: boolean) => void
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  composerFocus: number
  focusComposer: () => void
  toast: Toast | null
  notify: (message: string, tone?: ToastTone) => void
  dismissToast: (id: number) => void
  confirm: PendingConfirm | null
  askConfirm: (options: ConfirmOptions) => Promise<boolean>
  resolveConfirm: (value: boolean) => void
}

function sidebarWasCollapsed() {
  try {
    return localStorage.getItem('maxcode.sidebar-collapsed') === '1'
  } catch {
    return false
  }
}

function rememberSidebar(collapsed: boolean) {
  try {
    localStorage.setItem('maxcode.sidebar-collapsed', collapsed ? '1' : '0')
  } catch {
    // The preference is only a convenience; the session still works without it.
  }
}

export const useUi = create<UiState>()((set, get) => ({
  sidebarCollapsed: sidebarWasCollapsed(),
  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed
      rememberSidebar(next)
      return { sidebarCollapsed: next }
    }),
  mobileSidebarOpen: false,
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  workspaceOpen: false,
  setWorkspaceOpen: (open) => set({ workspaceOpen: open }),
  settingsOpen: false,
  settingsTab: 'models',
  openSettings: (tab = 'models') => set({ settingsOpen: true, settingsTab: tab, mobileSidebarOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  deployOpen: false,
  setDeployOpen: (open) => set({ deployOpen: open }),
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  composerFocus: 0,
  focusComposer: () => set((state) => ({ composerFocus: state.composerFocus + 1 })),
  toast: null,
  notify: (message, tone = 'info') =>
    set({ toast: { id: Date.now() + Math.random(), message, tone } }),
  dismissToast: (id) =>
    set((state) => (state.toast?.id === id ? { toast: null } : state)),
  confirm: null,
  askConfirm: (options) =>
    new Promise<boolean>((resolve) => {
      if (get().confirm) get().confirm?.resolve(false)
      set({ confirm: { ...options, resolve } })
    }),
  resolveConfirm: (value) => {
    const confirm = get().confirm
    set({ confirm: null })
    confirm?.resolve(value)
  },
}))

window.addEventListener('maxcode:notice', (event) => {
  const detail = (event as CustomEvent<{ message: string; tone?: ToastTone }>).detail
  if (detail?.message) useUi.getState().notify(detail.message, detail.tone ?? 'info')
})
