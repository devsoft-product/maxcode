import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  HttpError,
  clientIp,
  cookieValue,
  json,
  readJson,
  securityHeaders,
  sendError,
  serveStatic,
  setCookie,
} from './lib/http.mjs'
import {
  addWorkspace,
  DATA_DIR,
  dataPaths,
  forgetWorkspace,
  loadSecretsSafe,
  loadState,
  migrateLegacy,
  resetAll,
  resetSecrets,
  saveChats,
  saveSettings,
  saveState,
  secretSummary,
  setDeploySecret,
  setProviderSecret,
  setSearchSecret,
} from './lib/store.mjs'
import {
  isKnownProvider,
  listModelStatus,
  listModels,
  llmTarget,
  providerList,
  PROVIDERS,
  validateKeyFormat,
} from './lib/providers.mjs'
import {
  browseDirectories,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  discoverWorkspace,
  editWorkspaceFile,
  executeTool,
  gitSummary,
  listTree,
  readWorkspaceFile,
  renameWorkspaceEntry,
  runGit,
  runShell,
  workspaceRoot,
  writeWorkspaceFile,
} from './lib/tools.mjs'
import { deployToolStatus, runDeploy } from './lib/deploy.mjs'
import {
  getPluginArchive,
  installPlugin,
  listPlugins,
  requestPluginNetwork,
  setPluginEnabled,
  setPluginGrants,
  setPluginSafe,
  uninstallPlugin,
} from './lib/plugins.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', 'dist')
const VERSION = '1.0.0'
const SESSION_COOKIE = 'maxcode_session'
const CSRF_HEADER = 'x-maxcode-csrf'
const SESSION_TTL = 14 * 24 * 60 * 60 * 1000
const sessions = new Map()

let port = 4174
let host = '127.0.0.1'

function allowedHosts() {
  const ports = new Set([String(port), '80', '443'])
  const hosts = new Set()
  for (const value of ports) {
    hosts.add(`localhost:${value}`)
    hosts.add(`127.0.0.1:${value}`)
    hosts.add(`[::1]:${value}`)
  }
  hosts.add('localhost')
  hosts.add('127.0.0.1')
  hosts.add('[::1]')
  return hosts
}

function allowedOrigins() {
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://[::1]:5173',
    `http://127.0.0.1`,
    `http://localhost`,
  ])
}

function guardRequest(req) {
  const hostHeader = String(req.headers.host ?? '').toLowerCase()
  if (!hostHeader || !allowedHosts().has(hostHeader)) {
    throw new HttpError(403, 'MaxCode only answers requests addressed to localhost.', 'bad_host')
  }
  const origin = String(req.headers.origin ?? '')
  if (origin && !allowedOrigins().has(origin.toLowerCase())) {
    throw new HttpError(403, 'Cross-origin requests are blocked.', 'bad_origin')
  }
  const fetchSite = String(req.headers['sec-fetch-site'] ?? '')
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    throw new HttpError(403, 'Cross-site requests are blocked.', 'bad_origin')
  }
}

function purgeSessions() {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (now - session.lastSeen > SESSION_TTL) sessions.delete(token)
  }
}

function sessionFrom(req) {
  const token = cookieValue(req, SESSION_COOKIE)
  if (!token) return null
  const session = sessions.get(token)
  if (!session) return null
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(token)
    return null
  }
  session.lastSeen = Date.now()
  return { token, ...session }
}

function requireSession(req) {
  const session = sessionFrom(req)
  if (!session) throw new HttpError(401, 'Open MaxCode from its local address to start a session.', 'no_session')
  return session
}

function requireCsrf(req, session) {
  const provided = String(req.headers[CSRF_HEADER] ?? '')
  if (!provided || provided !== session.csrf) {
    throw new HttpError(403, 'This request is missing a valid CSRF token.', 'bad_csrf')
  }
  const contentType = String(req.headers['content-type'] ?? '')
  if (req.method !== 'DELETE' && !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Send JSON with Content-Type: application/json.', 'bad_content_type')
  }
}

function createSession(res) {
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(32).toString('base64url')
  sessions.set(token, { csrf, created: Date.now(), lastSeen: Date.now() })
  setCookie(res, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: SESSION_TTL / 1000 })
  return { token, csrf }
}

