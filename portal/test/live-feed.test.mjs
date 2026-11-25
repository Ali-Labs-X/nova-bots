// A live feed (server-sent events) through the bridge: a quiet one is kept
// open, its events stay whole, and neither side outlives the other.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { proxyHttp } from '../bridge.mjs'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const start = async (t, handler, options) => {
  const engine = createServer(handler)
  const enginePort = await listen(engine)
  const target = { url: `http://127.0.0.1:${enginePort}`, cookie: async () => 'dsh-auth-h=x' }
  const portal = createServer((req, res) => proxyHttp(req, res, target, options))
  const port = await listen(portal)
  t.after(() => { for (const server of [portal, engine]) { server.closeAllConnections(); server.close() } })
  return port
}

const open = async port => {
  const req = request({ host: '127.0.0.1', port, path: '/app/plugins/events' })
  req.on('error', () => {})
  req.end()
  const [res] = await once(req, 'response')
  const feed = { req, res, text: '' }
  res.setEncoding('utf8')
  res.on('data', chunk => { feed.text += chunk })
  res.on('error', () => {})
  return feed
}

const sse = { 'content-type': 'text/event-stream' }

test('a quiet live feed gets keep-alive comments', async (t) => {
  const port = await start(t, (_req, res) => { res.writeHead(200, sse); res.write('data: 1\n\n') }, { keepAliveMs: 20 })
  const feed = await open(port)
  await wait(150)
  feed.req.destroy()
  assert.match(feed.text, /^data: 1\n\n(: keep-alive\n\n)+$/)
})

test('a keep-alive never lands inside an event', async (t) => {
  const port = await start(t, async (_req, res) => {
    res.writeHead(200, sse)
    res.write('data: first ')
    await wait(120)
    res.write('half\n')
    await wait(60)
    res.write('\n')
  }, { keepAliveMs: 20 })
  const feed = await open(port)
  await wait(320)
  feed.req.destroy()
  assert.match(feed.text, /^data: first half\n\n(: keep-alive\n\n)+$/)
})

test('an answer that is not a live feed is left as it is', async (t) => {
  const port = await start(t, async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{')
    await wait(100)
    res.end('}')
  }, { keepAliveMs: 10 })
  const feed = await open(port)
  await once(feed.res, 'end')
  assert.equal(feed.text, '{}')
})

test('the engine side closes when the browser goes away', async (t) => {
  let closed = false
  const port = await start(t, (_req, res) => {
    res.writeHead(200, sse)
    res.write('data: 1\n\n')
    res.on('close', () => { closed = true })
  })
  const feed = await open(port)
  feed.req.destroy()
  await wait(150)
  assert.equal(closed, true)
})

test('the browser side closes when the engine breaks off', async (t) => {
  const port = await start(t, (_req, res) => {
    res.writeHead(200, sse)
    res.write('data: 1\n\n')
    setTimeout(() => res.destroy(), 30)
  })
  const feed = await open(port)
  const closed = await Promise.race([new Promise(resolve => feed.res.once('close', () => resolve(true))), wait(500).then(() => false)])
  assert.equal(closed, true)
})
