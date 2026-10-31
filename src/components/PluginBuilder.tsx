import { useRef, useState } from 'react'
import { FileUp, FolderTree, Hammer } from 'lucide-react'
import { buildPluginArchive, validatePluginManifest } from '../../shared/plugin-package.mjs'
import type { PluginCapability, PluginManifest } from '../../shared/plugin-package.mjs'
import { installPluginArchive, type InstalledPlugin } from '../lib/daemon'
import { isBinaryPath, loadPluginFolder, type PluginFolder } from '../lib/plugin-folder'
import { formatBytes } from '../lib/utils'
import { useUi } from '../store/ui'

const CAPABILITIES: PluginCapability[] = [
  'workspace.list',
  'workspace.read',
  'workspace.write',
  'workspace.edit',
  'ui.commands',
  'ui.panels',
  'ui.themes',
  'network.request',
]

const ACCEPT = '.js,.css,.json,.txt,.html,.svg,.png,.jpg,.jpeg,.gif,.webp,.woff,.woff2'

const fieldClass =
  'h-8 w-full rounded-lg border border-line bg-panel px-2.5 text-[12px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/50'

async function toPicked(file: File) {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
  return { path, content: isBinaryPath(path) ? new Uint8Array(await file.arrayBuffer()) : await file.text() }
}

