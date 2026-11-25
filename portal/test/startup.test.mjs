import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Auth } from '../auth.mjs'
import { untilDatabase } from '../startup.mjs'

const failure = code => Object.assign(new Error(code), { code })
const quiet = { sleep: async () => {}, log: () => {} }

test('a database that is still starting is waited for', async () => {
  const answers = [failure('ECONNREFUSED'), failure('ECONNRESET'), failure('57P03')]
  let calls = 0
  const value = await untilDatabase(async () => { calls += 1; const error = answers.shift(); if (error) throw error; return 'ready' }, quiet)
  assert.deepEqual([value, calls], ['ready', 4])
})

test('an error that waiting cannot fix stops the start at once', async () => {
  let calls = 0
  await assert.rejects(untilDatabase(async () => { calls += 1; throw failure('28P01') }, quiet), { code: '28P01' })
  assert.equal(calls, 1)
})

test('a database that never comes up ends the start', async () => {
  let time = 0
  await assert.rejects(untilDatabase(async () => { throw failure('ECONNREFUSED') },
    { ...quiet, sleep: async (ms) => { time += ms }, now: () => time, timeoutMs: 10000 }), { code: 'ECONNREFUSED' })
  assert.ok(time >= 10000)
})

test('a lost idle database connection does not stop the portal', async (t) => {
  const auth = new Auth({ databaseUrl: 'postgres://127.0.0.1:1/none', jwtSecret: 'x'.repeat(32) })
  t.after(() => auth.pool.end())
  t.mock.method(console, 'error', () => {})
  assert.doesNotThrow(() => auth.pool.emit('error', failure('57P01')))
})
