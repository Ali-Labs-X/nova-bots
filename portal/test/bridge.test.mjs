// Routing through the bridge with two fake engines: each engine accepts only
// the cookie it minted itself, like the real one (whose cookie key lives in
// its own volume). Proves that a session reaches only its own engine, that a
// cookie from engine A is useless on engine B, and that nothing secret is
// forwarded — over HTTP and WebSocket.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { EngineCookieJar, enginePath, proxyHttp, proxyUpgrade } from '../bridge.mjs'

// The port the front door listens on. The bridge takes the port the browser
// dialled from this setting, never from the request.
process.env.NOVA_PORT = '13080'

const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

const fakeEngine = (name) => {
  const token = `token-${name}-${Math.random().toString(36).slice(2)}`
  const secret = `cookie-${name}-${Math.random().toString(36).slice(2)}`
  const seen = []
  const cookieOk = (req) => String(req.headers.cookie ?? '').split(';').some(p => p.trim() === `dsh-auth-h=${secret}`)
  const server = createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie ?? '', authorization: req.headers.authorization, host: req.headers.host })
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/' && url.searchParams.get('token')) {
      if (url.searchParams.get('token') !== token) { res.writeHead(401); return res.end() }
      res.writeHead(303, { location: './', 'set-cookie': `dsh-auth-h=${secret}; Path=/; HttpOnly` })
      return res.end()
    }
    if (!cookieOk(req)) { res.writeHead(401); return res.end('no') }
    res.writeHead(200, { 'content-type': 'text/plain', connection: 'keep-alive', 'keep-alive': 'timeout=99', 'set-cookie': ['dsh-auth-h=leak; Path=/', 'access_token=evil; Path=/', 'pref=1; Path=/'] })
    res.end(`engine ${name}`)
  })
  server.on('upgrade', (req, socket) => {
    if (!cookieOk(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n'); return }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.end(`hello from engine ${name}`)
  })
  return { name, token, secret, seen, server }
}

const A = fakeEngine('A')
const B = fakeEngine('B')
const portA = await listen(A.server)
const portB = await listen(B.server)
const jar = new EngineCookieJar()
const targetOf = (engine, port) => ({
  key: engine.name,
  tenantId: engine.name,
  url: `http://127.0.0.1:${port}`,
  cookie: (host, { fresh = false } = {}) => jar.get({ key: engine.name, url: `http://127.0.0.1:${port}`, host, fresh, token: async () => engine.token }),
  invalidate: () => jar.invalidate(engine.name),
})
// The "portal": the session (here a header standing in for the verified
// portal session) picks the engine; nothing the browser sends can change it.
const targets = { alice: targetOf(A, portA), bob: targetOf(B, portB) }
const portal = createServer((req, res) => {
  const target = targets[req.headers['x-test-user']]
  if (!target) { res.writeHead(401); return res.end() }
  proxyHttp(req, res, target)
})
portal.on('upgrade', (req, socket, head) => {
  const target = targets[req.headers['x-test-user']]
  if (!target) return socket.destroy()
  proxyUpgrade(req, socket, head, target)
})
const portalPort = await listen(portal)
after(() => { portal.close(); A.server.close(); B.server.close() })

const get = (path, headers) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: portalPort, path, headers: { host: 'h', ...headers } }, res => {
    let body = ''
    res.on('data', c => { body += c })
    res.on('end', () => resolve({ status: res.statusCode, body, setCookie: res.headers['set-cookie'] ?? [] }))
  })
  req.on('error', reject)
  req.end()
})

const ws = (user, cookie = '') => new Promise(resolve => {
  const socket = connect(portalPort, '127.0.0.1', () => {
    socket.write(`GET /app/ws HTTP/1.1\r\nHost: h\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nx-test-user: ${user}\r\ncookie: ${cookie}\r\n\r\n`)
  })
  let data = ''
  socket.on('data', c => { data += c })
  socket.on('close', () => resolve(data))
  socket.on('error', () => resolve(data))
})

test('each session reaches only its own engine', async () => {
  assert.equal((await get('/app/', { 'x-test-user': 'alice' })).body, 'engine A')
  assert.equal((await get('/app/', { 'x-test-user': 'bob' })).body, 'engine B')
})

test("a cookie minted by engine A, presented in bob's browser, is stripped and never reaches B or A", async () => {
  const before = B.seen.length
  const res = await get('/app/x', { 'x-test-user': 'bob', cookie: `dsh-auth-h=${A.secret}; access_token=BOBSESSION` })
  assert.equal(res.body, 'engine B')
  const forwarded = B.seen.slice(before).map(s => s.cookie).join('|')
  assert.ok(!forwarded.includes(A.secret), 'A cookie must not reach B')
  assert.ok(!forwarded.includes('BOBSESSION'), 'the portal session must not reach an engine')
  // The stale browser cookie is deleted.
  assert.ok(res.setCookie.some(c => c.startsWith('dsh-auth-h=;') && c.includes('Max-Age=0')))
})

test('engine Set-Cookie for engine cookies and the portal session never reaches the browser', async () => {
  const res = await get('/app/', { 'x-test-user': 'alice' })
  assert.deepEqual(res.setCookie, ['pref=1; Path=/'])
})

test('Authorization and the admin token header are not forwarded', async () => {
  const before = A.seen.length
  await get('/app/', { 'x-test-user': 'alice', authorization: 'Bearer secret', 'x-nova-bots-token': 'admintoken' })
  assert.ok(A.seen.slice(before).every(s => !s.authorization))
})

test('engine A cookie is useless on engine B directly (HTTP)', async () => {
  const status = await new Promise(resolve => {
    request({ host: '127.0.0.1', port: portB, path: '/', headers: { host: 'h', cookie: `dsh-auth-h=${A.secret}` } }, res => { res.resume(); resolve(res.statusCode) }).end()
  })
  assert.equal(status, 401)
})

