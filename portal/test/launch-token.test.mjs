// The engine's launch token: the file first, then the log's tokens newest
// first, and a token the engine refuses is dropped so the next one is tried.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LaunchTokenPool, tokensFromLog } from '../launch-token.mjs'

const LOG = [
  'Nova Bots: http://127.0.0.1:3080/?token=oldtoken0123456789',
  'Nova Bots: http://127.0.0.1:3080/?token=midtoken0123456789',
  'Nova Bots: http://127.0.0.1:3080/?token=newtoken0123456789',
].join('\n')

const poolOf = (overrides = {}) => new LaunchTokenPool({
  file: '/nowhere/.launch-token',
  container: 'nova-bots',
  read: async () => { throw new Error('no file') },
  log: async () => LOG,
  backoffMs: [1, 1],
  ...overrides,
})

test('the newest token in the log wins', () => {
  assert.deepEqual(tokensFromLog(LOG), ['newtoken0123456789', 'midtoken0123456789', 'oldtoken0123456789'])
})

test('a token that appears twice in the log is listed once', () => {
  assert.deepEqual(tokensFromLog('token=aaaaaaaaaaaaaaa1\ntoken=bbbbbbbbbbbbbbb2\ntoken=aaaaaaaaaaaaaaa1'), ['aaaaaaaaaaaaaaa1', 'bbbbbbbbbbbbbbb2'])
})

test('the file token comes first, then the log tokens newest first', async () => {
  const pool = poolOf({ read: async () => 'filetoken0123456789' })
  assert.deepEqual(await pool.candidates(), ['filetoken0123456789', 'newtoken0123456789', 'midtoken0123456789', 'oldtoken0123456789'])
})

test('a refused token falls through to the next candidate', async () => {
  const tried = []
  const pool = poolOf({
    read: async () => 'filetoken0123456789',
    log: async () => LOG,
  })
  const mint = async (url, token) => {
    tried.push(token)
    // The engine refuses the file token and the newest log token.
    if (token === 'filetoken0123456789' || token === 'newtoken0123456789') return null
    return `dsh-auth-h=cookie-for-${token}`
  }
  const cookie = await pool.mint('http://127.0.0.1:13083', 'h', mint)
  assert.equal(cookie, 'dsh-auth-h=cookie-for-midtoken0123456789')
  assert.deepEqual(tried, ['filetoken0123456789', 'newtoken0123456789', 'midtoken0123456789'])
})

test('the token that worked is tried first the next time', async () => {
  const pool = poolOf({ read: async () => 'filetoken0123456789' })
  const tried = []
  const mint = async (url, token) => { tried.push(token); return token === 'midtoken0123456789' ? 'dsh-auth-h=ok' : null }
  assert.equal(await pool.mint('http://127.0.0.1:13083', 'h', mint), 'dsh-auth-h=ok')
  assert.equal(await pool.mint('http://127.0.0.1:13083', 'h', mint), 'dsh-auth-h=ok')
  assert.deepEqual(tried, ['filetoken0123456789', 'newtoken0123456789', 'midtoken0123456789', 'midtoken0123456789'])
})

test('a refused token is dropped, and the next candidate is used', async () => {
  const pool = poolOf({ read: async () => 'filetoken0123456789' })
  const mint = async (url, token) => (token === 'filetoken0123456789' ? null : 'dsh-auth-h=ok')
  assert.equal(await pool.mint('http://127.0.0.1:13083', 'h', mint), 'dsh-auth-h=ok')
  assert.equal(pool.winner, 'newtoken0123456789')
  pool.invalidate('newtoken0123456789')
  assert.equal(pool.winner, null)
})

test('when every candidate is refused the pool waits and looks again', async () => {
  let logCalls = 0
  const pool = poolOf({
    read: async () => { throw new Error('no file') },
    // The engine prints a fresh token while the pool waits.
    log: async () => (logCalls++ === 0 ? 'Nova Bots: http://127.0.0.1:3080/?token=oldtoken0123456789' : 'Nova Bots: http://127.0.0.1:3080/?token=freshtoken0123456789'),
    rounds: 3,
    backoffMs: [1, 1],
  })
  let calls = 0
  const mint = async (url, token) => {
    calls += 1
    if (token !== 'freshtoken0123456789') return null
    return 'dsh-auth-h=ok'
  }
  const cookie = await pool.mint('http://127.0.0.1:13083', 'h', mint)
  assert.equal(cookie, 'dsh-auth-h=ok')
  assert.ok(calls > 1, 'the candidates are tried again')
})

test('a pool that never gets a token answers with nothing', async () => {
  const pool = poolOf({ rounds: 2, backoffMs: [1] })
  const mint = async () => null
  assert.equal(await pool.mint('http://127.0.0.1:13083', 'h', mint), null)
})
