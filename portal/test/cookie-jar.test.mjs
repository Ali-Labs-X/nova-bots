import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EngineCookieJar } from '../bridge.mjs'

const counting = () => {
  const minted = []
  return { minted, mint: async (_url, host) => { minted.push(host); return `dsh-auth-${minted.length}=v` } }
}

test('a client that varies the Host cannot grow the jar past its bound', async () => {
  const jar = new EngineCookieJar({ maxEntries: 4 })
  const { mint } = counting()
  for (let i = 0; i < 50; i++) await jar.get({ key: 'A', url: 'http://engine', host: `h${i}.example`, mint })
  assert.equal(jar.cookies.size, 4)
  assert.deepEqual([...jar.cookies.keys()], ['A\u0000h46.example', 'A\u0000h47.example', 'A\u0000h48.example', 'A\u0000h49.example'])
})

test('the least recently used host is the one evicted', async () => {
  const jar = new EngineCookieJar({ maxEntries: 2 })
  const { minted, mint } = counting()
  await jar.get({ key: 'A', url: 'http://engine', host: 'one', mint })
  await jar.get({ key: 'A', url: 'http://engine', host: 'two', mint })
  await jar.get({ key: 'A', url: 'http://engine', host: 'one', mint })
  await jar.get({ key: 'A', url: 'http://engine', host: 'three', mint })
  assert.deepEqual(minted, ['one', 'two', 'three'])
  await jar.get({ key: 'A', url: 'http://engine', host: 'one', mint })
  assert.deepEqual(minted, ['one', 'two', 'three'], 'one stayed cached')
  await jar.get({ key: 'A', url: 'http://engine', host: 'two', mint })
  assert.deepEqual(minted, ['one', 'two', 'three', 'two'], 'two was evicted and minted again')
})

test('a failed mint leaves no entry behind', async () => {
  const jar = new EngineCookieJar()
  await jar.get({ key: 'A', url: 'http://engine', host: 'h', mint: async () => null })
  assert.equal(jar.cookies.size, 0)
})
