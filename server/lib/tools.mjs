import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { isIP } from 'node:net'
import path from 'node:path'
import { HttpError } from './http.mjs'
import { loadState, loadSecretsSafe } from './store.mjs'

const MAX_READ = 2 * 1024 * 1024
const MAX_WRITE = 8 * 1024 * 1024
const MAX_OUTPUT = 200_000
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.turbo',
  '.cache',
])
const TEXT_PROBE = 8000

export async function workspaceRoot() {
  const state = await loadState()
  if (!state.activeWorkspace) {
    throw new HttpError(
      409,
      'No workspace is open. Choose a folder in Workspace before using tools.',
      'no_workspace',
    )
  }
  const info = await stat(state.activeWorkspace).catch(() => null)
  if (!info?.isDirectory()) {
    throw new HttpError(
      409,
      `The workspace folder no longer exists: ${state.activeWorkspace}`,
      'workspace_missing',
    )
  }
  return realpath(state.activeWorkspace)
}

function relativeLabel(root, absolute) {
  const rel = path.relative(root, absolute)
  return rel ? rel.split(path.sep).join('/') : '.'
}

function cleanRelative(input) {
  if (typeof input !== 'string') throw new HttpError(400, 'A path is required.', 'bad_path')
  if (input.includes('\0')) throw new HttpError(400, 'That path is not valid.', 'bad_path')
  const trimmed = input.trim()
  if (!trimmed || trimmed === '.' || trimmed === './') return ''
  return trimmed.replace(/^\.\//, '').replace(/^\/+/, '')
}

async function insideRoot(root, candidate) {
  const rootReal = root
  const parent = path.dirname(candidate)
  const existing = await realpath(candidate).catch(() => null)
  const anchor = existing ?? (await realpath(parent).catch(() => parent))
  const prefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`
  if (anchor !== rootReal && !anchor.startsWith(prefix)) {
    throw new HttpError(403, 'That path is outside the open workspace.', 'outside_workspace')
  }
  if (existing && existing !== rootReal && !existing.startsWith(prefix)) {
    throw new HttpError(403, 'That path is outside the open workspace.', 'outside_workspace')
  }
  return existing ?? candidate
}

export async function resolveWorkspacePath(input, { allowRoot = true } = {}) {
  const root = await workspaceRoot()
  const rel = cleanRelative(input)
  if (!rel && !allowRoot) {
    throw new HttpError(400, 'Choose a file or folder inside the workspace.', 'bad_path')
  }
  const candidate = path.resolve(root, rel)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (candidate !== root && !candidate.startsWith(prefix)) {
    throw new HttpError(403, 'That path is outside the open workspace.', 'outside_workspace')
  }
  if (/^(.*\/)?\.git(\/|$)/.test(rel)) {
    throw new HttpError(403, 'MaxCode does not edit the .git directory.', 'git_protected')
  }
  const absolute = await insideRoot(root, candidate)
  return { root, absolute, relative: rel || '.' }
}

function displayPath(root, absolute) {
  return relativeLabel(root, absolute)
}

function isProbablyBinary(buffer) {
  const probe = buffer.subarray(0, TEXT_PROBE)
  for (let i = 0; i < probe.length; i += 1) {
    if (probe[i] === 0) return true
  }
  return false
}

function snapshot(buffer) {
  return {
    hash: createHash('sha256').update(buffer).digest('hex').slice(0, 16),
    size: buffer.length,
  }
}

export async function listTree(input = '', { depth = 2, showHidden = false, limit = 1200 } = {}) {
  const root = await workspaceRoot()
  const rel = cleanRelative(input)
  const start = rel ? await resolveWorkspacePath(rel) : { root, absolute: root, relative: '' }
  const info = await stat(start.absolute).catch(() => null)
  if (!info) throw new HttpError(404, `Not found: ${rel || '.'}`, 'not_found')
  if (!info.isDirectory()) {
    return { root, path: rel, entries: [], truncated: false }
  }

  let count = 0
  let truncated = false
  const entries = []
  const maxDepth = Math.max(0, Math.min(8, depth))

  async function walk(directory, relativeDir, level) {
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    children.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const child of children) {
      if (count >= limit) {
        truncated = true
        return
      }
      if (!showHidden && child.name.startsWith('.')) continue
      if (SKIP_DIRS.has(child.name)) continue
      const absolute = path.join(directory, child.name)
      const relative = relativeDir ? `${relativeDir}/${child.name}` : child.name
      const childInfo = await lstat(absolute).catch(() => null)
      if (!childInfo) continue
      count += 1
      if (childInfo.isSymbolicLink()) {
        entries.push({ name: child.name, path: relative, type: 'link', size: 0, mtime: childInfo.mtimeMs })
        continue
      }
      if (childInfo.isDirectory()) {
        entries.push({ name: child.name, path: relative, type: 'dir', size: 0, mtime: childInfo.mtimeMs })
        if (level + 1 < maxDepth) await walk(absolute, relative, level + 1)
      } else if (childInfo.isFile()) {
        entries.push({
          name: child.name,
          path: relative,
          type: 'file',
          size: childInfo.size,
          mtime: childInfo.mtimeMs,
        })
      }
    }
  }

  await walk(start.absolute, rel, 0)
  return { root, path: rel || '.', entries, truncated }
}

export async function readWorkspaceFile(input, { maxBytes = MAX_READ } = {}) {
  const { root, absolute, relative } = await resolveWorkspacePath(input, { allowRoot: false })
  const info = await stat(absolute).catch(() => null)
  if (!info) throw new HttpError(404, `File not found: ${relative}`, 'not_found')
  if (!info.isFile()) throw new HttpError(400, `${relative} is not a file.`, 'not_a_file')
  const buffer = await readFile(absolute)
  const binary = isProbablyBinary(buffer)
  const clipped = buffer.subarray(0, maxBytes)
  return {
    path: relative,
    absolute: displayPath(root, absolute),
    size: info.size,
    mtime: info.mtimeMs,
    binary,
    truncated: buffer.length > maxBytes,
    content: binary ? '' : clipped.toString('utf8'),
    base64: binary ? clipped.toString('base64') : '',
    hash: snapshot(buffer).hash,
  }
}

export async function writeWorkspaceFile(input, content, { create = true } = {}) {
  const { root, absolute, relative } = await resolveWorkspacePath(input, { allowRoot: false })
  if (typeof content !== 'string') throw new HttpError(400, 'File content must be text.', 'bad_content')
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE) {
    throw new HttpError(413, 'That file is too large to write from MaxCode.', 'file_too_large')
  }
  const existing = await stat(absolute).catch(() => null)
  if (!existing && !create) throw new HttpError(404, `File not found: ${relative}`, 'not_found')
  if (existing?.isDirectory()) throw new HttpError(400, `${relative} is a folder.`, 'is_directory')
  await mkdir(path.dirname(absolute), { recursive: true })
  const temp = `${absolute}.${process.pid}.maxcode.tmp`
  await writeFile(temp, content, 'utf8')
  try {
    await rename(temp, absolute)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
  const info = await stat(absolute)
  return {
    path: relative,
    size: info.size,
    mtime: info.mtimeMs,
    created: !existing,
    bytes: info.size,
    hash: snapshot(Buffer.from(content, 'utf8')).hash,
  }
}

export async function editWorkspaceFile(input, oldText, newText, { replaceAll = false } = {}) {
  if (typeof oldText !== 'string' || !oldText) {
    throw new HttpError(400, 'The text to replace is empty.', 'bad_edit')
  }
  if (typeof newText !== 'string') throw new HttpError(400, 'The replacement text is invalid.', 'bad_edit')
  const file = await readWorkspaceFile(input, { maxBytes: MAX_READ })
  if (file.binary) throw new HttpError(400, 'That file is binary.', 'binary_file')
  if (file.truncated) throw new HttpError(400, 'That file is too large to edit precisely.', 'file_too_large')
  const occurrences = file.content.split(oldText).length - 1
  if (occurrences === 0) {
    throw new HttpError(409, `The search text was not found in ${file.path}.`, 'no_match')
  }
  if (occurrences > 1 && !replaceAll) {
    throw new HttpError(
      409,
      `The search text appears ${occurrences} times in ${file.path}. Add more context or set replaceAll.`,
      'ambiguous_edit',
    )
  }
  const next = replaceAll
    ? file.content.split(oldText).join(newText)
    : file.content.replace(oldText, newText)
  const written = await writeWorkspaceFile(input, next)
  return { ...written, replacements: replaceAll ? occurrences : 1 }
}

export async function createWorkspaceEntry(input, type = 'file', content = '') {
  const { root, absolute, relative } = await resolveWorkspacePath(input, { allowRoot: false })
  if (type === 'dir') {
    const existing = await stat(absolute).catch(() => null)
    if (existing) throw new HttpError(409, `${relative} already exists.`, 'already_exists')
    await mkdir(absolute, { recursive: false })
    return { path: relative, type: 'dir', created: true }
  }
  const existing = await stat(absolute).catch(() => null)
  if (existing) throw new HttpError(409, `${relative} already exists.`, 'already_exists')
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, typeof content === 'string' ? content : '', 'utf8')
  const info = await stat(absolute)
  return { path: relative, type: 'file', size: info.size, created: true, root: displayPath(root, root) }
}

export async function renameWorkspaceEntry(from, to) {
  const source = await resolveWorkspacePath(from, { allowRoot: false })
  const target = await resolveWorkspacePath(to, { allowRoot: false })
  const existing = await stat(target.absolute).catch(() => null)
  if (existing) throw new HttpError(409, `${target.relative} already exists.`, 'already_exists')
  await mkdir(path.dirname(target.absolute), { recursive: true })
  await rename(source.absolute, target.absolute)
  return { from: source.relative, to: target.relative }
}

export async function deleteWorkspaceEntry(input) {
  const { absolute, relative } = await resolveWorkspacePath(input, { allowRoot: false })
  const info = await stat(absolute).catch(() => null)
  if (!info) throw new HttpError(404, `${relative} does not exist.`, 'not_found')
  await rm(absolute, { recursive: info.isDirectory(), force: false })
  return { path: relative, deleted: true, type: info.isDirectory() ? 'dir' : 'file' }
}

export async function chmodWorkspaceFile(input, mode) {
  const { absolute, relative } = await resolveWorkspacePath(input, { allowRoot: false })
  const parsed = Number.parseInt(String(mode), 8)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0o777) {
    throw new HttpError(400, 'Use a valid octal mode such as 755.', 'bad_mode')
  }
  await chmod(absolute, parsed)
  return { path: relative, mode: parsed.toString(8) }
}

async function walkFiles(root, { maxFiles = 4000, maxBytes = 12 * 1024 * 1024 } = {}) {
  const files = []
  let bytes = 0
  async function walk(directory) {
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of children) {
      if (files.length >= maxFiles || bytes >= maxBytes) return
      if (child.name.startsWith('.') || SKIP_DIRS.has(child.name)) continue
      const absolute = path.join(directory, child.name)
      if (child.isDirectory()) {
        await walk(absolute)
      } else if (child.isFile()) {
        const info = await stat(absolute).catch(() => null)
        if (!info || info.size > 512 * 1024) continue
        files.push({ absolute, size: info.size })
        bytes += info.size
      }
    }
  }
  await walk(root)
  return files
}

export async function grepWorkspace(pattern, { path: sub = '', ignoreCase = false, maxResults = 200 } = {}) {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    throw new HttpError(400, 'A search pattern is required.', 'bad_pattern')
  }
  const root = await workspaceRoot()
  const start = sub
    ? (await resolveWorkspacePath(sub)).absolute
    : root
  const info = await stat(start).catch(() => null)
  if (!info) throw new HttpError(404, `Not found: ${sub || '.'}`, 'not_found')

  const rg = await runProcess(
    'rg',
    [
      '--line-number',
      '--no-heading',
      '--color',
      'never',
      '--hidden',
      '--glob',
      '!node_modules',
      '--glob',
      '!.git',
      '--glob',
      '!dist',
      '--glob',
      '!build',
      ...(ignoreCase ? ['--ignore-case'] : []),
      '--',
      pattern,
      '.',
    ],
    { cwd: info.isDirectory() ? start : path.dirname(start), timeoutMs: 20_000, maxOutput: 80_000 },
  ).catch(() => null)

  if (rg) {
    if (rg.code === 1 && !rg.stdout.trim()) {
      return { pattern, matches: [], truncated: false, engine: 'rg' }
    }
    if (rg.code === 0) {
      const lines = rg.stdout.split('\n').filter(Boolean)
      const matches = lines.slice(0, maxResults).map((line) => {
        const [file, lineNumber, ...rest] = line.split(':')
        return { file: file.replace(/^\.\//, ''), line: Number(lineNumber) || 0, text: rest.join(':') }
      })
      return { pattern, matches, truncated: lines.length > maxResults, engine: 'rg' }
    }
  }

  const files = info.isDirectory() ? await walkFiles(start) : [{ absolute: start, size: info.size }]
  const regex = new RegExp(
    pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ignoreCase ? 'i' : '',
  )
  const matches = []
  let truncated = false
  outer: for (const file of files) {
    const buffer = await readFile(file.absolute).catch(() => null)
    if (!buffer || isProbablyBinary(buffer)) continue
    const lines = buffer.toString('utf8').split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      if (!regex.test(lines[index])) continue
      matches.push({
        file: displayPath(root, file.absolute),
        line: index + 1,
        text: lines[index].slice(0, 400),
      })
      if (matches.length >= maxResults) {
        truncated = true
        break outer
      }
    }
  }
  return { pattern, matches, truncated, engine: 'js' }
}

function runProcess(command, args, { cwd, env, timeoutMs = 120_000, maxOutput = MAX_OUTPUT, stdin = '' } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let killed = false
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const terminate = () => {
      killed = true
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeoutMs)

    const collect = (target) => (chunk) => {
      const text = chunk.toString('utf8')
      if (target === 'stdout') {
        if (stdout.length < maxOutput) stdout += text
      } else if (stderr.length < maxOutput) {
        stderr += text
      }
    }
    child.stdout.on('data', collect('stdout'))
    child.stderr.on('data', collect('stderr'))
    child.stdin.on('error', () => undefined)
    if (stdin) child.stdin.end(stdin)
    else child.stdin.end()

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr: `${stderr}${error.message}`,
        code: 127,
        timedOut,
        killed,
        durationMs: Date.now() - started,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const clip = (value) =>
        value.length > maxOutput
          ? `${value.slice(0, maxOutput)}\n… output truncated (${value.length - maxOutput} more characters)`
          : value
      resolve({
        stdout: clip(stdout),
        stderr: clip(stderr),
        code: typeof code === 'number' ? code : -1,
        timedOut,
        killed,
        durationMs: Date.now() - started,
      })
    })
  })
}

function planShellAllowed(command) {
  if (/[;&|><`$(){}[\]\n]/.test(command)) return false
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  const head = tokens[0]
  const safe = new Set([
    'pwd',
    'ls',
    'cat',
    'head',
    'tail',
    'wc',
    'grep',
    'rg',
    'find',
    'tree',
    'file',
    'stat',
    'du',
    'df',
    'date',
    'whoami',
    'git',
  ])
  if (!safe.has(head)) return false
  if (head === 'git') {
    const sub = tokens[1] ?? ''
    if (!['status', 'diff', 'log', 'show', 'branch', 'remote', 'rev-parse', 'ls-files'].includes(sub)) {
      return false
    }
  }
  return true
}

