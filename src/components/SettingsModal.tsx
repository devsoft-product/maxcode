import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownToLine,
  Bot,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  FilePenLine,
  FilePlus2,
  FileSearch,
  FileText,
  FolderTree,
  GitBranch,
  Globe2,
  HardDrive,
  Info,
  Link2,
  LockKeyhole,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Terminal,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react'
import type { DeployProviderId, Effort, ModelInfo, ProviderId, SearchProvider, Skill, ToolName } from '../types'
import type { LucideIcon } from 'lucide-react'
import { EFFORT_LABELS, PROVIDERS, PROVIDER_MAP } from '../data/providers'
import { STARTER_SKILL } from '../data/skills'
import {
  DEFAULT_SYSTEM_PROMPT,
  activeModelId,
  providerHasCredentials,
  useSettings,
} from '../store/settings'
import { useActiveModel, useModelCatalog } from '../store/models'
import { useUi } from '../store/ui'
import { useChats, exportChats, importChats } from '../store/chats'
import { useWorkspace } from '../store/workspace'
import { stopAllRuns } from '../agent'
import { applySnapshot } from '../lib/boot'
import { executeDaemonTool, resetScope } from '../lib/daemon'
import { effortOptions, reasoningSummary } from '../lib/reasoning'
import { cn, formatBytes, readFileAsText } from '../lib/utils'
import { LogoMark } from './Logo'
import { PluginManager } from './PluginManager'
import { pluginRuntime } from '../plugins'
import { Modal, Segmented, Spinner, Switch } from './ui'

const TABS = [
  { id: 'models', label: 'Models', icon: Cpu, description: 'Providers, encrypted keys, live models and reasoning defaults.' },
  { id: 'tools', label: 'Tools', icon: Wrench, description: 'What MaxCode can do on this machine, and when it must ask.' },
  { id: 'search', label: 'Search', icon: Globe2, description: 'Give the agent current web results with your own key.' },
  { id: 'skills', label: 'Skills', icon: Sparkles, description: 'Instructions added to every request when enabled.' },
  { id: 'plugins', label: 'Plugins', icon: Package, description: 'Install local .pluginmax packages, review what they ask for, and run them once you trust the code.' },
  { id: 'deploy', label: 'Deploy', icon: Rocket, description: 'Hosting credentials and command-line tools.' },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and interface preferences.' },
  { id: 'about', label: 'About', icon: Info, description: 'Local storage, history and reset controls.' },
] as const

const fieldClass =
  'h-8 w-full rounded-lg border border-line bg-panel px-2.5 text-[12px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/50 disabled:opacity-50'

function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-medium text-ink">{children}</span>
      {hint && <span className="text-[9.5px] text-faint">{hint}</span>}
    </div>
  )
}