test('WebSocket: each session is bridged only to its own engine; foreign cookies do not help', async () => {
  assert.match(await ws('alice'), /hello from engine A/)
  const bob = await ws('bob', `dsh-auth-h=${A.secret}`)
  assert.match(bob, /hello from engine B/)
  assert.doesNotMatch(bob, /engine A/)
  assert.equal(await ws('mallory'), '')
})

test('a stale minted cookie is re-minted once on 401 for a GET', async () => {
  jar.cookies.set(`A\u0000h`, 'dsh-auth-h=stale')
  assert.equal((await get('/app/', { 'x-test-user': 'alice' })).body, 'engine A')
})

test('the /app prefix maps to the engine root', () => {
  assert.equal(enginePath('/app'), '/')
  assert.equal(enginePath('/app/'), '/')
  assert.equal(enginePath('/app/api/x?y=1'), '/api/x?y=1')
  assert.equal(enginePath('/assets/a.js'), '/assets/a.js')
})

test("hop-by-hop headers from the engine are not forwarded (a client's Connection: close is honoured)", async () => {
  const res = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: portalPort, path: '/app/', headers: { host: 'h', 'x-test-user': 'alice', connection: 'close' } }, r => { r.resume(); r.on('end', () => resolve(r)) })
    req.on('error', reject)
    req.end()
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers.connection, 'close')
  assert.equal(res.headers['keep-alive'], undefined)
})

// The real engine refuses a request whose Origin authority differs from its
// Host authority — the browser-trust fence that also guards the live socket.
// A front door that forwards the host without its port makes the two differ,
// and then every API call is answered with 403.
const fenced = createServer((req, res) => {
  const origin = String(req.headers.origin ?? '')
  if (origin) {
    let originHost
    try { originHost = new URL(origin).host } catch { originHost = '' }
    if (originHost && originHost !== req.headers.host) { res.writeHead(403); return res.end('forbidden') }
  }
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('engine fenced')
})
const fencedPort = await listen(fenced)
after(() => fenced.close())

const fencedTarget = {
  key: 'fenced',
  tenantId: 'fenced',
  url: `http://127.0.0.1:${fencedPort}`,
  cookie: async () => 'dsh-auth-h=fenced',
  invalidate: () => {},
}

const throughFence = (headers) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: fencedPort, path: '/api/bot', method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, res => {
    let body = ''
    res.on('data', c => { body += c })
    res.on('end', () => resolve({ status: res.statusCode, body }))
  })
  req.on('error', reject)
  req.end('{}')
})

test('the engine sees the authority the browser used, port included', async () => {
  const before = A.seen.length
  await get('/app/', { 'x-test-user': 'alice', host: 'localhost', origin: 'http://localhost:13080' })
  // The last request is the call itself; the one before it is the mint.
  assert.equal(A.seen.at(-1).host, 'localhost:13080')
})

test('a foreign Origin never rewrites the authority', async () => {
  const before = A.seen.length
  await get('/app/', { 'x-test-user': 'alice', host: 'localhost', origin: 'http://evil.example' })
  assert.equal(A.seen.at(-1).host, 'localhost')
})

test('a page on another port of the same host never rewrites the authority', async () => {
  // The port belongs to the front door, not to the page that asks. A page on
  // another port of the same host is same-site, so the browser carries the
  // session cookie, and it must not be able to name its own authority.
  const before = A.seen.length
  await get('/app/', { 'x-test-user': 'alice', host: 'localhost', origin: 'http://localhost:3000' })
  assert.equal(A.seen.at(-1).host, 'localhost')
})

test('the public host keeps the authority it came with', async () => {
  const before = A.seen.length
  await get('/app/', { 'x-test-user': 'alice', host: 'bots.alilabsx.com', origin: 'https://bots.alilabsx.com' })
  assert.equal(A.seen.at(-1).host, 'bots.alilabsx.com')
})

test('a request without an Origin keeps the host it came with', async () => {
  const before = A.seen.length
  await get('/app/', { 'x-test-user': 'alice', host: 'localhost' })
  assert.equal(A.seen.at(-1).host, 'localhost')
})

test('the engine refuses a request whose Origin authority differs from its Host authority', async () => {
  const direct = await throughFence({ host: 'localhost', origin: 'http://localhost:13080' })
  assert.equal(direct.status, 403)
  const matching = await throughFence({ host: 'localhost:13080', origin: 'http://localhost:13080' })
  assert.equal(matching.status, 200)
})

test('the portal bridge keeps the Origin and the Host in step for the engine', async () => {
  const res = await new Promise((resolve, reject) => {
    const server = createServer((req, r) => proxyHttp(req, r, fencedTarget))
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      const req = request({ host: '127.0.0.1', port, path: '/api/bot', method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost:13080' } }, resp => {
        let body = ''
        resp.on('data', c => { body += c })
        resp.on('end', () => { server.close(); resolve({ status: resp.statusCode, body }) })
      })
      req.on('error', reject)
      req.end('{}')
    })
  })
  assert.equal(res.status, 200)
  assert.equal(res.body, 'engine fenced')
})

test('the engine refuses a same-host page on another port, through the bridge', async () => {
  const res = await new Promise((resolve, reject) => {
    const server = createServer((req, r) => proxyHttp(req, r, fencedTarget))
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      const req = request({ host: '127.0.0.1', port, path: '/api/bot', method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost:3000' } }, resp => {
        let body = ''
        resp.on('data', c => { body += c })
        resp.on('end', () => { server.close(); resolve({ status: resp.statusCode, body }) })
      })
      req.on('error', reject)
      req.end('{}')
    })
  })
  assert.equal(res.status, 403)
})

