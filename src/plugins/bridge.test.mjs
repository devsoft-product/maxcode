import test from 'node:test'
import assert from 'node:assert/strict'
import { isPluginPreviewMessage } from './bridge.mjs'

test('preview bridge accepts bounded registration and status messages', () => {
  assert.equal(isPluginPreviewMessage({ type: 'ready' }), true)
  assert.equal(isPluginPreviewMessage({ type: 'command', id: 'open-panel', label: 'Open panel' }), true)
  assert.equal(isPluginPreviewMessage({ type: 'panel', id: 'settings', label: 'Settings' }), true)
  assert.equal(isPluginPreviewMessage({ type: 'log', message: 'preview ready' }), true)
})

test('preview bridge rejects API calls, malformed registrations, and oversized messages', () => {
  assert.equal(isPluginPreviewMessage({ type: 'api-call', method: 'workspace.read', path: 'secret' }), false)
  assert.equal(isPluginPreviewMessage({ type: 'command', id: '../x', label: 'Bad' }), false)
  assert.equal(isPluginPreviewMessage({ type: 'error', message: 'x'.repeat(501) }), false)
  assert.equal(isPluginPreviewMessage(Object.assign(Object.create({ polluted: true }), { type: 'ready' })), false)
})
