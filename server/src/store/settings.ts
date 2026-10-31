import { create } from 'zustand'
import type {
  AppSettings,
  DaemonSnapshot,
  DeployProviderId,
  DeploySecretEntry,
  DeployToolInfo,
  Effort,
  ProviderId,
  SecretEntry,
  SecretsSummary,
  Skill,
  ToolName,
  ToolSetting,
} from '../types'
import { BUILTIN_SKILLS } from '../data/skills'
import { PROVIDER_MAP } from '../data/providers'
import {
  patchSettings,
  setDeployCredentials as saveDeployCredentials,
  setProviderKey,
  setSearchKey as saveSearchKey,
  listProviders,
} from '../lib/daemon'
import { defaultEffort, normalizeEffort, supportsReasoningControl } from '../lib/reasoning'

export const DEFAULT_SYSTEM_PROMPT = `You are MaxCode, a senior web engineer and coding agent built by DevSoft.

You work directly in the user's open folder through a local daemon. The shell, file, git, search and deploy tools are real. Never describe tool output you did not receive.

Engineering standard:
- Read every file you change. Match the existing stack, style, naming and conventions. Never invent APIs, versions, flags, package names or paths.
- Make the smallest correct change. One concern per edit. No speculative abstraction, dead code, placeholder TODOs or swallowed errors.
- Keep public behavior stable unless the task explicitly changes it.
- Security: never expose secrets, never weaken auth, CSRF, CSP or validation to make something pass, and validate untrusted input at boundaries.
- Accessibility: semantic HTML, keyboard paths, visible focus, sufficient contrast.
- Performance: avoid needless work; measure before optimizing.
- Every bug fix gets a regression test when a test setup exists. Tests assert behavior, not implementation.

Working loop:
1. Inspect before editing: list files, read the relevant source, grep for call sites, check git status.
2. For non-trivial work, state a short plan.
3. Edit in small, coherent steps.
4. Verify with the project's real commands (typecheck, lint, tests, build) and read the output.
5. Report what changed, which files, and what was verified. If a check fails or cannot run, say so plainly and explain why.

Never claim a check passed without running it. Ask only when a decision is genuinely ambiguous or destructive. Answer in the user's language. Cite web sources as links, and only when you actually read them.`

const DEFAULT_TOOLS: Record<ToolName, ToolSetting> = {
  shell: { enabled: true, approval: 'ask' },
  read_file: { enabled: true, approval: 'auto' },
  list_files: { enabled: true, approval: 'auto' },
  write_file: { enabled: true, approval: 'auto' },
  edit_file: { enabled: true, approval: 'auto' },
  rewrite_file: { enabled: true, approval: 'auto' },
  grep: { enabled: true, approval: 'auto' },
  web_search: { enabled: true, approval: 'auto' },
  read_url: { enabled: true, approval: 'auto' },
  git: { enabled: true, approval: 'ask' },
  subagent: { enabled: true, approval: 'ask' },
}

const DEFAULTS: AppSettings = {
  provider: 'openai',
  model: '',
  effort: 'medium',
  deepThink: false,
  webSearchEnabled: true,
  temperature: 0.4,
  maxTokens: 8192,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  providers: {},
  searchProvider: 'duckduckgo',
  tools: DEFAULT_TOOLS,
  skills: BUILTIN_SKILLS,
  theme: 'system',
  showTokenEstimate: true,
  mode: 'build',
}

const EFFORTS = new Set<Effort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const THEMES = new Set(['light', 'dark', 'system'])

