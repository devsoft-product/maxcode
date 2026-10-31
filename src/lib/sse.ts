export async function* readSSE(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error('The provider returned an empty response body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data) yield data
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
    for (const line of buffer.split('\n')) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (data) yield data
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function parseErrorMessage(raw: string, status: number): string {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; type?: string } | string
      message?: string
    }
    if (typeof parsed.error === 'string') return `${parsed.error} (${status})`
    if (parsed.error?.message) return `${parsed.error.message} (${status})`
    if (parsed.message) return `${parsed.message} (${status})`
  } catch {
    // Fall through to the raw text, which is still useful.
  }
  const trimmed = raw.trim()
  if (trimmed.startsWith('<')) {
    return `The provider returned an HTML error page (${status}). Check the base URL and key.`
  }
  return trimmed ? `${trimmed.slice(0, 500)} (${status})` : `Request failed with status ${status}.`
}

export async function assertOk(response: Response): Promise<void> {
  if (response.ok) return
  const text = await response.text().catch(() => '')
  throw new Error(parseErrorMessage(text, response.status))
}

export function describeRequestError(error: unknown, providerName: string): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Stopped.'
  if (error instanceof Error) {
    if (/daemon is not reachable|lost the connection/i.test(error.message)) {
      return 'The local MaxCode daemon is not reachable. Start it with “npm start”, then try again.'
    }
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return `The local daemon could not reach ${providerName}. Check the network and the provider base URL, then try again.`
    }
    if (/401|403/.test(error.message) && /key|auth|permission|refus|reject/i.test(error.message)) {
      return `${error.message} Check the API key in Settings → Models, or choose a model this key can access.`
    }
    return error.message
  }
  return 'The request failed for an unknown reason.'
}
