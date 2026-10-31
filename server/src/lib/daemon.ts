import type {
  AgentMode,
  AppSettings,
  ChatSession,
  DaemonSnapshot,
  DeployEvent,
  DeployProviderId,
  DeployRequest,
  DeployResult,
  ModelInfo,
  ProviderId,
  ProviderStatus,
  SecretsSummary,
  WorkspaceFile,
  WorkspaceInfo,
} from '../types'

export class DaemonError extends Error {
  status: number
  code: string

  constructor(message: string, status = 0, code = 'daemon_error') {
    super(message)
    this.name = 'DaemonError'
    this.status = status
    this.code = code
  }
}

let csrf = ''
let sessionPromise: Promise<void> | null = null

export function csrfToken() {
  return csrf
}

async function parseError(response: Response): Promise<DaemonError> {
  const raw = await response.text().catch(() => '')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string; status?: number } }
      if (parsed.error?.message) {
        return new DaemonError(
          parsed.error.message,
          parsed.error.status ?? response.status,
          parsed.error.code ?? 'daemon_error',
        )
      }
    } catch {
      // Fall through to the raw response.
    }
  }
  return new DaemonError(
    raw.trim().slice(0, 400) || `The local daemon returned ${response.status}.`,
    response.status,
    'daemon_error',
  )
}

export async function ensureSession(force = false): Promise<void> {
  if (sessionPromise && !force) return sessionPromise
  sessionPromise = (async () => {
    let response: Response
    try {
      response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      })
    } catch {
      throw new DaemonError(
        'MaxCode’s local daemon is not reachable. Start it with “npm start” in the MaxCode folder, then reload this page.',
        0,
        'daemon_unreachable',
      )
    }
    if (!response.ok) throw await parseError(response)
    const data = (await response.json()) as { csrf?: string }
    csrf = typeof data.csrf === 'string' ? data.csrf : ''
  })().catch((error) => {
    sessionPromise = null
    throw error
  })
  return sessionPromise
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  await ensureSession()
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD'].includes(method)) headers.set('x-maxcode-csrf', csrf)
  let response: Response
  try {
    response = await fetch(path, { ...init, method, headers, credentials: 'same-origin' })
  } catch {
    throw new DaemonError(
      'Lost the connection to the local daemon. Check that it is still running.',
      0,
      'daemon_unreachable',
    )
  }
  if (response.status === 401 && retry) {
    await ensureSession(true)
    return api<T>(path, init, false)
  }
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) return (await response.text()) as T
  return (await response.json()) as T
}

function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) }
}

export function getState(): Promise<DaemonSnapshot> {
  return api<DaemonSnapshot>('/api/state')
}

export function getHealth(): Promise<{ ok: boolean; pid: number; port: number; dist: boolean }> {
  return api('/api/health')
}

