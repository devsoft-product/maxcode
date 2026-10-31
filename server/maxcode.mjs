#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { open, readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, ensureDataDir } from './lib/store.mjs'
import { daemonStatus, startServer, stopDaemon } from './daemon.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DAEMON = path.join(HERE, 'daemon.mjs')
const LOG_FILE = path.join(DATA_DIR, 'daemon.log')
const PID_FILE = path.join(DATA_DIR, 'daemon.json')

const HELP = `MaxCode — local coding agent daemon

Usage:
  maxcode start [--port=4174] [--open] [--foreground]
  maxcode stop
  maxcode status
  maxcode open
  maxcode logs

The daemon serves the built app from dist/ and keeps your settings, chats and
encrypted provider keys in ${DATA_DIR}. It listens on 127.0.0.1 only.
`

function parseFlags(args) {
  const flags = { port: 4174, open: false, foreground: false }
  for (const arg of args) {
    if (arg === '--open') flags.open = true
    else if (arg === '--foreground') flags.foreground = true
    else if (arg.startsWith('--port=')) {
      const value = Number(arg.slice('--port='.length))
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error('Use --port=<1-65535>.')
      }
      flags.port = value
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return flags
}

function openerFor(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => console.log(`Open ${url} in your browser.`))
  child.unref()
}

async function tailLog(lines = 40) {
  const info = await stat(LOG_FILE).catch(() => null)
  if (!info) {
    console.log('No daemon log yet.')
    return
  }
  const raw = await readFile(LOG_FILE, 'utf8')
  const slice = raw.trimEnd().split('\n').slice(-lines)
  console.log(slice.join('\n'))
}

async function rotateLog() {
  const info = await stat(LOG_FILE).catch(() => null)
  if (info && info.size > 5 * 1024 * 1024) {
    const previous = `${LOG_FILE}.1`
    await unlink(previous).catch(() => undefined)
    const { rename } = await import('node:fs/promises')
    await rename(LOG_FILE, previous).catch(() => undefined)
  }
}

async function waitForDaemon(pid, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await daemonStatus()
    if (status.running) return status
    if (pid) {
      try {
        process.kill(pid, 0)
      } catch {
        return { running: false, info: null }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return { running: false, info: null }
}

async function commandStart(args) {
  const flags = parseFlags(args)
  if (flags.help) {
    console.log(HELP)
    return
  }
  await ensureDataDir()
  const existing = await daemonStatus()
  if (existing.running) {
    console.log(`MaxCode is already running at ${existing.info.url}`)
    if (flags.open) openerFor(existing.info.url)
    return
  }
  await unlink(PID_FILE).catch(() => undefined)

  if (flags.foreground) {
    await startServer({ port: flags.port, open: flags.open })
    return
  }

  await rotateLog()
  const handle = await open(LOG_FILE, 'a', 0o600)
  const child = spawn(process.execPath, [DAEMON, `--port=${flags.port}`], {
    detached: true,
    stdio: ['ignore', handle.fd, handle.fd],
    cwd: path.resolve(HERE, '..'),
    env: { ...process.env, MAXCODE_DATA: DATA_DIR },
  })
  child.unref()
  await handle.close()

  const status = await waitForDaemon(child.pid)
  if (!status.running) {
    console.error('MaxCode did not start. Recent log:')
    await tailLog(20)
    process.exitCode = 1
    return
  }
  console.log(`MaxCode is running at ${status.info.url}`)
  console.log(`Data: ${DATA_DIR}`)
  console.log(`Log:  ${LOG_FILE}`)
  if (flags.open) openerFor(status.info.url)
}

async function commandStatus() {
  const status = await daemonStatus()
  if (!status.running) {
    console.log('MaxCode is not running.')
    return
  }
  console.log(`MaxCode is running at ${status.info.url}`)
  console.log(`PID: ${status.info.pid}`)
  console.log(`Data: ${status.info.dataDir ?? DATA_DIR}`)
  console.log(`Dist ready: ${status.info.dist ? 'yes' : 'no'}`)
}

async function commandOpen() {
  const status = await daemonStatus()
  if (!status.running) {
    console.error('MaxCode is not running. Start it with: maxcode start')
    process.exitCode = 1
    return
  }
  openerFor(status.info.url)
  console.log(`Opened ${status.info.url}`)
}

async function commandStop() {
  const result = await stopDaemon()
  if (!result.stopped) {
    console.log(result.reason ?? 'MaxCode is not running.')
    return
  }
  console.log(`Stopped MaxCode${result.pid ? ` (pid ${result.pid})` : ''}.`)
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2)
  switch (command) {
    case 'start':
      await commandStart(args)
      break
    case 'stop':
      await commandStop()
      break
    case 'status':
      await commandStatus()
      break
    case 'open':
      await commandOpen()
      break
    case 'logs':
      await tailLog()
      break
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      break
    default:
      console.error(`Unknown command: ${command}\n`)
      console.log(HELP)
      process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