export async function runShell(command, { mode = 'build', timeoutMs = 120_000 } = {}) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new HttpError(400, 'A command is required.', 'bad_command')
  }
  if (command.length > 20_000) throw new HttpError(400, 'That command is too long.', 'bad_command')
  if (mode === 'plan' && !planShellAllowed(command)) {
    throw new HttpError(
      403,
      'Plan mode is read-only. Use read_file, list_files, grep or a read-only shell command.',
      'plan_readonly',
    )
  }
  const root = await workspaceRoot()
  const result = await runProcess('/bin/bash', ['-lc', command], {
    cwd: root,
    timeoutMs: Math.max(1000, Math.min(Number(timeoutMs) || 120_000, 600_000)),
    env: { MAXCODE: '1', MAXCODE_WORKSPACE: root },
  })
  return { ...result, command, cwd: root }
}

const GIT_ACTIONS = new Set(['status', 'diff', 'log', 'show', 'branch', 'add', 'commit', 'init', 'checkout'])

function safeRef(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._~^/@{}-]+$/.test(value) ? value : ''
}

export async function runGit(action, args = {}, { mode = 'build' } = {}) {
  if (!GIT_ACTIONS.has(action)) throw new HttpError(400, `Unsupported git action: ${action}`, 'bad_git')
  const write = ['add', 'commit', 'init', 'checkout'].includes(action)
  if (mode === 'plan' && write) {
    throw new HttpError(403, 'Plan mode cannot change git state.', 'plan_readonly')
  }
  const root = await workspaceRoot()
  const git = (argv, timeoutMs = 60_000) =>
    runProcess('git', ['-C', root, ...argv], { cwd: root, timeoutMs, maxOutput: 150_000 })

  if (action === 'status') {
    const porcelain = await git(['status', '--porcelain=v1', '-b'])
    return { action, ...porcelain, cwd: root }
  }
  if (action === 'diff') {
    const argv = ['diff', '--no-color']
    if (args.staged === true) argv.push('--staged')
    const file = typeof args.path === 'string' ? args.path.trim() : ''
    if (file) {
      const resolved = await resolveWorkspacePath(file, { allowRoot: false })
      argv.push('--', resolved.absolute)
    }
    const result = await git(argv)
    return { action, ...result, cwd: root }
  }
  if (action === 'log') {
    const limit = Math.max(1, Math.min(Number(args.limit) || 30, 100))
    return { action, ...(await git(['log', `--max-count=${limit}`, '--pretty=format:%h %ad %s', '--date=short'])), cwd: root }
  }
  if (action === 'show') {
    const ref = safeRef(args.ref) || 'HEAD'
    return { action, ...(await git(['show', '--stat', '--oneline', ref])), cwd: root }
  }
  if (action === 'branch') {
    const current = await git(['branch', '--show-current'])
    const all = await git(['branch', '--all', '--no-color'])
    return { action, current: current.stdout.trim(), branches: all.stdout, cwd: root, code: all.code }
  }
  if (action === 'add') {
    const paths = Array.isArray(args.paths) ? args.paths : []
    if (paths.length === 0) throw new HttpError(400, 'Choose files to stage.', 'bad_git')
    const resolved = []
    for (const entry of paths.slice(0, 200)) {
      resolved.push((await resolveWorkspacePath(String(entry), { allowRoot: false })).absolute)
    }
    return { action, ...(await git(['add', '--', ...resolved])), cwd: root }
  }
  if (action === 'commit') {
    const message = typeof args.message === 'string' ? args.message.trim() : ''
    if (!message) throw new HttpError(400, 'A commit message is required.', 'bad_git')
    if (message.length > 4000) throw new HttpError(400, 'That commit message is too long.', 'bad_git')
    return { action, ...(await git(['commit', '-m', message])), cwd: root }
  }
  if (action === 'init') {
    return { action, ...(await git(['init'])), cwd: root }
  }
  const branch = typeof args.branch === 'string' ? args.branch.trim() : ''
  if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-')) {
    throw new HttpError(400, 'Use a simple branch name.', 'bad_git')
  }
  const argv = args.create === false ? ['checkout', branch] : ['checkout', '-b', branch]
  return { action, ...(await git(argv)), cwd: root }
}

