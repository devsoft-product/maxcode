import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildPluginArchive } from '../../shared/plugin-package.mjs'

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'maxcode-plugin-test-'))
process.env.MAXCODE_DATA = dataDir
const plugins = await import('./plugins.mjs')

const baseManifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'plugin.js',
  stylesheet: 'plugin.css',
  capabilities: ['network.request'],
  domains: ['api.example.test'],
}

function packageBytes(manifest = baseManifest) {
  return buildPluginArchive({
    manifest,
    files: { 'plugin.js': 'api.registerCommand("sample", () => {})', 'plugin.css': '' },
  })
}

async function installAndGrant(manifest = baseManifest) {
  await plugins.installPlugin(packageBytes(manifest))
  await plugins.setPluginGrants(manifest.id, {
    capabilities: manifest.capabilities,
    domains: manifest.domains,
  })
  await plugins.setPluginSafe(manifest.id, true)
  await plugins.setPluginEnabled(manifest.id, true)
}

beforeEach(async () => {
  for (const plugin of await plugins.listPlugins()) await plugins.uninstallPlugin(plugin.id)
})

test('installing a package starts disabled and not trusted', async () => {
  const archive = packageBytes()
  const installed = await plugins.installPlugin(archive)
  assert.equal(installed.enabled, false)
  assert.equal(installed.safe, false)
  assert.deepEqual(installed.grants, { capabilities: [], domains: [] })
  assert.equal((await plugins.listPlugins()).length, 1)
  assert.deepEqual(await plugins.getPluginArchive(installed.id), Buffer.from(archive))
})

test('enabling an untrusted plugin or granting undeclared access is rejected', async () => {
  await plugins.installPlugin(packageBytes())
  await assert.rejects(plugins.setPluginEnabled('test-plugin', true), /trust|Safe/i)
  await assert.rejects(
    plugins.setPluginGrants('test-plugin', { capabilities: ['workspace.write'], domains: [] }),
    /undeclared/i,
  )
})

test('permission decisions reject malformed grant and activation values', async () => {
  await plugins.installPlugin(packageBytes())
  await assert.rejects(
    plugins.setPluginGrants('test-plugin', { capabilities: 'network.request', domains: [] }),
    /grant|capabilit/i,
  )
  await assert.rejects(plugins.setPluginSafe('test-plugin', 'true'), /trust|true or false/i)
  await assert.rejects(plugins.setPluginEnabled('test-plugin', 'true'), /activation|true or false/i)
})

test('changing a manifest revokes prior trust and grants', async () => {
  await installAndGrant()
  const changed = { ...baseManifest, domains: ['api.example.test', 'new.example.test'] }
  const result = await plugins.installPlugin(packageBytes(changed))
  assert.equal(result.safe, false)
  assert.equal(result.enabled, false)
  assert.deepEqual(result.grants, { capabilities: [], domains: [] })
})

test('network requests require a separately granted exact domain', async () => {
  await installAndGrant()
  let called = false
  await assert.rejects(
    plugins.requestPluginNetwork('test-plugin', { url: 'https://other.example.test/data' }, {
      fetchImpl: async () => {
        called = true
        return new Response('ok')
      },
      lookupImpl: async () => [{ address: '93.184.216.34' }],
    }),
    /domain|permission/i,
  )
  assert.equal(called, false)
})

test('network requests reject redirects instead of following them', async () => {
  await installAndGrant()
  await assert.rejects(
    plugins.requestPluginNetwork('test-plugin', { url: 'https://api.example.test/data' }, {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://other.example.test/' } }),
      lookupImpl: async () => [{ address: '93.184.216.34' }],
    }),
    /redirect/i,
  )
})

test('network responses reject executable and oversized content', async () => {
  await installAndGrant()
  await assert.rejects(
    plugins.requestPluginNetwork('test-plugin', { url: 'https://api.example.test/file' }, {
      fetchImpl: async () => new Response('alert(1)', { headers: { 'content-type': 'application/javascript' } }),
      lookupImpl: async () => [{ address: '93.184.216.34' }],
    }),
    /content type/i,
  )
  await assert.rejects(
    plugins.requestPluginNetwork('test-plugin', { url: 'https://api.example.test/large' }, {
      fetchImpl: async () => new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'text/plain' } }),
      lookupImpl: async () => [{ address: '93.184.216.34' }],
    }),
    /large|size/i,
  )
})

test('network requests reject private DNS results', async () => {
  await installAndGrant()
  await assert.rejects(
    plugins.requestPluginNetwork('test-plugin', { url: 'https://api.example.test/data' }, {
      fetchImpl: async () => new Response('unexpected'),
      lookupImpl: async () => [{ address: '127.0.0.1' }],
    }),
    /private/i,
  )
})

test.after(async () => {
  await rm(dataDir, { recursive: true, force: true })
})
