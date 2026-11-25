import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src', 'client')

// An overlay made from the text color lights the page up in a dark theme.
test('what lies behind a dialog is dimmed in both themes', () => {
  const overlays = readdirSync(CLIENT).filter(name => name.endsWith('.js')).flatMap(name =>
    [...readFileSync(join(CLIENT, name), 'utf8').matchAll(/(\.bt-[a-z-]*scrim)\{([^}]*)\}/g)]
      .map(([, selector, rules]) => [name, selector, /background:([^;]+)/.exec(rules)?.[1]]))
    .filter(([, , background]) => background !== undefined)
  assert.ok(overlays.length >= 4)
  for (const [name, selector, background] of overlays) assert.match(background, /^rgba\(0,0,0,/, `${name} ${selector}`)
})