interface SettingsStore extends AppSettings {
  hydrated: boolean
  daemon: DaemonSnapshot | null
  secretStatus: SecretsSummary | null
  providerStatus: DaemonSnapshot['providers']
  deployTools: DaemonSnapshot['deployTools'] | null
  deploySecrets: DaemonSnapshot['deploySecrets'] | null
  secretsError: string
  hydrate: (snapshot: DaemonSnapshot) => void
  update: (patch: Partial<AppSettings>) => void
  selectModel: (provider: ProviderId, model: string, effort?: Effort) => void
  updateProvider: (provider: ProviderId, patch: { baseUrl?: string }) => void
  saveProviderKey: (provider: ProviderId, apiKey: string) => Promise<void>
  saveSearchKey: (apiKey: string) => Promise<void>
  saveDeployCredentials: (provider: DeployProviderId, fields: Record<string, string>) => Promise<void>
  refreshProviders: () => Promise<void>
  updateTool: (tool: ToolName, patch: Partial<ToolSetting>) => void
  addSkill: (skill: Skill) => void
  updateSkill: (id: string, patch: Partial<Skill>) => void
  removeSkill: (id: string) => void
  setMode: (mode: AppSettings['mode']) => void
  flush: () => Promise<void>
}

function notify(message: string, tone: 'info' | 'success' | 'error' = 'error') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('maxcode:notice', { detail: { message, tone } }))
}

function mergeTools(saved?: Partial<Record<ToolName, Partial<ToolSetting>>>) {
  const merged = {} as Record<ToolName, ToolSetting>
  for (const key of Object.keys(DEFAULT_TOOLS) as ToolName[]) {
    merged[key] = { ...DEFAULT_TOOLS[key], ...(saved?.[key] ?? {}) }
  }
  return merged
}

function mergeSkills(saved?: Skill[]) {
  const byId = new Map<string, Skill>()
  for (const skill of BUILTIN_SKILLS) byId.set(skill.id, skill)
  for (const skill of saved ?? []) {
    if (!skill || typeof skill.id !== 'string') continue
    byId.set(skill.id, { ...(byId.get(skill.id) ?? {}), ...skill, builtIn: skill.builtIn ?? byId.has(skill.id) })
  }
  return [...byId.values()]
}

function upgradePrompt(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_SYSTEM_PROMPT
  const legacy =
    /sandboxed workspace stored in the user's browser/i.test(value) ||
    /There is no node, npm, git or network in the shell/i.test(value) ||
    /workspace root is \/workspace/i.test(value)
  return legacy ? DEFAULT_SYSTEM_PROMPT : value
}

function sanitizeBaseUrls(saved: AppSettings['providers'] | undefined) {
  const providers: AppSettings['providers'] = {}
  for (const [id, value] of Object.entries(saved ?? {})) {
    if (!(id in PROVIDER_MAP) || !value || typeof value !== 'object') continue
    if (typeof value.baseUrl === 'string' && value.baseUrl.trim()) {
      providers[id] = { baseUrl: value.baseUrl.trim() }
    }
  }
  return providers
}

function buildSettings(persisted?: Partial<AppSettings>): AppSettings {
  const saved = persisted ?? {}
  const provider =
    typeof saved.provider === 'string' && saved.provider in PROVIDER_MAP
      ? (saved.provider as ProviderId)
      : DEFAULTS.provider
  const mode = saved.mode === 'plan' ? 'plan' : saved.mode === 'build' ? 'build' : DEFAULTS.mode
  return {
    ...DEFAULTS,
    ...saved,
    provider,
    model: typeof saved.model === 'string' ? saved.model.trim() : '',
    mode,
    effort: typeof saved.effort === 'string' && EFFORTS.has(saved.effort as Effort)
      ? (saved.effort as Effort)
      : DEFAULTS.effort,
    deepThink: saved.deepThink === true,
    webSearchEnabled: saved.webSearchEnabled !== false,
    showTokenEstimate: saved.showTokenEstimate !== false,
    temperature:
      typeof saved.temperature === 'number' && Number.isFinite(saved.temperature)
        ? Math.max(0, Math.min(2, saved.temperature))
        : DEFAULTS.temperature,
    maxTokens:
      typeof saved.maxTokens === 'number' && Number.isFinite(saved.maxTokens)
        ? Math.max(256, Math.min(200_000, Math.round(saved.maxTokens)))
        : DEFAULTS.maxTokens,
    systemPrompt: upgradePrompt(saved.systemPrompt),
    providers: sanitizeBaseUrls(saved.providers),
    searchProvider:
      saved.searchProvider && ['duckduckgo', 'tavily', 'brave', 'serper'].includes(saved.searchProvider)
        ? saved.searchProvider
        : DEFAULTS.searchProvider,
    tools: mergeTools(saved.tools),
    skills: mergeSkills(saved.skills),
    theme: THEMES.has(saved.theme ?? '') ? (saved.theme as AppSettings['theme']) : DEFAULTS.theme,
  }
}