function sanitizeString(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

const TOOL_NAMES = new Set([
  'shell',
  'read_file',
  'list_files',
  'write_file',
  'edit_file',
  'rewrite_file',
  'grep',
  'web_search',
  'read_url',
  'git',
  'subagent',
])
const SEARCH_PROVIDERS = new Set(['duckduckgo', 'tavily', 'brave', 'serper'])

function sanitizeSettings(patch, current = {}) {
  const source = patch && typeof patch === 'object' ? patch : {}
  const next = { ...current }

  if (typeof source.provider === 'string' && isKnownProvider(source.provider)) next.provider = source.provider
  if (typeof source.model === 'string') next.model = source.model.slice(0, 300)
  if (typeof source.effort === 'string' && /^[a-z]{2,12}$/.test(source.effort)) next.effort = source.effort
  if (typeof source.webSearchEnabled === 'boolean') next.webSearchEnabled = source.webSearchEnabled
  if (typeof source.showTokenEstimate === 'boolean') next.showTokenEstimate = source.showTokenEstimate
  if (typeof source.temperature === 'number' && Number.isFinite(source.temperature)) {
    next.temperature = Math.max(0, Math.min(2, source.temperature))
  }
  if (typeof source.maxTokens === 'number' && Number.isFinite(source.maxTokens)) {
    next.maxTokens = Math.max(256, Math.min(200_000, Math.round(source.maxTokens)))
  }
  if (typeof source.systemPrompt === 'string') next.systemPrompt = source.systemPrompt.slice(0, 60_000)
  if (typeof source.searchProvider === 'string' && SEARCH_PROVIDERS.has(source.searchProvider)) {
    next.searchProvider = source.searchProvider
  }
  // Plugin themes are named by their plugin, so accept any bounded theme slug.
  if (typeof source.theme === 'string' && /^[a-z0-9-]{1,64}$/.test(source.theme)) next.theme = source.theme
  if (source.mode === 'build' || source.mode === 'plan') next.mode = source.mode

  if (source.providers && typeof source.providers === 'object') {
    const providers = { ...(current.providers ?? {}) }
    for (const [id, value] of Object.entries(source.providers)) {
      if (!isKnownProvider(id) || !value || typeof value !== 'object') continue
      const baseUrl = sanitizeString(value.baseUrl, 600)
      if (baseUrl !== undefined) {
        providers[id] = { ...(providers[id] ?? {}), baseUrl: baseUrl.trim() }
      }
    }
    next.providers = providers
  }

  if (source.tools && typeof source.tools === 'object') {
    const tools = { ...(current.tools ?? {}) }
    for (const [name, value] of Object.entries(source.tools)) {
      if (!TOOL_NAMES.has(name) || !value || typeof value !== 'object') continue
      const entry = { ...(tools[name] ?? {}) }
      if (typeof value.enabled === 'boolean') entry.enabled = value.enabled
      if (value.approval === 'auto' || value.approval === 'ask') entry.approval = value.approval
      tools[name] = entry
    }
    next.tools = tools
  }

  if (Array.isArray(source.skills)) {
    next.skills = source.skills.slice(0, 60).map((skill) => {
      const item = skill && typeof skill === 'object' ? skill : {}
      return {
        id: typeof item.id === 'string' ? item.id.slice(0, 120) : `skill-${randomBytes(4).toString('hex')}`,
        name: sanitizeString(item.name, 120) ?? 'Skill',
        description: sanitizeString(item.description, 600) ?? '',
        instructions: sanitizeString(item.instructions, 20_000) ?? '',
        enabled: item.enabled === true,
        builtIn: item.builtIn === true,
      }
    })
  }

  return next
}

function sanitizeChats(payload) {
  const sessionsInput = Array.isArray(payload?.sessions) ? payload.sessions.slice(0, 500) : []
  const sessionsOut = []
  for (const raw of sessionsInput) {
    if (!raw || typeof raw !== 'object') continue
    if (typeof raw.id !== 'string' || !Array.isArray(raw.messages)) continue
    sessionsOut.push({
      ...raw,
      id: raw.id.slice(0, 120),
      title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : 'Untitled',
      messages: raw.messages.slice(0, 400),
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    })
  }
  const activeId =
    typeof payload?.activeId === 'string' && sessionsOut.some((session) => session.id === payload.activeId)
      ? payload.activeId
      : sessionsOut[0]?.id ?? null
  return { sessions: sessionsOut, activeId }
}

async function workspacePayload() {
  const state = await loadState()
  let root = state.activeWorkspace ?? ''
  let available = false
  let error = ''
  if (root) {
    const info = await stat(root).catch(() => null)
    available = Boolean(info?.isDirectory())
    if (!available) error = 'The saved workspace folder is missing. Choose another folder.'
  }
  return {
    root,
    name: root ? path.basename(root) : '',
    available,
    error,
    workspaces: state.workspaces ?? [],
  }
}

async function buildStatePayload() {
  const state = await loadState()
  const { secrets, error } = await loadSecretsSafe()
  const providers = await providerList(state.settings ?? {})
  const [workspace, deployTools] = await Promise.all([workspacePayload(), deployToolStatus()])
  return {
    version: VERSION,
    dataDir: DATA_DIR,
    home: os.homedir(),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
    settings: state.settings ?? {},
    chats: state.chats ?? { sessions: [], activeId: null },
    workspace,
    secrets: secretSummary(secrets),
    secretsError: error,
    providers,
    deployTools,
    deploySecrets: secretSummary(secrets).deploy,
    migration: { migratedAt: state.legacyMigratedAt ?? null },
    modelCatalog: {
      providers: Object.keys(PROVIDERS),
    },
  }
}

function streamHeaders(res, contentType = 'text/event-stream') {
  res.writeHead(200, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
}

async function handleLlm(req, res) {
  const payload = await readJson(req, 24 * 1024 * 1024)
  const provider = String(payload.provider ?? '')
  const kind = String(payload.kind ?? '')
  const model = String(payload.model ?? '')
  const body = payload.body && typeof payload.body === 'object' ? payload.body : null
  if (!isKnownProvider(provider)) throw new HttpError(400, 'Unknown provider.', 'unknown_provider')
  if (!body) throw new HttpError(400, 'The model request body is missing.', 'missing_body')
  const state = await loadState()
  const target = await llmTarget(provider, kind, model, state.settings ?? {})
  const controller = new AbortController()
  let closed = false
  res.on('close', () => {
    if (!res.writableEnded) {
      closed = true
      controller.abort()
    }
  })
  let upstream
  try {
    // Gemini uses ?alt=sse in the URL for streaming; adding stream:true to the
    // JSON body causes a 400 "Unknown name \"stream\"" error from the Google API.
    const streamBody = target.kind === 'gemini' ? body : { ...body, stream: true }
    upstream = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify(streamBody),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60 * 1000)]),
    })
  } catch (error) {
    if (closed) return
    throw new HttpError(
      502,
      `${PROVIDERS[provider].name} could not be reached. ${error instanceof Error ? error.message : ''}`.trim(),
      'provider_unreachable',
    )
  }

  if (!upstream.ok) {
    const raw = await upstream.text().catch(() => '')
    let detail = raw.trim()
    try {
      const parsed = JSON.parse(raw)
      const error = parsed.error
      detail =
        (typeof error === 'string' ? error : '') ||
        error?.message ||
        parsed.message ||
        parsed.detail ||
        detail
    } catch {
      // Keep the raw text.
    }
    detail = String(detail ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600)
    const status = upstream.status === 401 || upstream.status === 403 ? upstream.status : 502
    let friendly =
      upstream.status === 401
        ? `${PROVIDERS[provider].name} rejected the API key (401).`
        : upstream.status === 403
          ? `${PROVIDERS[provider].name} refused this request (403). The key may not have access to ${model}.`
          : upstream.status === 429
            ? `${PROVIDERS[provider].name} is rate limiting this key (429).`
            : `${PROVIDERS[provider].name} returned HTTP ${upstream.status}.`

    if (provider === 'openrouter' && upstream.status === 401 && detail.includes('Missing Authentication header')) {
      friendly = 'OpenRouter rejected the API key (401: Missing Authentication header). OpenRouter keys must start with "sk-or-v1-". The key you configured does not match OpenRouter (it looks like a DeepSeek or OpenAI key). If you meant to use DeepSeek, please choose DeepSeek in Settings → Models.'
    }
    throw new HttpError(status, `${friendly}${detail && !friendly.includes(detail) ? ` ${detail}` : ''}`, 'provider_error')
  }

  streamHeaders(res)
  res.write(': maxcode\n\n')
  const bodyStream = upstream.body
  if (!bodyStream) {
    res.end()
    throw new HttpError(502, 'The provider returned an empty response.', 'empty_provider_response')
  }
  const nodeStream = Readable.fromWeb(bodyStream)
  nodeStream.on('error', () => {
    if (!res.writableEnded) res.end()
  })
  nodeStream.pipe(res)
  await new Promise((resolve) => {
    res.on('finish', resolve)
    res.on('close', resolve)
    nodeStream.on('end', resolve)
  })
}

