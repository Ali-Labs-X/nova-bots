// The app's own UI takes the webserver's fallback seat: the runtime's own front end
// (`web-runtime`) gives it up, and the runtime's static frontend plugin serves the app's
// `ui/dist` instead. The overlay is written next to the profiles and read only through
// `patchFiles`, so it cannot rewrite the profile or outlive the launch.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { parse } from 'yaml'
import { reconcileUiPatch, UI_PATCH_NAME, uiPatch } from '../src/ui-patch.mjs'

const STATIC_FRONTEND = '@deepseek-ai/dsh-host-frontend-static'

// A stand-in profile: the app's own, with the folder the runtime keeps the profiles in.
function profile() {
  const dir = mkdtempSync(join(tmpdir(), 'ds-bot-ui-patch-'))
  return { name: 'ds-bot', dir, patchPath: join(dir, 'cordis.patch.yml'), skippedBundles: [], layers: [], patches: [] }
}

describe('uiPatch', () => {
  test('the runtime row gives up the seat and the static frontend takes it', () => {
    const rows = uiPatch('/app/ui/dist/index.html')
    assert.deepEqual(rows.find(row => row.id === 'web-runtime'), { id: 'web-runtime', disabled: true })
    // The webApp service goes with the runtime row, so this bundle entry would stay pending
    // and the Host would warn about it on every launch.
    assert.deepEqual(rows.find(row => row.id === 'harness-dev-context'), { id: 'harness-dev-context', disabled: true })
    const inserted = rows.find(row => row.insert !== undefined)?.insert?.[0]
    assert.equal(inserted?.id, 'frontend-static')
    assert.equal(inserted?.name, STATIC_FRONTEND)
    assert.equal(inserted?.config?.distIndex, '/app/ui/dist/index.html')
  })
})

describe('reconcileUiPatch', () => {
  let dir, index
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ds-bot-ui-reconcile-'))
    index = join(dir, 'index.html')
    writeFileSync(index, '<!doctype html><title>Nova Bots</title>')
  })
  after(() => { rmSync(dir, { recursive: true, force: true }) })

  test('writes the overlay where the runtime reads it only through patchFiles', () => {
    const p = profile()
    try {
      const [file] = reconcileUiPatch(p, index)
      assert.equal(file, join(p.dir, '..', UI_PATCH_NAME))
      assert.notEqual(file, p.patchPath)
      assert.equal(existsSync(file), true)
    } finally {
      rmSync(p.dir, { recursive: true, force: true })
    }
  })

  test('the written overlay disables the runtime row and names the app\'s own index', () => {
    const p = profile()
    try {
      const [file] = reconcileUiPatch(p, index)
      const rows = parse(readFileSync(file, 'utf8'))
      assert.deepEqual(rows.find(row => row.id === 'web-runtime'), { id: 'web-runtime', disabled: true })
      assert.deepEqual(rows.find(row => row.id === 'harness-dev-context'), { id: 'harness-dev-context', disabled: true })
      const inserted = rows.find(row => row.insert !== undefined)?.insert?.[0]
      assert.equal(inserted?.id, 'frontend-static')
      assert.equal(inserted?.name, STATIC_FRONTEND)
      assert.equal(inserted?.config?.distIndex, index)
    } finally {
      rmSync(p.dir, { recursive: true, force: true })
    }
  })

  test('drops a stale overlay when the app has no UI of its own', () => {
    const p = profile()
    try {
      const [file] = reconcileUiPatch(p, index)
      assert.equal(existsSync(file), true)
      // A build without a UI: the runtime's own front end answers the window again.
      assert.deepEqual(reconcileUiPatch(p, ''), [])
      assert.equal(existsSync(file), false)
      // An index that is not there is the same case.
      reconcileUiPatch(p, index)
      assert.deepEqual(reconcileUiPatch(p, join(dir, 'gone.html')), [])
      assert.equal(existsSync(file), false)
    } finally {
      rmSync(p.dir, { recursive: true, force: true })
    }
  })
})