export async function gitSummary() {
  const root = await workspaceRoot().catch(() => '')
  if (!root) return { available: false, root: '', branch: '', entries: [], error: 'No workspace is open.' }
  const check = await runProcess('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    timeoutMs: 8000,
  })
  if (check.code !== 0) {
    return { available: false, root, branch: '', entries: [], error: check.stderr.trim() || 'Not a git repository.' }
  }
  const statusRun = await runProcess('git', ['-C', root, 'status', '--porcelain=v1', '-b'], {
    cwd: root,
    timeoutMs: 15_000,
  })
  const lines = statusRun.stdout.split('\n').filter(Boolean)
  const branchLine = lines.find((line) => line.startsWith('## ')) ?? ''
  const branch = branchLine.replace(/^##\s+/, '').split('...')[0] ?? ''
  const entries = lines
    .filter((line) => !line.startsWith('## '))
    .slice(0, 300)
    .map((line) => ({ status: line.slice(0, 2).trim() || '?', path: line.slice(3).trim() }))
  return { available: true, root, branch, entries, error: '' }
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
}

function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|pre|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n'),
  ).trim()
}

async function searchKeyFor(provider) {
  const { secrets } = await loadSecretsSafe()
  return {
    apiKey: secrets.search?.apiKey ?? '',
    provider: secrets.search?.provider ?? '',
  }
}

