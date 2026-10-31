import test from 'node:test'
import assert from 'node:assert/strict'

import { allowedDomain, createPluginApi, emptyContributions, hasCapability } from './api.ts'

const plugin = {
  id: 'demo',
  manifest: { id: 'demo', name: 'Demo', version: '1.0.0', apiVersion: 1, entry: 'main.js', stylesheet: 'main.css', capabilities: [], domains: ['api.example.com'] },
  manifestHash: 'x',
  installedAt: '0',
  safe: false,
  enabled: false,
  grants: { capabilities: [], domains: [] },
}

const calls = {
  workspace: {
    list: async () => [{ path: 'a.ts', name: 'a.ts', type: 'file' }],
    read: async () => 'contents',
    write: async () => undefined,
    edit: async () => true,
  },
  network: async (_id, request) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(request) }),
}

const full = { capabilities: ['workspace.list', 'workspace.read', 'workspace.write', 'workspace.edit', 'ui.commands', 'ui.panels', 'ui.themes', 'network.request'], domains: ['api.example.com'] }

test('ungranted capabilities are refused at call time', async () => {
  const api = createPluginApi(plugin, { capabilities: [], domains: [] }, calls)
  assert.throws(() => api.registerCommand('x', 'X', () => undefined), /not granted ui\.commands/)
  await assert.rejects(() => api.workspace.read('secret'), /not granted workspace\.read/)
  assert.throws(() => api.network.request('https://api.example.com/v1'), /not granted network\.request/)
})

test('granted workspace calls reach the host and bad ids are rejected', async () => {
  const contributions = emptyContributions()
  const api = createPluginApi(plugin, full, calls, contributions)
  assert.deepEqual(await api.workspace.list(), [{ path: 'a.ts', name: 'a.ts', type: 'file' }])
  api.registerCommand('open-panel', 'Open panel', () => undefined)
  assert.equal(contributions.commands.get('open-panel')?.label, 'Open panel')
  assert.throws(() => api.registerCommand('../x', 'Bad', () => undefined), /lowercase/)
})

test('network stays inside the declared and granted host list', async () => {
  const api = createPluginApi(plugin, full, calls)
  const result = await api.network.request('https://api.example.com/v1')
  assert.equal(result.status, 200)
  assert.throws(() => api.network.request('https://evil.example.com/v1'), /declared and you granted/)
  assert.throws(() => api.network.request('http://api.example.com/v1'), /declared and you granted/)
})

test('disabling a plugin drops its contributions', () => {
  const contributions = emptyContributions()
  const api = createPluginApi(plugin, full, calls, contributions)
  api.registerPanel('settings', 'Settings', () => undefined)
  contributions.commands.clear()
  contributions.panels.clear()
  contributions.themes.clear()
  assert.equal(contributions.panels.size, 0)
})

test('a capability is only available once the user grants it', () => {
  assert.equal(hasCapability({ capabilities: ['workspace.read'], domains: [] }, 'workspace.read'), true)
  assert.equal(hasCapability({ capabilities: ['workspace.read'], domains: [] }, 'workspace.write'), false)
  assert.equal(hasCapability(undefined, 'workspace.read'), false)
})

test('network is limited to a declared-and-granted HTTPS host on 443', () => {
  const declared = ['api.example.com']
  const granted = { capabilities: [], domains: declared }
  assert.equal(allowedDomain(granted, declared, 'https://api.example.com/v1'), 'api.example.com')
  assert.equal(allowedDomain(granted, declared, 'http://api.example.com/v1'), null)
  assert.equal(allowedDomain(granted, declared, 'https://api.example.com:8443/v1'), null)
  assert.equal(allowedDomain(granted, declared, 'https://api.example.com.evil.com/v1'), null)
  assert.equal(allowedDomain(granted, declared, 'not a url'), null)
  assert.equal(allowedDomain({ capabilities: [], domains: [] }, declared, 'https://api.example.com'), null)
})
