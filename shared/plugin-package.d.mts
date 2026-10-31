export type PluginCapability =
  | 'workspace.list'
  | 'workspace.read'
  | 'workspace.write'
  | 'workspace.edit'
  | 'ui.commands'
  | 'ui.panels'
  | 'ui.themes'
  | 'network.request'

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: 1
  entry: string
  stylesheet: string
  capabilities: PluginCapability[]
  domains: string[]
}

export interface PluginPackageSources {
  manifest: PluginManifest
  files: Record<string, string | Uint8Array>
}

export interface PluginPackage {
  manifest: PluginManifest
  files: Record<string, string>
}

export function validatePluginManifest(value: unknown): PluginManifest
export function buildPluginArchive(sources: PluginPackageSources): Uint8Array
export function readPluginArchive(bytes: Uint8Array): PluginPackage