async function duckduckgo(query, signal) {
  const response = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 MaxCode/1.0',
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal,
  })
  if (!response.ok) throw new HttpError(502, `DuckDuckGo returned ${response.status}.`, 'search_failed')
  const html = await response.text()
  const results = []
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = pattern.exec(html)) && results.length < 8) {
    let url = decodeEntities(match[1])
    if (url.startsWith('//duckduckgo.com/l/?uddg=')) {
      const target = new URL(`https:${url}`).searchParams.get('uddg')
      if (target) url = target
    }
    if (!/^https?:/i.test(url)) continue
    results.push({ title: stripHtml(match[2]), url, snippet: '' })
  }
  return results
}

async function tavily(query, key, signal) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: 6 }),
    signal,
  })
  if (!response.ok) throw new HttpError(502, `Tavily returned ${response.status}.`, 'search_failed')
  const payload = await response.json()
  return (payload.results ?? []).slice(0, 6).map((item) => ({
    title: String(item.title ?? ''),
    url: String(item.url ?? ''),
    snippet: String(item.content ?? ''),
  }))
}

async function brave(query, key, signal) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', '8')
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal,
  })
  if (!response.ok) throw new HttpError(502, `Brave Search returned ${response.status}.`, 'search_failed')
  const payload = await response.json()
  return (payload.web?.results ?? []).slice(0, 8).map((item) => ({
    title: String(item.title ?? ''),
    url: String(item.url ?? ''),
    snippet: stripHtml(String(item.description ?? '')),
  }))
}

