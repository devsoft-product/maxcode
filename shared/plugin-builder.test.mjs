import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPluginArchive, readPluginArchive, validatePluginManifest } from './plugin-package.mjs'

const manifest = {
  id: 'demo-plugin',
  name: 'Demo plugin',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'main.js',
  stylesheet: 'main.css',
  capabilities: ['ui.commands'],
  domains: [],
}

test('a built package reopens with its sources and assets intact', () => {
  const archive = buildPluginArchive({
    manifest,
    files: { 'main.js': 'maxcode.log("hi")', 'main.css': '.a{}', 'assets/icon.txt': 'icon' },
  })
  const reopened = readPluginArchive(archive)
  assert.equal(reopened.manifest.id, 'demo-plugin')
  assert.equal(reopened.files['main.js'], 'maxcode.log("hi")')
  assert.equal(reopened.files['main.css'], '.a{}')
  assert.equal(reopened.files['assets/icon.txt'], 'icon')
})

test('a manifest may omit domains entirely — a plugin with no network declares none', () => {
  const { domains, ...withoutDomains } = manifest
  assert.deepEqual(validatePluginManifest(withoutDomains).domains, [])
  assert.deepEqual(readPluginArchive(buildPluginArchive({
    manifest: withoutDomains,
    files: { 'main.js': 'maxcode.log("hi")', 'main.css': '' },
  })).manifest.domains, [])
  assert.throws(() => validatePluginManifest({ ...manifest, domains: 'api.example.com' }), /domains must be an array/)
})

test('the builder rejects an invalid manifest before packaging', () => {
  assert.throws(() => validatePluginManifest({ ...manifest, id: 'Bad Id' }), /Invalid \.pluginmax package/)
  assert.throws(() => validatePluginManifest({ ...manifest, entry: 'main.ts' }), /entry must be JavaScript/)
  assert.throws(() => validatePluginManifest({ ...manifest, capabilities: ['shell.exec'] }), /capabilit/i)
  assert.throws(() => validatePluginManifest({ ...manifest, domains: ['https://api.example.com'] }), /domain/i)
})
