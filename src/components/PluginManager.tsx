import { useEffect, useRef, useState } from 'react'
import { Eye, FolderOpen, Package, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import type { InstalledPlugin } from '../lib/daemon'
import {
  getInstalledPluginArchive,
  installPluginArchive,
  listInstalledPlugins,
  removeInstalledPlugin,
  savePluginGrants,
  setPluginActivation,
  setPluginTrust,
} from '../lib/daemon'
import { attachPreviewBridge, previewDocument } from '../plugins/preview'
import type { PluginCapability } from '../../shared/plugin-package.mjs'
import { readPluginArchive } from '../../shared/plugin-package.mjs'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'
import { Switch } from './ui'
import { PluginBuilder } from './PluginBuilder'

const PREVIEW_LOGS = 6

function PluginPreview({ plugin }: { plugin: InstalledPlugin }) {
  const notify = useUi((state) => state.notify)
  const [html, setHtml] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!frameRef.current || !html) return
    return attachPreviewBridge(frameRef.current, (message) => {
      const entry = message as { type: string; message?: string; label?: string }
      const text =
        entry.type === 'ready'
          ? 'Sandbox ready — no app access, no network.'
          : `${entry.type}: ${entry.message ?? entry.label ?? ''}`
      setLog((current) => [...current.slice(-(PREVIEW_LOGS - 1)), text])
    })
  }, [html])

  const start = async () => {
    setLoading(true)
    try {
      const archive = await getInstalledPluginArchive(plugin.id)
      const { files, manifest } = readPluginArchive(archive)
      setLog([])
      setHtml(previewDocument(manifest, files[manifest.entry] ?? '', files[manifest.stylesheet] ?? ''))
    } catch (error) {
      notify(error instanceof Error ? error.message : 'This plugin could not be previewed.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={() => (html ? setHtml(null) : void start())}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[10.5px] font-medium text-muted hover:text-ink disabled:opacity-40"
      >
        <Eye size={11} />
        {html ? 'Stop preview' : 'Preview in sandbox'}
      </button>
      {html && (
        <div className="w-full overflow-hidden rounded-lg border border-line">
          <iframe
            ref={frameRef}
            title={`${plugin.manifest.name} preview`}
            sandbox="allow-scripts"
            srcDoc={html}
            className="h-52 w-full bg-panel"
          />
          <div className="max-h-24 overflow-y-auto border-t border-line bg-raised/40 px-2.5 py-1.5 font-mono text-[9.5px] leading-relaxed text-faint">
            {log.map((entry, index) => (
              <p key={index} className="truncate">
                {entry}
              </p>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

const CAPABILITY_LABELS: Record<PluginCapability, string> = {
  'workspace.list': 'List files in the open workspace',
  'workspace.read': 'Read workspace files',
  'workspace.write': 'Create and overwrite workspace files',
  'workspace.edit': 'Edit workspace files in place',
  'ui.commands': 'Add commands to MaxCode',
  'ui.panels': 'Add panels to MaxCode',
  'ui.themes': 'Add themes to MaxCode',
  'network.request': 'Call the HTTPS domains it declared',
}

export function PluginManager() {
  const notify = useUi((state) => state.notify)
  const askConfirm = useUi((state) => state.askConfirm)
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    try {
      setPlugins((await listInstalledPlugins()).plugins)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not list plugins.', 'error')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const replace = (plugin: InstalledPlugin) => {
    setPlugins((current) => current.map((entry) => (entry.id === plugin.id ? plugin : entry)))
  }

  const install = async (file: File) => {
    setBusy(true)
    try {
      // Read it locally first: a malformed file is rejected before it reaches the daemon.
      readPluginArchive(new Uint8Array(await file.arrayBuffer()))
      const { plugin } = await installPluginArchive(new Uint8Array(await file.arrayBuffer()))
      setPlugins((current) => [...current.filter((entry) => entry.id !== plugin.id), plugin])
      setOpen(plugin.id)
      notify(`${plugin.manifest.name} installed. It starts sandboxed and disabled.`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That file is not a valid .pluginmax package.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const grant = async (plugin: InstalledPlugin, capabilities: PluginCapability[], domains: string[]) => {
    try {
      replace((await savePluginGrants(plugin.id, { capabilities, domains })).plugin)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save plugin permissions.', 'error')
    }
  }

  const trust = async (plugin: InstalledPlugin) => {
    if (plugin.safe) {
      replace((await setPluginTrust(plugin.id, false)).plugin)
      return
    }
    const ok = await askConfirm({
      title: `Run ${plugin.manifest.name} outside the sandbox?`,
      body: 'Safe plugins run as real JavaScript inside MaxCode. They can do anything this app can, so only mark plugins you wrote or have reviewed.',
      confirmLabel: 'Mark as Safe',
      tone: 'danger',
    })
    if (!ok) return
    replace((await setPluginTrust(plugin.id, true)).plugin)
  }

  return (
    <>
      <section className="rounded-xl border border-line bg-raised/20 p-3">
        <h3 className="text-[12px] font-medium text-ink">Install a local plugin</h3>
        <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
          MaxCode installs <code className="font-mono">.pluginmax</code> files you pick from this machine. New plugins
          start sandboxed and disabled until you review them.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[10.5px] font-medium text-on-accent hover:bg-accent/90 disabled:opacity-40"
          >
            <FolderOpen size={12} />
            Choose .pluginmax
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pluginmax,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void install(file)
            }}
          />
        </div>
      </section>

      {plugins.length === 0 ? (
        <p className="rounded-lg border border-line bg-raised/30 px-3 py-3 text-[10.5px] text-faint">
          No plugins installed.
        </p>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin) => {
            const expanded = open === plugin.id
            return (
              <div key={plugin.id} className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <Package size={14} className="shrink-0 text-faint" />
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : plugin.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-[11.5px] font-medium text-ink">{plugin.manifest.name}</span>
                    <span className="block truncate text-[9.5px] text-faint">
                      {plugin.id} · v{plugin.manifest.version} ·{' '}
                      {plugin.safe ? 'Safe — runs unsandboxed' : 'Sandboxed'}
                    </span>
                  </button>
                  <Switch
                    checked={plugin.enabled}
                    disabled={!plugin.safe}
                    label={`Enable ${plugin.manifest.name}`}
                    onChange={async (enabled) => {
                      replace((await setPluginActivation(plugin.id, enabled)).plugin)
                    }}
                  />
                </div>

                {expanded && (
                  <div className="space-y-2.5 border-t border-line px-3 py-3">
                    <div className={cn('flex items-start gap-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed', plugin.safe ? 'bg-warning/10 text-ink' : 'bg-raised/60 text-muted')}>
                      {plugin.safe ? <ShieldAlert size={13} className="mt-0.5 shrink-0 text-warning" /> : <ShieldCheck size={13} className="mt-0.5 shrink-0 text-faint" />}
                      <span>
                        {plugin.safe
                          ? 'This plugin runs as real JavaScript in MaxCode with the permissions below. It is not sandboxed any more.'
                          : 'This plugin is sandboxed. Mark it Safe to run its code, or preview it first.'}
                      </span>
                    </div>

                    <div>
                      <p className="text-[10.5px] font-medium text-ink">Capabilities</p>
                      <div className="mt-1.5 space-y-1">
                        {plugin.manifest.capabilities.length === 0 && (
                          <p className="text-[10px] text-faint">This plugin requests no capabilities.</p>
                        )}
                        {plugin.manifest.capabilities.map((capability) => (
                          <label key={capability} className="flex items-center gap-2 text-[10.5px] text-muted">
                            <input
                              type="checkbox"
                              className="accent-[rgb(var(--accent))]"
                              checked={plugin.grants.capabilities.includes(capability)}
                              onChange={(event) =>
                                void grant(
                                  plugin,
                                  event.target.checked
                                    ? [...plugin.grants.capabilities, capability]
                                    : plugin.grants.capabilities.filter((entry) => entry !== capability),
                                  plugin.grants.domains,
                                )
                              }
                            />
                            <span className="flex-1">{CAPABILITY_LABELS[capability]}</span>
                            <code className="font-mono text-[9.5px] text-faint">{capability}</code>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10.5px] font-medium text-ink">Network domains</p>
                      {plugin.manifest.domains.length === 0 ? (
                        <p className="mt-1 text-[10px] text-faint">This plugin declares no network access.</p>
                      ) : (
                        <div className="mt-1.5 space-y-1">
                          {plugin.manifest.domains.map((domain) => (
                            <label key={domain} className="flex items-center gap-2 text-[10.5px] text-muted">
                              <input
                                type="checkbox"
                                className="accent-[rgb(var(--accent))]"
                                checked={plugin.grants.domains.includes(domain)}
                                onChange={(event) =>
                                  void grant(
                                    plugin,
                                    plugin.grants.capabilities,
                                    event.target.checked
                                      ? [...plugin.grants.domains, domain]
                                      : plugin.grants.domains.filter((entry) => entry !== domain),
                                  )
                                }
                              />
                              <code className="flex-1 font-mono text-[10px]">{domain}</code>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <PluginPreview plugin={plugin} />
                      <button
                        type="button"
                        onClick={() => void trust(plugin)}
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[10.5px] font-medium',
                          plugin.safe
                            ? 'border-line bg-panel text-muted hover:text-ink'
                            : 'border-warning/40 bg-warning/10 text-ink',
                        )}
                      >
                        {plugin.safe ? 'Return to sandbox' : 'Mark as Safe'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await askConfirm({
                            title: `Uninstall ${plugin.manifest.name}?`,
                            body: 'Its permissions, styles and commands are removed from MaxCode.',
                            confirmLabel: 'Uninstall',
                            tone: 'danger',
                          })
                          if (!ok) return
                          await removeInstalledPlugin(plugin.id)
                          setPlugins((current) => current.filter((entry) => entry.id !== plugin.id))
                        }}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[10.5px] font-medium text-muted hover:text-danger"
                      >
                        <Trash2 size={11} />
                        Uninstall
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <PluginBuilder onInstalled={(plugin) => setPlugins((current) => [...current.filter((entry) => entry.id !== plugin.id), plugin])} />
    </>
  )
}
