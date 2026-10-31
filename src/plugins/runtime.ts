import type { InstalledPlugin } from '../lib/daemon'
import { getInstalledPluginArchive } from '../lib/daemon'
import type { PluginContribution } from './types'
import { registerTheme, unregisterTheme } from '../lib/themes'
import { createPluginApi, emptyContributions, type PluginHostCalls } from './api'
import { readPluginArchive } from '../../shared/plugin-package.mjs'

const STYLE_ID = (id: string) => `maxcode-plugin-style-${id}`

export const PLUGIN_THEME_PREFIX = 'plugin-'

function tokens(palette: Record<string, string>): Array<[string, string]> {
  return Object.entries(palette).filter(
    ([token, value]) => /^[a-z][a-z0-9-]*$/.test(token) && /^[\d\s.]+$/.test(value),
  )
}

function isDarkPalette(palette: Record<string, string>): boolean {
  const canvas = (palette.canvas ?? '').trim().split(/\s+/).map(Number)
  const [r, g, b] = canvas.length === 3 ? canvas : [255, 255, 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
}

/** Plugin theme palettes become `[data-theme='<id>']` custom properties. */
export function themeCss(themeId: string, palette: Record<string, string>): string {
  const entries = tokens(palette).map(([token, value]) => `--${token}:${value.trim()}`)
  return entries.length === 0 ? '' : `[data-theme='${themeId}']{${entries.join(';')}}`
}

export function styleElement(id: string): HTMLStyleElement | null {
  return document.getElementById(STYLE_ID(id)) as HTMLStyleElement | null
}

export function applyStyles(id: string, css: string) {
  let node = styleElement(id)
  if (!node) {
    node = document.createElement('style')
    node.id = STYLE_ID(id)
    document.head.append(node)
  }
  node.textContent = css
}

export function removeStyles(id: string) {
  styleElement(id)?.remove()
}

export interface PluginRuntime {
  contributions: Map<string, PluginContribution>
  themes(): Array<{ id: string; label: string }>
  contributionsFor(id: string): PluginContribution
  commands(): Array<{ pluginId: string; id: string; label: string; run: () => void }>
  activate(plugin: InstalledPlugin, calls: PluginHostCalls): Promise<void>
  deactivate(id: string): void
  deactivateAll(): void
}

interface PluginGlobals {
  __maxcodePluginApi?: unknown
}

/**
 * Runs plugin source as a blob ES module, which keeps the daemon's CSP free of
 * `unsafe-eval`: the source is handed the API through the identifier `maxcode`.
 */
async function runPluginSource(source: string, api: unknown): Promise<void> {
  const scoped = globalThis as typeof globalThis & PluginGlobals
  const url = URL.createObjectURL(
    new Blob([`const maxcode = globalThis.__maxcodePluginApi;\n${source}\n`], { type: 'text/javascript' }),
  )
  scoped.__maxcodePluginApi = api
  try {
    await import(/* @vite-ignore */ url)
  } finally {
    delete scoped.__maxcodePluginApi
    URL.revokeObjectURL(url)
  }
}

/**
 * Same-realm execution for plugins the user marked Safe. Anything not Safe stays
 * out; disabling or uninstalling drops its styles, commands, panels and themes.
 */
export function createPluginRuntime(): PluginRuntime {
  const contributions = new Map<string, PluginContribution>()

  const deactivate = (id: string) => {
    const entry = contributions.get(id)
    if (entry) for (const theme of entry.themes.keys()) unregisterTheme(`${PLUGIN_THEME_PREFIX}${id}:${theme}`)
    contributions.delete(id)
    removeStyles(id)
  }

  return {
    contributions,
    contributionsFor: (id) => contributions.get(id) ?? emptyContributions(),
    themes() {
      const out: Array<{ id: string; label: string }> = []
      for (const [pluginId, entry] of contributions) {
        for (const [id, theme] of entry.themes) {
          out.push({ id: `${PLUGIN_THEME_PREFIX}${pluginId}:${id}`, label: theme.label })
        }
      }
      return out
    },
    commands() {
      const out: Array<{ pluginId: string; id: string; label: string; run: () => void }> = []
      for (const [pluginId, entry] of contributions) {
        for (const [id, command] of entry.commands) out.push({ pluginId, id, label: command.label, run: command.run })
      }
      return out
    },
    async activate(plugin, calls) {
      deactivate(plugin.id)
      if (!plugin.safe || !plugin.enabled) return

      const { files, manifest } = readPluginArchive(await getInstalledPluginArchive(plugin.id))
      const entry = contributions.get(plugin.id) ?? emptyContributions()
      contributions.set(plugin.id, entry)

      const api = createPluginApi(plugin, plugin.grants, calls, entry)
      try {
        await runPluginSource(files[manifest.entry] ?? '', Object.freeze(api))
        const themes = [...entry.themes.entries()]
          .map(([id, theme]) => {
            const themeId = `${PLUGIN_THEME_PREFIX}${plugin.id}:${id}`
            registerTheme({ id: themeId, label: theme.label, dark: isDarkPalette(theme.palette) })
            return themeCss(themeId, theme.palette)
          })
          .join('\n')
        applyStyles(plugin.id, `${files[manifest.stylesheet] ?? ''}\n${themes}`)
      } catch (error) {
        deactivate(plugin.id)
        throw new Error(`Plugin ${plugin.id} failed to start: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    deactivate,
    deactivateAll() {
      for (const id of [...contributions.keys()]) deactivate(id)
    },
  }
}
