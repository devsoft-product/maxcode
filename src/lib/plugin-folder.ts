import type { PluginManifest } from '../../shared/plugin-package.mjs'
import { validatePluginManifest } from '../../shared/plugin-package.mjs'

export interface PickedFile {
  path: string
  content: string | Uint8Array
}

export interface PluginFolder {
  entry: string
  stylesheet: string
  files: Record<string, string | Uint8Array>
  manifest?: PluginManifest
  /** A `manifest.json` we would not use, so the load still succeeds and the form keeps its values. */
  manifestError?: string
}

const BINARY = /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|wasm|zip|pdf|mp3|mp4)$/i

/** Anything not read as UTF-8 text, so a picked image or font survives the round trip. */
export function isBinaryPath(path: string): boolean {
  return BINARY.test(path)
}

/** A directory pick prefixes every path with the folder the user chose; loose picks do not. */
function stripRoot(paths: string[]): string[] {
  const slash = paths[0]?.indexOf('/') ?? -1
  if (slash < 0) return paths
  const root = paths[0].slice(0, slash + 1)
  return paths.every((path) => path.startsWith(root)) ? paths.map((path) => path.slice(root.length)) : paths
}

function parseManifest(raw: string | Uint8Array): PluginManifest {
  if (typeof raw !== 'string') throw new Error('manifest.json must be text.')
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('manifest.json is not valid JSON.')
  }
  return validatePluginManifest(value)
}

/**
 * Turns a picked folder or file set into the sources `.pluginmax` needs. The
 * folder's own `manifest.json` only seeds the form; the package manifest is
 * always rebuilt from the fields, so what you see is what gets packed.
 */
export function loadPluginFolder(picked: PickedFile[]): PluginFolder {
  const paths = stripRoot(picked.map((file) => file.path))
  const files: Record<string, string | Uint8Array> = {}
  let raw: string | Uint8Array | undefined
  picked.forEach((file, index) => {
    const path = paths[index]
    if (path === 'manifest.json') raw = file.content
    else files[path] = file.content
  })

  const names = Object.keys(files)
  const usable = (path: string | undefined, extension: string) =>
    path !== undefined && path.endsWith(extension) && names.includes(path) ? path : undefined
  const pick = (preferred: string, extension: string) => {
    if (names.includes(preferred)) return preferred
    const candidates = names.filter((name) => name.endsWith(extension)).sort()
    // `src/main.js` is the entry just as much as `main.js` is; compare leaf names.
    return candidates.find((name) => name.slice(name.lastIndexOf('/') + 1) === preferred) ?? candidates[0]
  }

  // A folder manifest is a convenience. A broken one must not cost you the load.
  let manifest: PluginManifest | undefined
  let manifestError: string | undefined
  if (raw !== undefined) {
    try {
      manifest = parseManifest(raw)
    } catch (error) {
      manifestError = error instanceof Error ? error.message : 'manifest.json could not be read.'
    }
  }

  // What the folder declared beats guessing by extension, and makes the pick stable.
  const entry = usable(manifest?.entry, '.js') ?? pick('main.js', '.js')
  if (!entry) throw new Error('A plugin needs one .js entry file. Pick a folder that has one.')
  const stylesheet = usable(manifest?.stylesheet, '.css') ?? pick('main.css', '.css') ?? 'main.css'

  // The package holds exactly one script and one stylesheet: no imports, no second module.
  const extra = names.filter(
    (name) => name !== entry && name !== stylesheet && /\.(?:m?js|cjs|jsx|tsx?|css)$/i.test(name),
  )
  if (extra.length > 0) {
    throw new Error(
      `A .pluginmax holds one script and one stylesheet. Remove or merge: ${extra.join(', ')}.`,
    )
  }

  return { entry, stylesheet, files, manifest, manifestError }
}
