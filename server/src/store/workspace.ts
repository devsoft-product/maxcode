import { create } from 'zustand'
import type { WorkspaceEntry, WorkspaceFile, WorkspaceInfo } from '../types'
import {
  addWorkspace as addWorkspaceToDaemon,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  forgetWorkspace as forgetWorkspaceInDaemon,
  getWorkspaceTree,
  gitSummary as fetchGitSummary,
  readWorkspaceFile,
  renameWorkspaceEntry,
  writeWorkspaceFile,
} from '../lib/daemon'
import { useUi } from './ui'

export interface GitState {
  available: boolean
  root: string
  branch: string
  entries: Array<{ status: string; path: string }>
  error: string
}

const EMPTY_INFO: WorkspaceInfo = {
  root: '',
  name: '',
  available: false,
  error: '',
  workspaces: [],
}

const EMPTY_GIT: GitState = {
  available: false,
  root: '',
  branch: '',
  entries: [],
  error: '',
}

interface WorkspaceStore {
  info: WorkspaceInfo
  root: string
  entries: WorkspaceEntry[]
  truncated: boolean
  loadingTree: boolean
  treeError: string
  activeFile: string | null
  file: WorkspaceFile | null
  content: string
  dirty: boolean
  saving: boolean
  openingFile: boolean
  git: GitState
  gitLoading: boolean
  hydrate: (info: WorkspaceInfo) => Promise<void>
  loadTree: () => Promise<void>
  refresh: (options?: { treeOnly?: boolean }) => Promise<void>
  openFile: (path: string) => Promise<void>
  closeFile: () => void
  setContent: (content: string) => void
  saveFile: () => Promise<boolean>
  createEntry: (path: string, type: 'file' | 'dir') => Promise<void>
  renameEntry: (from: string, to: string) => Promise<void>
  deleteEntry: (path: string) => Promise<void>
  addWorkspace: (path: string) => Promise<void>
  forgetWorkspace: () => Promise<void>
  loadGit: () => Promise<void>
  setActiveFile: (path: string | null) => void
}

function isRemoved(activeFile: string | null, path: string) {
  return Boolean(activeFile && (activeFile === path || activeFile.startsWith(`${path}/`)))
}

