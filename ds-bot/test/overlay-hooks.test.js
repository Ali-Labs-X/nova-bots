import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// jsdom comes from the harness that test/harness-resolve.mjs found, like the dsh packages.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS ?? join(PLUGIN, '..', 'deepseek-harness'), 'package.json'))('jsdom')
const { outputFiles } = await build({
  entryPoints: [join(PLUGIN, 'src/client/overlay-hooks.js')],
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react'],
})

// The shell as it is in the Bot view: its own sidebar is collapsed under the Bot column.
const SHELL = left => `<!doctype html><body>
  <div class="a_frame" data-sidebar-collapsed="true">
    <div class="a_sidebarCol" data-x="0" data-right="1"><div class="b_root b_collapsed" data-x="0" data-right="20"><div class="b_footArea" data-x="10" data-right="22"></div></div></div>
    <div class="a_centerCol" data-x="${left}" data-right="1280"></div>
  </div></body>`

function paneLeft(html) {
  const { window } = new JSDOM(html)
  window.HTMLElement.prototype.getBoundingClientRect = function () { return { left: Number(this.dataset.x), right: Number(this.dataset.right) } }
  const seen = { observers: [] }
  const react = {
    useState: (initial) => { seen.value = initial; return [initial, (next) => { seen.value = next }] },
    useLayoutEffect: (effect) => { seen.cleanup = effect() },
    useEffect() {}, useRef: current => ({ current }),
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.on = []; seen.observers.push(this) }
    observe(node) { this.on.push(node) }
    disconnect() { this.on = [] }
  }
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => react, document: window.document, window, ResizeObserver })
  module.exports.usePaneLeft()
  return { seen, column: window.document.querySelector('.a_centerCol') }
}

test('a pane starts where the conversation does, not over the Bot column', () => {
  assert.equal(paneLeft(SHELL(280)).seen.value, 280)
  assert.equal(paneLeft(SHELL(88)).seen.value, 88)
})

test('a hidden column leaves the pane the whole window', () => {
  assert.equal(paneLeft(SHELL(0)).seen.value, 0)
})

test('a pane follows the column when it is dragged or folded, until it closes', () => {
  const { seen, column } = paneLeft(SHELL(280))
  column.dataset.x = '340'
  seen.observers[0].callback()
  assert.equal(seen.value, 340)
  seen.cleanup()
  assert.deepEqual(seen.observers[0].on, [])
})

test('with no conversation to measure a pane leaves the column its usual width', () => {
  assert.equal(paneLeft('<!doctype html><body></body>').seen.value, 280)
})
