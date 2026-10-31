import { createHash, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import { HttpError } from './http.mjs'
import { DATA_DIR } from './store.mjs'
import { readPluginArchive } from '../../shared/plugin-package.mjs'

const PLUGINS_DIR = path.join(DATA_DIR, 'plugins')
const INDEX_FILE = path.join(PLUGINS_DIR, 'index.json')
const MAX_NETWORK_BODY = 64 * 1024
const MAX_NETWORK_RESPONSE = 1024 * 1024
const REQUEST_TIMEOUT_MS = 12_000
let writes = Promise.resolve()

async function ensurePluginsDir() {
  await mkdir(PLUGINS_DIR, { recursive: true, mode: 0o700 })
}

async function readIndex() {
  await ensurePluginsDir()
  try {
    const parsed = JSON.parse(await readFile(INDEX_FILE, 'utf8'))
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.plugins)
      ? parsed.plugins
      : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    if (error instanceof SyntaxError) throw new Error('MaxCode plugin index is damaged.')
    throw error
  }
}

async function saveIndex(plugins) {
  const task = writes.then(async () => {
    await ensurePluginsDir()
    const temporary = `${INDEX_FILE}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(temporary, `${JSON.stringify({ plugins }, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, INDEX_FILE)
  })
  writes = task.catch(() => undefined)
  return task
}

function publicRecord(plugin) {
  const { id, manifest, manifestHash, installedAt, safe, enabled, grants } = plugin
  return { id, manifest, manifestHash, installedAt, safe, enabled, grants }
}

function locate(plugins, id) {
  const plugin = plugins.find((item) => item.id === id)
  if (!plugin) throw new HttpError(404, 'Plugin not found.', 'plugin_not_found')
  return plugin
}

export async function listPlugins() {
  return (await readIndex()).map(publicRecord)
}

export async function getPluginArchive(id) {
  const plugins = await readIndex()
  locate(plugins, id)
  try {
    return await readFile(path.join(PLUGINS_DIR, `${id}.pluginmax`))
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(404, 'Plugin package is missing.', 'plugin_package_missing')
    throw error
  }
}

export async function installPlugin(bytes) {
  let parsed
  try {
    parsed = readPluginArchive(bytes)
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid plugin package.', 'invalid_plugin')
  }
  const plugins = await readIndex()
  const manifestHash = createHash('sha256').update(JSON.stringify(parsed.manifest)).digest('hex')
  const previous = plugins.find((item) => item.id === parsed.manifest.id)
  const unchanged = previous?.manifestHash === manifestHash
  const record = {
    id: parsed.manifest.id,
    manifest: parsed.manifest,
    manifestHash,
    installedAt: previous?.installedAt ?? new Date().toISOString(),
    safe: unchanged ? previous.safe : false,
    enabled: unchanged ? previous.enabled : false,
    grants: unchanged
      ? previous.grants
      : { capabilities: [], domains: [] },
  }
  const archivePath = path.join(PLUGINS_DIR, `${record.id}.pluginmax`)
  await writeFile(archivePath, bytes, { mode: 0o600 })
  const next = previous
    ? plugins.map((item) => (item.id === record.id ? record : item))
    : [...plugins, record]
  await saveIndex(next)
  return publicRecord(record)
}

export async function setPluginGrants(id, grants) {
  const plugins = await readIndex()
  const plugin = locate(plugins, id)
  if (
    !grants ||
    typeof grants !== 'object' ||
    !Array.isArray(grants.capabilities) ||
    !Array.isArray(grants.domains)
  ) {
    throw new HttpError(400, 'Plugin grants must list capabilities and domains.', 'invalid_plugin_grant')
  }
  const { capabilities, domains } = grants
  if (
    capabilities.some((value) => !plugin.manifest.capabilities.includes(value)) ||
    domains.some((value) => !plugin.manifest.domains.includes(value))
  ) {
    throw new HttpError(400, 'A plugin cannot be granted undeclared permissions.', 'invalid_plugin_grant')
  }
  const updated = {
    ...plugin,
    grants: {
      capabilities: [...new Set(capabilities)],
      domains: [...new Set(domains)],
    },
  }
  await saveIndex(plugins.map((item) => (item.id === id ? updated : item)))
  return publicRecord(updated)
}

export async function setPluginSafe(id, safe) {
  if (typeof safe !== 'boolean') throw new HttpError(400, 'Plugin trust must be explicitly true or false.', 'invalid_plugin_trust')
  const plugins = await readIndex()
  const plugin = locate(plugins, id)
  const updated = { ...plugin, safe, enabled: safe ? plugin.enabled : false }
  await saveIndex(plugins.map((item) => (item.id === id ? updated : item)))
  return publicRecord(updated)
}

export async function setPluginEnabled(id, enabled) {
  if (typeof enabled !== 'boolean') throw new HttpError(400, 'Plugin activation must be explicitly true or false.', 'invalid_plugin_activation')
  const plugins = await readIndex()
  const plugin = locate(plugins, id)
  if (enabled && !plugin.safe) {
    throw new HttpError(409, 'Review and trust the plugin before enabling it.', 'plugin_not_safe')
  }
  const updated = { ...plugin, enabled }
  await saveIndex(plugins.map((item) => (item.id === id ? updated : item)))
  return publicRecord(updated)
}

export async function uninstallPlugin(id) {
  const plugins = await readIndex()
  locate(plugins, id)
  await rm(path.join(PLUGINS_DIR, `${id}.pluginmax`), { force: true })
  await saveIndex(plugins.filter((item) => item.id !== id))
  return { id, removed: true }
}

function privateAddress(address) {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number)
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] >= 224
    )
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase()
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      (lower.startsWith('::ffff:') && privateAddress(lower.slice(7)))
    )
  }
  return true
}

