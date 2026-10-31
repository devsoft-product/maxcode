import { deflateSync, strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 100
const MAX_MANIFEST_BYTES = 64 * 1024
const CAPABILITIES = new Set([
  'workspace.list',
  'workspace.read',
  'workspace.write',
  'workspace.edit',
  'ui.commands',
  'ui.panels',
  'ui.themes',
  'network.request',
])
const MANIFEST_KEYS = new Set([
  'id',
  'name',
  'version',
  'apiVersion',
  'entry',
  'stylesheet',
  'capabilities',
  'domains',
])

function packageError(message) {
  throw new Error(`Invalid .pluginmax package: ${message}`)
}

function validateSource(path, content) {
  const source = strFromU8(content)
  const rule = path.endsWith('.js')
    ? [
        /\b(?:import|export)\b|\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(/i,
        'module imports and unmanaged network calls are forbidden',
      ]
    : path.endsWith('.css')
      ? [
          /@import\b|url\s*\(\s*(['"]?)(?!data:image\/(?:png|jpeg|gif|webp);base64,)[^)]*\)/i,
          'external CSS resources and imports are forbidden',
        ]
      : null
  if (!rule) return
  const found = rule[0].exec(source)
  if (!found) return
  // The pattern is text-only, so it also fires inside a comment or a string. Say
  // exactly where it landed, or the author has to hunt the keyword themselves.
  const line = source.slice(0, found.index).split('\n').length
  const hit = found[0].length > 60 ? `${found[0].slice(0, 60)}…` : found[0]
  packageError(`${rule[1]}: found "${hit}" at ${path}:${line}`)
}

function safePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    packageError(`unsafe path "${String(value)}"`)
  }
  return value
}

function validateDomain(value) {
  if (typeof value !== 'string' || value.length > 253 || value.endsWith('.')) {
    packageError('invalid domain')
  }
  const labels = value.split('.')
  if (
    labels.length < 2 ||
    labels.some((label) => !/^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  ) {
    packageError(`invalid domain "${value}"`)
  }
  return value.toLowerCase()
}

export function validatePluginManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) packageError('manifest must be an object')
  if (Object.keys(value).some((key) => !MANIFEST_KEYS.has(key))) packageError('unknown manifest field')
  const { id, name, version, apiVersion, entry, stylesheet, capabilities, domains } = value
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) packageError('invalid plugin id')
  if (typeof name !== 'string' || !name.trim() || name.length > 100) packageError('invalid plugin name')
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    packageError('invalid plugin version')
  }
  if (apiVersion !== 1) packageError('unsupported API version')
  safePath(entry)
  safePath(stylesheet)
  if (!entry.endsWith('.js') || !stylesheet.endsWith('.css')) packageError('entry must be JavaScript and stylesheet must be CSS')
  if (!Array.isArray(capabilities) || capabilities.some((item) => !CAPABILITIES.has(item))) {
    packageError('invalid capability')
  }
  // Domains are optional: a plugin that reaches no network simply omits the field.
  if (domains !== undefined && !Array.isArray(domains)) packageError('domains must be an array')
  const normalizedDomains = (domains ?? []).map(validateDomain)
  if (new Set(normalizedDomains).size !== normalizedDomains.length) packageError('duplicate domain')
  return {
    id,
    name: name.trim(),
    version,
    apiVersion,
    entry,
    stylesheet,
    capabilities: [...new Set(capabilities)],
    domains: normalizedDomains,
  }
}

