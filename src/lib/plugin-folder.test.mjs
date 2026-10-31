import assert from 'node:assert/strict'
import test from 'node:test'
import { isBinaryPath, loadPluginFolder } from './plugin-folder.ts'

const MANIFEST = JSON.stringify({
  id: 'demo-plugin',
  name: 'Demo plugin',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'main.js',
  stylesheet: 'main.css',
  capabilities: ['ui.commands'],
})

test('a picked folder drops its own name and keeps the file layout', () => {
  const folder = loadPluginFolder([
    { path: 'demo/main.js', content: 'maxcode.log("hi")' },
    { path: 'demo/styles/main.css', content: '.a{}' },
    { path: 'demo/assets/icon.bin', content: new Uint8Array([1, 2, 3]) },
  ])
  assert.deepEqual(Object.keys(folder.files).sort(), ['assets/icon.bin', 'main.js', 'styles/main.css'])
  assert.equal(folder.entry, 'main.js')
  assert.equal(folder.stylesheet, 'styles/main.css')
})

test('a loose file pick keeps its flat names and needs no stylesheet', () => {
  const folder = loadPluginFolder([{ path: 'main.js', content: '' }])
  assert.equal(folder.entry, 'main.js')
  assert.equal(folder.stylesheet, 'main.css')
  assert.equal(folder.manifest, undefined)
})

test('the folder manifest.json seeds the form and never becomes a package file', () => {
  const folder = loadPluginFolder([
    { path: 'demo/manifest.json', content: MANIFEST },
    { path: 'demo/main.js', content: '' },
  ])
  assert.equal(folder.manifest?.id, 'demo-plugin')
  assert.deepEqual(folder.manifest?.domains, [])
  assert.equal('manifest.json' in folder.files, false)
})

test('a folder without an entry file is rejected with a readable reason', () => {
  assert.throws(() => loadPluginFolder([{ path: 'demo/main.css', content: '.a{}' }]), /\.js entry/)
  assert.throws(() => loadPluginFolder([{ path: 'demo/manifest.json', content: 'not json' }]), /entry/i)
})

test('a broken manifest.json is reported without costing the load', () => {
  const folder = loadPluginFolder([
    { path: 'demo/main.js', content: 'maxcode.log("hi")' },
    { path: 'demo/manifest.json', content: '{oops' },
  ])
  assert.equal(folder.entry, 'main.js')
  assert.equal(folder.manifest, undefined)
  assert.match(folder.manifestError, /valid JSON/)
  const incomplete = loadPluginFolder([
    { path: 'demo/main.js', content: '' },
    { path: 'demo/manifest.json', content: '{"id":"x"}' },
  ])
  assert.equal(incomplete.manifest, undefined)
  assert.match(incomplete.manifestError, /plugin id/)
})

test('the folder manifest decides the entry, so a folder of many files picks the declared one', () => {
  const folder = loadPluginFolder([
    { path: 'demo/manifest.json', content: JSON.stringify({ ...JSON.parse(MANIFEST), entry: 'index.js', stylesheet: 'theme.css' }) },
    { path: 'demo/index.js', content: 'maxcode.log(1)' },
    { path: 'demo/theme.css', content: '.a{}' },
  ])
  assert.equal(folder.entry, 'index.js')
  assert.equal(folder.stylesheet, 'theme.css')
})

test('a folder with a second script is refused with the reason, not a validator error', () => {
  assert.throws(
    () =>
      loadPluginFolder([
        { path: 'demo/main.js', content: '' },
        { path: 'demo/helper.js', content: '' },
      ]),
    /one script and one stylesheet.*helper\.js/s,
  )
})

test('a nested src/main.js is the entry, and a sibling helper is named as the extra', () => {
  const folder = loadPluginFolder([
    { path: 'demo/src/main.js', content: '' },
    { path: 'demo/src/main.css', content: '' },
  ])
  assert.equal(folder.entry, 'src/main.js')
  assert.equal(folder.stylesheet, 'src/main.css')

  // The extra named must be the helper — naming main.js would mean the entry was misdetected.
  assert.throws(
    () =>
      loadPluginFolder([
        { path: 'demo/src/helper.js', content: '' },
        { path: 'demo/src/main.js', content: '' },
      ]),
    /one script and one stylesheet.*src\/helper\.js/s,
  )
})

test('the entry pick is stable when a folder has more than one .js', () => {
  const many = (order) => loadPluginFolder(order.map((path) => ({ path, content: '' })))
  const error = (order) => {
    try {
      many(order)
      return ''
    } catch (caught) {
      return caught.message
    }
  }
  assert.equal(error(['demo/zed.js', 'demo/alpha.js']), error(['demo/alpha.js', 'demo/zed.js']))
})

test('a declared entry that is not in the folder falls back to detection', () => {
  const folder = loadPluginFolder([
    { path: 'demo/manifest.json', content: JSON.stringify({ ...JSON.parse(MANIFEST), entry: 'missing.js' }) },
    { path: 'demo/main.js', content: '' },
  ])
  assert.equal(folder.entry, 'main.js')
})

test('binary assets are recognised by extension', () => {
  assert.equal(isBinaryPath('assets/icon.png'), true)
  assert.equal(isBinaryPath('fonts/inter.woff2'), true)
  assert.equal(isBinaryPath('main.js'), false)
  assert.equal(isBinaryPath('styles/main.css'), false)
})

test('a package built from a picked folder with no domains round-trips', async () => {
  const { buildPluginArchive, readPluginArchive } = await import('../../shared/plugin-package.mjs')
  const folder = loadPluginFolder([
    { path: 'demo/manifest.json', content: MANIFEST },
    { path: 'demo/main.js', content: 'maxcode.log("hi")' },
  ])
  assert.ok(folder.manifest)
  const archive = buildPluginArchive({
    manifest: folder.manifest,
    files: { ...folder.files, [folder.stylesheet]: '' },
  })
  assert.deepEqual(readPluginArchive(archive).files['main.js'], 'maxcode.log("hi")')
  assert.deepEqual(readPluginArchive(archive).manifest.domains, [])
})