async function addressesFor(hostname, lookupImpl) {
  const literal = isIP(hostname)
  const addresses = literal ? [{ address: hostname, family: literal }] : await lookupImpl(hostname, { all: true })
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) {
    throw new HttpError(403, 'Plugin network access to private hosts is blocked.', 'plugin_private_host')
  }
  return addresses
}

function httpsRequest(url, method, headers, body, addresses) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        method,
        path: `${url.pathname}${url.search}`,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
        lookup: (_hostname, options, callback) => {
          if (options?.all) callback(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        },
      },
      (response) => {
        const chunks = []
        let total = 0
        response.on('data', (chunk) => {
          total += chunk.length
          if (total > MAX_NETWORK_RESPONSE) {
            request.destroy(new HttpError(413, 'Plugin network response is too large.', 'plugin_response_too_large'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }))
      },
    )
    request.on('timeout', () => request.destroy(new HttpError(504, 'Plugin network request timed out.', 'plugin_request_timeout')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

export async function requestPluginNetwork(id, request, {
  fetchImpl,
  lookupImpl = lookup,
} = {}) {
  const plugins = await readIndex()
  const plugin = locate(plugins, id)
  if (!plugin.safe || !plugin.enabled) throw new HttpError(403, 'Plugin network access requires an enabled Safe plugin.', 'plugin_disabled')
  if (!plugin.grants.capabilities.includes('network.request')) {
    throw new HttpError(403, 'Plugin has not been granted network access.', 'plugin_capability_denied')
  }
  let url
  try {
    url = new URL(String(request?.url ?? ''))
  } catch {
    throw new HttpError(400, 'Plugin URL is invalid.', 'plugin_bad_url')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port && url.port !== '443' ||
    !plugin.manifest.domains.includes(url.hostname.toLowerCase()) ||
    !plugin.grants.domains.includes(url.hostname.toLowerCase())
  ) {
    throw new HttpError(403, 'Plugin URL must use an explicitly granted HTTPS domain.', 'plugin_domain_denied')
  }
  const method = String(request.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST'].includes(method)) throw new HttpError(400, 'Plugin network method is not allowed.', 'plugin_bad_method')
  const body = request.body === undefined ? undefined : String(request.body)
  if (body && Buffer.byteLength(body) > MAX_NETWORK_BODY) {
    throw new HttpError(413, 'Plugin network request body is too large.', 'plugin_request_too_large')
  }
  const headers = {}
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    const lower = key.toLowerCase()
    if (!['accept', 'content-type'].includes(lower) || typeof value !== 'string' || value.length > 200) {
      throw new HttpError(400, 'Plugin request contains an unsupported header.', 'plugin_bad_header')
    }
    headers[lower] = value
  }
  const addresses = await addressesFor(url.hostname, lookupImpl)
  const response = fetchImpl
    ? await fetchImpl(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    : await httpsRequest(url, method, headers, body, addresses)
  if (response.status >= 300 && response.status < 400) {
    throw new HttpError(403, 'Plugin network redirects are blocked.', 'plugin_redirect_blocked')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HttpError(502, `Plugin network host returned HTTP ${response.status}.`, 'plugin_request_failed')
  }
  const getHeader = (name) =>
    typeof response.headers?.get === 'function'
      ? response.headers.get(name)
      : response.headers?.[name] ?? response.headers?.[name.toLowerCase()]
  const contentType = getHeader('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (!['application/json', 'text/plain', 'application/xml', 'text/xml'].includes(contentType)) {
    throw new HttpError(415, 'Plugin response content type is not allowed.', 'plugin_content_type')
  }
  const disposition = getHeader('content-disposition') ?? ''
  if (/attachment/i.test(disposition)) throw new HttpError(415, 'Plugin file downloads are blocked.', 'plugin_download_blocked')
  const declaredLength = Number(getHeader('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_NETWORK_RESPONSE) {
    throw new HttpError(413, 'Plugin network response is too large.', 'plugin_response_too_large')
  }
  const bytes =
    response.body instanceof Uint8Array
      ? Buffer.from(response.body)
      : Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_NETWORK_RESPONSE) {
    throw new HttpError(413, 'Plugin network response is too large.', 'plugin_response_too_large')
  }
  return {
    status: response.status,
    contentType,
    body: bytes.toString('utf8'),
  }
}