async function serper(query, key, signal) {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q: query }),
    signal,
  })
  if (!response.ok) throw new HttpError(502, `Serper returned ${response.status}.`, 'search_failed')
  const payload = await response.json()
  return (payload.organic ?? []).slice(0, 8).map((item) => ({
    title: String(item.title ?? ''),
    url: String(item.link ?? ''),
    snippet: String(item.snippet ?? ''),
  }))
}

export async function searchWeb(query, { provider = 'duckduckgo' } = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new HttpError(400, 'A search query is required.', 'bad_query')
  }
  const stored = await searchKeyFor(provider)
  const key = stored.apiKey
  const chosen = key && stored.provider ? stored.provider : provider
  if (chosen !== 'duckduckgo' && !key) {
    throw new HttpError(
      400,
      `Add a ${chosen} API key in Settings → Tools, or switch to DuckDuckGo.`,
      'missing_search_key',
    )
  }
  const signal = AbortSignal.timeout(25_000)
  if (chosen === 'tavily') return { provider: chosen, results: await tavily(query, key, signal) }
  if (chosen === 'brave') return { provider: chosen, results: await brave(query, key, signal) }
  if (chosen === 'serper') return { provider: chosen, results: await serper(query, key, signal) }
  return { provider: 'duckduckgo', results: await duckduckgo(query, signal) }
}

