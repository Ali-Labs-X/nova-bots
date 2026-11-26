import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { allThemes } from '../src/client/themes.js'

// An open page on which nothing happens must not draw frames: a decoration that moves
// forever kept the browser busy all day (docs/design/ui-standard.md 9.5). Decorations
// may move when the page opens, then rest; what shows work in progress may move on.
const shell = name => readFileSync(new URL(`../../docker/nova/${name}`, import.meta.url), 'utf8')
const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
const forever = css => rules(css).filter(rule => /animation[^;]*\binfinite\b/.test(rule.body)).map(rule => rule.selector)

test('the decoration of every theme comes to rest', () => {
  for (const [id, theme] of Object.entries(allThemes())) {
    assert.deepEqual(forever(theme.css ?? ''), [], `theme ${id}`)
  }
})

test('the hosted shell moves forever only while the app has not mounted', () => {
  assert.deepEqual(forever(shell('nova-ui.css')), ['#root:empty::before'])
  assert.doesNotMatch(shell('brand-module.js'), /\binfinite\b/)
})

test('nothing behind the app is blurred as a whole panel', () => {
  const blurred = rules(allThemes().nova.css).filter(rule => /backdrop-filter/.test(rule.body)).map(rule => rule.selector)
  assert.deepEqual(blurred, ['html body [data-composer-card]'])
})
