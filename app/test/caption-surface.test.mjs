// The caption buttons of the app's window take the colour of the surface they stand on.
// The preload measures that surface in the window; our own page marks it, and the runtime's
// front end names its own columns, which the app does not know.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { installHooks } from './helpers/register.mjs'

await installHooks()

const require = createRequire(import.meta.url)
const { captionColumn } = require('../src/caption-column.cjs')

// The function as it stands in the shipped preload and in the module the test reads. The
// preload cannot require the module (it runs in a sandbox, where require only resolves a
// fixed list of modules), so it keeps its own copy; these two must stay the same text.
const functionText = source => {
  const match = /function captionColumn\(document, mica\) \{[\s\S]*?\n\}/u.exec(source)
  assert.ok(match !== null, 'captionColumn is not in the file')
  return match[0]
}

// A document that answers with the elements a page would have.
const documentWith = elements => ({
  querySelector: selector => elements.find(element => element.selector === selector) ?? null,
})

// The runtime's own column, with the width the page gives it.
const runtimeColumn = (selector, width = 320) => ({
  selector,
  getBoundingClientRect: () => ({ width }),
})

test('our own page names the column the caption buttons stand on', () => {
  const own = { selector: '[data-caption-surface]' }
  assert.equal(captionColumn(documentWith([own]), false), own)
  assert.equal(captionColumn(documentWith([own]), true), own)
})

test('the runtime\'s front end keeps its own columns', () => {
  const sidebar = runtimeColumn('div[class*="_sidebarCol"]')
  assert.equal(captionColumn(documentWith([sidebar]), false), sidebar)
  const center = runtimeColumn('div[class*="_centerCol"]')
  assert.equal(captionColumn(documentWith([center]), true), center)
  // The right sidebar stands on the buttons while it is open.
  const right = runtimeColumn('div[class*="_rightbarCol"]')
  assert.equal(captionColumn(documentWith([right, center]), true), right)
  // A right sidebar of no width is no sidebar.
  const closed = runtimeColumn('div[class*="_rightbarCol"]', 0)
  assert.equal(captionColumn(documentWith([closed, center]), true), center)
})

test('our own page marks the conversation column', () => {
  const source = readFileSync(new URL('../ui/src/app.js', import.meta.url), 'utf8')
  const column = /h\('main', \{([^}]*)\}/u.exec(source)
  assert.ok(column !== null, 'the conversation column is not rendered')
  assert.match(column[1], /dsb-main/u)
  assert.match(column[1], /'data-caption-surface'/u)
})

test('the shipped preload keeps the same function as the module', () => {
  const preload = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8')
  const module_ = readFileSync(new URL('../src/caption-column.cjs', import.meta.url), 'utf8')
  assert.equal(functionText(preload), functionText(module_), 'the preload and the module differ')
  // The shipped preload exports nothing: it runs in the renderer, not as a module.
  assert.equal(/module\.exports/u.test(preload), false, 'the shipped preload still exports')
})