function privateAddress(address) {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number)
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    if (parts[0] >= 224) return true
    return false
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (lower.startsWith('fe80')) return true
    if (lower.startsWith('::ffff:')) return privateAddress(lower.slice(7))
    return false
  }
  return false
}

async function assertPublicUrl(url) {
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'Only http and https URLs can be read.', 'bad_url')
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new HttpError(403, 'That host is private.', 'private_url')
  }
  const literal = isIP(url.hostname)
  const addresses = literal ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => [])
  if (addresses.length === 0) throw new HttpError(400, 'That host could not be resolved.', 'dns_failed')
  if (addresses.some((entry) => privateAddress(entry.address))) {
    throw new HttpError(403, 'That host is on a private network.', 'private_url')
  }
}

export async function readUrl(rawUrl, { maxBytes = 400_000 } = {}) {
  let url
  try {
    url = new URL(String(rawUrl))
  } catch {
    throw new HttpError(400, 'That URL is not valid.', 'bad_url')
  }
  await assertPublicUrl(url)
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 MaxCode/1.0',
    },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) {
    throw new HttpError(502, `That page returned HTTP ${response.status}.`, 'fetch_failed')
  }
  const type = response.headers.get('content-type') ?? ''
  if (!/text\/|json|xml|javascript/i.test(type)) {
    throw new HttpError(415, `MaxCode cannot read ${type || 'that content type'}.`, 'unsupported_type')
  }
  const raw = (await response.text()).slice(0, maxBytes)
  const text = /html/i.test(type) ? stripHtml(raw) : raw
  return {
    url: response.url,
    title: (() => {
      const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)
      return match ? stripHtml(match[1]) : ''
    })(),
    content: text.slice(0, 60_000),
    truncated: text.length > 60_000,
  }
}

