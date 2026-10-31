import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  HardDrive,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { WorkspaceEntry } from '../types'
import { browseFolders } from '../lib/daemon'
import { cn, formatBytes } from '../lib/utils'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { Spinner } from './ui'

interface TreeNode {
  entry: WorkspaceEntry
  children: TreeNode[]
}

function buildTree(entries: WorkspaceEntry[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const entry of entries) nodes.set(entry.path, { entry, children: [] })
  const roots: TreeNode[] = []
  const sorted = [...entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  for (const entry of sorted) {
    const node = nodes.get(entry.path)
    if (!node) continue
    const slash = entry.path.lastIndexOf('/')
    const parent = slash === -1 ? null : nodes.get(entry.path.slice(0, slash))
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (items: TreeNode[]) => {
    items.sort((a, b) =>
      a.entry.type === b.entry.type
        ? a.entry.name.localeCompare(b.entry.name)
        : a.entry.type === 'dir'
          ? -1
          : 1,
    )
    items.forEach((item) => sort(item.children))
  }
  sort(roots)
  return roots
}

function extension(path: string) {
  const match = /\.([a-z0-9]+)$/i.exec(path)
  return match ? match[1].toUpperCase() : 'TEXT'
}

function FolderPicker({ onDone }: { onDone?: () => void }) {
  const addWorkspace = useWorkspace((state) => state.addWorkspace)
  const workspaces = useWorkspace((state) => state.info.workspaces)
  const notify = useUi((state) => state.notify)
  const [path, setPath] = useState('')
  const [parent, setParent] = useState('')
  const [home, setHome] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)

  const load = async (target: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await browseFolders(target)
      setPath(result.path)
      setParent(result.parent)
      setHome(result.home)
      setEntries(result.entries)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that folder.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('')
  }, [])

  const open = async (target: string) => {
    setOpening(true)
    try {
      await addWorkspace(target)
      onDone?.()
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not open that folder.', 'error')
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-4">
        <p className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">Choose a real folder</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
          MaxCode works directly in this folder through the local daemon. Nothing is uploaded.
        </p>
      </div>

      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <button
          type="button"
          className="icon-button h-7 w-7"
          onClick={() => void load(parent)}
          disabled={!parent || loading}
          aria-label="Parent folder"
        >
          <ArrowLeft size={13} />
        </button>
        <button
          type="button"
          className="icon-button h-7 w-7"
          onClick={() => void load(home)}
          disabled={!home || loading}
          aria-label="Home folder"
        >
          <HardDrive size={13} />
        </button>
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted" title={path}>
          {path || 'Home'}
        </p>
        {loading && <Spinner size={12} />}
        <button
          type="button"
          onClick={() => void open(path)}
          disabled={!path || opening}
          className="inline-flex h-7 items-center gap-1 rounded-lg bg-ink px-2.5 text-[10.5px] font-medium text-panel disabled:opacity-40"
        >
          {opening ? <Spinner size={11} /> : <Check size={11} />}
          Open
        </button>
      </div>

      {workspaces.length > 0 && (
        <div className="border-b border-line px-3 py-2">
          <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-faint">Recent</p>
          <div className="flex flex-wrap gap-1">
            {workspaces.slice(0, 6).map((workspace) => (
              <button
                key={workspace.path}
                type="button"
                onClick={() => void open(workspace.path)}
                className="max-w-full truncate rounded-md border border-line bg-raised/60 px-2 py-1 text-left text-[10px] text-muted hover:text-ink"
                title={workspace.path}
              >
                {workspace.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && <p className="px-2 py-3 text-[11px] text-danger">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p className="px-2 py-4 text-[11px] text-faint">This folder has no subfolders.</p>
        )}
        {entries.map((entry) => (
          <div key={entry.path} className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load(entry.path)}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Folder size={13} className="shrink-0 text-faint" />
              <span className="truncate">{entry.name}</span>
            </button>
            <button
              type="button"
              onClick={() => void open(entry.path)}
              className="hidden h-7 rounded-md px-2 text-[10px] font-medium text-accent group-hover:block"
            >
              Use
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WorkspacePanel() {
  const open = useUi((state) => state.workspaceOpen)
  const setOpen = useUi((state) => state.setWorkspaceOpen)
  const notify = useUi((state) => state.notify)
  const askConfirm = useUi((state) => state.askConfirm)
  const info = useWorkspace((state) => state.info)
  const root = useWorkspace((state) => state.root)
  const entries = useWorkspace((state) => state.entries)
  const loadingTree = useWorkspace((state) => state.loadingTree)
  const treeError = useWorkspace((state) => state.treeError)
  const activeFile = useWorkspace((state) => state.activeFile)
  const file = useWorkspace((state) => state.file)
  const content = useWorkspace((state) => state.content)
  const dirty = useWorkspace((state) => state.dirty)
  const saving = useWorkspace((state) => state.saving)
  const openingFile = useWorkspace((state) => state.openingFile)
  const git = useWorkspace((state) => state.git)
  const gitLoading = useWorkspace((state) => state.gitLoading)
  const setActiveFile = useWorkspace((state) => state.setActiveFile)
  const saveFile = useWorkspace((state) => state.saveFile)
  const setContent = useWorkspace((state) => state.setContent)
  const createEntry = useWorkspace((state) => state.createEntry)
  const renameEntry = useWorkspace((state) => state.renameEntry)
  const deleteEntry = useWorkspace((state) => state.deleteEntry)
  const forgetWorkspace = useWorkspace((state) => state.forgetWorkspace)
  const loadGit = useWorkspace((state) => state.loadGit)
  const refresh = useWorkspace((state) => state.refresh)

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'files' | 'git'>('files')
  const [choosing, setChoosing] = useState(!info.available)
  const [editor, setEditor] = useState<{ mode: 'create-file' | 'create-dir' | 'rename'; value: string } | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const editorRef = useRef<HTMLInputElement>(null)

  const tree = useMemo(() => buildTree(entries), [entries])
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase()
    if (!clean) return null
    return entries.filter((entry) => entry.path.toLowerCase().includes(clean)).slice(0, 300)
  }, [entries, query])
  const lineCount = content ? content.split('\n').length : 0

  useEffect(() => {
    if (editor) editorRef.current?.focus()
  }, [editor])

  useEffect(() => {
    setChoosing(!info.available)
  }, [info.available])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      if (!useUi.getState().workspaceOpen || !useWorkspace.getState().activeFile) return
      event.preventDefault()
      void useWorkspace.getState().saveFile()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null

  const submitEditor = async () => {
    if (!editor) return
    const value = editor.value.trim().replace(/^\/+/, '')
    if (!value) return setEditor(null)
    try {
      if (editor.mode === 'rename') {
        if (!activeFile) return
        await renameEntry(activeFile, value)
      } else {
        await createEntry(value, editor.mode === 'create-dir' ? 'dir' : 'file')
      }
      setEditor(null)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'That change failed.', 'error')
    }
  }

  const removeEntry = async (path: string) => {
    const confirmed = await askConfirm({
      title: 'Delete this path?',
      body: `${path} will be deleted from disk. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await deleteEntry(path)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not delete that path.', 'error')
    }
  }

  const copyFile = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      notify('Clipboard access was blocked.', 'error')
    }
  }

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const path = node.entry.path
    if (node.entry.type === 'dir') {
      const closed = collapsed.has(path)
      return (
        <div key={path}>
          <button
            type="button"
            onClick={() =>
              setCollapsed((current) => {
                const next = new Set(current)
                if (next.has(path)) next.delete(path)
                else next.add(path)
                return next
              })
            }
            className="group flex h-7 w-full items-center gap-1.5 rounded-md pr-1.5 text-left text-[11.5px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
            style={{ paddingLeft: 8 + depth * 13 }}
            title={path}
          >
            <ChevronRight size={10} className={cn('shrink-0 text-faint transition-transform', !closed && 'rotate-90')} />
            {closed ? (
              <Folder size={12} className="shrink-0 text-faint" />
            ) : (
              <FolderOpen size={12} className="shrink-0 text-faint" />
            )}
            <span className="min-w-0 flex-1 truncate">{node.entry.name}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                void removeEntry(path)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void removeEntry(path)
              }}
              className="hidden h-5 w-5 items-center justify-center rounded text-faint hover:text-danger group-hover:flex"
              aria-label={`Delete ${path}`}
            >
              <Trash2 size={10} />
            </span>
          </button>
          {!closed && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }
    return (
      <button
        key={path}
        type="button"
        onClick={() => setActiveFile(path)}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded-md pr-1.5 text-left font-mono text-[10.5px] transition-colors',
          activeFile === path ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-raised hover:text-ink',
        )}
        style={{ paddingLeft: 8 + depth * 13 + 10 }}
        title={path}
      >
        <FileText size={11} className={cn('shrink-0', activeFile === path ? 'text-accent' : 'text-faint')} />
        <span className="min-w-0 flex-1 truncate">{node.entry.name}</span>
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close workspace"
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 cursor-default bg-ink/20 backdrop-blur-[1px] xl:hidden"
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(96vw,440px)] flex-col border-l border-line bg-panel shadow-float xl:static xl:z-auto xl:w-[390px] xl:shadow-none">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <FolderOpen size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold tracking-[-0.01em] text-ink">
              {info.available ? info.name : 'Workspace'}
            </p>
            <p className="truncate text-[9px] text-faint" title={root}>
              {info.available ? root : 'No folder open'}
            </p>
          </div>
          {info.available && (
            <>
              <button
                type="button"
                className="icon-button h-7 w-7"
                onClick={() => setChoosing(true)}
                title="Change folder"
                aria-label="Change folder"
              >
                <Folder size={14} />
              </button>
              <button
                type="button"
                className="icon-button h-7 w-7"
                onClick={() => void refresh().catch(() => undefined)}
                title="Refresh tree"
                aria-label="Refresh tree"
              >
                <RefreshCw size={13} className={cn(loadingTree && 'animate-spin')} />
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-button h-7 w-7"
            onClick={() => setOpen(false)}
            title="Close workspace"
            aria-label="Close workspace"
          >
            <X size={15} />
          </button>
        </div>

        {choosing || !info.available ? (
          <FolderPicker onDone={() => setChoosing(false)} />
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
              <button
                type="button"
                onClick={() => setTab('files')}
                className={cn(
                  'h-7 rounded-md px-2.5 text-[11px] font-medium',
                  tab === 'files' ? 'bg-raised text-ink' : 'text-muted hover:text-ink',
                )}
              >
                Files
              </button>
              <button
                type="button"
                onClick={() => setTab('git')}
                className={cn(
                  'h-7 rounded-md px-2.5 text-[11px] font-medium',
                  tab === 'git' ? 'bg-raised text-ink' : 'text-muted hover:text-ink',
                )}
              >
                Git {git.entries.length > 0 && <span className="text-warning">· {git.entries.length}</span>}
              </button>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  className="icon-button h-7 w-7"
                  onClick={() => setEditor({ mode: 'create-file', value: '' })}
                  title="New file"
                  aria-label="New file"
                >
                  <FilePlus2 size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button h-7 w-7"
                  onClick={() => setEditor({ mode: 'create-dir', value: '' })}
                  title="New folder"
                  aria-label="New folder"
                >
                  <FolderPlus size={13} />
                </button>
              </div>
            </div>

            {tab === 'files' ? (
              <>
                <div className="shrink-0 border-b border-line px-2.5 py-2">
                  <div className="relative">
                    <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Find a file"
                      className="h-7 w-full rounded-md border border-transparent bg-raised/60 pl-7 pr-2 text-[10.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-line focus:bg-panel"
                      aria-label="Find a file"
                    />
                  </div>
                  {editor && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <input
                        ref={editorRef}
                        value={editor.value}
                        onChange={(event) => setEditor({ ...editor, value: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void submitEditor()
                          if (event.key === 'Escape') setEditor(null)
                        }}
                        placeholder={editor.mode === 'rename' ? activeFile ?? 'new/path' : 'folder/file.ts'}
                        className="h-7 min-w-0 flex-1 rounded-md border border-accent/40 bg-panel px-2 font-mono text-[10.5px] outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void submitEditor()}
                        className="flex h-7 items-center rounded-md bg-ink px-2 text-[10px] font-medium text-panel"
                      >
                        <Plus size={10} />
                      </button>
                      <button type="button" onClick={() => setEditor(null)} className="icon-button h-7 w-7">
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="thin-scroll max-h-[32dvh] min-h-[92px] shrink-0 overflow-y-auto px-1.5 py-1.5 xl:max-h-[38%]">
                  {treeError && <p className="px-2 py-2 text-[10.5px] text-danger">{treeError}</p>}
                  {loadingTree && entries.length === 0 && (
                    <p className="flex items-center gap-1.5 px-2 py-3 text-[10.5px] text-faint">
                      <Spinner size={11} /> Reading folder…
                    </p>
                  )}
                  {filtered
                    ? filtered.map((entry) => (
                        <button
                          key={entry.path}
                          type="button"
                          onClick={() => entry.type === 'file' && setActiveFile(entry.path)}
                          className={cn(
                            'flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left font-mono text-[10.5px]',
                            activeFile === entry.path
                              ? 'bg-accent-soft font-medium text-accent'
                              : 'text-muted hover:bg-raised hover:text-ink',
                          )}
                        >
                          {entry.type === 'dir' ? <Folder size={11} /> : <FileText size={11} />}
                          <span className="truncate">{entry.path}</span>
                        </button>
                      ))
                    : tree.map((node) => renderNode(node, 0))}
                  {!loadingTree && !treeError && entries.length === 0 && (
                    <p className="px-2 py-4 text-center text-[10.5px] text-faint">This folder is empty.</p>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col border-t border-line">
                  {activeFile && file ? (
                    <>
                      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[10.5px] font-medium text-ink">{activeFile}</p>
                          <p className="mt-0.5 text-[9px] text-faint">
                            {extension(activeFile)} · {lineCount} lines · {formatBytes(file.size)}
                            {dirty ? ' · unsaved' : ' · saved'}
                          </p>
                        </div>
                        {openingFile && <Spinner size={11} />}
                        <button
                          type="button"
                          className="icon-button h-7 w-7"
                          onClick={() => setEditor({ mode: 'rename', value: activeFile })}
                          title="Rename"
                          aria-label="Rename"
                        >
                          <Pencil size={12} />
                        </button>
                        <button type="button" className="icon-button h-7 w-7" onClick={copyFile} title="Copy" aria-label="Copy">
                          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                        </button>
                        <button
                          type="button"
                          className="icon-button h-7 w-7 hover:text-danger"
                          onClick={() => void removeEntry(activeFile)}
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveFile()}
                          disabled={!dirty || saving}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2 text-[10px] font-medium text-panel disabled:opacity-35"
                        >
                          {saving ? <Spinner size={10} /> : <Save size={10} />}
                          Save
                        </button>
                      </div>
                      {file.binary ? (
                        <div className="flex flex-1 items-center justify-center px-6 text-center text-[11px] text-faint">
                          This file is binary and cannot be edited here.
                        </div>
                      ) : (
                        <textarea
                          value={content}
                          onChange={(event) => setContent(event.target.value)}
                          spellCheck={false}
                          wrap="off"
                          aria-label={`Edit ${activeFile}`}
                          className="thin-scroll min-h-0 flex-1 resize-none overflow-auto bg-panel p-3.5 font-mono text-[11.5px] leading-[1.75] text-ink outline-none"
                        />
                      )}
                      <div className="flex h-6 shrink-0 items-center justify-between border-t border-line px-3 text-[8.5px] text-faint">
                        <span className="flex items-center gap-1">
                          <span className={cn('h-1 w-1 rounded-full', dirty ? 'bg-warning' : 'bg-success')} />
                          {dirty ? 'Unsaved changes' : 'Saved to disk'}
                        </span>
                        <span>⌘S to save · UTF-8</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-raised text-faint">
                        <FileText size={16} />
                      </span>
                      <p className="text-[11.5px] font-medium text-ink">No file selected</p>
                      <p className="max-w-[230px] text-[10px] leading-relaxed text-faint">
                        Pick a file from the tree. The agent reads and writes these same files.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="flex items-center gap-2 border-b border-line px-3 py-3">
                  <GitBranch size={14} className="text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-medium text-ink">
                      {git.available ? git.branch || 'detached HEAD' : 'Not a git repository'}
                    </p>
                    <p className="text-[9.5px] text-faint">
                      {git.available ? `${git.entries.length} changed path${git.entries.length === 1 ? '' : 's'}` : git.error}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-button h-7 w-7"
                    onClick={() => void loadGit()}
                    aria-label="Refresh git"
                  >
                    <RefreshCw size={12} className={cn(gitLoading && 'animate-spin')} />
                  </button>
                </div>
                {git.entries.length === 0 ? (
                  <p className="px-3 py-5 text-[10.5px] text-faint">The working tree is clean.</p>
                ) : (
                  git.entries.map((entry) => (
                    <button
                      key={`${entry.status}-${entry.path}`}
                      type="button"
                      onClick={() => setActiveFile(entry.path)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[10px] hover:bg-raised"
                      title={entry.path}
                    >
                      <span className="w-6 shrink-0 text-warning">{entry.status}</span>
                      <span className="truncate text-muted">{entry.path}</span>
                    </button>
                  ))
                )}
                <div className="border-t border-line p-3">
                  <button
                    type="button"
                    onClick={async () => {
                      const confirmed = await askConfirm({
                        title: 'Forget this workspace?',
                        body: 'The folder stays on disk. MaxCode stops showing it and closes the current file.',
                        confirmLabel: 'Forget workspace',
                      })
                      if (confirmed) await forgetWorkspace()
                    }}
                    className="text-[10.5px] font-medium text-faint hover:text-danger"
                  >
                    Forget this workspace
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {info.available && !choosing && (
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-t border-line px-3 text-[9px] text-faint">
            <LoaderCircle size={10} className={cn(loadingTree && 'animate-spin')} />
            Real folder · daemon-scoped access
            <span className="ml-auto">{entries.length} entries</span>
          </div>
        )}
      </aside>
    </>
  )
}