function SettingsSection({
  title,
  description,
  children,
  action,
}: {
  title: string
  description?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="border-b border-line px-5 py-5 last:border-b-0 sm:px-7">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
          {description && <p className="mt-1 max-w-[620px] text-[11px] leading-relaxed text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  )
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  label: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        className={cn(fieldClass, 'pr-8 font-mono text-[11px]')}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-faint hover:text-ink"
        aria-label={visible ? 'Hide secret' : 'Show secret'}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </div>
  )
}

const NO_MODELS: ModelInfo[] = []

function tokenLabel(value?: number) {
  if (!value) return ''
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

const KEY_FORMATS: Record<string, { prefix: string; label: string }> = {
  openrouter: { prefix: 'sk-or-', label: 'OpenRouter' },
  anthropic: { prefix: 'sk-ant-', label: 'Anthropic' },
  google: { prefix: 'AIza', label: 'Google' },
  groq: { prefix: 'gsk_', label: 'Groq' },
  xai: { prefix: 'xai-', label: 'xAI' },
}

function ProviderCard({
  providerId,
  open,
  onToggle,
}: {
  providerId: ProviderId
  open: boolean
  onToggle: () => void
}) {
  const settings = useSettings()
  const selectModel = useSettings((state) => state.selectModel)
  const updateProvider = useSettings((state) => state.updateProvider)
  const saveProviderKey = useSettings((state) => state.saveProviderKey)
  const notify = useUi((state) => state.notify)
  const askConfirm = useUi((state) => state.askConfirm)
  const fetchModels = useModelCatalog((state) => state.fetchModels)
  const models = useModelCatalog((state) => state.byProvider[providerId]) ?? NO_MODELS
  const loading = useModelCatalog((state) => Boolean(state.loading[providerId]))
  const error = useModelCatalog((state) => state.errors[providerId] ?? '')
  const note = useModelCatalog((state) => state.notes[providerId] ?? '')
  const source = useModelCatalog((state) => state.source[providerId] ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [manual, setManual] = useState('')
  const [saving, setSaving] = useState(false)

  const preset = PROVIDER_MAP[providerId]
  const status = settings.providerStatus.find((entry) => entry.id === providerId)
  const configured = providerHasCredentials(settings, providerId)
  const isActive = settings.provider === providerId
  const baseUrl = settings.providers[providerId]?.baseUrl ?? ''
  const keyHint = status?.hint ?? ''
  const activeModel = activeModelId(settings)
  const currentModel = models.find((model) => model.id === activeModel)

  useEffect(() => {
    if (!open || !configured) return
    const timer = window.setTimeout(() => void fetchModels(providerId), 400)
    return () => window.clearTimeout(timer)
  }, [open, configured, providerId, baseUrl, fetchModels])

  const saveKey = async () => {
    const key = keyDraft.trim()
    if (!key) {
      notify(`Paste a ${preset.name} API key first.`, 'error')
      return
    }
    const expected = KEY_FORMATS[providerId]
    if (expected && !key.startsWith(expected.prefix)) {
      let hint = ''
      if (providerId === 'openrouter' && key.startsWith('sk-')) {
        hint = ' (looks like a DeepSeek or OpenAI key). If you are using DeepSeek, please paste it under DeepSeek instead.'
      }
      notify(`A key for ${expected.label} must start with "${expected.prefix}"${hint}`, 'error')
      return
    }
    setSaving(true)
    try {
      await saveProviderKey(providerId, key)
      setKeyDraft('')
      notify(`${preset.name} key saved and encrypted.`, 'success')
      void fetchModels(providerId, true)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not save that key.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const clearKey = async () => {
    const confirmed = await askConfirm({
      title: `Remove the ${preset.name} key?`,
      body: 'The encrypted key is deleted from this computer. You can add it again at any time.',
      confirmLabel: 'Remove key',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await saveProviderKey(providerId, '')
      notify(`${preset.name} key removed.`, 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not remove that key.', 'error')
    }
  }

  const activate = async () => {
    if (models.length === 0) {
      const loaded = await fetchModels(providerId, true)
      if (loaded[0]) selectModel(providerId, loaded[0].id)
      else notify('No usable model was returned by this provider.', 'error')
      return
    }
    selectModel(providerId, models[0].id)
  }

  return (
    <div className={cn('rounded-xl border transition-colors', open ? 'border-line bg-raised/25' : 'border-line bg-panel')}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-panel font-display text-[12px] font-semibold text-muted">
          {preset.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-ink">{preset.name}</span>
            {isActive && (
              <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[8.5px] font-medium text-accent">Active</span>
            )}
          </span>
          <span
            className={cn(
              'mt-0.5 flex items-center gap-1 text-[9.5px]',
              configured ? 'text-success' : 'text-faint',
            )}
          >
            <span className={cn('h-1 w-1 rounded-full', configured ? 'bg-success' : 'bg-faint')} />
            {configured
              ? providerId === 'custom'
                ? 'Endpoint configured'
                : preset.keyless
                  ? 'No key needed'
                  : `Connected ${keyHint}`
              : preset.keyless
                ? 'Local endpoint'
                : 'No key'}
          </span>
        </span>
        {!open && (
          <span className="hidden max-w-[170px] truncate text-[9.5px] text-faint sm:block">
            {isActive && activeModel
              ? currentModel?.name ?? activeModel
              : models.length
                ? `${models.length} live models`
                : ''}
          </span>
        )}
        <ChevronDown size={14} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-line px-3 pb-3 pt-3">
          {!preset.keyless && (
            <div className="mb-2.5">
              <Label hint={configured ? 'Saved and encrypted' : 'Required'}>API key</Label>
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <PasswordInput
                    value={keyDraft}
                    onChange={setKeyDraft}
                    placeholder={configured ? `Replace key ${keyHint}` : preset.keyHint}
                    label={`${preset.name} API key`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void saveKey()}
                  disabled={!keyDraft.trim() || saving}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-ink px-2.5 text-[10px] font-medium text-panel disabled:opacity-40"
                >
                  {saving ? <Spinner size={10} /> : <LockKeyhole size={10} />}
                  Save
                </button>
              </div>
              {configured && (
                <button
                  type="button"
                  onClick={() => void clearKey()}
                  className="mt-1.5 text-[9.5px] font-medium text-faint transition-colors hover:text-danger"
                >
                  Remove saved key
                </button>
              )}
            </div>
          )}

          <div className="mb-2.5">
            <Label hint={providerId === 'custom' ? 'Required' : 'Optional'}>Base URL</Label>
            <input
              value={baseUrl}
              onChange={(event) => updateProvider(providerId, { baseUrl: event.target.value })}
              placeholder={preset.baseUrl || 'https://example.com/v1'}
              spellCheck={false}
              className={cn(fieldClass, 'font-mono text-[11px]')}
            />
            <p className="mt-1 text-[9px] leading-relaxed text-faint">
              {providerId === 'custom'
                ? 'Point this at an OpenAI-compatible endpoint or proxy you control.'
                : `Leave blank for ${preset.baseUrl || 'the provider default'}. Useful for a gateway or local proxy.`}
            </p>
          </div>

          {preset.note && <p className="mb-2.5 text-[9.5px] leading-relaxed text-faint">{preset.note}</p>}

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-ink">Model</span>
              <button
                type="button"
                onClick={() => void fetchModels(providerId, true)}
                disabled={!configured || loading}
                className="inline-flex items-center gap-1 text-[9.5px] font-medium text-faint transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? <Spinner size={10} /> : <RefreshCw size={10} />}
                {loading ? 'Loading' : 'Refresh live models'}
              </button>
            </div>

            {error && (
              <p className="mb-1.5 rounded-md border border-danger/20 bg-danger/[0.04] px-2 py-1.5 text-[9.5px] leading-relaxed text-danger">
                {error}
              </p>
            )}
            {note && !error && <p className="mb-1.5 text-[9px] leading-relaxed text-faint">{note}</p>}

            {models.length > 0 ? (
              <>
                <select
                  value={isActive ? activeModel : ''}
                  onChange={(event) => {
                    if (event.target.value) selectModel(providerId, event.target.value)
                  }}
                  className={cn(fieldClass, 'font-mono text-[11px]')}
                  aria-label={`${preset.name} model`}
                >
                  <option value="">Choose a model…</option>
                  {isActive && activeModel && !models.some((model) => model.id === activeModel) && (
                    <option value={activeModel}>{activeModel} (not listed)</option>
                  )}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name || model.id}
                      {model.context ? ` · ${tokenLabel(model.context)} ctx` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[9px] text-faint">
                  {models.length} usable chat model{models.length === 1 ? '' : 's'}
                  {source === 'catalog' ? ' from the models.dev fallback' : ' loaded live from the provider'}.
                </p>
              </>
            ) : (
              <p className="text-[9.5px] leading-relaxed text-faint">
                {loading
                  ? 'Loading the provider’s current models…'
                  : !configured
                    ? providerId === 'custom'
                      ? 'Set a base URL, then refresh.'
                      : preset.keyless
                        ? 'Start the local server, then refresh.'
                        : 'Add a key to load the provider’s current models.'
                    : 'No usable models were returned. You can still enter an exact model ID.'}
              </p>
            )}

            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                placeholder="or enter a model ID"
                spellCheck={false}
                aria-label={`${preset.name} model ID`}
                className={cn(fieldClass, 'font-mono text-[10.5px]')}
              />
              <button
                type="button"
                onClick={() => {
                  const id = manual.trim()
                  if (!id) return
                  selectModel(providerId, id)
                  setManual('')
                }}
                disabled={!manual.trim()}
                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-line px-2.5 text-[10px] font-medium text-ink disabled:opacity-40"
              >
                Use ID
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <p className="text-[9px] leading-relaxed text-faint">
              {preset.keyless
                ? 'No key is stored for this provider.'
                : configured
                  ? 'The daemon decrypts the key only when it calls the provider.'
                  : 'The key never enters the page after saving.'}
            </p>
            {configured && !isActive && (
              <button
                type="button"
                onClick={() => void activate()}
                className="shrink-0 text-[9.5px] font-medium text-accent hover:underline"
              >
                Use {preset.name}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ModelsTab() {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const refreshProviders = useSettings((state) => state.refreshProviders)
  const [expanded, setExpanded] = useState<ProviderId | null>(settings.provider)
  const [refreshing, setRefreshing] = useState(false)
  const active = useActiveModel()
  const efforts = effortOptions(active)
  const chosenEffort = efforts.includes(settings.effort) ? settings.effort : efforts[0]

  return (
    <>
      <SettingsSection
        title="Providers"
        description="Keys and base URLs are stored by the local daemon. Model lists are fetched live from the provider; the bundled catalog is only a fallback when the provider list cannot be reached."
        action={
          <button
            type="button"
            onClick={async () => {
              setRefreshing(true)
              try {
                await refreshProviders()
              } catch (cause) {
                useUi.getState().notify(cause instanceof Error ? cause.message : 'Could not refresh providers.', 'error')
              } finally {
                setRefreshing(false)
              }
            }}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[10px] font-medium text-muted hover:text-ink"
          >
            {refreshing ? <Spinner size={10} /> : <RefreshCw size={10} />}
            Refresh
          </button>
        }
      >
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-raised/50 px-3 py-2.5">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
          <p className="text-[10.5px] leading-relaxed text-muted">
            Keys are encrypted with AES-256-GCM under <code className="font-mono text-[10px]">~/.maxcode</code>. The
            browser only receives a masked hint; the daemon decrypts a key in memory for the provider request.
          </p>
        </div>
        <div className="space-y-2">
          {PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider.id}
              providerId={provider.id}
              open={expanded === provider.id}
              onToggle={() => setExpanded(expanded === provider.id ? null : provider.id)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Reasoning defaults"
        description="Only controls advertised by the live model are offered; an unsupported field is never sent."
      >
        {active ? (
          <div className="space-y-2.5">
            {efforts.length > 0 ? (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-raised/30 px-3 py-2.5">
                <div>
                  <p className="text-[11.5px] font-medium text-ink">Effort</p>
                  <p className="mt-0.5 text-[9.5px] text-faint">
                    Options come from {active.name || active.id} · {active.apiKind}
                  </p>
                </div>
                <select
                  value={chosenEffort}
                  onChange={(event) => update({ effort: event.target.value as Effort })}
                  className="h-8 rounded-lg border border-line bg-panel px-2 text-[11px] text-ink outline-none"
                  aria-label="Reasoning effort"
                >
                  {efforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {EFFORT_LABELS[effort].label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="rounded-lg border border-line bg-raised/30 px-3 py-2.5 text-[10px] leading-relaxed text-faint">
                {reasoningSummary(active)}
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-raised/30 px-3 py-3 text-[10.5px] leading-relaxed text-faint">
            Choose a model in the composer to see the reasoning controls this provider actually advertises.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Advanced request settings"
        description="Defaults for every provider. The adapter ignores fields the selected model cannot accept."
      >
        <details className="group/advanced rounded-xl border border-line bg-raised/20">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[11.5px] font-medium text-ink [&::-webkit-details-marker]:hidden">
            Request controls and system prompt
            <ChevronDown size={13} className="text-faint transition-transform group-open/advanced:rotate-180" />
          </summary>
          <div className="border-t border-line px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label hint="0 – 2">Temperature</Label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settings.temperature}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) update({ temperature: Math.min(2, Math.max(0, value)) })
                  }}
                  className={fieldClass}
                />
              </div>
              <div>
                <Label hint="256 – 200,000">Max output tokens</Label>
                <input
                  type="number"
                  min={256}
                  max={200000}
                  step={256}
                  value={settings.maxTokens}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      update({ maxTokens: Math.min(200000, Math.max(256, Math.round(value))) })
                    }
                  }}
                  className={fieldClass}
                />
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium text-ink">System prompt</span>
                <button
                  type="button"
                  onClick={() => update({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}
                  className="inline-flex items-center gap-1 text-[9.5px] font-medium text-faint hover:text-ink"
                >
                  <RotateCcw size={10} /> Restore default
                </button>
              </div>
              <textarea
                value={settings.systemPrompt}
                onChange={(event) => update({ systemPrompt: event.target.value })}
                rows={9}
                spellCheck={false}
                className="thin-scroll w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-ink outline-none focus:border-accent/50"
              />
              <p className="mt-1 text-[9px] leading-relaxed text-faint">
                Enabled skill instructions and the current workspace/git context are appended after this prompt.
              </p>
            </div>
          </div>
        </details>
      </SettingsSection>
    </>
  )
}

const TOOL_ORDER: Array<{ title: string; tools: ToolName[] }> = [
  {
    title: 'Workspace and shell',
    tools: ['read_file', 'list_files', 'grep', 'write_file', 'edit_file', 'rewrite_file', 'shell', 'git'],
  },
  { title: 'Web', tools: ['web_search', 'read_url'] },
  { title: 'Delegation', tools: ['subagent'] },
]

const TOOL_ICONS: Record<ToolName, LucideIcon> = {
  shell: SquareTerminal,
  read_file: FileText,
  list_files: FolderTree,
  write_file: FilePlus2,
  edit_file: FilePenLine,
  rewrite_file: FilePenLine,
  grep: FileSearch,
  web_search: Globe2,
  read_url: Link2,
  git: GitBranch,
  subagent: Bot,
}

const TOOL_COPY: Record<ToolName, { label: string; description: string }> = {
  shell: { label: 'Shell', description: 'Run commands in the workspace root. Plan mode allows read-only commands only.' },
  read_file: { label: 'Read file', description: 'Inspect a file on disk before changing it.' },
  list_files: { label: 'List files', description: 'Explore the real workspace tree.' },
  write_file: { label: 'Write file', description: 'Create a file or replace its complete contents.' },
  edit_file: { label: 'Edit file', description: 'Replace an exact passage in a file.' },
  rewrite_file: { label: 'Rewrite file', description: 'Replace the entire content of an existing file.' },
  grep: { label: 'Grep', description: 'Search file contents with a regular expression.' },
  web_search: { label: 'Web search', description: 'Find current pages and cite the sources.' },
  read_url: { label: 'Read URL', description: 'Open a public http(s) page as plain text.' },
  git: { label: 'Git', description: 'Inspect or change repository state. Plan mode is read-only.' },
  subagent: { label: 'Subagent', description: 'Delegate a read-only investigation and return a concise report.' },
}

function ToolsTab() {
  const settings = useSettings()
  const updateTool = useSettings((state) => state.updateTool)
  const openSettings = useUi((state) => state.openSettings)

  return (
    <SettingsSection
      title="Tool permissions"
      description="Ask adds an approval card to the conversation. Auto runs immediately. Disabled tools are not sent to the model at all. Plan mode always hides write tools."
    >
      <div className="space-y-5">
        {TOOL_ORDER.map((group) => (
          <div key={group.title}>
            <p className="mb-2 text-[10px] font-medium text-faint">{group.title}</p>
            <div className="overflow-hidden rounded-xl border border-line">
              {group.tools.map((tool, index) => {
                const config = settings.tools[tool]
                const Icon = TOOL_ICONS[tool]
                const copy = TOOL_COPY[tool]
                return (
                  <div
                    key={tool}
                    className={cn(
                      'flex flex-col gap-2.5 px-3 py-3 sm:flex-row sm:items-center',
                      index !== 0 && 'border-t border-line',
                      !config.enabled && 'opacity-60',
                    )}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-muted">
                      <Icon size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[11.5px] font-medium text-ink">{copy.label}</p>
                        <span className="font-mono text-[8.5px] text-faint">{tool}</span>
                      </div>
                      <p className="mt-0.5 text-[9.5px] leading-relaxed text-muted">{copy.description}</p>
                      {group.title === 'Web' && !settings.webSearchEnabled && (
                        <button
                          type="button"
                          onClick={() => openSettings('search')}
                          className="mt-1 text-[9.5px] font-medium text-warning hover:underline"
                        >
                          Web access is off. Turn it on in Search.
                        </button>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pl-9 sm:pl-0">
                      {config.enabled && (
                        <Segmented<'auto' | 'ask'>
                          value={config.approval}
                          onChange={(approval) => updateTool(tool, { approval })}
                          options={[
                            { value: 'auto', label: 'Auto', title: 'Run without asking' },
                            { value: 'ask', label: 'Ask', title: 'Ask before running' },
                          ]}
                        />
                      )}
                      <Switch
                        checked={config.enabled}
                        onChange={(enabled) => updateTool(tool, { enabled })}
                        label={`Enable ${copy.label}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-line bg-raised/40 px-3 py-2.5 text-[9.5px] leading-relaxed text-faint">
        <ShieldCheck size={11} className="mt-0.5 shrink-0" />
        Shell and Git approval are on by default. Approvals apply to the open workspace only; the daemon rejects paths
        outside it with <code className="font-mono">..</code> or absolute escapes.
      </div>
    </SettingsSection>
  )
}

const SEARCH_OPTIONS: Array<{ id: SearchProvider; name: string; description: string; keyless?: boolean }> = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    description: 'No key. HTML results with a Wikipedia fallback; coverage is limited.',
    keyless: true,
  },
  { id: 'tavily', name: 'Tavily', description: 'Built for AI agents. Search in, clean results out.' },
  { id: 'brave', name: 'Brave Search', description: 'Independent web index with a free tier.' },
  { id: 'serper', name: 'Serper', description: 'Google results through a simple API.' },
]

function SearchTab() {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const saveSearchKey = useSettings((state) => state.saveSearchKey)
  const notify = useUi((state) => state.notify)
  const [keyDraft, setKeyDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const searchSecret = settings.secretStatus?.search
  const keyless = settings.searchProvider === 'duckduckgo'
  const configured = Boolean(searchSecret?.configured)

  const save = async () => {
    if (!keyDraft.trim()) {
      notify('Paste a search API key first.', 'error')
      return
    }
    setSaving(true)
    try {
      await saveSearchKey(keyDraft.trim())
      setKeyDraft('')
      setTestResult(null)
      notify('Search key saved and encrypted.', 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not save that key.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    try {
      await saveSearchKey('')
      setTestResult(null)
      notify('Search key removed.', 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not remove that key.', 'error')
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await executeDaemonTool(
        'web_search',
        { query: 'MaxCode local coding agent', provider: settings.searchProvider },
        'build',
      )
      const result = response.result && typeof response.result === 'object' ? (response.result as Record<string, unknown>) : {}
      const results = Array.isArray(result.results) ? result.results : []
      setTestResult({
        ok: results.length > 0,
        message:
          results.length > 0
            ? `${results.length} results via ${String(result.provider ?? settings.searchProvider)}.`
            : 'No results were returned. Try another provider or query.',
      })
    } catch (cause) {
      setTestResult({ ok: false, message: cause instanceof Error ? cause.message : 'Search failed.' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <SettingsSection
        title="Web access"
        description="When enabled, the agent may search and read public pages. The daemon performs the requests; this page never sees the raw results."
      >
        <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-raised/30 px-3 py-2.5">
          <div>
            <p className="text-[11.5px] font-medium text-ink">Allow web tools</p>
            <p className="mt-0.5 text-[9.5px] text-faint">
              Adds web_search and read_url when they are also enabled under Tools.
            </p>
          </div>
          <Switch
            checked={settings.webSearchEnabled}
            onChange={(webSearchEnabled) => update({ webSearchEnabled })}
            label="Allow web tools"
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Search provider" description="Choose where current results come from. A key is encrypted by the daemon.">
        <div className="grid gap-2 sm:grid-cols-2">
          {SEARCH_OPTIONS.map((option) => {
            const selected = settings.searchProvider === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  update({ searchProvider: option.id })
                  setTestResult(null)
                }}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  selected ? 'border-accent/35 bg-accent-soft/40' : 'border-line bg-panel hover:bg-raised/40',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-medium text-ink">{option.name}</span>
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 items-center justify-center rounded-full border',
                      selected ? 'border-accent bg-accent text-on-accent' : 'border-line',
                    )}
                  >
                    {selected && <Check size={8} strokeWidth={3} />}
                  </span>
                </span>
                <span className="mt-1 block text-[9.5px] leading-relaxed text-muted">{option.description}</span>
                {option.keyless && (
                  <span className="mt-1.5 inline-block rounded bg-raised px-1.5 py-0.5 text-[8.5px] font-medium text-faint">
                    No key
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {!keyless && (
          <div className="mt-3">
            <Label hint={configured ? `Saved ${searchSecret?.hint ?? ''}` : 'Required'}>
              {settings.searchProvider === 'tavily'
                ? 'Tavily API key'
                : settings.searchProvider === 'brave'
                  ? 'Brave Search API key'
                  : 'Serper API key'}
            </Label>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <PasswordInput
                  value={keyDraft}
                  onChange={setKeyDraft}
                  placeholder={
                    settings.searchProvider === 'tavily' ? 'tvly-…' : settings.searchProvider === 'brave' ? 'BSA…' : '…'
                  }
                  label="Search API key"
                />
              </div>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!keyDraft.trim() || saving}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-ink px-2.5 text-[10px] font-medium text-panel disabled:opacity-40"
              >
                {saving ? <Spinner size={10} /> : <LockKeyhole size={10} />}
                Save
              </button>
            </div>
            {configured && (
              <button
                type="button"
                onClick={() => void clear()}
                className="mt-1.5 text-[9.5px] font-medium text-faint hover:text-danger"
              >
                Remove saved key
              </button>
            )}
            <p className="mt-1 text-[9px] leading-relaxed text-faint">
              One key is stored. If you switch providers, replace the key with one issued by the new provider.
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing || (!keyless && !configured)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[10.5px] font-medium text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
          >
            {testing ? <Spinner size={12} /> : <Search size={12} />}
            {testing ? 'Testing…' : 'Test search'}
          </button>
          {!keyless && !configured && <span className="text-[9.5px] text-faint">Add a key to test.</span>}
        </div>

        {testResult && (
          <div
            className={cn(
              'mt-2.5 rounded-lg border px-3 py-2 text-[10px] leading-relaxed',
              testResult.ok
                ? 'border-success/25 bg-success/[0.04] text-success'
                : 'border-warning/30 bg-warning/[0.04] text-warning',
            )}
          >
            {testResult.message}
          </div>
        )}
      </SettingsSection>
    </>
  )
}

interface SkillDraft {
  id?: string
  name: string
  description: string
  instructions: string
}

function newSkillId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `skill_${crypto.randomUUID()}` : `skill_${Date.now()}`
}

function SkillsTab() {
  const settings = useSettings()
  const addSkill = useSettings((state) => state.addSkill)
  const updateSkill = useSettings((state) => state.updateSkill)
  const removeSkill = useSettings((state) => state.removeSkill)
  const askConfirm = useUi((state) => state.askConfirm)
  const notify = useUi((state) => state.notify)
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const active = settings.skills.filter((skill) => skill.enabled).length

  const loadFile = async (file: File) => {
    try {
      const text = await readFileAsText(file)
      const heading = /^#\s+(.+)$/m.exec(text)
      const name = heading?.[1]?.trim() || file.name.replace(/\.[^.]+$/, '')
      const body = heading ? text.replace(heading[0], '').trim() : text.trim()
      const paragraph = body.split(/\n\s*\n/).find((part) => part.trim() && !part.trim().startsWith('#'))
      setDraft({
        name,
        description: (paragraph ?? '').replace(/[#>*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180),
        instructions: text.trim(),
      })
      notify(`Loaded ${file.name}. Review it, then save the skill.`, 'info')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not read that skill.', 'error')
    }
  }

  const save = () => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      notify('Give the skill a name.', 'error')
      return
    }
    if (!draft.instructions.trim()) {
      notify('Add instructions for the skill.', 'error')
      return
    }
    if (draft.id) {
      updateSkill(draft.id, {
        name,
        description: draft.description.trim(),
        instructions: draft.instructions.trim(),
      })
      notify('Skill updated.', 'success')
    } else {
      addSkill({
        id: newSkillId(),
        name,
        description: draft.description.trim() || 'Custom skill',
        instructions: draft.instructions.trim(),
        enabled: true,
      })
      notify('Skill saved and enabled.', 'success')
    }
    setDraft(null)
  }

  const remove = async (skill: Skill) => {
    const confirmed = await askConfirm({
      title: 'Delete this skill?',
      body: `“${skill.name}” will be removed from this computer.`,
      confirmLabel: 'Delete skill',
      tone: 'danger',
    })
    if (confirmed) removeSkill(skill.id)
  }

  return (
    <SettingsSection
      title="Loaded skills"
      description={`${active} of ${settings.skills.length} enabled. Enabled instructions are appended to the system prompt for every request.`}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDraft({ name: '', description: '', instructions: '' })}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[10.5px] font-medium text-panel"
        >
          <Plus size={12} /> New skill
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[10.5px] font-medium text-ink hover:bg-raised"
        >
          <Upload size={12} /> Load skill file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void loadFile(file)
            event.target.value = ''
          }}
        />
      </div>

      {draft && (
        <div className="mb-3 rounded-xl border border-accent/30 bg-accent-soft/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-medium text-ink">{draft.id ? 'Edit skill' : 'Load a skill'}</p>
            <button type="button" className="icon-button h-6 w-6" onClick={() => setDraft(null)} aria-label="Close editor">
              <X size={12} />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="API contract reviewer"
                className={fieldClass}
                autoFocus
              />
            </div>
            <div>
              <Label hint="Shown in the skills list">Description</Label>
              <input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Checks a diff against an API contract"
                className={fieldClass}
              />
            </div>
          </div>
          <div className="mt-2">
            <Label hint="Markdown">Instructions</Label>
            <textarea
              value={draft.instructions}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              placeholder={STARTER_SKILL}
              rows={8}
              className="thin-scroll w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-ink outline-none focus:border-accent/50"
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="chip h-7 text-[10.5px]" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-accent px-2.5 text-[10.5px] font-medium text-on-accent hover:bg-accent/90"
            >
              <Check size={11} /> Save skill
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line">
        {settings.skills.map((skill, index) => (
          <div key={skill.id} className={cn('px-3 py-3', index !== 0 && 'border-t border-line')}>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Sparkles size={11} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[11.5px] font-medium text-ink">{skill.name}</p>
                  {skill.builtIn && (
                    <span className="rounded bg-raised px-1.5 py-0.5 text-[8px] font-medium text-faint">Built-in</span>
                  )}
                  <span className={cn('text-[8.5px]', skill.enabled ? 'text-success' : 'text-faint')}>
                    {skill.enabled ? 'Enabled' : 'Off'}
                  </span>
                </div>
                <p className="mt-0.5 text-[9.5px] leading-relaxed text-muted">{skill.description}</p>
                <details className="group/skill mt-1">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[9px] font-medium text-faint hover:text-muted [&::-webkit-details-marker]:hidden">
                    View instructions
                    <ChevronDown size={9} className="transition-transform group-open/skill:rotate-180" />
                  </summary>
                  <pre className="thin-scroll mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-raised/40 p-2 font-mono text-[9.5px] leading-relaxed text-muted">
                    {skill.instructions}
                  </pre>
                </details>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!skill.builtIn && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          id: skill.id,
                          name: skill.name,
                          description: skill.description,
                          instructions: skill.instructions,
                        })
                      }
                      className="icon-button h-7 w-7"
                      aria-label={`Edit ${skill.name}`}
                      title="Edit skill"
                    >
                      <FilePenLine size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(skill)}
                      className="icon-button h-7 w-7 hover:text-danger"
                      aria-label={`Delete ${skill.name}`}
                      title="Delete skill"
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
                <Switch
                  checked={skill.enabled}
                  onChange={(enabled) => updateSkill(skill.id, { enabled })}
                  label={`Enable ${skill.name}`}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

const DEPLOY_META: Record<
  DeployProviderId,
  {
    label: string
    short: string
    icon: LucideIcon
    description: string
    fields: Array<{ key: string; label: string; secret: boolean; hint: string; placeholder: string }>
  }
> = {
  cloudflare: {
    label: 'Cloudflare Pages',
    short: 'Cloudflare',
    icon: Cloud,
    description: 'API token + account id. Create a token with the Cloudflare Pages edit permission.',
    fields: [
      { key: 'apiToken', label: 'API token', secret: true, hint: 'Required', placeholder: 'Cloudflare API token' },
      { key: 'accountId', label: 'Account ID', secret: false, hint: 'Required', placeholder: 'a1b2c3…' },
    ],
  },
  netlify: {
    label: 'Netlify',
    short: 'Netlify',
    icon: Globe2,
    description: 'Personal access token. A new site is created when no site id is set.',
    fields: [
      { key: 'authToken', label: 'Personal access token', secret: true, hint: 'Required', placeholder: 'nfp_…' },
      { key: 'siteId', label: 'Site ID', secret: false, hint: 'Optional', placeholder: 'Existing site id' },
    ],
  },
  vercel: {
    label: 'Vercel',
    short: 'Vercel',
    icon: Cloud,
    description: 'Access token. The CLI deploys a new production build through npx when needed.',
    fields: [
      { key: 'token', label: 'Access token', secret: true, hint: 'Required', placeholder: 'vercel token' },
      { key: 'teamId', label: 'Team / scope ID', secret: false, hint: 'Optional', placeholder: 'team_…' },
    ],
  },
}

function DeployCredentialCard({ providerId }: { providerId: DeployProviderId }) {
  const meta = DEPLOY_META[providerId]
  const secret = useSettings((state) => state.deploySecrets?.[providerId])
  const tool = useSettings((state) => state.deployTools?.[providerId])
  const save = useSettings((state) => state.saveDeployCredentials)
  const notify = useUi((state) => state.notify)
  const askConfirm = useUi((state) => state.askConfirm)
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [secretDraft, setSecretDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const nonSecret = meta.fields.filter((field) => !field.secret)
  const secretField = meta.fields.find((field) => field.secret)

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const field of nonSecret) next[field.key] = secret?.fields?.[field.key] ?? ''
    setDrafts(next)
  }, [secret, nonSecret.length])

  const saveCreds = async () => {
    setSaving(true)
    try {
      const payload: Record<string, string> = { ...drafts }
      if (secretDraft.trim() && secretField) payload[secretField.key] = secretDraft.trim()
      await save(providerId, payload)
      setSecretDraft('')
      notify(`${meta.label} credentials saved and encrypted.`, 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not save those credentials.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const clearCreds = async () => {
    const confirmed = await askConfirm({
      title: `Remove ${meta.label} credentials?`,
      body: 'The encrypted token and ids are deleted from this computer. Deployments for this host will stop until you add them again.',
      confirmLabel: 'Remove credentials',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      const payload: Record<string, string> = {}
      for (const field of meta.fields) payload[field.key] = ''
      await save(providerId, payload)
      setSecretDraft('')
      notify(`${meta.label} credentials removed.`, 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not remove those credentials.', 'error')
    }
  }

  const Icon = meta.icon

  return (
    <div className="rounded-xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-raised/60 text-muted">
          <Icon size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[11.5px] font-medium text-ink">{meta.label}</span>
            {secret?.configured ? (
              <span className="flex items-center gap-1 text-[9px] text-success">
                <span className="h-1 w-1 rounded-full bg-success" /> configured
              </span>
            ) : (
              <span className="text-[9px] text-faint">not configured</span>
            )}
          </span>
          <span className="mt-0.5 block text-[9px] text-faint">
            {tool?.installed ? `${tool.label} ${tool.version || 'installed'}` : 'Uses npx on deploy'}
            {secret?.hint ? ` · token ${secret.hint}` : ''}
          </span>
        </span>
        <ChevronDown size={13} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line px-3 py-3">
          <p className="mb-2.5 text-[9.5px] leading-relaxed text-faint">{meta.description}</p>
          {secretField && (
            <div className="mb-2.5">
              <Label hint={secret?.configured ? 'Saved; leave blank to keep' : 'Required'}>{secretField.label}</Label>
              <PasswordInput
                value={secretDraft}
                onChange={setSecretDraft}
                placeholder={secret?.configured ? `Replace token ${secret.hint}` : secretField.placeholder}
                label={`${meta.label} ${secretField.label}`}
              />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {nonSecret.map((field) => (
              <div key={field.key}>
                <Label hint={field.hint}>{field.label}</Label>
                <input
                  value={drafts[field.key] ?? ''}
                  onChange={(event) => setDrafts((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  spellCheck={false}
                  className={cn(fieldClass, 'font-mono text-[10.5px]')}
                />
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            {secret?.configured ? (
              <button
                type="button"
                onClick={() => void clearCreds()}
                className="text-[9.5px] font-medium text-faint hover:text-danger"
              >
                Remove credentials
              </button>
            ) : (
              <span className="text-[9px] text-faint">Values are encrypted at rest.</span>
            )}
            <button
              type="button"
              onClick={() => void saveCreds()}
              disabled={saving}
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-ink px-2.5 text-[10px] font-medium text-panel disabled:opacity-40"
            >
              {saving ? <Spinner size={10} /> : <Check size={10} />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DeployTab() {
  const deployTools = useSettings((state) => state.deployTools)
  const secretsError = useSettings((state) => state.secretsError)

  return (
    <>
      <SettingsSection
        title="Hosting credentials"
        description="Tokens are encrypted by the local daemon and passed to the deploy CLI through environment variables. They are never written to logs or returned to this page."
      >
        {secretsError && (
          <p className="mb-3 rounded-lg border border-warning/30 bg-warning/[0.04] px-3 py-2 text-[10px] text-warning">
            {secretsError}
          </p>
        )}
        <div className="space-y-2">
          {(Object.keys(DEPLOY_META) as DeployProviderId[]).map((provider) => (
            <DeployCredentialCard key={provider} providerId={provider} />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Command-line tools"
        description="MaxCode uses an installed CLI when available and falls back to npx. Node.js must be on PATH."
      >
        <div className="overflow-hidden rounded-xl border border-line">
          {(Object.keys(DEPLOY_META) as DeployProviderId[]).map((provider, index) => {
            const tool = deployTools?.[provider]
            const meta = DEPLOY_META[provider]
            return (
              <div
                key={provider}
                className={cn('flex items-center gap-3 px-3 py-2.5', index !== 0 && 'border-t border-line')}
              >
                <Terminal size={13} className="shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-ink">{meta.short}</p>
                  <p className="truncate font-mono text-[9px] text-faint">
                    {tool?.bin ?? '—'} {tool?.installed ? `· ${tool.version || 'installed'}` : '· not installed, uses npx'}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-1.5 py-0.5 text-[8.5px] font-medium',
                    tool?.installed ? 'border-success/25 text-success' : 'border-line text-faint',
                  )}
                >
                  {tool?.installed ? 'installed' : 'npx fallback'}
                </span>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => useUi.getState().setDeployOpen(true)}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[10.5px] font-medium text-on-accent hover:bg-accent/90"
        >
          <Rocket size={12} /> Open deploy panel
        </button>
      </SettingsSection>
    </>
  )
}

function PluginsTab() {
  return (
    <SettingsSection
      title="Local plugins"
      description="MaxCode only installs .pluginmax files you choose from this machine. A plugin stays sandboxed and disabled until you review its permissions and mark it Safe."
    >
      <PluginManager />
    </SettingsSection>
  )
}

function AppearanceTab() {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const themes = [
    { id: 'light' as const, label: 'Light', className: 'bg-[#fcfcfc]', line: 'bg-[#e2e2e5]' },
    { id: 'dark' as const, label: 'Dark', className: 'bg-[#09090b]', line: 'bg-[#2a2a31]' },
    { id: 'night-owl' as const, label: 'Night Owl', className: 'bg-[#011627]', line: 'bg-[#1a3e5a]' },
    { id: 'claude-code' as const, label: 'Claude Code', className: 'bg-[#262624]', line: 'bg-[#42423e]' },
    { id: 'flame' as const, label: 'Flame', className: 'bg-[#130d0c]', line: 'bg-[#3e2621]' },
    {
      id: 'system' as const,
      label: 'System',
      className: 'bg-gradient-to-br from-[#fcfcfc] to-[#09090b]',
      line: 'bg-[#8a8a92]',
    },
    // Themes contributed by Safe plugins.
    ...pluginRuntime().themes().map((theme) => ({
      id: theme.id,
      label: theme.label,
      className: 'bg-gradient-to-br from-accent-soft to-panel',
      line: 'bg-line',
    })),
  ]

  return (
    <>
      <SettingsSection title="Theme" description="System follows your OS preference and updates when it changes.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {themes.map((theme) => {
            const selected = settings.theme === theme.id
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => update({ theme: theme.id })}
                className={cn(
                  'rounded-xl border p-2 text-left transition-all',
                  selected ? 'border-accent ring-2 ring-accent/10' : 'border-line hover:border-faint/50',
                )}
              >
                <span className={cn('block h-14 w-full overflow-hidden rounded-lg border border-line/60 p-2', theme.className)}>
                  <span className={cn('block h-1.5 w-8 rounded-full', theme.line)} />
                  <span className={cn('mt-1.5 block h-1.5 w-12 rounded-full opacity-60', theme.line)} />
                  <span className="mt-3 block h-2 w-5 rounded-full bg-accent" />
                </span>
                <span className="mt-1.5 flex items-center justify-between px-0.5">
                  <span className="text-[10.5px] font-medium text-ink">{theme.label}</span>
                  {selected && <Check size={11} className="text-accent" />}
                </span>
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Interface">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-raised/30 px-3 py-2.5">
          <div>
            <p className="text-[11.5px] font-medium text-ink">Show token estimates</p>
            <p className="mt-0.5 text-[9.5px] text-faint">
              When a provider does not report usage, show a rough output estimate.
            </p>
          </div>
          <Switch
            checked={settings.showTokenEstimate}
            onChange={(showTokenEstimate) => update({ showTokenEstimate })}
            label="Show token estimates"
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Shortcuts">
        <div className="space-y-1.5 text-[10.5px]">
          {[
            ['Search and commands', '⌘ K / Ctrl K'],
            ['Send message', 'Enter'],
            ['New line', 'Shift Enter'],
            ['Save file in the editor', '⌘ S / Ctrl S'],
          ].map(([label, shortcut]) => (
            <div key={label} className="flex items-center justify-between rounded-lg px-1 py-1">
              <span className="text-muted">{label}</span>
              <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-sans text-[9.5px] text-faint">
                {shortcut}
              </kbd>
            </div>
          ))}
        </div>
      </SettingsSection>
    </>
  )
}

function AboutTab() {
  const sessions = useChats((state) => state.sessions)
  const daemon = useSettings((state) => state.daemon)
  const secretStatus = useSettings((state) => state.secretStatus)
  const entries = useWorkspace((state) => state.entries)
  const workspace = useWorkspace((state) => state.info)
  const askConfirm = useUi((state) => state.askConfirm)
  const notify = useUi((state) => state.notify)
  const importRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const messageCount = sessions.reduce((sum, session) => sum + session.messages.length, 0)
  const fileCount = entries.filter((entry) => entry.type === 'file').length

  const runReset = async (scope: 'history' | 'settings' | 'all', copy: { title: string; body: string; label: string }) => {
    const confirmed = await askConfirm({ ...copy, tone: 'danger', confirmLabel: copy.label })
    if (!confirmed) return
    setBusy(scope)
    try {
      stopAllRuns()
      const snapshot = await resetScope(scope)
      await applySnapshot(snapshot)
      notify(
        scope === 'history'
          ? 'Conversation history cleared.'
          : scope === 'settings'
            ? 'Settings restored to defaults.'
            : 'MaxCode was reset.',
        'success',
      )
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not reset that data.', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <SettingsSection title="About">
        <div className="flex items-start gap-3.5">
          <LogoMark size={46} />
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-display text-[20px] font-semibold tracking-[-0.03em] text-ink">MaxCode</h3>
              <span className="text-[10px] text-faint">v{daemon?.version ?? '1.0.0'}</span>
            </div>
            <p className="mt-0.5 text-[10.5px] font-medium text-muted">A DevSoft product</p>
            <p className="mt-2 max-w-[520px] text-[10.5px] leading-relaxed text-muted">
              A local-first coding agent with a real workspace, shell, git, web research, subagents and deploy flows.
              No MaxCode account and no DevSoft server. Your keys never leave this machine.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ['Conversations', String(sessions.length)],
            ['Messages', String(messageCount)],
            ['Workspace files', workspace.available ? String(fileCount) : 'None'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-raised/30 px-3 py-2">
              <p className="text-[9px] text-faint">{label}</p>
              <p className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-ink">{value}</p>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Local data" description="Everything is stored under ~/.maxcode. Clearing that folder removes MaxCode’s local state.">
        <div className="space-y-1.5 rounded-lg border border-line bg-raised/30 px-3 py-2.5 text-[10px]">
          <p className="flex items-center justify-between gap-3">
            <span className="text-faint">Data folder</span>
            <span className="min-w-0 truncate font-mono text-ink" title={daemon?.dataDir}>
              {daemon?.dataDir ?? '~/.maxcode'}
            </span>
          </p>
          <p className="flex items-center justify-between gap-3">
            <span className="text-faint">Encryption</span>
            <span className="text-muted">{secretStatus?.encryption ?? 'AES-256-GCM'}</span>
          </p>
          <p className="flex items-center justify-between gap-3">
            <span className="text-faint">Runtime</span>
            <span className="truncate text-muted">
              {daemon?.platform ?? '—'} · Node {daemon?.node ?? '—'}
            </span>
          </p>
          <p className="flex items-center justify-between gap-3">
            <span className="text-faint">Workspace</span>
            <span className="min-w-0 truncate font-mono text-muted" title={workspace.root}>
              {workspace.available ? workspace.root : 'No folder open'}
            </span>
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportChats}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[10.5px] font-medium text-ink hover:bg-raised"
          >
            <ArrowDownToLine size={12} /> Export conversations
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[10.5px] font-medium text-ink hover:bg-raised"
          >
            <Upload size={12} /> Import conversations
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              importChats(file)
                .then((count) =>
                  notify(
                    count > 0
                      ? `Imported ${count} conversation${count === 1 ? '' : 's'}.`
                      : 'Those conversations are already in your history.',
                    count > 0 ? 'success' : 'info',
                  ),
                )
                .catch((cause: unknown) =>
                  notify(cause instanceof Error ? cause.message : 'Could not import that file.', 'error'),
                )
              event.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() =>
              void runReset('history', {
                title: 'Clear conversation history?',
                body: 'Every conversation saved on this computer will be deleted. Keys, skills and workspace files are kept.',
                label: 'Clear history',
              })
            }
            disabled={busy === 'history'}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[10.5px] font-medium text-ink hover:bg-raised disabled:opacity-40"
          >
            {busy === 'history' ? <Spinner size={12} /> : <Trash2 size={12} />} Clear history
          </button>
        </div>
        <p className="mt-3 flex items-center gap-2 text-[9.5px] text-faint">
          <HardDrive size={11} />
          {formatBytes(new Blob([JSON.stringify(sessions)]).size)} of conversation history
          <span className="text-line">·</span>
          <LockKeyhole size={10} />
          secrets encrypted at rest
        </p>
      </SettingsSection>

      <SettingsSection title="Danger zone">
        <div className="space-y-2">
          <div className="flex flex-col gap-2 rounded-lg border border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-medium text-ink">Restore default settings</p>
              <p className="mt-0.5 text-[9.5px] text-muted">Reset prompt, modes, tool permissions and skills. Keys and chats stay.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                void runReset('settings', {
                  title: 'Restore default settings?',
                  body: 'Your prompt, tool permissions, skills and interface settings return to their defaults. Conversations and encrypted keys are kept.',
                  label: 'Restore defaults',
                })
              }
              disabled={busy === 'settings'}
              className="inline-flex h-7 shrink-0 items-center gap-1 self-start rounded-lg border border-line px-2.5 text-[10px] font-medium text-muted hover:border-warning/30 hover:text-warning disabled:opacity-40 sm:self-auto"
            >
              {busy === 'settings' ? <Spinner size={11} /> : <RotateCcw size={11} />} Restore defaults
            </button>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-danger/20 bg-danger/[0.02] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-medium text-ink">Reset MaxCode</p>
              <p className="mt-0.5 text-[9.5px] text-muted">
                Delete conversations, encrypted keys, skills, settings and the remembered workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void runReset('all', {
                  title: 'Reset everything?',
                  body: 'Conversations, API keys, hosting credentials, skills, settings and the workspace list will be permanently removed from this computer. Files in your project folder are never deleted.',
                  label: 'Reset everything',
                })
              }
              disabled={busy === 'all'}
              className="inline-flex h-7 shrink-0 items-center gap-1 self-start rounded-lg bg-danger px-2.5 text-[10px] font-medium text-on-accent hover:bg-danger/90 disabled:opacity-40 sm:self-auto"
            >
              {busy === 'all' ? <Spinner size={11} /> : <Trash2 size={11} />} Reset everything
            </button>
          </div>
        </div>
      </SettingsSection>
    </>
  )
}

export function SettingsModal() {
  const open = useUi((state) => state.settingsOpen)
  const tab = useUi((state) => state.settingsTab)
  const close = useUi((state) => state.closeSettings)
  const openSettings = useUi((state) => state.openSettings)
  const meta = TABS.find((item) => item.id === tab) ?? TABS[0]
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) contentRef.current?.scrollTo({ top: 0 })
  }, [open, tab])

  return (
    <Modal open={open} onClose={close} labelledBy="settings-title" className="h-[92dvh] p-0 sm:h-[min(88dvh,760px)]">
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[208px] shrink-0 flex-col border-r border-line bg-canvas sm:flex">
          <div className="flex h-14 items-center gap-2 border-b border-line px-4">
            <LogoMark size={22} />
            <span className="font-display text-[16px] font-semibold tracking-[-0.02em] text-ink">MaxCode</span>
            <span className="ml-auto text-[9px] text-faint">Settings</span>
          </div>
          <nav className="flex-1 space-y-0.5 p-2">
            {TABS.map((item) => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openSettings(item.id)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] transition-colors',
                    active ? 'bg-panel font-medium text-ink shadow-pill' : 'text-muted hover:bg-raised hover:text-ink',
                  )}
                >
                  <Icon size={13} className={cn(active ? 'text-accent' : 'text-faint')} />
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div className="border-t border-line p-3">
            <p className="flex items-center gap-1.5 text-[9px] text-faint">
              <LockKeyhole size={10} />
              Keys encrypted on this machine
            </p>
            <p className="mt-1 text-[9px] text-faint">MaxCode 1.0 · DevSoft</p>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-3.5 sm:px-7">
            <div className="min-w-0">
              <h2 id="settings-title" className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
                {meta.label}
              </h2>
              <p className="mt-0.5 text-[10.5px] text-muted">{meta.description}</p>
            </div>
            <button type="button" className="icon-button -mr-1 shrink-0" onClick={close} aria-label="Close settings">
              <X size={16} />
            </button>
          </div>

          <div className="thin-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 sm:hidden">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openSettings(item.id)}
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors',
                  tab === item.id ? 'bg-ink text-panel' : 'text-muted hover:bg-raised',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div ref={contentRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {tab === 'models' && <ModelsTab />}
            {tab === 'tools' && <ToolsTab />}
            {tab === 'search' && <SearchTab />}
            {tab === 'skills' && <SkillsTab />}
            {tab === 'plugins' && <PluginsTab />}
            {tab === 'deploy' && <DeployTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </Modal>
  )
}
