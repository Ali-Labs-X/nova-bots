// The public pages may move all the time, but only in ways the browser hands to
// its compositor (docs/design/ui-standard.md 9.5). An endless animation of a
// filter or a background is painted again on the main thread for every frame.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../public/', import.meta.url)
const pages = readdirSync(dir).filter(name => name.endsWith('.html'))

const keyframes = css => Object.fromEntries([...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)].map(([, name, body]) => [name, body]))
const endless = css => [...css.matchAll(/animation:\s*([\w-]+)[^;]*\binfinite\b/g)].map(([, name]) => name)

test('an endless animation on a public page changes only transform and opacity', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(page, dir), 'utf8')
    const frames = keyframes(html)
    for (const name of new Set(endless(html))) {
      assert.ok(frames[name] !== undefined, `${page}: @keyframes ${name}`)
      const properties = [...frames[name].matchAll(/([\w-]+)\s*:/g)].map(([, property]) => property)
      assert.deepEqual(properties.filter(property => !['transform', 'opacity'].includes(property)), [], `${page}: ${name}`)
    }
  }
})
