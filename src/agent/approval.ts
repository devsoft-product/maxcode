const pending = new Map<string, { resolve: (allow: boolean) => void; cleanup: () => void }>()

export function waitForApproval(toolCallId: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const finish = (allow: boolean) => {
      const entry = pending.get(toolCallId)
      if (!entry) return
      entry.cleanup()
      pending.delete(toolCallId)
      resolve(allow)
    }
    const onAbort = () => finish(false)
    signal.addEventListener('abort', onAbort, { once: true })
    pending.set(toolCallId, {
      resolve: finish,
      cleanup: () => signal.removeEventListener('abort', onAbort),
    })
  })
}

export function resolveApproval(toolCallId: string, allow: boolean) {
  pending.get(toolCallId)?.resolve(allow)
}
