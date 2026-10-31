const ID = /^[a-z0-9][a-z0-9-]{0,47}$/

export function isPluginPreviewMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  if (value.type === 'ready') return Object.keys(value).length === 1
  if (value.type === 'command' || value.type === 'panel') {
    return (
      Object.keys(value).every((key) => ['type', 'id', 'label'].includes(key)) &&
      typeof value.id === 'string' &&
      ID.test(value.id) &&
      typeof value.label === 'string' &&
      value.label.trim().length > 0 &&
      value.label.length <= 80
    )
  }
  if (value.type === 'log' || value.type === 'error') {
    return (
      Object.keys(value).every((key) => ['type', 'message'].includes(key)) &&
      typeof value.message === 'string' &&
      value.message.length <= 500
    )
  }
  return false
}
