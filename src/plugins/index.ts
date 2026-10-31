import { getWorkspaceTree, readWorkspaceFile, writeWorkspaceFile, pluginNetworkRequest, type InstalledPlugin } from '../lib/daemon'
import { createPluginRuntime, type PluginRuntime } from './runtime'
import type { PluginHostCalls } from './api'

const calls: PluginHostCalls = {
  workspace: {
    async list(path = '') {
      const tree = await getWorkspaceTree(path)
      return tree.entries.map((entry) => ({ path: entry.path, name: entry.name, type: entry.type }))
    },
    async read(path) {
      const file = await readWorkspaceFile(path)
      return file.content
    },
    async write(path, content) {
      await writeWorkspaceFile(path, content)
    },
    async edit(path, from, to) {
      const file = await readWorkspaceFile(path)
      if (!file.content.includes(from)) return false
      await writeWorkspaceFile(path, file.content.replace(from, to))
      return true
    },
  },
  network: (pluginId, request) => pluginNetworkRequest(pluginId, request),
}

let runtime: PluginRuntime | null = null

export function pluginRuntime(): PluginRuntime {
  runtime ??= createPluginRuntime()
  return runtime
}

/** Loads every Safe + enabled plugin, dropping anything no longer trusted. */
export async function syncPlugins(plugins: InstalledPlugin[]): Promise<void> {
  const active = new Set(plugins.filter((plugin) => plugin.safe && plugin.enabled).map((plugin) => plugin.id))
  const live = pluginRuntime()
  for (const id of [...live.contributions.keys()]) {
    if (!active.has(id)) live.deactivate(id)
  }
  for (const plugin of plugins) {
    if (!active.has(plugin.id)) continue
    try {
      await live.activate(plugin, calls)
    } catch (error) {
      console.error(error)
    }
  }
}

export { calls as pluginHostCalls }
