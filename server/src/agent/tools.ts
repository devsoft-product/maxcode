import type { AgentMode, AppSettings, ToolName } from '../types'
import { executeDaemonTool } from '../lib/daemon'
import { useWorkspace } from '../store/workspace'

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolSchema {
  name: ToolName
  description: string
  parameters: JsonSchema
}

const MAX_TOOL_OUTPUT = 28_000
const READ_ONLY_TOOLS = new Set<ToolName>([
  'read_file',
  'list_files',
  'grep',
  'web_search',
  'read_url',
])

function truncate(value: string, limit = MAX_TOOL_OUTPUT) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… truncated (${value.length - limit} more characters)`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing string argument "${key}".`)
  return value
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

export function toolAllowedInMode(name: ToolName, mode: AgentMode): boolean {
  if (mode === 'build') return true
  return READ_ONLY_TOOLS.has(name) || name === 'shell' || name === 'git' || name === 'subagent'
}

export function getToolSchemas(
  settings: AppSettings,
  mode: AgentMode = 'build',
  { subagent = false } = {},
): ToolSchema[] {
  const tools: ToolSchema[] = [
    {
      name: 'shell',
      description:
        'Run a shell command in the workspace root. The working directory resets between calls. Prefer dedicated file and git tools for edits. In Plan mode only read-only commands are accepted.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (max 600000).' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    {
      name: 'read_file',
      description: 'Read a text file from the workspace. Use offset and limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from the workspace root.' },
          offset: { type: 'number', description: '1-based first line. Defaults to 1.' },
          limit: { type: 'number', description: 'Maximum lines. Defaults to 400.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_files',
      description: 'List files and folders below a workspace path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Folder path. Defaults to the workspace root.' },
          depth: { type: 'number', description: 'Recursion depth, 1–8. Defaults to 3.' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'write_file',
      description: 'Create a file or replace its full contents. Prefer edit_file for small changes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          content: { type: 'string', description: 'Complete file content.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    {
      name: 'edit_file',
      description:
        'Replace an exact text occurrence in a file. oldText must match whitespace exactly and be unique unless replaceAll is true.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          oldText: { type: 'string', description: 'Exact text to replace.' },
          newText: { type: 'string', description: 'Replacement text.' },
          replaceAll: { type: 'boolean', description: 'Replace every occurrence. Defaults to false.' },
        },
        required: ['path', 'oldText', 'newText'],
        additionalProperties: false,
      },
    },
    {
      name: 'rewrite_file',
      description: 'Replace the complete contents of an existing file. Use when most of the file changes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          content: { type: 'string', description: 'The new complete file content.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    {
      name: 'grep',
      description: 'Search workspace contents with a regular expression. Returns path, line and matching text.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression to search for.' },
          path: { type: 'string', description: 'File or folder. Defaults to the workspace root.' },
          ignoreCase: { type: 'boolean', description: 'Case-insensitive search. Defaults to false.' },
          maxResults: { type: 'number', description: 'Maximum matches. Defaults to 80.' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
    {
      name: 'web_search',
      description: 'Search the web for current information. Returns titles, URLs and snippets. Cite URLs you use.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'read_url',
      description: 'Read a public web page as plain text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The http(s) URL to read.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
    {
      name: 'git',
      description:
        'Inspect or change git state. In Plan mode only status, diff, log, show and branch are accepted.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'diff', 'log', 'show', 'branch', 'add', 'commit', 'init', 'checkout'],
          },
          path: { type: 'string', description: 'Limit diff to this file.' },
          staged: { type: 'boolean', description: 'Diff the staged changes.' },
          ref: { type: 'string', description: 'Commit or ref for show.' },
          limit: { type: 'number', description: 'Log limit.' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Files to stage.' },
          message: { type: 'string', description: 'Commit message.' },
          branch: { type: 'string', description: 'Branch to create or check out.' },
          create: { type: 'boolean', description: 'Create a new branch. Defaults to true.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  ]

  if (!subagent) {
    tools.push({
      name: 'subagent',
      description:
        'Delegate a focused investigation to a read-only subagent. Use it to explore a large area, trace a bug or verify assumptions without changing files. The subagent returns a concise report.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The specific question or investigation to perform.' },
          context: { type: 'string', description: 'Optional context, constraints or files to start from.' },
        },
        required: ['task'],
        additionalProperties: false,
      },
    })
  }

  return tools.filter((tool) => {
    if (!settings.tools[tool.name]?.enabled) return false
    if (!toolAllowedInMode(tool.name, mode)) return false
    if ((tool.name === 'web_search' || tool.name === 'read_url') && !settings.webSearchEnabled) return false
    return true
  })
}

export interface ToolResult {
  output: string
  isError: boolean
}

async function refreshTree() {
  await useWorkspace.getState().refresh({ treeOnly: true }).catch(() => undefined)
}

async function refreshWorkspace() {
  await useWorkspace.getState().refresh().catch(() => undefined)
}

function formatList(result: Record<string, unknown>): string {
  const entries = Array.isArray(result.entries) ? result.entries : []
  if (entries.length === 0) return 'This folder is empty.'
  const lines = entries.map((raw) => {
    const entry = record(raw)
    const path = textValue(entry.path)
    if (entry.type === 'dir') return `${path}/`
    if (entry.type === 'link') return `${path} -> link`
    return `${path}${numberValue(entry.size) !== undefined ? `  (${numberValue(entry.size)} B)` : ''}`
  })
  const suffix = result.truncated === true ? '\n… listing truncated. Narrow the path or reduce depth.' : ''
  return `${textValue(result.root) ? `Root: ${textValue(result.root)}\n` : ''}${lines.join('\n')}${suffix}`
}

function formatShell(result: Record<string, unknown>, command: string): string {
  const parts = [`$ ${command}`, textValue(result.stdout)]
  if (textValue(result.stderr)) parts.push(`stderr:\n${textValue(result.stderr)}`)
  const code = numberValue(result.code)
  if (code !== undefined && code !== 0) parts.push(`exit code: ${code}`)
  if (result.timedOut === true) parts.push('The command timed out.')
  return parts.filter((part) => part !== '').join('\n')
}

function formatGrep(result: Record<string, unknown>, pattern: string): string {
  const matches = Array.isArray(result.matches) ? result.matches : []
  if (matches.length === 0) return `No matches for ${pattern}.`
  const lines = matches.map((raw) => {
    const match = record(raw)
    return `${textValue(match.file)}:${numberValue(match.line) ?? 0}: ${textValue(match.text)}`
  })
  const suffix = result.truncated === true ? '\n… more matches exist. Narrow the pattern or path.' : ''
  return lines.join('\n') + suffix
}

function formatGit(result: Record<string, unknown>): string {
  const parts: string[] = []
  if (textValue(result.current)) parts.push(`Current branch: ${textValue(result.current)}`)
  if (textValue(result.branches)) parts.push(textValue(result.branches))
  if (textValue(result.stdout)) parts.push(textValue(result.stdout))
  if (textValue(result.stderr)) parts.push(`stderr:\n${textValue(result.stderr)}`)
  const code = numberValue(result.code)
  if (code !== undefined && code !== 0) parts.push(`exit code: ${code}`)
  return parts.filter(Boolean).join('\n') || 'Git completed with no output.'
}

async function runTool(
  name: Exclude<ToolName, 'subagent'>,
  args: Record<string, unknown>,
  settings: AppSettings,
  mode: AgentMode,
  signal: AbortSignal,
): Promise<ToolResult> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  if (name === 'read_file') {
    const path = requireString(args, 'path')
    const result = record((await executeDaemonTool('read_file', { path }, mode, signal)).result)
    if (result.binary === true) {
      return { output: `${path} is binary (${numberValue(result.size) ?? 0} bytes).`, isError: false }
    }
    const offset = Math.max(1, Math.round(numberArg(args, 'offset', 1)))
    const limit = Math.min(Math.max(1, Math.round(numberArg(args, 'limit', 400))), 2000)
    const lines = textValue(result.content).split('\n')
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    const remaining = lines.length - (offset - 1 + limit)
    const header = `${textValue(result.path) || path} · ${lines.length} lines${result.truncated === true ? ' · file clipped by daemon' : ''}`
    const footer = remaining > 0 ? `\n… ${remaining} more lines. Read again with offset ${offset + limit}.` : ''
    return { output: truncate(`${header}\n────\n${slice.join('\n')}${footer}`), isError: false }
  }

  if (name === 'list_files') {
    const result = record(
      (
        await executeDaemonTool(
          'list_files',
          {
            path: optionalString(args, 'path') ?? '',
            depth: Math.min(Math.max(1, numberArg(args, 'depth', 3)), 8),
          },
          mode,
          signal,
        )
      ).result,
    )
    return { output: formatList(result), isError: false }
  }

  if (name === 'write_file' || name === 'rewrite_file') {
    const path = requireString(args, 'path')
    const content = requireString(args, 'content')
    const result = record((await executeDaemonTool(name, { path, content }, mode, signal)).result)
    await refreshWorkspace()
    const verb = result.created === true ? 'Created' : name === 'rewrite_file' ? 'Rewrote' : 'Updated'
    return {
      output: `${verb} ${textValue(result.path) || path} · ${content.split('\n').length} lines, ${numberValue(result.size) ?? content.length} bytes.`,
      isError: false,
    }
  }

  if (name === 'edit_file') {
    const path = requireString(args, 'path')
    const oldText = requireString(args, 'oldText')
    const newText = typeof args.newText === 'string' ? args.newText : ''
    const result = record(
      (
        await executeDaemonTool(
          'edit_file',
          { path, oldText, newText, replaceAll: args.replaceAll === true },
          mode,
          signal,
        )
      ).result,
    )
    await refreshWorkspace()
    return {
      output: `Edited ${textValue(result.path) || path} · ${numberValue(result.replacements) ?? 1} replacement${numberValue(result.replacements) === 1 ? '' : 's'}.`,
      isError: false,
    }
  }

  if (name === 'shell') {
    const command = requireString(args, 'command')
    const result = record(
      (
        await executeDaemonTool(
          'shell',
          { command, timeoutMs: numberArg(args, 'timeoutMs', 120_000) },
          mode,
          signal,
        )
      ).result,
    )
    void refreshTree()
    return {
      output: truncate(formatShell(result, command)),
      isError: (numberValue(result.code) ?? 0) !== 0 || result.timedOut === true,
    }
  }

  if (name === 'grep') {
    const pattern = requireString(args, 'pattern')
    const result = record(
      (
        await executeDaemonTool(
          'grep',
          {
            pattern,
            path: optionalString(args, 'path') ?? '',
            ignoreCase: args.ignoreCase === true,
          },
          mode,
          signal,
        )
      ).result,
    )
    const maxResults = Math.min(Math.max(1, Math.round(numberArg(args, 'maxResults', 80))), 200)
    const matches = Array.isArray(result.matches) ? result.matches.slice(0, maxResults) : []
    const clipped = { ...result, matches, truncated: result.truncated === true || (Array.isArray(result.matches) && result.matches.length > maxResults) }
    return { output: truncate(formatGrep(clipped, pattern)), isError: false }
  }

  if (name === 'web_search') {
    const query = requireString(args, 'query')
    const result = record(
      (
        await executeDaemonTool(
          'web_search',
          { query, provider: settings.searchProvider },
          mode,
          signal,
        )
      ).result,
    )
    const results = Array.isArray(result.results) ? result.results : []
    if (results.length === 0) return { output: 'No results found.', isError: false }
    const formatted = results
      .map((raw, index) => {
        const item = record(raw)
        return `${index + 1}. ${textValue(item.title)}\n   ${textValue(item.url)}${textValue(item.snippet) ? `\n   ${textValue(item.snippet)}` : ''}`
      })
      .join('\n\n')
    return {
      output: truncate(`Search: ${query}\nProvider: ${textValue(result.provider) || 'web'}\n\n${formatted}`),
      isError: false,
    }
  }

  if (name === 'read_url') {
    const url = requireString(args, 'url')
    const result = record((await executeDaemonTool('read_url', { url }, mode, signal)).result)
    const title = textValue(result.title)
    return {
      output: truncate(
        `Source: ${textValue(result.url) || url}${title ? `\nTitle: ${title}` : ''}\n\n${textValue(result.content)}${result.truncated === true ? '\n\n… page truncated.' : ''}`,
      ),
      isError: false,
    }
  }

  const action = requireString(args, 'action')
  const gitArgs: Record<string, unknown> = { ...args }
  delete gitArgs.action
  const result = record((await executeDaemonTool('git', { action, ...gitArgs }, mode, signal)).result)
  if (action === 'add' || action === 'commit' || action === 'init' || action === 'checkout') {
    await useWorkspace.getState().loadGit().catch(() => undefined)
  }
  return {
    output: truncate(formatGit(result)),
    isError: (numberValue(result.code) ?? 0) !== 0,
  }
}

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  settings: AppSettings,
  mode: AgentMode,
  signal: AbortSignal,
): Promise<ToolResult> {
  if (!settings.tools[name]?.enabled) {
    return { output: 'This tool is disabled in Settings → Tools.', isError: true }
  }
  if (!toolAllowedInMode(name, mode)) {
    return {
      output:
        'Plan mode is read-only. Do not edit files or change git state. Finish with an implementation plan instead.',
      isError: true,
    }
  }
  if ((name === 'web_search' || name === 'read_url') && !settings.webSearchEnabled) {
    return { output: 'Web access is turned off for this session.', isError: true }
  }
  if (name === 'subagent') {
    return { output: 'Subagents are handled by the agent loop.', isError: true }
  }
  try {
    return await runTool(name, args, settings, mode, signal)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return { output: error instanceof Error ? error.message : 'The tool failed.', isError: true }
  }
}

export function toolLabel(name: ToolName): string {
  const labels: Record<ToolName, string> = {
    shell: 'Shell',
    read_file: 'Read file',
    list_files: 'List files',
    write_file: 'Write file',
    edit_file: 'Edit file',
    rewrite_file: 'Rewrite file',
    grep: 'Grep',
    web_search: 'Web search',
    read_url: 'Read URL',
    git: 'Git',
    subagent: 'Subagent',
  }
  return labels[name] ?? 'Tool'
}

export function toolSummary(name: ToolName, args: Record<string, unknown>): string {
  const value =
    name === 'shell'
      ? args.command
      : name === 'grep'
        ? args.pattern
        : name === 'web_search'
          ? args.query
          : name === 'read_url'
            ? args.url
            : name === 'git'
              ? args.action
              : name === 'subagent'
                ? args.task
                : (args.path ?? '')
  return typeof value === 'string' ? value : ''
}
