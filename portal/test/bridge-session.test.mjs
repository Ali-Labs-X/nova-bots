// The bridge when the engine changes its cookie key under the portal's feet,
// and the redirect that gives the app its trailing slash.
//
// The engine here rotates its cookie secret when the test says so: the cookie
// the portal holds is stale, the engine answers 401, and the portal has to
// mint a new one and send the request again — the roster poll is a POST, so a
// request that cannot be sent again must not look like a missing workspace.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { EngineCookieJar, proxyHttp, redirectToApp } from '../bridge.mjs'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

// An engine that can rotate its cookie key, like an engine that reloads.
const rotatingEngine = () => {
  const token = 'token-rotating-1234567890'
  const state = { secret: 'cookie-one-1234567890', requests: [], bodies: [], mints: 0, generation: 1 }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const cookies = String(req.headers.cookie ?? '')
    if (url.pathname === '/' && url.searchParams.get('token')) {
      if (url.searchParams.get('token') !== token) { res.writeHead(401); return res.end() }
      state.mints += 1
      res.writeHead(303, { location: './', 'set-cookie': `dsh-auth-h=${state.secret}; Path=/; HttpOnly` })
      return res.end()
    }
    if (!cookies.includes(state.secret)) { res.writeHead(401); return res.end('no') }
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      state.requests.push({ method: req.method, url: req.url, cookie: cookies })
      state.bodies.push(Buffer.concat(chunks).toString())
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  return {
    token,
    state,
    server,
    // The engine changes its key: the cookie the portal holds is stale now.
    rotate: () => { state.generation += 1; state.secret = `cookie-${state.generation}-1234567890` },
  }
}

const engine = rotatingEngine()
const enginePort = await listen(engine.server)
const jar = new EngineCookieJar()
const target = {
  key: 'rotating',
  url: `http://127.0.0.1:${enginePort}`,
  cookie: (host, { fresh = false } = {}) => jar.get({ key: 'rotating', url: `http://127.0.0.1:${enginePort}`, host, fresh, token: async () => engine.token }),
  invalidate: () => jar.invalidate('rotating'),
}

const portal = createServer((req, res) => {
  if (req.url === '/app' && (req.method === 'GET' || req.method === 'HEAD')) return redirectToApp(req, res)
  proxyHttp(req, res, target)
})
const portalPort = await listen(portal)
after(() => { portal.close(); engine.server.close() })

const post = (path, body, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: portalPort, path, method: 'POST', headers: { host: 'h', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers } }, res => {
    let text = ''
    res.on('data', c => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, body: text }))
  })
  req.on('error', reject)
  req.end(body)
})

const get = path => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: portalPort, path, headers: { host: 'h' } }, res => {
    let text = ''
    res.on('data', c => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, body: text, location: res.headers.location }))
  })
  req.on('error', reject)
  req.end()
})

test('a POST is sent again with a fresh cookie when the engine changed its key', async () => {
  // The portal holds a cookie; the engine changes its key.
  assert.equal((await get('/app/')).status, 200)
  engine.rotate()
  const res = await post('/app/api/bot', JSON.stringify({ endpoint: 'state' }))
  assert.equal(res.status, 200)
  assert.equal(res.body, '{"ok":true}')
  // The engine answered with the fresh cookie, and the body arrived with it.
  assert.ok(engine.state.requests.at(-1).cookie.includes(`cookie-${engine.state.generation}-1234567890`))
  assert.equal(engine.state.bodies.at(-1), JSON.stringify({ endpoint: 'state' }))
})

test('a request that cannot be sent again is answered with 401, not 503', async () => {
  assert.equal((await get('/app/')).status, 200)
  engine.rotate()
  // No content-length: the body is streamed and cannot be replayed.
  const res = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: portalPort, path: '/app/api/bot', method: 'POST', headers: { host: 'h', 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, response => {
      let text = ''
      response.on('data', c => { text += c })
      response.on('end', () => resolve({ status: response.statusCode, body: text }))
    })
    req.on('error', reject)
    req.write('{"endpoint":"state"}')
    req.end()
  })
  assert.equal(res.status, 401)
  assert.match(res.body, /refused the session/)
})

test('/app answers with a redirect to /app/', async () => {
  const res = await get('/app')
  assert.equal(res.status, 302)
  assert.equal(res.location, '/app/')
  assert.equal(res.body, '')
})

test('/app/ is bridged as it is', async () => {
  const res = await get('/app/')
  assert.equal(res.status, 200)
  assert.equal(res.body, '{"ok":true}')
})