function normalizeFiles(files, manifest) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) packageError('files must be a path-to-source object')
  const paths = Object.keys(files)
  if (paths.length > MAX_FILES) packageError('too many files')
  const normalized = {}
  let total = 0
  for (const rawPath of paths) {
    const filePath = safePath(rawPath)
    if (filePath === 'manifest.json') packageError('manifest is generated from the manifest field')
    if (/\.(?:mjs|cjs|jsx|ts|tsx)$/i.test(filePath) && filePath !== manifest.entry) {
      packageError(`undeclared executable file "${filePath}"`)
    }
    if (filePath !== manifest.entry && filePath !== manifest.stylesheet && /\.(?:js|css)$/i.test(filePath)) {
      packageError(`undeclared executable file "${filePath}"`)
    }
    const content = files[rawPath]
    if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
      packageError(`file "${filePath}" must be text or bytes`)
    }
    const data = typeof content === 'string' ? strToU8(content) : content
    total += data.byteLength
    if (total > MAX_PACKAGE_BYTES) packageError('package is too large')
    if (filePath === manifest.entry || filePath === manifest.stylesheet) validateSource(filePath, data)
    normalized[filePath] = data
  }
  if (!(manifest.entry in normalized)) packageError('entry file is missing')
  if (!(manifest.stylesheet in normalized)) packageError('stylesheet file is missing')
  if (normalized[manifest.entry].byteLength > 2 * 1024 * 1024) packageError('entry file is too large')
  return normalized
}

export function buildPluginArchive(sources) {
  const manifest = validatePluginManifest(sources?.manifest)
  const files = normalizeFiles(sources?.files, manifest)
  const manifestBytes = strToU8(JSON.stringify(manifest))
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) packageError('manifest is too large')
  return zipSync({ 'manifest.json': manifestBytes, ...files }, { level: 6 })
}

function inspectCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557)
  let eocd = -1
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) packageError('ZIP central directory is missing')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  let offset = view.getUint32(eocd + 16, true)
  if (count > MAX_FILES + 1 || offset + centralSize > eocd) packageError('ZIP directory is invalid or too large')
  let total = 0
  const names = new Set()
  for (let index = 0; index < count; index += 1) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== 0x02014b50
    ) {
      packageError('ZIP central directory entry is invalid')
    }
    const flags = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameStart = offset + 46
    const end = nameStart + nameLength + extraLength + commentLength
    if (end > bytes.length || (flags & 1) !== 0) packageError('encrypted or truncated ZIP entry')
    const name = strFromU8(bytes.subarray(nameStart, nameStart + nameLength))
    safePath(name.endsWith('/') ? name.slice(0, -1) : name)
    if (names.has(name)) packageError(`duplicate path "${name}"`)
    names.add(name)
    total += uncompressedSize
    if (total > MAX_PACKAGE_BYTES + MAX_MANIFEST_BYTES) packageError('uncompressed package is too large')
    if (compressedSize > MAX_ARCHIVE_BYTES) packageError('compressed file is too large')
    offset = end
  }
  if (offset !== view.getUint32(eocd + 16, true) + centralSize) packageError('ZIP central directory length mismatch')
}

export function readPluginArchive(input) {
  if (!(input instanceof Uint8Array) || input.byteLength > MAX_ARCHIVE_BYTES || input.byteLength < 22) {
    packageError('archive is too large or invalid')
  }
  inspectCentralDirectory(input)
  const unzipped = unzipSync(input)
  if (!Object.hasOwn(unzipped, 'manifest.json')) packageError('manifest.json is missing')
  const manifestBytes = unzipped['manifest.json']
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) packageError('manifest is too large')
  let rawManifest
  try {
    rawManifest = JSON.parse(strFromU8(manifestBytes))
  } catch {
    packageError('manifest.json is not valid JSON')
  }
  const manifest = validatePluginManifest(rawManifest)
  const files = {}
  for (const [filePath, content] of Object.entries(unzipped)) {
    if (filePath === 'manifest.json') continue
    safePath(filePath)
    files[filePath] = content
  }
  const normalized = normalizeFiles(files, manifest)
  for (const [filePath, content] of Object.entries(normalized)) {
    if (/\.(?:js|css)$/i.test(filePath) && filePath !== manifest.entry && filePath !== manifest.stylesheet) {
      packageError(`undeclared executable file "${filePath}"`)
    }
    if (filePath === manifest.entry || filePath === manifest.stylesheet) validateSource(filePath, content)
  }
  return {
    manifest,
    files: Object.fromEntries(
      Object.entries(normalized).map(([filePath, content]) => [filePath, strFromU8(content)]),
    ),
  }
}
