import assert from 'node:assert/strict'
import test from 'node:test'
import { previewDocument } from './preview.ts'

test('the preview document carries the stylesheet, the manifest identity and the source', () => {
  const html = previewDocument({ id: 'demo', name: 'Demo' }, 'maxcode.log("hi")', 'body{color:red}')
  assert.match(html, /<style>body\{color:red\}<\/style>/)
  assert.match(html, /\{"id":"demo","name":"Demo"\}/)
  assert.match(html, /maxcode\.log\("hi"\)/)
  assert.equal(html.startsWith('<!doctype html>'), true)
})

test('the preview hands the plugin a stub API with no network and no workspace writes', () => {
  const html = previewDocument({ id: 'demo', name: 'Demo' }, '', '')
  assert.match(html, /network: \(\) => \{ throw new Error\('The sandboxed preview has no network access\.'\) \}/)
  assert.match(html, /list: \(\) => \[\]/)
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|allow-same-origin/)
})
