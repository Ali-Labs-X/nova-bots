// A live feed (server-sent events) through the bridge: a quiet one is kept
// open, its events stay whole, and neither side outlives the other.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { connect } from 'node:net'
import { proxyHttp, proxyUpgrade } from '../bridge.mjs'

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

test('a browser that leaves while its request is prepared leaves nothing open at the engine', async (t) => {
  let asked = 0
  let browserSide
  const open = new Set()
  const engine = createServer((_req, res) => { asked += 1; res.writeHead(200, sse); res.write('data: 1\n\n') })
  engine.on('upgrade', (_req, socket) => {
    open.add(socket)
    socket.on('error', () => {})
    socket.on('end', () => socket.end())
    socket.on('close', () => open.delete(socket))
    socket.resume()
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  })
  const target = { url: `http://127.0.0.1:${await listen(engine)}`, cookie: async () => { await wait(80); return 'dsh-auth-h=x' } }
  const portal = createServer((req, res) => proxyHttp(req, res, target))
  portal.on('upgrade', (req, socket, head) => { browserSide = socket; socket.on('error', () => {}); return proxyUpgrade(req, socket, head, target, { limits: { handshakeMs: 1000, halfOpenMs: 40 } }) })
  const port = await listen(portal)
  t.after(() => { for (const server of [portal, engine]) { server.closeAllConnections(); server.close() } for (const socket of open) socket.destroy() })
  for (const extra of ['', 'Connection: Upgrade\r\nUpgrade: websocket\r\n']) {
    const socket = connect(port, '127.0.0.1', () => socket.write(`GET /app/feed HTTP/1.1\r\nHost: x\r\n${extra}\r\n`))
    socket.on('error', () => {})
    await wait(30)
    socket.destroy()
  }
  await wait(300)
  assert.deepEqual([asked, open.size, browserSide.destroyed], [0, 0, true])
})

test('an engine that never answers a live connection does not hold it', async (t) => {
  const held = []
  const engine = createServer()
  engine.on('upgrade', (_req, socket) => { held.push(socket); socket.on('error', () => {}) })
  const target = { url: `http://127.0.0.1:${await listen(engine)}`, cookie: async () => 'dsh-auth-h=x' }
  const portal = createServer()
  portal.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, target, { limits: { handshakeMs: 60, halfOpenMs: 40 } }))
  const port = await listen(portal)
  t.after(() => { for (const server of [portal, engine]) { server.closeAllConnections(); server.close() } for (const socket of held) socket.destroy() })
  const answer = await new Promise(resolve => {
    const socket = connect(port, '127.0.0.1', () => socket.write('GET /app/x HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'))
    let text = ''
    socket.on('data', chunk => { text += chunk })
    socket.on('error', () => {})
    socket.on('close', () => resolve(text.split('\r\n')[0]))
    setTimeout(() => socket.destroy(), 2000)
  })
  assert.equal(answer, 'HTTP/1.1 504 Gateway Timeout')
})

test('a live connection that was made has no time limit', async (t) => {
  const open = new Set()
  const engine = createServer()
  engine.on('upgrade', (_req, socket) => {
    open.add(socket)
    socket.on('error', () => {})
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  })
  const target = { url: `http://127.0.0.1:${await listen(engine)}`, cookie: async () => 'dsh-auth-h=x' }
  const portal = createServer()
  portal.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, target, { limits: { handshakeMs: 40, halfOpenMs: 40 } }))
  const port = await listen(portal)
  const socket = connect(port, '127.0.0.1', () => socket.write('GET /app/x HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'))
  let closed = false
  socket.on('close', () => { closed = true })
  socket.resume()
  t.after(() => { socket.destroy(); for (const server of [portal, engine]) { server.closeAllConnections(); server.close() } for (const one of open) one.destroy() })
  await wait(250)
  assert.equal(closed, false)
})

test('a live feed is reported, other answers are not', async (t) => {
  const feeds = []
  const engine = createServer((req, res) => { res.writeHead(200, req.url === '/feed' ? sse : { 'content-type': 'application/json' }); res.end(req.url === '/feed' ? 'data: 1\n\n' : '{}') })
  const target = { url: `http://127.0.0.1:${await listen(engine)}`, cookie: async () => 'dsh-auth-h=x' }
  const portal = createServer((req, res) => proxyHttp(req, res, target, { onFeed: () => feeds.push(req.url) }))
  const port = await listen(portal)
  t.after(() => { for (const server of [portal, engine]) { server.closeAllConnections(); server.close() } })
  for (const path of ['/app/feed', '/app/state']) await (await fetch(`http://127.0.0.1:${port}${path}`)).text()
  assert.deepEqual(feeds, ['/app/feed'])
})

test('a live connection that is refused says why', async (t) => {
  const engine = createServer()
  engine.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n'))
  const url = `http://127.0.0.1:${await listen(engine)}`
  const targets = {
    '/app/no-cookie': { url, cookie: async () => null },
    '/app/refused': { url, cookie: async () => 'dsh-auth-h=x' },
    '/app/down': { url: 'http://127.0.0.1:9', cookie: async () => 'dsh-auth-h=x' },
  }
  const portal = createServer()
  portal.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, targets[req.url]))
  const port = await listen(portal)
  t.after(() => { for (const server of [portal, engine]) { server.closeAllConnections(); server.close() } })
  const answers = []
  for (const path of Object.keys(targets)) {
    answers.push(await new Promise(resolve => {
      const socket = connect(port, '127.0.0.1', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`))
      let text = ''
      socket.on('data', chunk => { text += chunk })
      socket.on('error', () => {})
      socket.on('close', () => resolve(text.split('\r\n')[0]))
    }))
  }
  assert.deepEqual(answers, ['HTTP/1.1 503 Service Unavailable', 'HTTP/1.1 403 Forbidden', 'HTTP/1.1 502 Bad Gateway'])
})

test('a live connection ends on both sides when the browser goes away', async (t) => {
  const open = new Set()
  let browserSide
  const engine = createServer()
  // An engine that does not end its own side.
  engine.on('upgrade', (_req, socket) => {
    open.add(socket)
    socket.on('error', () => {})
    socket.resume()
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  })
  const target = { url: `http://127.0.0.1:${await listen(engine)}`, cookie: async () => 'dsh-auth-h=x' }
  const portal = createServer()
  portal.on('upgrade', (req, socket, head) => { browserSide = socket; return proxyUpgrade(req, socket, head, target, { limits: { handshakeMs: 1000, halfOpenMs: 40 } }) })
  const port = await listen(portal)
  t.after(() => { for (const server of [portal, engine]) { server.closeAllConnections(); server.close() } for (const socket of open) socket.destroy() })
  const socket = connect(port, '127.0.0.1', () => socket.write('GET /app/x HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'))
  socket.resume()
  await wait(60)
  socket.end()
  await wait(250)
  assert.equal(browserSide.destroyed, true)
})
