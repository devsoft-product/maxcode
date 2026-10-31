import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPluginArchive, readPluginArchive } from './plugin-package.mjs'

const source = {
  manifest: {
    id: 'sample-plugin',
    name: 'Sample Plugin',
    version: '1.0.0',
    apiVersion: 1,
    entry: 'plugin.js',
    stylesheet: 'plugin.css',
    capabilities: ['workspace.read'],
    domains: ['api.example.test'],
  },
  files: {
    'plugin.js': 'api.registerCommand("sample", () => "ok")',
    'plugin.css': '.sample { color: red }',
    'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  },
}

test('plugin archive round-trips manifest and local source files', () => {
  const archive = buildPluginArchive(source)
  const result = readPluginArchive(archive)
  assert.deepEqual(result.manifest, source.manifest)
  assert.deepEqual(result.files, source.files)
})

test('plugin archive rejects traversal paths before packaging', () => {
  assert.throws(
    () => buildPluginArchive({ ...source, files: { ...source.files, '../outside.js': 'bad' } }),
    /path/i,
  )
})

test('plugin archive rejects a manifest whose entry is missing', () => {
  assert.throws(() => buildPluginArchive({ ...source, files: { 'plugin.css': 'x' } }), /entry/i)
})

test('plugin archive rejects undeclared executable source', () => {
  assert.throws(
    () => buildPluginArchive({ ...source, files: { ...source.files, 'extra.js': 'alert(1)' } }),
    /executable/i,
  )
})

test('plugin archive rejects remote code declarations and invalid domains', () => {
  assert.throws(
    () => buildPluginArchive({ ...source, manifest: { ...source.manifest, entry: 'https://evil.test/p.js' } }),
    /entry|path/i,
  )
  assert.throws(
    () => buildPluginArchive({ ...source, manifest: { ...source.manifest, domains: ['https://example.test'] } }),
    /domain/i,
  )
})

test('plugin archive rejects unmanaged network APIs and external CSS resources', () => {
  assert.throws(
    () => buildPluginArchive({ ...source, files: { ...source.files, 'plugin.js': 'fetch("https://evil.test")' } }),
    /network|remote/i,
  )
  assert.throws(
    () => buildPluginArchive({ ...source, files: { ...source.files, 'plugin.css': '@import url("https://evil.test/style.css")' } }),
    /network|remote|external/i,
  )
})

test('a rejected source names the file, the line and the text that matched', () => {
  // The pattern is text-only, so a comment or a string trips it too — the message
  // has to point at the match or the author cannot find it.
  assert.throws(
    () =>
      buildPluginArchive({
        ...source,
        files: { ...source.files, 'plugin.js': 'maxcode.log("hi")\n// export the palette\nconst x = 1' },
      }),
    /found "export" at plugin\.js:2/,
  )
  assert.throws(() => buildPluginArchive({ ...source, files: { ...source.files, 'plugin.js': 'fetch("https://evil.test")' } }), /"fetch\("/)
  assert.throws(
    () => buildPluginArchive({ ...source, files: { ...source.files, 'plugin.css': '.a{}\n@import url("https://evil.test/x.css")' } }),
    /plugin\.css:2/,
  )
})

test('plugin archive rejects malformed or oversized archives', () => {
  assert.throws(() => readPluginArchive(new Uint8Array([0, 1, 2, 3])), /archive|zip|package/i)
  assert.throws(
    () => buildPluginArchive({ ...source, files: { ...source.files, 'plugin.js': 'x'.repeat(10_485_761) } }),
    /size|large/i,
  )
})
