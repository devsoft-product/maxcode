import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
}

export class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // `blob:` lets a user-approved Safe plugin load as a module without unsafe-eval.
      "script-src 'self' 'unsafe-inline' blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  )
}

export function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(body)
}

export function sendError(res, error) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  const status = error instanceof HttpError ? error.status : 500
  const message =
    error instanceof HttpError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'The daemon hit an unexpected error.'
  json(res, status, {
    error: {
      message,
      code: error instanceof HttpError ? error.code : 'daemon_error',
      status,
    },
  })
}

export async function readBody(req, maxBytes = 8 * 1024 * 1024) {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'That request is too large.', 'request_too_large')
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) {
      throw new HttpError(413, 'That request is too large.', 'request_too_large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function readJson(req, maxBytes = 8 * 1024 * 1024) {
  const body = await readBody(req, maxBytes)
  if (body.length === 0) return {}
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.', 'invalid_json')
  }
}

export function clientIp(req) {
  return req.socket.remoteAddress ?? 'local'
}

export function cookieValue(req, name) {
  const header = req.headers.cookie
  if (!header) return ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim())
  }
  return ''
}

export function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`]
  if (options.httpOnly !== false) parts.push('HttpOnly')
  parts.push(`SameSite=${options.sameSite ?? 'Strict'}`)
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
  if (options.secure) parts.push('Secure')
  const existing = res.getHeader('Set-Cookie')
  const next = Array.isArray(existing) ? [...existing, parts.join('; ')] : existing ? [String(existing), parts.join('; ')] : [parts.join('; ')]
  res.setHeader('Set-Cookie', next)
}

export async function serveStatic(req, res, root, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
  }
  let relative
  try {
    relative = decodeURIComponent(pathname)
  } catch {
    throw new HttpError(400, 'That path is not valid.', 'invalid_path')
  }
  if (relative.includes('\0')) throw new HttpError(400, 'That path is not valid.', 'invalid_path')
  relative = relative.replace(/^\/+/, '')
  const candidate = path.resolve(root, relative)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (candidate !== root && !candidate.startsWith(prefix)) {
    throw new HttpError(403, 'That path is outside the app.', 'forbidden')
  }

  let target = candidate
  let info
  try {
    info = await stat(target)
  } catch {
    info = null
  }
  if (info?.isDirectory()) {
    target = path.join(target, 'index.html')
    info = await stat(target).catch(() => null)
  }
  if (!info?.isFile()) {
    // App routes are client-side. Only fall back for navigation requests.
    const accepts = String(req.headers.accept ?? '')
    if (pathname.startsWith('/api/') || (!accepts.includes('text/html') && pathname !== '/')) {
      throw new HttpError(404, 'Not found.', 'not_found')
    }
    target = path.join(root, 'index.html')
    info = await stat(target).catch(() => null)
  }
  if (!info?.isFile()) {
    throw new HttpError(503, 'MaxCode is not built yet. Run the remote build and place the output in dist/.', 'dist_missing')
  }

  const ext = path.extname(target).toLowerCase()
  const immutable = target.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(target)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

export function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
