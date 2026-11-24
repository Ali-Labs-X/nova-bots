import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandOf, commandsFor, commandSource, runCommand } from '../src/client/commands.js'
import { bankEntries, bankPlaces } from '../src/client/memory-bank-model.js'

const bot = { id: 'b', name: 'Ada' }
const room = { id: 'r', name: 'Crew' }
const roster = { ready: true, byId: { b: bot, part2: bot }, roomsById: { r: room }, bots: [bot], rooms: [room] }
const names = list => list.map(command => command.name)

test('a Bot chat and a group take every command, another Session none', () => {
  assert.deepEqual(names(commandsFor(roster, 'part2')), ['clear', 'stop', 'folder', 'memory'])
  assert.deepEqual(names(commandsFor(roster, 'r')), ['clear', 'stop', 'folder', 'memory'])
  assert.deepEqual(commandsFor(roster, 'other'), [])
  assert.deepEqual(names(commandsFor({ ...roster, memory: false }, 'b', '/m')), [])
})

test('only a whole line is a command', () => {
  assert.equal(commandOf(roster, 'b', ' /clear ').name, 'clear')
  assert.equal(commandOf(roster, 'b', '/clear the cache'), undefined)
  assert.equal(commandOf(roster, 'b', '/clean'), undefined)
})

test('a command acts on the Bot, whichever part of its chat is open', async () => {
  const done = []
  await runCommand(commandOf(roster, 'part2', '/clear'), { roster, sessionId: 'part2', actions: { clearChat: id => { done.push(id) } } })
  assert.deepEqual(done, ['b'])
})

test('the "/" menu claims a picked command', async () => {
  const done = []
  const source = commandSource({ roster: { getSnapshot: () => roster }, actions: { openFolder: id => { done.push(id) } } })
  const [candidate] = await source.candidates({ sessionId: 'b' }, { query: 'fo' })
  const { claim } = source.onPick({ candidate, session: { sessionId: 'b' } })
  await assert.rejects(claim.submit('extra'))
  assert.deepEqual(await claim.submit(''), { kind: 'success' })
  assert.deepEqual(done, ['b'])
})

test('the Memory Bank lists one place, and searches all of them', () => {
  const places = bankPlaces(roster)
  assert.deepEqual(places.map(place => place.scope), ['team', 'own', 'group'])
  const views = { b: { entries: [{ scope: 'own', text: 'likes chai' }, { scope: 'team', text: 'ship Friday' }] }, r: { entries: [{ scope: 'group', text: 'Chai at five' }] } }
  assert.deepEqual(bankEntries(places, views, { selected: 'team', query: '' }).map(item => item.entry.text), ['ship Friday'])
  assert.deepEqual(bankEntries(places, views, { selected: 'team', query: 'CHAI' }).map(item => item.entry.text), ['likes chai', 'Chai at five'])
})
