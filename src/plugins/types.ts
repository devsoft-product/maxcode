import type { InstalledPlugin } from '../lib/daemon'
import type { PluginCapability, PluginManifest } from '../../shared/plugin-package.mjs'

export type { PluginCapability, PluginManifest }

export interface PluginGrant {
  capabilities: PluginCapability[]
  domains: string[]
}

export interface PluginRuntimeApi {
  /** Declared identity of the running plugin. */
  manifest: Readonly<PluginManifest>
  version: number
  registerCommand(id: string, label: string, run: () => void): void
  registerPanel(id: string, label: string, render: (host: HTMLElement) => void): void
  registerTheme(id: string, label: string, palette: Record<string, string>): void
  workspace: {
    list(path?: string): Promise<{ path: string; name: string; type: string }[]>
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<void>
    edit(path: string, from: string, to: string): Promise<boolean>
  }
  network: {
    request(url: string, init?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }): Promise<{
      status: number
      contentType: string
      body: string
    }>
  }
  log(message: string): void
}

export interface PluginContribution {
  commands: Map<string, { label: string; run: () => void }>
  panels: Map<string, { label: string; render: (host: HTMLElement) => void }>
  themes: Map<string, { label: string; palette: Record<string, string> }>
}

export type { InstalledPlugin }
