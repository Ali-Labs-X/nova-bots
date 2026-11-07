import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { APP_UI_PARTS, composerTextExpression, cssRules, pageKindExpression, surfaceTreatment } from '../scripts/page-rules.mjs'

// The stylesheet of our own UI, the one the app's own page is painted with.
const ownCss = () => readFileSync(new URL('../ui/src/app.css', import.meta.url), 'utf8')

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

test('the sidebar shows the material of the window only when the window has it', () => {
  const treatment = surfaceTreatment(ownCss(), ['body', '.dsb-side', '.dsb-main'])
  // The page under the surfaces lets the material through, or the sidebar hides it.
  assert.equal(treatment.body.mica, true, 'the page under the surfaces is opaque with the material')
  // The sidebar is a translucent variant of the theme's own colour, so the theme still reads.
  assert.equal(treatment['.dsb-side'].mica, true, 'the sidebar does not show the material')
  // Without the material the surfaces keep the theme's own colours.
  assert.equal(treatment.body.opaque, true, 'the page has no colour of its own')
  assert.equal(treatment['.dsb-side'].opaque, true, 'the sidebar has no colour of its own')
  // A window without the material must not show it through the surfaces.
  assert.equal(treatment.body.translucent, false, 'the page is translucent without the material')
  assert.equal(treatment['.dsb-side'].translucent, false, 'the sidebar is translucent without the material')
  // The conversation stays opaque, so the text on it stays readable.
  assert.equal(treatment['.dsb-main'].mica, false, 'the conversation shows the material')
  assert.equal(treatment['.dsb-main'].opaque, true, 'the conversation has no colour of its own')
})