export const useWorkspace = create<WorkspaceStore>()((set, get) => ({
  info: EMPTY_INFO,
  root: '',
  entries: [],
  truncated: false,
  loadingTree: false,
  treeError: '',
  activeFile: null,
  file: null,
  content: '',
  dirty: false,
  saving: false,
  openingFile: false,
  git: EMPTY_GIT,
  gitLoading: false,

  hydrate: async (info) => {
    set({
      info,
      root: info.root,
      treeError: info.available ? '' : info.error,
      entries: info.available ? get().entries : [],
      activeFile: info.available ? get().activeFile : null,
      file: info.available ? get().file : null,
      content: info.available ? get().content : '',
      dirty: false,
      git: info.available ? get().git : EMPTY_GIT,
    })
    if (info.available) {
      await get().loadTree()
      void get().loadGit()
    }
  },

  loadTree: async () => {
    const info = get().info
    if (!info.available || !info.root) {
      set({ entries: [], loadingTree: false, treeError: info.error })
      return
    }
    set({ loadingTree: true, treeError: '' })
    try {
      const result = await getWorkspaceTree('', 7)
      set({
        entries: result.entries,
        truncated: result.truncated,
        loadingTree: false,
        root: result.root,
        info: result.workspace,
      })
    } catch (error) {
      set({
        loadingTree: false,
        treeError: error instanceof Error ? error.message : 'Could not read the workspace.',
      })
    }
  },

  refresh: async ({ treeOnly = false } = {}) => {
    await get().loadTree()
    if (treeOnly) return
    const active = get().activeFile
    if (!active || get().dirty) return
    const stillThere = get().entries.some((entry) => entry.path === active && entry.type === 'file')
    if (!stillThere) {
      set({ activeFile: null, file: null, content: '', dirty: false })
      return
    }
    try {
      await get().openFile(active)
    } catch {
      // A tree refresh is still useful if the file disappeared mid-read.
    }
  },

  openFile: async (path) => {
    if (!path || get().openingFile) return
    if (get().activeFile === path && get().file) return
    if (get().dirty) {
      const saved = await get().saveFile()
      if (!saved) return
    }
    set({ openingFile: true, treeError: '' })
    try {
      const file = await readWorkspaceFile(path)
      set({
        activeFile: path,
        file,
        content: file.content,
        dirty: false,
        openingFile: false,
      })
    } catch (error) {
      set({
        openingFile: false,
        treeError: error instanceof Error ? error.message : 'Could not open that file.',
      })
      useUi.getState().notify(error instanceof Error ? error.message : 'Could not open that file.', 'error')
    }
  },

  closeFile: () => set({ activeFile: null, file: null, content: '', dirty: false }),

  setContent: (content) => {
    if (get().file?.binary) return
    if (content === get().content) return
    set({ content, dirty: true })
  },

  saveFile: async () => {
    const { activeFile, content, dirty, file, saving } = get()
    if (!activeFile || !dirty || saving || file?.binary) return true
    set({ saving: true })
    try {
      const result = await writeWorkspaceFile(activeFile, content)
      set({
        saving: false,
        dirty: false,
        file: file
          ? { ...file, size: result.size, mtime: result.mtime, hash: result.hash, truncated: false }
          : file,
      })
      useUi.getState().notify(`Saved ${activeFile}`, 'success')
      return true
    } catch (error) {
      set({ saving: false })
      useUi.getState().notify(error instanceof Error ? error.message : 'Could not save that file.', 'error')
      return false
    }
  },

  createEntry: async (path, type) => {
    await createWorkspaceEntry(path, type)
    await get().loadTree()
    if (type === 'file') await get().openFile(path)
    useUi.getState().notify(`${type === 'dir' ? 'Folder' : 'File'} created: ${path}`, 'success')
  },

  renameEntry: async (from, to) => {
    await renameWorkspaceEntry(from, to)
    await get().loadTree()
    if (isRemoved(get().activeFile, from)) {
      const moved = get().activeFile === from ? to : `${to}${get().activeFile?.slice(from.length) ?? ''}`
      set({ activeFile: null, file: null, content: '', dirty: false })
      await get().openFile(moved)
    }
    useUi.getState().notify(`Renamed to ${to}`, 'success')
  },

  deleteEntry: async (path) => {
    await deleteWorkspaceEntry(path)
    if (isRemoved(get().activeFile, path)) {
      set({ activeFile: null, file: null, content: '', dirty: false })
    }
    await get().loadTree()
    useUi.getState().notify(`Deleted ${path}`, 'success')
  },

  addWorkspace: async (path) => {
    const result = await addWorkspaceToDaemon(path)
    set({ activeFile: null, file: null, content: '', dirty: false, entries: [] })
    await get().hydrate(result.workspace)
    useUi.getState().notify(`Workspace set to ${result.entry.name}`, 'success')
  },

  forgetWorkspace: async () => {
    if (get().dirty) {
      const saved = await get().saveFile()
      if (!saved) return
    }
    const info = await forgetWorkspaceInDaemon()
    set({
      info,
      root: '',
      entries: [],
      activeFile: null,
      file: null,
      content: '',
      dirty: false,
      git: EMPTY_GIT,
    })
  },

  loadGit: async () => {
    if (!get().info.available) return
    set({ gitLoading: true })
    try {
      const git = await fetchGitSummary()
      set({ git: { ...git }, gitLoading: false })
    } catch (error) {
      set({
        git: { ...EMPTY_GIT, error: error instanceof Error ? error.message : 'Git status failed.' },
        gitLoading: false,
      })
    }
  },

  setActiveFile: (path) => {
    if (!path) get().closeFile()
    else void get().openFile(path)
  },
}))

export function workspaceFileCount(state: WorkspaceStore) {
  return state.entries.filter((entry) => entry.type === 'file').length
}
