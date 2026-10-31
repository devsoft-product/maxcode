import type { InstalledPlugin } from '../lib/daemon'
import type { PluginCapability, PluginContribution, PluginGrant, PluginRuntimeApi } from './types'

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/

export function hasCapability(grant: PluginGrant | undefined, capability: PluginCapability): boolean {
  return Boolean(grant?.capabilities.includes(capability))
}

/**
 * A plugin may only reach a host its manifest declared *and* the user granted.
 * HTTPS on port 443 only; the daemon re-checks all of this server-side.
 */
export function allowedDomain(
  grant: PluginGrant | undefined,
  declared: string[],
  url: string,
): string | null {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    if (parsed.port && parsed.port !== '443') return null
    host = parsed.hostname.toLowerCase()
  } catch {
    return null
  }
  if (!declared.includes(host)) return null
  if (!grant?.domains.includes(host)) return null
  return host
}

export interface PluginHostCalls {
  workspace: {
    list(path?: string): Promise<{ path: string; name: string; type: string }[]>
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<void>
    edit(path: string, from: string, to: string): Promise<boolean>
  }
  network(pluginId: string, request: { url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }): Promise<{
    status: number
    contentType: string
    body: string
  }>
}

export function emptyContributions(): PluginContribution {
  return { commands: new Map(), panels: new Map(), themes: new Map() }
}

function denied(capability: string): never {
  throw new Error(`The plugin was not granted ${capability}.`)
}

/**
 * The API handed to plugin code. Every entry point re-checks the user's grants,
 * so a plugin cannot reach a capability it never got approved for, even if it
 * calls the API directly.
 */
export function createPluginApi(
  plugin: InstalledPlugin,
  grant: PluginGrant,
  calls: PluginHostCalls,
  contributions: PluginContribution = emptyContributions(),
): PluginRuntimeApi {
  const check = (capability: Parameters<typeof hasCapability>[1]) => {
    if (!hasCapability(grant, capability)) denied(capability)
  }
  const checkId = (id: string) => {
    if (!ID.test(id)) throw new Error('A plugin contribution id must be lowercase letters, digits and dashes.')
  }

  return {
    manifest: Object.freeze({ ...plugin.manifest }),
    version: 1,
    registerCommand(id, label, run) {
      check('ui.commands')
      checkId(id)
      if (typeof run !== 'function') throw new Error('A command needs a function.')
      contributions.commands.set(id, { label: String(label).slice(0, 80), run })
    },
    registerPanel(id, label, render) {
      check('ui.panels')
      checkId(id)
      if (typeof render !== 'function') throw new Error('A panel needs a render function.')
      contributions.panels.set(id, { label: String(label).slice(0, 80), render })
    },
    registerTheme(id, label, palette) {
      check('ui.themes')
      checkId(id)
      if (!palette || typeof palette !== 'object') throw new Error('A theme needs a palette.')
      contributions.themes.set(id, { label: String(label).slice(0, 80), palette: { ...palette } })
    },
    workspace: {
      list: async (path) => (check('workspace.list'), calls.workspace.list(path)),
      read: async (path) => (check('workspace.read'), calls.workspace.read(path)),
      write: async (path, content) => (check('workspace.write'), calls.workspace.write(path, content)),
      edit: async (path, from, to) => (check('workspace.edit'), calls.workspace.edit(path, from, to)),
    },
    network: {
      request(url, init) {
        check('network.request')
        if (!allowedDomain(grant, plugin.manifest.domains, url)) {
          throw new Error('This plugin may only call HTTPS hosts it declared and you granted.')
        }
        return calls.network(plugin.id, { url, ...init })
      },
    },
    log(message) {
      console.info(`[plugin:${plugin.id}]`, message)
    },
  }
}
