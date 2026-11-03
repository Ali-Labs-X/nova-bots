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

const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

const fakeEngine = (name) => {
  const token = `token-${name}-${Math.random().toString(36).slice(2)}`
  const secret = `cookie-${name}-${Math.random().toString(36).slice(2)}`
  const seen = []
  const cookieOk = (req) => String(req.headers.cookie ?? '').split(';').some(p => p.trim() === `dsh-auth-h=${secret}`)
  const server = createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie ?? '', authorization: req.headers.authorization })
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/' && url.searchParams.get('token')) {
      if (url.searchParams.get('token') !== token) { res.writeHead(401); return res.end() }
      res.writeHead(303, { location: './', 'set-cookie': `dsh-auth-h=${secret}; Path=/; HttpOnly` })
      return res.end()
    }
    if (!cookieOk(req)) { res.writeHead(401); return res.end('no') }
    res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['dsh-auth-h=leak; Path=/', 'access_token=evil; Path=/', 'pref=1; Path=/'] })
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