export function PluginBuilder({ onInstalled }: { onInstalled?: (plugin: InstalledPlugin) => void }) {
  const notify = useUi((state) => state.notify)
  const [id, setId] = useState('my-plugin')
  const [name, setName] = useState('My plugin')
  const [version, setVersion] = useState('1.0.0')
  const [capabilities, setCapabilities] = useState<PluginCapability[]>(['ui.commands'])
  const [domains, setDomains] = useState('')
  const [folder, setFolder] = useState<PluginFolder | null>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async (list: FileList | null) => {
    if (!list?.length) return
    try {
      const picked = await Promise.all([...list].map(toPicked))
      const next = loadPluginFolder(picked)
      setFolder(next)
      // A manifest.json in the folder is a starting point, not the last word: the fields below win.
      if (next.manifest) {
        setId(next.manifest.id)
        setName(next.manifest.name)
        setVersion(next.manifest.version)
        setCapabilities(next.manifest.capabilities)
        setDomains(next.manifest.domains.join(', '))
      }
      notify(
        next.manifestError
          ? `Loaded ${Object.keys(next.files).length} file(s). Its manifest.json was ignored: ${next.manifestError}`
          : `Loaded ${Object.keys(next.files).length} file(s) — entry ${next.entry}.`,
        next.manifestError ? 'error' : 'info',
      )
    } catch (error) {
      setFolder(null)
      notify(error instanceof Error ? error.message : 'Those files are not a plugin folder.', 'error')
    }
  }

  const build = () => {
    try {
      if (!folder) throw new Error('Load a plugin folder or its files first.')
      const manifest: PluginManifest = {
        id: id.trim(),
        name: name.trim(),
        version: version.trim(),
        apiVersion: 1,
        entry: folder.entry,
        stylesheet: folder.stylesheet,
        capabilities,
        domains: domains
          .split(/[\s,]+/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      }
      validatePluginManifest(manifest)
      const files = { ...folder.files }
      // A plugin with no stylesheet of its own still ships an empty one.
      files[manifest.stylesheet] ??= ''
      return { archive: buildPluginArchive({ manifest, files }) }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That package could not be built.', 'error')
      return null
    }
  }

  const download = () => {
    const built = build()
    if (!built) return
    const url = URL.createObjectURL(new Blob([built.archive as BlobPart], { type: 'application/zip' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${id.trim() || 'plugin'}.pluginmax`
    link.click()
    URL.revokeObjectURL(url)
  }

  const install = async () => {
    const built = build()
    if (!built) return
    try {
      const { plugin } = await installPluginArchive(built.archive)
      onInstalled?.(plugin)
      notify(`${plugin.manifest.name} installed. It starts sandboxed and disabled.`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The daemon rejected this package.', 'error')
    }
  }

  const loaded = folder ? Object.keys(folder.files) : []

  return (
    <details className="rounded-xl border border-line bg-raised/20">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[11.5px] font-medium text-ink">
        <Hammer size={13} className="text-faint" />
        Build a .pluginmax from a folder
      </summary>
      <div className="space-y-2.5 border-t border-line px-3 py-3">
        <p className="text-[10.5px] leading-relaxed text-faint">
          Load a plugin folder, or the files themselves. One <code className="font-mono">.js</code> entry and one
          optional <code className="font-mono">.css</code> stylesheet become the package. A{' '}
          <code className="font-mono">manifest.json</code> in the folder fills these fields in; the fields win.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[10.5px] font-medium text-on-accent hover:bg-accent/90"
          >
            <FolderTree size={12} />
            Load folder
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[10.5px] font-medium text-ink hover:bg-raised"
          >
            <FileUp size={12} />
            Load files
          </button>
          <input
            type="file"
            multiple
            // React's types predate `webkitdirectory`; set it on the node instead.
            ref={(node) => {
              folderRef.current = node
              if (node) node.webkitdirectory = true
            }}
            className="hidden"
            onChange={(event) => {
              void load(event.target.files)
              event.target.value = ''
            }}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              void load(event.target.files)
              event.target.value = ''
            }}
          />
        </div>

        {folder && (
          <div className="rounded-lg border border-line bg-panel/60 px-2.5 py-2">
            <p className="text-[10.5px] text-muted">
              <span className="font-medium text-ink">{loaded.length} file(s)</span> · entry{' '}
              <code className="font-mono">{folder.entry}</code> · stylesheet{' '}
              <code className="font-mono">{folder.stylesheet}</code>
            </p>
            <ul className="mt-1 space-y-0.5">
              {loaded.slice(0, 6).map((path) => (
                <li key={path} className="truncate font-mono text-[9.5px] text-faint">
                  {path} · {formatBytes(
                    typeof folder.files[path] === 'string'
                      ? new TextEncoder().encode(folder.files[path]).length
                      : (folder.files[path] as Uint8Array).byteLength,
                  )}
                </li>
              ))}
              {loaded.length > 6 && <li className="font-mono text-[9.5px] text-faint">+{loaded.length - 6} more</li>}
            </ul>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="text-[10px] font-medium text-muted">Id</span>
            <input className={fieldClass} value={id} onChange={(event) => setId(event.target.value)} />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium text-muted">Name</span>
            <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium text-muted">Version</span>
            <input className={fieldClass} value={version} onChange={(event) => setVersion(event.target.value)} />
          </label>
        </div>

        <div>
          <span className="text-[10px] font-medium text-muted">Capabilities</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CAPABILITIES.map((capability) => {
              const on = capabilities.includes(capability)
              return (
                <button
                  key={capability}
                  type="button"
                  onClick={() =>
                    setCapabilities((current) =>
                      on ? current.filter((entry) => entry !== capability) : [...current, capability],
                    )
                  }
                  className={`rounded-full border px-2 py-1 font-mono text-[9.5px] ${
                    on ? 'border-accent/40 bg-accent-soft text-ink' : 'border-line text-faint'
                  }`}
                >
                  {capability}
                </button>
              )
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-[10px] font-medium text-muted">Network domains (optional, comma separated)</span>
          <input
            className={fieldClass}
            value={domains}
            placeholder="Leave empty — a plugin that needs no network declares none"
            onChange={(event) => setDomains(event.target.value)}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={download}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[10.5px] font-medium text-on-accent hover:bg-accent/90"
          >
            Download .pluginmax
          </button>
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[10.5px] font-medium text-ink hover:bg-raised"
          >
            Build and install
          </button>
        </div>
      </div>
    </details>
  )
}
