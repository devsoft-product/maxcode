import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const DATA_DIR = process.env.MAXCODE_DATA
  ? path.resolve(process.env.MAXCODE_DATA)
  : path.join(os.homedir(), '.maxcode')

const STATE_FILE = path.join(DATA_DIR, 'state.json')
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.enc')
const MASTER_FILE = path.join(DATA_DIR, 'master.key')
const MODELS_CACHE = path.join(DATA_DIR, 'models-cache.json')
const AAD = Buffer.from('maxcode-secrets-v1', 'utf8')

export const STATE_VERSION = 2

const DEFAULT_STATE = () => ({
  version: STATE_VERSION,
  createdAt: new Date().toISOString(),
  settings: {},
  chats: { sessions: [], activeId: null },
  workspaces: [],
  activeWorkspace: null,
  legacyMigratedAt: null,
})

const EMPTY_SECRETS = () => ({
  providers: {},
  search: {},
  deploy: {
    cloudflare: {},
    netlify: {},
    vercel: {},
  },
})

const queues = new Map()
let stateCache = null
let secretsCache = null
let masterKeyCache = null

export async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  await chmod(DATA_DIR, 0o700).catch(() => undefined)
}

function enqueue(key, task) {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  queues.set(
    key,
    next.finally(() => {
      if (queues.get(key) === next) queues.delete(key)
    }),
  )
  return next
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return fallback
    if (error instanceof SyntaxError) {
      const backup = `${file}.broken-${Date.now()}`
      await rename(file, backup).catch(() => undefined)
      throw new Error(`MaxCode data is damaged. The file was moved to ${backup}.`)
    }
    throw error
  }
}

async function writeAtomic(file, value, mode = 0o600) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode })
  await chmod(temp, mode).catch(() => undefined)
  await rename(temp, file)
}

function mergeLegacySettings(current, legacy) {
  if (!legacy || typeof legacy !== 'object') return current
  const merged = { ...legacy, ...current }
  merged.providers = { ...(legacy.providers ?? {}), ...(current.providers ?? {}) }
  merged.tools = { ...(legacy.tools ?? {}), ...(current.tools ?? {}) }
  if (!Array.isArray(current.skills) || current.skills.length === 0) {
    if (Array.isArray(legacy.skills)) merged.skills = legacy.skills
  }
  return merged
}

export async function loadState() {
  if (stateCache) return stateCache
  await ensureDataDir()
  const parsed = await readJson(STATE_FILE, null)
  const base = DEFAULT_STATE()
  if (!parsed || typeof parsed !== 'object') {
    stateCache = base
    return stateCache
  }
  stateCache = {
    ...base,
    ...parsed,
    version: STATE_VERSION,
    settings:
      parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
    chats:
      parsed.chats && Array.isArray(parsed.chats.sessions)
        ? {
            sessions: parsed.chats.sessions,
            activeId: typeof parsed.chats.activeId === 'string' ? parsed.chats.activeId : null,
          }
        : base.chats,
    workspaces: Array.isArray(parsed.workspaces)
      ? parsed.workspaces
          .filter((entry) => entry && typeof entry.path === 'string')
          .slice(0, 20)
      : [],
    activeWorkspace: typeof parsed.activeWorkspace === 'string' ? parsed.activeWorkspace : null,
  }
  return stateCache
}

export async function saveState(next) {
  stateCache = next
  await enqueue('state', () => writeAtomic(STATE_FILE, next))
  return next
}

export async function patchState(patch) {
  const state = await loadState()
  const next = { ...state, ...patch }
  return saveState(next)
}

export function cachedState() {
  return stateCache
}

async function masterKey() {
  if (masterKeyCache) return masterKeyCache
  await ensureDataDir()
  try {
    const raw = (await readFile(MASTER_FILE, 'utf8')).trim()
    const key = Buffer.from(raw, 'base64')
    if (key.length !== 32) throw new Error('The local master key is invalid.')
    masterKeyCache = key
    return key
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
    const key = randomBytes(32)
    await writeFile(MASTER_FILE, `${key.toString('base64')}\n`, { mode: 0o600 })
    await chmod(MASTER_FILE, 0o600).catch(() => undefined)
    masterKeyCache = key
    return key
  }
}

export async function loadSecrets() {
  if (secretsCache) return secretsCache
  await ensureDataDir()
  const envelope = await readJson(SECRETS_FILE, null)
  if (!envelope) {
    secretsCache = EMPTY_SECRETS()
    return secretsCache
  }
  try {
    const key = await masterKey()
    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    const data = Buffer.from(envelope.data, 'base64')
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted file.')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plain)
    secretsCache = {
      ...EMPTY_SECRETS(),
      ...parsed,
      providers: { ...(parsed.providers ?? {}) },
      search: { ...(parsed.search ?? {}) },
      deploy: {
        cloudflare: { ...(parsed.deploy?.cloudflare ?? {}) },
        netlify: { ...(parsed.deploy?.netlify ?? {}) },
        vercel: { ...(parsed.deploy?.vercel ?? {}) },
      },
    }
    return secretsCache
  } catch (error) {
    throw new Error(
      `MaxCode could not decrypt its saved keys. Restore ${MASTER_FILE} or reset secrets from Settings → About. (${error instanceof Error ? error.message : 'unknown error'})`,
    )
  }
}