async function handleDeploy(req, res) {
  const payload = await readJson(req, 2 * 1024 * 1024)
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  streamHeaders(res, 'application/x-ndjson')
  const write = (event) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`)
  }
  write({ type: 'start', provider: payload.provider, path: payload.path })
  try {
    const result = await runDeploy(payload, {
      signal: controller.signal,
      onLog: (entry) => write({ type: 'log', ...entry }),
    })
    write({ type: 'done', result })
    res.end()
  } catch (error) {
    if (res.writableEnded) return
    write({
      type: 'error',
      message: error instanceof Error ? error.message : 'Deployment failed.',
      code: error instanceof HttpError ? error.code : 'deploy_failed',
    })
    res.end()
  }
}

async function handleProviderModels(res, url) {
  const provider = url.searchParams.get('provider') ?? ''
  if (!isKnownProvider(provider)) throw new HttpError(400, 'Unknown provider.', 'unknown_provider')
  const state = await loadState()
  const result = await listModels(provider, state.settings ?? {})
  json(res, 200, result)
}

function providerFromPath(pathname, prefix) {
  const rest = pathname.slice(prefix.length)
  const [provider] = rest.split('/').filter(Boolean)
  if (!provider || !isKnownProvider(provider)) throw new HttpError(400, 'Unknown provider.', 'unknown_provider')
  return provider
}

async function route(req, res) {
  guardRequest(req)
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const pathname = url.pathname
  const method = req.method ?? 'GET'

  if (pathname === '/api/health') {
    if (method !== 'GET') throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    const distReady = await stat(path.join(DIST, 'index.html'))
      .then((info) => info.isFile())
      .catch(() => false)
    json(res, 200, {
      ok: true,
      app: 'maxcode',
      version: VERSION,
      pid: process.pid,
      port,
      dataDir: DATA_DIR,
      dist: distReady,
      startedAt: new Date(startedAt).toISOString(),
    })
    return
  }

  if (pathname === '/api/session') {
    if (method !== 'POST' && method !== 'GET') throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    purgeSessions()
    const existing = sessionFrom(req)
    if (method === 'POST') {
      if (existing) {
        json(res, 200, { authenticated: true, csrf: existing.csrf })
        return
      }
      const session = createSession(res)
      json(res, 200, { authenticated: true, csrf: session.csrf })
      return
    }
    if (!existing) {
      json(res, 200, { authenticated: false, csrf: '' })
      return
    }
    json(res, 200, { authenticated: true, csrf: existing.csrf })
    return
  }

  if (pathname.startsWith('/api/')) {
    const session = requireSession(req)
    if (!['GET', 'HEAD'].includes(method)) requireCsrf(req, session)

    if (pathname === '/api/state' && method === 'GET') {
      json(res, 200, await buildStatePayload())
      return
    }

    if (pathname === '/api/plugins' && method === 'GET') {
      json(res, 200, { plugins: await listPlugins() })
      return
    }

    if (pathname === '/api/plugins' && method === 'POST') {
      const body = await readJson(req, 8 * 1024 * 1024)
      if (typeof body.archive !== 'string' || body.archive.length > 7_000_000) {
        throw new HttpError(400, 'A local plugin archive is required.', 'missing_plugin_archive')
      }
      json(res, 201, { plugin: await installPlugin(Buffer.from(body.archive, 'base64')) })
      return
    }

    const pluginRoute = /^\/api\/plugins\/([a-z0-9][a-z0-9-]{1,63})(?:\/(package|grants|safe|enabled|network))?$/.exec(pathname)
    if (pluginRoute) {
      const [, pluginId, action] = pluginRoute
      if (action === 'package' && method === 'GET') {
        const archive = await getPluginArchive(pluginId)
        json(res, 200, { archive: archive.toString('base64') })
        return
      }
      if (!action && method === 'DELETE') {
        json(res, 200, await uninstallPlugin(pluginId))
        return
      }
      if (action) {
        const body = await readJson(req, action === 'network' ? 128 * 1024 : 64 * 1024)
        if (action === 'grants' && method === 'PUT') {
          json(res, 200, { plugin: await setPluginGrants(pluginId, body) })
          return
        }
        if (action === 'safe' && method === 'PUT') {
          json(res, 200, { plugin: await setPluginSafe(pluginId, body.safe) })
          return
        }
        if (action === 'enabled' && method === 'PUT') {
          json(res, 200, { plugin: await setPluginEnabled(pluginId, body.enabled) })
          return
        }
        if (action === 'network' && method === 'POST') {
          json(res, 200, await requestPluginNetwork(pluginId, body))
          return
        }
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    }

    if (pathname === '/api/settings' && method === 'PATCH') {
      const state = await loadState()
      const patch = await readJson(req)
      const settings = sanitizeSettings(patch, state.settings ?? {})
      await saveSettings(settings)
      json(res, 200, { settings })
      return
    }

    if (pathname === '/api/chats' && method === 'PUT') {
      const payload = await readJson(req, 40 * 1024 * 1024)
      const chats = sanitizeChats(payload)
      await saveChats(chats)
      json(res, 200, { sessions: chats.sessions.length, activeId: chats.activeId })
      return
    }

    if (pathname === '/api/migrate' && method === 'POST') {
      const payload = await readJson(req, 32 * 1024 * 1024)
      const result = await migrateLegacy(payload)
      json(res, 200, { ...result, state: await buildStatePayload() })
      return
    }

    if (pathname === '/api/providers' && method === 'GET') {
      const state = await loadState()
      json(res, 200, { providers: await providerList(state.settings ?? {}) })
      return
    }

    if (pathname === '/api/models' && method === 'GET') {
      await handleProviderModels(res, url)
      return
    }

    if (pathname.startsWith('/api/providers/') && pathname.endsWith('/key')) {
      const provider = providerFromPath(pathname, '/api/providers/')
      const body = await readJson(req)
      if (method === 'PUT') {
        const key = String(body.apiKey ?? '')
        const formatError = validateKeyFormat(provider, key)
        if (formatError) throw new HttpError(400, formatError, 'invalid_key_format')
        const result = await setProviderSecret(provider, key)
        json(res, 200, result)
        return
      }
      if (method === 'DELETE') {
        const result = await setProviderSecret(provider, '')
        json(res, 200, result)
        return
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    }

    if (pathname === '/api/search/key') {
      const body = await readJson(req)
      if (method === 'PUT') {
        json(res, 200, await setSearchSecret(String(body.apiKey ?? '')))
        return
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    }

    if (pathname.startsWith('/api/deploy/credentials/')) {
      const provider = pathname.slice('/api/deploy/credentials/'.length)
      if (!['cloudflare', 'netlify', 'vercel'].includes(provider)) {
        throw new HttpError(400, 'Unknown deploy provider.', 'bad_deploy_provider')
      }
      if (method === 'PUT') {
        const body = await readJson(req)
        json(res, 200, await setDeploySecret(provider, body))
        return
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    }

    if (pathname === '/api/deploy/status' && method === 'GET') {
      const { secrets } = await loadSecretsSafe()
      json(res, 200, { tools: await deployToolStatus(), secrets: secretSummary(secrets).deploy })
      return
    }

    if (pathname === '/api/deploy' && method === 'POST') {
      await handleDeploy(req, res)
      return
    }

    if (pathname === '/api/llm' && method === 'POST') {
      await handleLlm(req, res)
      return
    }

    if (pathname === '/api/workspaces') {
      if (method === 'GET') {
        json(res, 200, await workspacePayload())
        return
      }
      if (method === 'POST') {
        const body = await readJson(req)
        const found = await discoverWorkspace(String(body.path ?? ''))
        const entry = await addWorkspace(found.path)
        json(res, 200, { workspace: await workspacePayload(), entry })
        return
      }
      if (method === 'DELETE') {
        await forgetWorkspace()
        json(res, 200, await workspacePayload())
        return
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    }

    if (pathname === '/api/workspaces/browse') {
      if (method === 'GET') {
        json(res, 200, await browseDirectories(url.searchParams.get('path') ?? ''))
        return
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    }

    if (pathname === '/api/workspace/tree' && method === 'GET') {
      const depth = Number(url.searchParams.get('depth') ?? 3)
      const showHidden = url.searchParams.get('hidden') === '1'
      const result = await listTree(url.searchParams.get('path') ?? '', { depth, showHidden })
      json(res, 200, { ...result, workspace: await workspacePayload() })
      return
    }

    if (pathname === '/api/workspace/file') {
      if (method === 'GET') {
        const file = await readWorkspaceFile(url.searchParams.get('path') ?? '')
        json(res, 200, file)
        return
      }
      if (method === 'PUT') {
        const body = await readJson(req, 20 * 1024 * 1024)
        const result = await writeWorkspaceFile(String(body.path ?? ''), String(body.content ?? ''))
        json(res, 200, result)
        return
      }
      if (method === 'POST') {
        const body = await readJson(req, 8 * 1024 * 1024)
        const action = String(body.action ?? 'create')
        if (action === 'create') {
          const result = await createWorkspaceEntry(
            String(body.path ?? ''),
            body.type === 'dir' ? 'dir' : 'file',
            String(body.content ?? ''),
          )
          json(res, 200, result)
          return
        }
        if (action === 'rename') {
          const result = await renameWorkspaceEntry(String(body.from ?? ''), String(body.to ?? ''))
          json(res, 200, result)
          return
        }
        if (action === 'delete') {
          const result = await deleteWorkspaceEntry(String(body.path ?? ''))
          json(res, 200, result)
          return
        }
        throw new HttpError(400, 'Unknown file action.', 'bad_action')
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
    }

    if (pathname === '/api/workspace/edit' && method === 'POST') {
      const body = await readJson(req, 20 * 1024 * 1024)
      const result = await editWorkspaceFile(
        String(body.path ?? ''),
        String(body.oldText ?? ''),
        String(body.newText ?? ''),
        { replaceAll: body.replaceAll === true },
      )
      json(res, 200, result)
      return
    }

    if (pathname === '/api/workspace/root' && method === 'GET') {
      const root = await workspaceRoot()
      json(res, 200, { root, workspace: await workspacePayload() })
      return
    }

    if (pathname === '/api/git' && method === 'GET') {
      json(res, 200, await gitSummary())
      return
    }

    if (pathname === '/api/git' && method === 'POST') {
      const body = await readJson(req)
      const result = await runGit(String(body.action ?? 'status'), body.args ?? {}, {
        mode: body.mode === 'plan' ? 'plan' : 'build',
      })
      json(res, 200, result)
      return
    }

    if (pathname === '/api/tools/execute' && method === 'POST') {
      const body = await readJson(req, 24 * 1024 * 1024)
      const name = String(body.name ?? '')
      if (!TOOL_NAMES.has(name) || name === 'subagent') {
        throw new HttpError(400, `Unknown tool: ${name}`, 'unknown_tool')
      }
      const result = await executeTool(name, body.args ?? {}, {
        mode: body.mode === 'plan' ? 'plan' : 'build',
      })
      json(res, 200, { name, result })
      return
    }

    if (pathname === '/api/shell' && method === 'POST') {
      const body = await readJson(req, 2 * 1024 * 1024)
      json(res, 200, await runShell(String(body.command ?? ''), {
        mode: body.mode === 'plan' ? 'plan' : 'build',
        timeoutMs: body.timeoutMs,
      }))
      return
    }

    if (pathname === '/api/reset' && method === 'POST') {
      const body = await readJson(req)
      const scope = String(body.scope ?? '')
      if (scope === 'history') {
        await saveChats({ sessions: [], activeId: null })
      } else if (scope === 'secrets') {
        await resetSecrets()
      } else if (scope === 'settings') {
        await saveSettings({})
      } else if (scope === 'all') {
        await resetAll({ keepMaster: true })
      } else {
        throw new HttpError(400, 'Unknown reset scope.', 'bad_scope')
      }
      json(res, 200, await buildStatePayload())
      return
    }

    if (pathname === '/api/export' && method === 'GET') {
      const state = await loadState()
      json(res, 200, {
        app: 'maxcode',
        version: VERSION,
        exportedAt: new Date().toISOString(),
        settings: state.settings,
        chats: state.chats,
        workspaces: state.workspaces,
      })
      return
    }

    if (pathname === '/api/shutdown' && method === 'POST') {
      json(res, 200, { ok: true })
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100).unref()
      return
    }

    throw new HttpError(404, 'Unknown API route.', 'not_found')
  }

  if (method !== 'GET' && method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
  }
  await serveStatic(req, res, DIST, pathname)
}

const startedAt = Date.now()

async function handler(req, res) {
  securityHeaders(res)
  try {
    await route(req, res)
  } catch (error) {
    if (res.headersSent) {
      res.destroy()
      return
    }
    if (!(error instanceof HttpError)) {
      console.error(`[maxcode] ${clientIp(req)} ${req.method} ${req.url}`)
      console.error(error)
    }
    sendError(res, error)
  }
}

async function findPort(start) {
  for (let candidate = start; candidate < start + 30; candidate += 1) {
    const free = await new Promise((resolve) => {
      const probe = http.createServer()
      probe.once('error', () => resolve(false))
      probe.once('listening', () => probe.close(() => resolve(true)))
      probe.listen(candidate, '127.0.0.1')
    })
    if (free) return candidate
  }
  throw new Error(`No free port found between ${start} and ${start + 29}.`)
}

export async function startServer({ port: requested = 4174, open = false } = {}) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  port = requested === 0 ? await findPort(4174) : requested
  const server = http.createServer((req, res) => {
    handler(req, res)
  })
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 70_000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  const pidFile = path.join(DATA_DIR, 'daemon.json')
  await writeFile(
    pidFile,
    `${JSON.stringify({ pid: process.pid, port, host, url: `http://${host}:${port}`, startedAt: Date.now() }, null, 2)}\n`,
    { mode: 0o600 },
  )

  const shutdown = async (signal) => {
    console.log(`[maxcode] ${signal} received, shutting down.`)
    server.close()
    await rm(pidFile, { force: true }).catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('uncaughtException', (error) => console.error('[maxcode] uncaught exception', error))
  process.on('unhandledRejection', (error) => console.error('[maxcode] unhandled rejection', error))

  const url = `http://${host}:${port}`
  console.log(`[maxcode] daemon listening on ${url}`)
  console.log(`[maxcode] data: ${DATA_DIR}`)
  console.log(`[maxcode] dist: ${DIST}`)
  if (open) {
    const { spawn } = await import('node:child_process')
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(opener, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => console.log(`[maxcode] open ${url} in your browser.`))
    child.unref()
  }
  return { server, url, port }
}

export async function daemonStatus() {
  const pidFile = path.join(DATA_DIR, 'daemon.json')
  try {
    const raw = await readFile(pidFile, 'utf8')
    const info = JSON.parse(raw)
    const response = await fetch(`http://${info.host ?? host}:${info.port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return { running: false, info }
    const health = await response.json()
    return { running: true, info: { ...info, ...health } }
  } catch {
    return { running: false, info: null }
  }
}

export async function stopDaemon() {
  const status = await daemonStatus()
  if (!status.running) {
    await rm(path.join(DATA_DIR, 'daemon.json'), { force: true })
    return { stopped: false, reason: 'MaxCode is not running.' }
  }
  try {
    process.kill(status.info.pid, 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    const next = await daemonStatus()
    if (!next.running) return { stopped: true, pid: status.info.pid }
  }
  try {
    process.kill(status.info.pid, 'SIGKILL')
  } catch {
    // It already exited.
  }
  return { stopped: true, pid: status.info.pid, forced: true }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const portArg = args.find((value) => value.startsWith('--port='))
  const parsedPort = portArg ? Number(portArg.split('=')[1]) : 4174
  startServer({ port: parsedPort, open: args.includes('--open') }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
