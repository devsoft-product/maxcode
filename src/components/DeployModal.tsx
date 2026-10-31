import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Cloud,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe2,
  Play,
  Rocket,
  ShieldCheck,
  Square,
  Triangle,
  Terminal,
} from 'lucide-react'
import type { DeployProviderId, DeployResult } from '../types'
import { streamDeploy } from '../lib/daemon'
import { cn } from '../lib/utils'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { Modal, Spinner } from './ui'

const PROVIDERS: Array<{
  id: DeployProviderId
  label: string
  short: string
  icon: typeof Cloud
  blurb: string
  needs: string
}> = [
  {
    id: 'cloudflare',
    label: 'Cloudflare Pages',
    short: 'Pages',
    icon: Cloud,
    blurb: 'Fast global hosting with a generous free tier.',
    needs: 'API token + account id',
  },
  {
    id: 'netlify',
    label: 'Netlify',
    short: 'Netlify',
    icon: Globe2,
    blurb: 'Create a site and publish a folder in one step.',
    needs: 'Personal access token',
  },
  {
    id: 'vercel',
    label: 'Vercel',
    short: 'Vercel',
    icon: Triangle,
    blurb: 'Production deploys through the Vercel CLI.',
    needs: 'Access token',
  },
]

interface LogLine {
  id: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

export function DeployModal() {
  const open = useUi((state) => state.deployOpen)
  const setOpen = useUi((state) => state.setDeployOpen)
  const openSettings = useUi((state) => state.openSettings)
  const notify = useUi((state) => state.notify)
  const workspaceRoot = useWorkspace((state) => state.root)
  const workspaceName = useWorkspace((state) => state.info.name)
  const workspaceAvailable = useWorkspace((state) => state.info.available)
  const deployTools = useSettings((state) => state.deployTools)
  const deploySecrets = useSettings((state) => state.deploySecrets)

  const [provider, setProvider] = useState<DeployProviderId>('cloudflare')
  const [path, setPath] = useState('')
  const [outputDir, setOutputDir] = useState('dist')
  const [buildCommand, setBuildCommand] = useState('')
  const [projectName, setProjectName] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [result, setResult] = useState<DeployResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const logId = useRef(0)

  const meta = PROVIDERS.find((entry) => entry.id === provider) ?? PROVIDERS[0]
  const tool = deployTools?.[provider]
  const configured = Boolean(deploySecrets?.[provider]?.configured)

  useEffect(() => {
    if (!open) return
    setPath(workspaceRoot)
    setResult(null)
    setError('')
    setLogs([])
    setRunning(false)
    setCopied(false)
  }, [open, workspaceRoot])

  useEffect(() => {
    if (!open) return
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logs, open])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const append = (stream: LogLine['stream'], text: string) => {
    const clean = text.trimEnd()
    if (!clean) return
    logId.current += 1
    const id = logId.current
    setLogs((current) => [...current.slice(-500), { id, stream, text: clean }])
  }

  const close = () => {
    abortRef.current?.abort()
    setOpen(false)
  }

  const deploy = async () => {
    if (running) return
    if (!path.trim()) {
      setError('Choose the project folder to deploy.')
      return
    }
    setRunning(true)
    setResult(null)
    setError('')
    setLogs([])
    const controller = new AbortController()
    abortRef.current = controller
    append('meta', `Preparing ${meta.label} deploy from ${path.trim()}`)
    try {
      for await (const event of streamDeploy(
        {
          provider,
          path: path.trim(),
          outputDir: outputDir.trim() || undefined,
          buildCommand: buildCommand.trim() || undefined,
          projectName: projectName.trim() || undefined,
        },
        controller.signal,
      )) {
        if (event.type === 'log') append(event.stream, event.text)
        else if (event.type === 'start') append('meta', `Deploying ${event.provider}${event.path ? ` · ${event.path}` : ''}`)
        else if (event.type === 'done') {
          setResult(event.result)
          append('meta', `Published ${event.result.url}`)
          break
        } else if (event.type === 'error') {
          setError(event.message)
          append('stderr', event.message)
          break
        }
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        append('meta', 'Deployment stopped.')
      } else {
        const message = cause instanceof Error ? cause.message : 'The deployment failed.'
        setError(message)
        append('stderr', message)
      }
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const copyUrl = async () => {
    if (!result?.url) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  return (
    <Modal open={open} onClose={close} labelledBy="deploy-title" wide className="h-[92dvh] p-0 sm:h-[min(90dvh,760px)]">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Rocket size={17} />
          </span>
          <div className="min-w-0">
            <h2 id="deploy-title" className="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
              Deploy a site
            </h2>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
              Publish the open workspace or another project folder. Tokens stay encrypted on this machine.
            </p>
          </div>
        </div>
        <button type="button" className="icon-button -mr-1 shrink-0" onClick={close} aria-label="Close deploy panel">
          <span className="text-[18px] leading-none">×</span>
        </button>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="thin-scroll min-h-0 overflow-y-auto border-b border-line lg:border-b-0 lg:border-r">
          <div className="space-y-5 p-5">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Host</p>
              <div className="grid gap-1.5">
                {PROVIDERS.map((entry) => {
                  const Icon = entry.icon
                  const active = provider === entry.id
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setProvider(entry.id)}
                      disabled={running}
                      className={cn(
                        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                        active
                          ? 'border-accent/35 bg-accent-soft/45'
                          : 'border-line bg-panel hover:bg-raised/50',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                          active ? 'bg-accent text-on-accent' : 'bg-raised text-muted',
                        )}
                      >
                        <Icon size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn('text-[12px] font-medium', active ? 'text-accent' : 'text-ink')}>
                            {entry.label}
                          </span>
                          {deploySecrets?.[entry.id]?.configured ? (
                            <Check size={11} className="text-success" />
                          ) : (
                            <span className="text-[9px] text-warning">needs token</span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-relaxed text-faint">{entry.blurb}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {!configured && (
              <div className="rounded-xl border border-warning/25 bg-warning/[0.045] p-3">
                <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted">
                  <ShieldCheck size={12} className="mt-0.5 shrink-0 text-warning" />
                  {meta.label} needs {meta.needs}. Add it once in Settings → Deploy; it is encrypted with AES-256-GCM
                  and never appears in the page again.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    openSettings('deploy')
                  }}
                  className="mt-2 inline-flex h-7 items-center rounded-lg bg-ink px-2.5 text-[10.5px] font-medium text-panel"
                >
                  Add {meta.label} credentials
                </button>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="deploy-path" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                  Project folder
                </label>
                {workspaceAvailable && (
                  <button
                    type="button"
                    onClick={() => setPath(workspaceRoot)}
                    disabled={running}
                    className="inline-flex items-center gap-1 text-[9.5px] font-medium text-accent disabled:opacity-40"
                  >
                    <FolderOpen size={10} />
                    Use open workspace
                  </button>
                )}
              </div>
              <input
                id="deploy-path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                disabled={running}
                placeholder="/absolute/path/to/project or ~/Projects/site"
                spellCheck={false}
                className="h-9 w-full rounded-lg border border-line bg-panel px-2.5 font-mono text-[10.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/50 disabled:opacity-60"
              />
              <p className="mt-1 text-[9px] leading-relaxed text-faint">
                {workspaceAvailable ? `Open workspace: ${workspaceName}` : 'No workspace open.'} Another folder must
                already exist on this machine.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="deploy-output" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                  Output folder
                </label>
                <input
                  id="deploy-output"
                  value={outputDir}
                  onChange={(event) => setOutputDir(event.target.value)}
                  disabled={running}
                  placeholder="dist"
                  spellCheck={false}
                  className="h-8 w-full rounded-lg border border-line bg-panel px-2 font-mono text-[10.5px] text-ink outline-none focus:border-accent/50 disabled:opacity-60"
                />
              </div>
              <div>
                <label htmlFor="deploy-name" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                  Project name
                </label>
                <input
                  id="deploy-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  disabled={running}
                  placeholder="my-site"
                  spellCheck={false}
                  className="h-8 w-full rounded-lg border border-line bg-panel px-2 font-mono text-[10.5px] text-ink outline-none focus:border-accent/50 disabled:opacity-60"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              {['dist', 'build', 'out', '.'].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOutputDir(value)}
                  disabled={running}
                  className={cn('chip h-7 px-2 text-[9.5px]', outputDir === value && 'chip-active')}
                >
                  {value}
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="deploy-build" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                Build command <span className="font-normal normal-case tracking-normal text-faint">optional</span>
              </label>
              <input
                id="deploy-build"
                value={buildCommand}
                onChange={(event) => setBuildCommand(event.target.value)}
                disabled={running}
                placeholder="npm run build"
                spellCheck={false}
                className="h-8 w-full rounded-lg border border-line bg-panel px-2 font-mono text-[10.5px] text-ink outline-none focus:border-accent/50 disabled:opacity-60"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {['npm run build', 'pnpm build', 'yarn build'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBuildCommand(value)}
                    disabled={running}
                    className="rounded-md border border-line px-1.5 py-0.5 text-[9px] text-faint transition-colors hover:text-ink"
                  >
                    {value}
                  </button>
                ))}
                {buildCommand && (
                  <button
                    type="button"
                    onClick={() => setBuildCommand('')}
                    disabled={running}
                    className="px-1.5 py-0.5 text-[9px] text-faint hover:text-danger"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-lg border border-line bg-raised/40 px-2.5 py-2 text-[9.5px] leading-relaxed text-faint">
              <Terminal size={11} className="mt-0.5 shrink-0" />
              {tool?.installed
                ? `${tool.label} ${tool.version ? `(${tool.version})` : ''} is installed locally.`
                : `${tool?.label ?? meta.short} CLI is not installed; MaxCode will use npx for this deploy.`}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'animate-breathe bg-accent' : result ? 'bg-success' : 'bg-faint')} />
            <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted">
              {running ? `Deploying with ${meta.label}…` : result ? 'Deployment complete' : 'Deploy output'}
            </p>
            {running && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[10px] font-medium text-muted hover:text-ink"
              >
                <Square size={9} fill="currentColor" /> Stop
              </button>
            )}
            {!running && (
              <button
                type="button"
                onClick={() => void deploy()}
                disabled={!configured || !path.trim()}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[10.5px] font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play size={10} fill="currentColor" />
                Deploy
              </button>
            )}
          </div>

          {result && (
            <div className="shrink-0 border-b border-line bg-success/[0.045] px-4 py-3">
              <div className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-medium text-ink">Published successfully</p>
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 block truncate text-[11px] text-accent hover:underline"
                  >
                    {result.url}
                  </a>
                </div>
                <button type="button" onClick={copyUrl} className="icon-button h-7 w-7" title="Copy URL" aria-label="Copy URL">
                  {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                </button>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-button h-7 w-7"
                  title="Open site"
                  aria-label="Open site"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          )}

          {error && (
            <div className="shrink-0 border-b border-danger/20 bg-danger/[0.045] px-4 py-2.5 text-[10.5px] leading-relaxed text-danger">
              {error}
            </div>
          )}

          <div ref={logRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas/40 px-4 py-3">
            {logs.length === 0 && !running ? (
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 px-6 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-faint">
                  <Rocket size={17} />
                </span>
                <p className="text-[11.5px] font-medium text-muted">Ready when you are</p>
                <p className="max-w-[260px] text-[10px] leading-relaxed text-faint">
                  The build and deploy output appears here. Credentials are passed to the CLI through the environment,
                  never printed in the log.
                </p>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-[1.7] text-muted">
                {logs.map((line) => (
                  <span
                    key={line.id}
                    className={cn(
                      'block',
                      line.stream === 'stderr' && 'text-danger',
                      line.stream === 'meta' && 'text-accent',
                    )}
                  >
                    {line.stream === 'meta' ? '› ' : ''}
                    {line.text}
                  </span>
                ))}
                {running && (
                  <span className="mt-1 flex items-center gap-1.5 text-accent">
                    <Spinner size={10} /> working…
                  </span>
                )}
              </pre>
            )}
          </div>

          <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-4 text-[9px] text-faint">
            <ShieldCheck size={10} />
            Tokens encrypted at rest
            <span className="ml-auto">{path.trim() ? path.trim().split(/[\\/]/).filter(Boolean).pop() : 'No folder'}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