export async function loadSecretsSafe() {
  try {
    return { secrets: await loadSecrets(), error: '' }
  } catch (error) {
    return { secrets: EMPTY_SECRETS(), error: error instanceof Error ? error.message : 'Could not read saved keys.' }
  }
}

export async function saveSecrets(next) {
  await ensureDataDir()
  const key = await masterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(AAD)
  const data = Buffer.concat([cipher.update(JSON.stringify(next), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const envelope = {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  }
  secretsCache = next
  await enqueue('secrets', () => writeAtomic(SECRETS_FILE, envelope))
  return next
}

export async function patchSecrets(patch) {
  const secrets = await loadSecrets()
  const next = {
    ...secrets,
    ...patch,
    providers: { ...secrets.providers, ...(patch.providers ?? {}) },
    search: { ...secrets.search, ...(patch.search ?? {}) },
    deploy: {
      cloudflare: { ...secrets.deploy.cloudflare, ...(patch.deploy?.cloudflare ?? {}) },
      netlify: { ...secrets.deploy.netlify, ...(patch.deploy?.netlify ?? {}) },
      vercel: { ...secrets.deploy.vercel, ...(patch.deploy?.vercel ?? {}) },
    },
  }
  return saveSecrets(next)
}

export function hintFor(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  if (text.length <= 8) return '••••'
  return `••••${text.slice(-4)}`
}

export function secretSummary(secrets) {
  const providers = {}
  for (const [id, value] of Object.entries(secrets.providers ?? {})) {
    const apiKey = typeof value?.apiKey === 'string' ? value.apiKey : ''
    providers[id] = { configured: Boolean(apiKey), hint: hintFor(apiKey) }
  }
  return {
    providers,
    search: {
      configured: Boolean(secrets.search?.apiKey),
      hint: hintFor(secrets.search?.apiKey),
    },
    deploy: {
      cloudflare: {
        configured: Boolean(secrets.deploy?.cloudflare?.apiToken && secrets.deploy?.cloudflare?.accountId),
        hint: hintFor(secrets.deploy?.cloudflare?.apiToken),
        fields: {
          accountId: secrets.deploy?.cloudflare?.accountId ?? '',
        },
      },
      netlify: {
        configured: Boolean(secrets.deploy?.netlify?.authToken),
        hint: hintFor(secrets.deploy?.netlify?.authToken),
        fields: {
          siteId: secrets.deploy?.netlify?.siteId ?? '',
        },
      },
      vercel: {
        configured: Boolean(secrets.deploy?.vercel?.token),
        hint: hintFor(secrets.deploy?.vercel?.token),
        fields: {
          projectId: secrets.deploy?.vercel?.projectId ?? '',
          teamId: secrets.deploy?.vercel?.teamId ?? '',
        },
      },
    },
    encryption: 'AES-256-GCM',
  }
}

export async function providerKey(providerId) {
  const { secrets } = await loadSecretsSafe()
  return secrets.providers?.[providerId]?.apiKey ?? ''
}

export async function setProviderSecret(providerId, apiKey) {
  const secrets = await loadSecrets()
  const providers = { ...secrets.providers }
  const clean = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (clean) providers[providerId] = { ...(providers[providerId] ?? {}), apiKey: clean }
  else delete providers[providerId]
  await saveSecrets({ ...secrets, providers })
  return { configured: Boolean(clean), hint: hintFor(clean) }
}

export async function setSearchSecret(apiKey) {
  const secrets = await loadSecrets()
  const clean = typeof apiKey === 'string' ? apiKey.trim() : ''
  await saveSecrets({ ...secrets, search: clean ? { apiKey: clean } : {} })
  return { configured: Boolean(clean), hint: hintFor(clean) }
}

export async function setDeploySecret(provider, patch) {
  if (!['cloudflare', 'netlify', 'vercel'].includes(provider)) {
    throw new Error('Unknown deploy provider.')
  }
  const secrets = await loadSecrets()
  const current = { ...(secrets.deploy?.[provider] ?? {}) }
  const next = { ...current }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (typeof value !== 'string') continue
    const clean = value.trim()
    if (clean) next[key] = clean
    else delete next[key]
  }
  const deploy = { ...secrets.deploy, [provider]: next }
  await saveSecrets({ ...secrets, deploy })
  return secretSummary({ ...secrets, deploy }).deploy[provider]
}

export async function addWorkspace(rawPath) {
  const state = await loadState()
  const resolved = path.resolve(rawPath)
  const name = path.basename(resolved) || resolved
  const entry = { path: resolved, name, lastOpened: Date.now() }
  const workspaces = [entry, ...state.workspaces.filter((item) => item.path !== resolved)].slice(0, 12)
  await saveState({ ...state, workspaces, activeWorkspace: resolved })
  return entry
}

export async function forgetWorkspace() {
  const state = await loadState()
  await saveState({ ...state, activeWorkspace: null })
}

export async function saveSettings(settings) {
  const state = await loadState()
  await saveState({ ...state, settings })
}

export async function saveChats(chats) {
  const state = await loadState()
  await saveState({
    ...state,
    chats: {
      sessions: Array.isArray(chats.sessions) ? chats.sessions : [],
      activeId: typeof chats.activeId === 'string' ? chats.activeId : null,
    },
  })
}

export async function migrateLegacy(payload) {
  const state = await loadState()
  const legacySettings =
    payload?.settings && typeof payload.settings === 'object'
      ? payload.settings.state && typeof payload.settings.state === 'object'
        ? payload.settings.state
        : payload.settings
      : {}
  const legacyChats =
    payload?.chats && typeof payload.chats === 'object'
      ? Array.isArray(payload.chats.state?.sessions)
        ? payload.chats.state
        : payload.chats
      : {}

  let changed = false
  const nextSettings = mergeLegacySettings(state.settings ?? {}, legacySettings)

  const { secrets } = await loadSecretsSafe()
  const nextSecrets = {
    ...secrets,
    providers: { ...(secrets.providers ?? {}) },
    search: { ...(secrets.search ?? {}) },
    deploy: {
      cloudflare: { ...(secrets.deploy?.cloudflare ?? {}) },
      netlify: { ...(secrets.deploy?.netlify ?? {}) },
      vercel: { ...(secrets.deploy?.vercel ?? {}) },
    },
  }

  for (const [provider, value] of Object.entries(legacySettings.providers ?? {})) {
    if (!value || typeof value !== 'object') continue
    const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : ''
    if (baseUrl) {
      nextSettings.providers = {
        ...(nextSettings.providers ?? {}),
        [provider]: { ...(nextSettings.providers?.[provider] ?? {}), baseUrl },
      }
    }
    const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : ''
    if (apiKey && !nextSecrets.providers[provider]?.apiKey) {
      nextSecrets.providers[provider] = { apiKey }
      changed = true
    }
  }
  const searchKey =
    typeof legacySettings.searchApiKey === 'string' ? legacySettings.searchApiKey.trim() : ''
  if (searchKey && !nextSecrets.search.apiKey) {
    nextSecrets.search = { apiKey: searchKey }
    changed = true
  }

  let addedChats = 0
  const legacySessions = Array.isArray(legacyChats.sessions) ? legacyChats.sessions : []
  let chats = state.chats
  if (state.chats.sessions.length === 0 && legacySessions.length > 0) {
    const activeId =
      typeof legacyChats.activeId === 'string' &&
      legacySessions.some((session) => session?.id === legacyChats.activeId)
        ? legacyChats.activeId
        : legacySessions[0]?.id ?? null
    chats = { sessions: legacySessions, activeId }
    addedChats = legacySessions.length
    changed = true
  }

  const settingsChanged =
    JSON.stringify(nextSettings) !== JSON.stringify(state.settings ?? {})
  if (changed) await saveSecrets(nextSecrets)
  const next = {
    ...state,
    settings: nextSettings,
    chats,
    legacyMigratedAt: state.legacyMigratedAt ?? new Date().toISOString(),
  }
  if (settingsChanged || addedChats > 0 || !state.legacyMigratedAt) await saveState(next)
  return {
    migratedSettings: settingsChanged,
    migratedChats: addedChats,
    migratedSecrets: changed,
  }
}

export async function resetAll({ keepMaster = true } = {}) {
  stateCache = null
  secretsCache = null
  await rm(STATE_FILE, { force: true })
  await rm(SECRETS_FILE, { force: true })
  if (!keepMaster) {
    masterKeyCache = null
    await rm(MASTER_FILE, { force: true })
  }
  await rm(MODELS_CACHE, { force: true })
  const fresh = DEFAULT_STATE()
  await saveState(fresh)
  return fresh
}

export async function resetSecrets() {
  secretsCache = null
  masterKeyCache = null
  await rm(SECRETS_FILE, { force: true })
  await rm(MASTER_FILE, { force: true })
  const empty = EMPTY_SECRETS()
  await saveSecrets(empty)
  return empty
}

export async function loadModelsCache() {
  return readJson(MODELS_CACHE, null)
}

export async function saveModelsCache(value) {
  await ensureDataDir()
  await enqueue('models-cache', () => writeAtomic(MODELS_CACHE, value, 0o600))
}

export function dataPaths() {
  return { dataDir: DATA_DIR, stateFile: STATE_FILE, secretsFile: SECRETS_FILE, masterFile: MASTER_FILE }
}