let persistEnabled = false
let pending: Partial<AppSettings> = {}
let saveTimer: number | undefined
let maxTimer: number | undefined

function persistedPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  const out: Record<string, unknown> = {}
  const keys: Array<keyof AppSettings> = [
    'provider',
    'model',
    'effort',
    'deepThink',
    'webSearchEnabled',
    'temperature',
    'maxTokens',
    'systemPrompt',
    'providers',
    'searchProvider',
    'tools',
    'skills',
    'theme',
    'showTokenEstimate',
    'mode',
  ]
  for (const key of keys) {
    if (key in patch) out[key] = patch[key]
  }
  return out as Partial<AppSettings>
}

function flushSettings() {
  if (!persistEnabled || Object.keys(pending).length === 0) return Promise.resolve()
  const body = persistedPatch(pending)
  pending = {}
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  if (maxTimer !== undefined) window.clearTimeout(maxTimer)
  saveTimer = undefined
  maxTimer = undefined
  return patchSettings(body)
    .then(() => undefined)
    .catch((error) => {
      notify(error instanceof Error ? error.message : 'Could not save settings to the local daemon.')
    })
}

function queueSave(patch: Partial<AppSettings>) {
  if (!persistEnabled) return
  pending = { ...pending, ...persistedPatch(patch) }
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void flushSettings(), 550)
  if (maxTimer === undefined) {
    maxTimer = window.setTimeout(() => void flushSettings(), 4000)
  }
}

