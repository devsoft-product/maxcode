import { isPluginPreviewMessage } from './bridge.mjs'

/**
 * Sandboxed preview: an iframe with no same-origin access and no direct network,
 * driven only by validated messages. No plugin API is exposed here.
 */
export function previewDocument(manifest: { id: string; name: string }, source: string, css: string): string {
  const bridge = `
    const send = (message) => parent.postMessage(message, '*')
    const api = {
      manifest: ${JSON.stringify({ id: manifest.id, name: manifest.name })},
      command: (id, label) => send({ type: 'command', id, label }),
      panel: (id, label) => send({ type: 'panel', id, label }),
      log: (message) => send({ type: 'log', message: String(message).slice(0, 500) }),
      network: () => { throw new Error('The sandboxed preview has no network access.') },
      workspace: { list: () => [], read: () => '', write: () => {}, edit: () => false },
    }
    try { ;(function (maxcode) { ${source} })(api) } catch (error) {
      send({ type: 'error', message: String(error && error.message ? error.message : error).slice(0, 500) })
    }
    send({ type: 'ready' })
  `
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><script>${bridge}</script></body></html>`
}

export function attachPreviewBridge(iframe: HTMLIFrameElement, onMessage: (message: unknown) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return
    if (!isPluginPreviewMessage(event.data)) return
    onMessage(event.data)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