export function patchSettings(patch: Partial<AppSettings>): Promise<{ settings: AppSettings }> {
  return api('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) })
}

export function saveChats(chats: { sessions: ChatSession[]; activeId: string | null }) {
  return api<{ sessions: number; activeId: string | null }>('/api/chats', {
    method: 'PUT',
    body: JSON.stringify(chats),
  })
}

export function migrateLegacy(payload: { settings?: unknown; chats?: unknown }) {
  return api<{
    migratedSettings: boolean
    migratedChats: number
    migratedSecrets: boolean
    state: DaemonSnapshot
  }>('/api/migrate', jsonBody(payload))
}

export function listProviders(): Promise<{ providers: ProviderStatus[] }> {
  return api('/api/providers')
}

export function fetchModels(provider: ProviderId) {
  return api<{
    provider: ProviderId
    models: ModelInfo[]
    source: 'live' | 'catalog'
    fetchedAt: number
    note: string
    catalogError: string
  }>(`/api/models?provider=${encodeURIComponent(provider)}`)
}

export function setProviderKey(provider: ProviderId, apiKey: string) {
  if (!apiKey) return api<{ configured: boolean; hint: string }>(`/api/providers/${provider}/key`, { method: 'DELETE' })
  return api<{ configured: boolean; hint: string }>(`/api/providers/${provider}/key`, {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  })
}

export function setSearchKey(apiKey: string) {
  return api<{ configured: boolean; hint: string }>('/api/search/key', {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  })
}

export function setDeployCredentials(provider: DeployProviderId, fields: Record<string, string>) {
  return api(`/api/deploy/credentials/${provider}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
}

export function resetScope(scope: 'history' | 'secrets' | 'settings' | 'all'): Promise<DaemonSnapshot> {
  return api('/api/reset', jsonBody({ scope }))
}

export function addWorkspace(path: string): Promise<{ workspace: WorkspaceInfo; entry: { path: string; name: string } }> {
  return api('/api/workspaces', jsonBody({ path }))
}

export function forgetWorkspace(): Promise<WorkspaceInfo> {
  return api('/api/workspaces', { method: 'DELETE' })
}

export function browseFolders(path: string) {
  return api<{ path: string; parent: string; home: string; entries: Array<{ name: string; path: string }> }>(
    `/api/workspaces/browse?path=${encodeURIComponent(path)}`,
  )
}

export function getWorkspaceTree(path = '', depth = 6) {
  return api<{
    root: string
    path: string
    entries: Array<{ name: string; path: string; type: 'file' | 'dir' | 'link'; size: number; mtime: number }>
    truncated: boolean
    workspace: WorkspaceInfo
  }>(`/api/workspace/tree?depth=${depth}&path=${encodeURIComponent(path)}`)
}

export function readWorkspaceFile(path: string): Promise<WorkspaceFile> {
  return api(`/api/workspace/file?path=${encodeURIComponent(path)}`)
}

export function writeWorkspaceFile(path: string, content: string) {
  return api<{ path: string; size: number; mtime: number; created: boolean; hash: string }>(
    '/api/workspace/file',
    { method: 'PUT', body: JSON.stringify({ path, content }) },
  )
}

export function createWorkspaceEntry(path: string, type: 'file' | 'dir') {
  return api<{ path: string; type: 'file' | 'dir' }>('/api/workspace/file', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', path, type }),
  })
}

export function renameWorkspaceEntry(from: string, to: string) {
  return api<{ from: string; to: string }>('/api/workspace/file', {
    method: 'POST',
    body: JSON.stringify({ action: 'rename', from, to }),
  })
}

export function deleteWorkspaceEntry(path: string) {
  return api<{ path: string; type: 'file' | 'dir' }>('/api/workspace/file', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', path }),
  })
}

export function gitSummary() {
  return api<{
    available: boolean
    root: string
    branch: string
    entries: Array<{ status: string; path: string }>
    error: string
  }>('/api/git')
}

export interface DaemonToolResult {
  name: string
  result: unknown
}

export function executeDaemonTool(
  name: string,
  args: Record<string, unknown>,
  mode: AgentMode,
  signal?: AbortSignal,
) {
  return api<DaemonToolResult>(
    '/api/tools/execute',
    { ...jsonBody({ name, args, mode }), signal },
  )
}

export function runGit(action: string, args: Record<string, unknown> = {}, mode: AgentMode = 'build') {
  return api<Record<string, unknown>>('/api/git', jsonBody({ action, args, mode }))
}

export async function requestLLM(
  provider: ProviderId,
  kind: string,
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  await ensureSession()
  let response: Response
  try {
    response = await fetch('/api/llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-maxcode-csrf': csrf,
      },
      body: JSON.stringify({ provider, kind, model, body }),
      signal,
      credentials: 'same-origin',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new DaemonError('Lost the connection to the local daemon while calling the model.', 0, 'daemon_unreachable')
  }
  if (!response.ok) throw await parseError(response)
  return response
}

export async function* streamDeploy(
  request: DeployRequest,
  signal?: AbortSignal,
): AsyncGenerator<DeployEvent> {
  await ensureSession()
  let response: Response
  try {
    response = await fetch('/api/deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-maxcode-csrf': csrf,
      },
      body: JSON.stringify(request),
      signal,
      credentials: 'same-origin',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new DaemonError('Lost the connection to the local daemon while deploying.', 0, 'daemon_unreachable')
  }
  if (!response.ok) throw await parseError(response)
  if (!response.body) throw new DaemonError('The deploy stream was empty.', 502, 'empty_stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) {
          try {
            yield JSON.parse(line) as DeployEvent
          } catch {
            yield { type: 'log', stream: 'meta', text: line }
          }
        }
        index = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail) {
      try {
        yield JSON.parse(tail) as DeployEvent
      } catch {
        yield { type: 'log', stream: 'meta', text: tail }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export type { DeployResult, SecretsSummary }
