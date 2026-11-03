import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_COLORS, DEFAULT_SHAPES, FALLBACK_SHAPE, MAIN_LOOK, PICKER_SHAPES, SHAPES, defaultColor, defaultShape, lookOf, shapeId, shapeOf } from '../src/client/characters.js'
import { indexRoster } from '../src/client/sources.js'

const ids = Array.from({ length: 3000 }, (_, index) => `session-${index.toString(16).padStart(8, '0')}-look`)

test('every picker character draws a complete avatar with no missing paths', () => {
  for (const id of PICKER_SHAPES) {
    const shape = SHAPES[id]
    assert.ok(shape.path, `${id} has no body path`)
    assert.ok(!shape.layers.includes('undefined'), `${id} has a missing shade or highlight path`)
  }
})

test('the old mascot is gone: it is neither a picker shape nor a default', () => {
  assert.ok(!PICKER_SHAPES.includes('whale'))
  assert.ok(!DEFAULT_SHAPES.includes('whale'))
  assert.equal(SHAPES.whale, undefined)
  // The Nova spark is the Main Bot's own look, and it has a name of its own.
  assert.equal(MAIN_LOOK.shape, 'nova')
  assert.equal(SHAPES.nova.label, 'Nova Spark')
})

test('a Bot with no look of its own never gets gray, brown, or black', () => {
  for (const color of ['gray', 'brown', 'black', 'aurora']) assert.ok(!DEFAULT_COLORS.includes(color), color)
  const shapes = new Set(ids.map(defaultShape))
  const colors = new Set(ids.map(defaultColor))
  assert.deepEqual([...shapes].sort(), [...DEFAULT_SHAPES].sort())
  assert.deepEqual([...colors].sort(), [...DEFAULT_COLORS].sort())
})

test('a Bot saved with the old shape id still reads as the Nova spark', () => {
  const bot = { id: 'chief', name: 'Orion', color: 'nova', avatar: { shape: 'whale' } }
  assert.deepEqual(lookOf(bot), { shape: 'nova', color: 'nova', image: undefined })
  // The old id is a shape, so the Bot keeps the look it was saved with.
  assert.equal(shapeId('whale'), 'nova')
  assert.equal(shapeOf('whale').label, SHAPES.nova.label)
  // An id no shape ever had is still the fallback.
  assert.equal(shapeId('gargoyle'), FALLBACK_SHAPE)
})

const roster = (bots, mainBotIds) => indexRoster({ bots, rooms: [], mainBotIds, mainBotId: mainBotIds[0] ?? null })

test('the Nova spark is only a stored look: the browser gives no Bot a look by its place in the team', () => {
  const chief = { id: 'chief', name: 'Orion', createdAt: 1, color: 'nova', avatar: { shape: 'nova' } }
  const writer = { id: 'writer', name: 'Writer', createdAt: 2 }
  assert.deepEqual(lookOf(roster([writer, chief], ['chief']).byId.chief), { ...MAIN_LOOK, image: undefined })
  // The first Main Bot left, with no stored look, keeps the look its id gives it.
  const left = roster([writer], ['writer']).byId.writer
  assert.deepEqual(lookOf(left), { shape: defaultShape('writer'), color: defaultColor('writer'), image: undefined })
  const photo = lookOf({ id: 'chief', avatar: { image: 'data:image/png;base64,AA==' } })
  assert.equal(photo.image, 'data:image/png;base64,AA==')
  assert.equal(photo.shape, defaultShape('chief'))
})

test('Bot settings is the only settings entry; nothing is called Team settings', () => {
  const dir = new URL('../src/client/', import.meta.url)
  const sources = readdirSync(dir).filter(name => name.endsWith('.js')).map(name => [name, readFileSync(new URL(name, dir), 'utf8')])
  for (const [name, text] of [...sources, ['client.js', readFileSync(new URL('../client.js', import.meta.url), 'utf8')]]) {
    assert.ok(!text.includes('Team settings'), `${name} still names Team settings`)
  }
  const text = name => sources.find(([file]) => file === name)[1]
  assert.match(text('sidebar.js'), /\[t\('Bot settings'\), GearIcon, \(\) => actions\.openSettings\('general'\)\]/)
  assert.match(text('palette.js'), /title: t\('Bot settings'\), run: \(\) => actions\.openSettings\('general'\)/)
  // One Bot's own entries open that Bot, so they read Edit Bot instead.
  assert.match(text('context-menu.js'), /\[t\('Edit Bot'\), GearIcon, \(\) => actions\.openSettings\('bots', bot\.id\)\]/)
  assert.match(text('details-drawer.js'), /'aria-label': bot \? t\('Edit Bot'\) : t\('Group settings'\), title: bot \? t\('Edit Bot'\) : t\('Group settings'\)/)
  // A group chat's entries open its own settings the same way.
  assert.match(text('context-menu.js'), /\[t\('Group settings'\), GearIcon, \(\) => actions\.openSettings\('groups', room\.id\)\]/)
  assert.ok(!text('mark.js').includes('WhaleLogo'))
})