export async function executeTool(name, args = {}, { mode = 'build' } = {}) {
  const input = args && typeof args === 'object' ? args : {}
  switch (name) {
    case 'shell':
      return runShell(String(input.command ?? ''), { mode, timeoutMs: Number(input.timeoutMs) })
    case 'read_file':
      return readWorkspaceFile(String(input.path ?? ''))
    case 'list_files': {
      const result = await listTree(String(input.path ?? ''), { depth: Number(input.depth) || 2 })
      return { ...result, files: result.entries.map((entry) => entry.path) }
    }
    case 'write_file':
      return writeWorkspaceFile(String(input.path ?? ''), String(input.content ?? ''))
    case 'rewrite_file':
      return writeWorkspaceFile(String(input.path ?? ''), String(input.content ?? ''))
    case 'edit_file':
      return editWorkspaceFile(String(input.path ?? ''), String(input.oldText ?? ''), String(input.newText ?? ''), {
        replaceAll: input.replaceAll === true,
      })
    case 'grep':
      return grepWorkspace(String(input.pattern ?? ''), {
        path: typeof input.path === 'string' ? input.path : '',
        ignoreCase: input.ignoreCase === true,
      })
    case 'web_search':
      return searchWeb(String(input.query ?? ''), { provider: String(input.provider ?? 'duckduckgo') })
    case 'read_url':
      return readUrl(String(input.url ?? ''))
    case 'git':
      return runGit(String(input.action ?? 'status'), input, { mode })
    default:
      throw new HttpError(400, `Unknown tool: ${name}`, 'unknown_tool')
  }
}

export async function discoverWorkspace(rawPath) {
  const info = await stat(path.resolve(String(rawPath))).catch(() => null)
  if (!info?.isDirectory()) throw new HttpError(400, 'That folder does not exist.', 'bad_workspace')
  const resolved = await realpath(String(rawPath))
  return { path: resolved, name: path.basename(resolved) || resolved }
}

export async function browseDirectories(rawPath) {
  const target = path.resolve(rawPath || process.env.HOME || '/')
  const info = await stat(target).catch(() => null)
  if (!info?.isDirectory()) throw new HttpError(400, 'That folder does not exist.', 'bad_folder')
  const parent = path.dirname(target)
  const children = await readdir(target, { withFileTypes: true }).catch(() => [])
  return {
    path: target,
    parent: parent === target ? '' : parent,
    home: process.env.HOME || '',
    entries: children
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 300)
      .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) })),
  }
}
