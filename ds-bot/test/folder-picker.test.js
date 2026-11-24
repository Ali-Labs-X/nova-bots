import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/folder-picker.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react', 'react-dom'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => ({}) })
const { pickerPlaces } = module.exports

test('picking starts from the host places, and lists each folder once', () => {
  const info = { team: '/workspace', places: [{ path: '/host', title: 'This computer' }], folders: [{ path: '/host', title: 'host' }, { path: '/srv', title: 'srv' }] }
  assert.equal(pickerPlaces(info, '/home/n').map(place => place.path).join(), '/host,/workspace,/home/n,/srv')
  assert.equal(pickerPlaces(info, undefined, false).map(place => place.path).join(), '/host,/srv')
})

test('the container starts picking at the mounted host folder', () => {
  assert.match(readFileSync(new URL('../../docker/docker.patch.yml', import.meta.url), 'utf8'), /places:\s+- \{ path: \/host,/)
})
