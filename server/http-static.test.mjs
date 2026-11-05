import test from 'node:test'
import assert from 'node:assert/strict'
import { staticContentType } from './http.mjs'

test('bundled web fonts are served with a font content type', () => {
  assert.equal(staticContentType('/assets/geist-latin-wght-normal.woff2'), 'font/woff2')
  assert.equal(staticContentType('/assets/geist-latin-wght-normal.woff'), 'font/woff')
})

test('unknown extensions stay opaque', () => {
  assert.equal(staticContentType('/assets/blob.bin'), 'application/octet-stream')
})
