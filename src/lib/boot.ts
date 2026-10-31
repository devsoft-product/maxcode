import { create } from 'zustand'
import type { DaemonSnapshot } from '../types'
import { ensureSession, getState, migrateLegacy } from './daemon'
import { enableChatPersistence, useChats } from '../store/chats'
import { enableSettingsPersistence, useSettings } from '../store/settings'
import { useWorkspace } from '../store/workspace'

const LEGACY_KEYS = {
  settings: 'maxcode-settings-v1',
  chats: 'maxcode-chats-v1',
  workspace: 'maxcode-workspace-v1',
} as const

type BootPhase = 'idle' | 'loading' | 'ready' | 'error'

interface BootState {
  phase: BootPhase
  error: string
  startedAt: number
  boot: (force?: boolean) => Promise<void>
}

export const useBoot = create<BootState>()((set, get) => ({
  phase: 'idle',
  error: '',
  startedAt: 0,
  boot: async (force = false) => {
    if (get().phase === 'loading') return
    if (get().phase === 'ready' && !force) return
    set({ phase: 'loading', error: '', startedAt: Date.now() })
    try {
      await ensureSession()
      let snapshot = await getState()
      const legacy = readLegacy()
      if (legacy.found) {
        if (!snapshot.migration?.migratedAt) {
          const result = await migrateLegacy({ settings: legacy.settings, chats: legacy.chats })
          snapshot = result.state
        }
        clearLegacy()
      }
      await applySnapshot(snapshot)
      enableSettingsPersistence()
      enableChatPersistence()
      set({ phase: 'ready', error: '' })
    } catch (error) {
      set({
        phase: 'error',
        error:
          error instanceof Error
            ? error.message
            : 'MaxCode could not reach its local daemon.',
      })
    }
  },
}))

export async function applySnapshot(snapshot: DaemonSnapshot): Promise<void> {
  useSettings.getState().hydrate(snapshot)
  useChats.getState().hydrate(snapshot.chats)
  await useWorkspace.getState().hydrate(snapshot.workspace)
}

function parseLegacy(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function readLegacy() {
  if (typeof window === 'undefined') return { found: false, settings: undefined, chats: undefined }
  let settings: unknown
  let chats: unknown
  let found = false
  try {
    settings = parseLegacy(window.localStorage.getItem(LEGACY_KEYS.settings))
    chats = parseLegacy(window.localStorage.getItem(LEGACY_KEYS.chats))
    found = Boolean(settings || chats || window.localStorage.getItem(LEGACY_KEYS.workspace))
  } catch {
    // Local storage can be unavailable; the daemon state is still usable.
  }
  return { found, settings, chats }
}

function clearLegacy() {
  try {
    for (const key of Object.values(LEGACY_KEYS)) window.localStorage.removeItem(key)
  } catch {
    // Nothing else to clean up.
  }
}