export function enableSettingsPersistence() {
  persistEnabled = true
  if (Object.keys(pending).length > 0) queueSave({})
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  daemon: null,
  secretStatus: null,
  providerStatus: [],
  deployTools: null,
  deploySecrets: null,
  secretsError: '',
  hydrate: (snapshot) => {
    const settings = buildSettings(snapshot.settings as Partial<AppSettings>)
    const statuses = snapshot.providers
    const configured = statuses.filter((provider) => provider.configured)
    if (!providerHasCredentialsRaw(settings, statuses, settings.provider) && configured.length > 0) {
      settings.provider = configured[0].id
      settings.model = ''
    }
    if (!providerHasCredentialsRaw(settings, statuses, settings.provider)) settings.model = ''
    set({
      ...settings,
      hydrated: true,
      daemon: snapshot,
      secretStatus: snapshot.secrets,
      providerStatus: statuses,
      deployTools: snapshot.deployTools,
      deploySecrets: snapshot.deploySecrets,
      secretsError: snapshot.secretsError,
    })
  },
  update: (patch) => {
    set(patch)
    queueSave(patch)
  },
  selectModel: (provider, model, effort) => {
    const nextEffort = effort ?? get().effort
    const patch: Partial<AppSettings> = { provider, model: model.trim(), effort: nextEffort }
    set(patch)
    queueSave(patch)
  },
  updateProvider: (provider, patch) => {
    const next = {
      providers: {
        ...get().providers,
        [provider]: { ...(get().providers[provider] ?? {}), ...patch },
      },
    }
    set(next)
    queueSave(next)
  },
  saveProviderKey: async (provider, apiKey) => {
    const result = await setProviderKey(provider, apiKey.trim())
    const wasConfigured = providerHasCredentials(get(), provider)
    set((state) => {
      const secretStatus = state.secretStatus
        ? {
            ...state.secretStatus,
            providers: {
              ...state.secretStatus.providers,
              [provider]: { configured: result.configured, hint: result.hint },
            },
          }
        : state.secretStatus
      const providerStatus = state.providerStatus.map((entry) =>
        entry.id === provider ? { ...entry, configured: result.configured, hint: result.hint } : entry,
      )
      const activate = !result.configured ? false : !hasCredentials(state) || state.provider === provider
      const lost = state.provider === provider && !result.configured
      const patch: Partial<AppSettings> = {}
      if (activate) patch.provider = provider
      if (lost) patch.model = ''
      if (lost) patch.deepThink = false
      return {
        secretStatus,
        providerStatus,
        ...patch,
      }
    })
    if (!wasConfigured && result.configured) {
      notify(`${PROVIDER_MAP[provider]?.name ?? provider} is connected.`, 'success')
    }
  },
  saveSearchKey: async (apiKey) => {
    const result = await saveSearchKey(apiKey.trim())
    set((state) => ({
      secretStatus: state.secretStatus
        ? { ...state.secretStatus, search: { configured: result.configured, hint: result.hint } }
        : state.secretStatus,
    }))
  },
  saveDeployCredentials: async (provider, fields) => {
    const result = (await saveDeployCredentials(provider, fields)) as DeploySecretEntry
    set((state) => ({
      secretStatus: state.secretStatus
        ? {
            ...state.secretStatus,
            deploy: { ...state.secretStatus.deploy, [provider]: result },
          }
        : state.secretStatus,
      deploySecrets: state.deploySecrets
        ? { ...state.deploySecrets, [provider]: result }
        : state.deploySecrets,
    }))
  },
  refreshProviders: async () => {
    const result = await listProviders()
    set({ providerStatus: result.providers })
  },
  updateTool: (tool, patch) => {
    const next = { tools: { ...get().tools, [tool]: { ...get().tools[tool], ...patch } } }
    set(next)
    queueSave(next)
  },
  addSkill: (skill) => {
    const next = { skills: [...get().skills, skill] }
    set(next)
    queueSave(next)
  },
  updateSkill: (id, patch) => {
    const next = { skills: get().skills.map((skill) => (skill.id === id ? { ...skill, ...patch } : skill)) }
    set(next)
    queueSave(next)
  },
  removeSkill: (id) => {
    const next = { skills: get().skills.filter((skill) => skill.id !== id) }
    set(next)
    queueSave(next)
  },
  setMode: (mode) => {
    const patch = { mode }
    set(patch)
    queueSave(patch)
  },
  flush: () => flushSettings(),
}))

export function activeModelId(settings: AppSettings): string {
  return settings.model.trim()
}

export function providerHasCredentials(settings: AppSettings, provider: ProviderId): boolean {
  return providerHasCredentialsRaw(settings, useSettings.getState().providerStatus, provider)
}

export function providerStatusFor(provider: ProviderId) {
  return useSettings.getState().providerStatus.find((entry) => entry.id === provider)
}

function providerHasCredentialsRaw(
  settings: AppSettings,
  statuses: DaemonSnapshot['providers'],
  provider: ProviderId,
) {
  const preset = PROVIDER_MAP[provider]
  if (!preset) return false
  const status = statuses.find((entry) => entry.id === provider)
  if (status) return status.configured
  if (provider === 'custom') return Boolean(settings.providers.custom?.baseUrl?.trim())
  return Boolean(preset.keyless)
}

export function hasCredentials(settings: AppSettings): boolean {
  return providerHasCredentials(settings, settings.provider)
}

export function resolveBaseUrl(settings: AppSettings): string {
  const preset = PROVIDER_MAP[settings.provider]
  const custom = settings.providers[settings.provider]?.baseUrl?.trim()
  return (custom || preset?.baseUrl || '').replace(/\/+$/, '')
}

export function reasoningReady(settings: AppSettings, model?: Parameters<typeof supportsReasoningControl>[0]) {
  return settings.deepThink && supportsReasoningControl(model)
}

export function activeEffort(settings: AppSettings, model?: Parameters<typeof normalizeEffort>[1]) {
  return normalizeEffort(settings.effort, model)
}

export function preferredEffort(model?: Parameters<typeof defaultEffort>[0]) {
  return defaultEffort(model)
}

export type { SecretEntry, DeployToolInfo }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void useSettings.getState().flush()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void useSettings.getState().flush()
  })
}
