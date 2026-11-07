import assert from 'node:assert/strict'
import { test } from 'node:test'
import { APP_UI_PARTS, composerTextExpression, cssRules, pageKindExpression } from '../scripts/page-rules.mjs'

// The expressions run in the window, so they are read with a document that answers with
// the elements a page would have.
const run = (expression, document) => new Function('document', `return ${expression}`)(document)

const documentWith = elements => ({
  querySelector: selector => elements.find(element => selector.split(',').some(part => element.selector === part.trim())) ?? null,
  querySelectorAll: selector => elements.filter(element => selector.split(',').some(part => element.selector === part.trim())),
})

test('the rules of a stylesheet are its selectors, without the comments', () => {
  const css = `/* a comment, with a { brace in it */
body, .a, .b::before { color: red }
.c { color: blue }`
  assert.deepEqual(cssRules(css), [['.a', '.b'], ['.c']])
})

test('the page under test is the app\'s own UI or the runtime\'s front end', () => {
  const kind = elements => run(pageKindExpression, documentWith(elements))
  assert.equal(kind([{ selector: '.dsb-frame' }]), 'app')
  assert.equal(kind([{ selector: '[class*="_frame"]' }]), 'runtime')
  assert.equal(kind([{ selector: '#root' }]), 'unknown')
})

test('the parts of the app\'s own UI are the ones the app always renders', () => {
  assert.equal(APP_UI_PARTS.includes('#root'), true)
  assert.equal(APP_UI_PARTS.includes('.dsb-frame'), true)
  // Every part is a selector of our own bundle, so the guard asks the page for our own
  // classes and not for the classes of the runtime's shell.
  for (const part of APP_UI_PARTS) assert.equal(/^[#.][A-Za-z_][\w-]*$/u.test(part), true, `${part} is not a class or an id`)
})

test('the typed text is the value of the composer', () => {
  const typed = elements => run(composerTextExpression, documentWith(elements))
  // The app's own composer is a textarea: its text is its value, not the text of the page.
  assert.equal(typed([{ selector: 'textarea', value: 'packaged app check' }]), 'packaged app check')
  // The runtime's shell keeps the text of an editable field.
  assert.equal(typed([{ selector: '[role=textbox][contenteditable=true]', innerText: 'packaged app check' }]), 'packaged app check')
  // Without a composer there is no text.
  assert.equal(typed([]), '')
})
