// Requests that must not stop the portal, get past its sign-in limit or
// choose which host it connects to.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as createHttp, request } from 'node:http'
import { connect, createServer as createTcp } from 'node:net'
import { fileURLToPath } from 'node:url'
import { enginePath, proxyHttp } from '../bridge.mjs'
import { BodyTooLarge, clientIp, readBody } from '../http.mjs'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// Just enough of Postgres: the schema statements succeed, every query with
// parameters fails.
const fakePostgres = () => createTcp(socket => {
  const message = (type, body = Buffer.alloc(0)) => {
    const head = Buffer.alloc(5)
    head.write(type)
    head.writeInt32BE(body.length + 4, 1)
    return Buffer.concat([head, body])
  }
  const ready = message('Z', Buffer.from('I'))
  let data = Buffer.alloc(0)
  let started = false
  socket.on('error', () => {})
  socket.on('data', chunk => {
    data = Buffer.concat([data, chunk])
    if (!started) {
      if (data.length < 4 || data.length < data.readInt32BE(0)) return
      data = data.subarray(data.readInt32BE(0))
      started = true
      socket.write(Buffer.concat([message('R', Buffer.alloc(4)), ready]))
    }
    while (data.length >= 5 && data.length >= data.readInt32BE(1) + 1) {
      const type = String.fromCharCode(data[0])
      data = data.subarray(data.readInt32BE(1) + 1)
      if (type === 'Q') socket.write(Buffer.concat([message('C', Buffer.from('OK\0')), ready]))
      if (type === 'S') socket.write(Buffer.concat([message('E', Buffer.from('SERROR\0C22021\0Mprivate detail\0\0')), ready]))
    }
  })
})

const startPortal = async (t) => {
  const database = fakePostgres()
  const databasePort = await listen(database)
  const probe = createTcp()
  const port = await listen(probe)
  await new Promise(resolve => probe.close(resolve))
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: {
      PATH: process.env.PATH,
      NOVA_PORTAL_PORT: String(port),
      NOVA_DATABASE_URL: `postgres://u:p@127.0.0.1:${databasePort}/d`,
      NOVA_JWT_SECRET: 'x'.repeat(32),
      NOVA_LAUNCH_TOKEN_FILE: '/nonexistent',
    },
  })
  t.after(() => { child.kill('SIGKILL'); database.close() })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  for (let i = 0; i < 200 && !output.includes('Nova Bots portal on'); i += 1) await wait(50)
  assert.match(output, /Nova Bots portal on/)
  return { port, child }
}

const raw = (port, text) => new Promise(resolve => {
  const socket = connect(port, '127.0.0.1', () => socket.write(text))
  let answer = ''
  socket.on('data', chunk => { answer += chunk })
  socket.on('error', () => {})
  socket.on('close', () => resolve(answer))
  setTimeout(() => socket.destroy(), 1500)
})

const post = (path, body) => `POST ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: ${body.length}\r\n\r\n${body}`

test('no request stops the portal, and a failure shows no detail', async (t) => {
  const { port, child } = await startPortal(t)
  const requests = [
    'GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    'GET / HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n',
    'GET http://[/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    'GET // HTTP/1.1\r\nHost: [\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    post('/api/v1/auth/login/local', 'username=a%00b&password=x'),
    post('/api/v1/auth/register', 'email=a@b.co&password=longenough'),
    'GET /api/v1/auth/setup-status HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
  ]
  for (const text of requests) {
    const answer = await raw(port, text)
    assert.doesNotMatch(answer, /private detail/)
    assert.equal(child.exitCode, null, `stopped by ${JSON.stringify(text.slice(0, 60))}`)
  }
  assert.match(await raw(port, 'GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /200 OK/)
})

test('a path never chooses the engine host', async (t) => {
  for (const path of ['/app//evil.test/x', '//evil.test/x', '/app///evil.test/x', '/app/\\evil.test/x']) {
    assert.equal(new URL(enginePath(path), 'http://engine.local').hostname, 'engine.local', path)
  }
  const seen = []
  const evil = createHttp((req, res) => { seen.push(req.headers.cookie); res.end('evil') })
  const evilPort = await listen(evil)
  const engine = createHttp((_req, res) => res.end('engine'))
  const enginePort = await listen(engine)
  const target = { url: `http://127.0.0.1:${enginePort}`, cookie: async () => 'dsh-auth-h=secret' }
  const portal = createHttp((req, res) => proxyHttp(req, res, target))
  const port = await listen(portal)
  t.after(() => { for (const server of [portal, engine, evil]) { server.closeAllConnections(); server.close() } })
  const answer = await raw(port, `GET /app//127.0.0.1:${evilPort}/x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)
  assert.match(answer, /engine/)
  assert.deepEqual(seen, [])
})

test('the address comes from the proxies we run, not from what the visitor sent', () => {
  const from = (remoteAddress, forwarded) => clientIp({ socket: { remoteAddress }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} })
  assert.equal(from('172.18.0.3', '9.9.9.9, 203.0.113.7, 172.18.0.1'), '203.0.113.7')
  assert.equal(from('::ffff:172.18.0.3', '203.0.113.7, 127.0.0.1'), '203.0.113.7')
  assert.equal(from('192.168.1.20', '9.9.9.9'), '192.168.1.20')
  assert.equal(from('127.0.0.1', 'nonsense'), '127.0.0.1')
  assert.equal(from('127.0.0.1'), '127.0.0.1')
})

test('a body over the limit is refused', async (t) => {
  let refused
  const server = createHttp((req, res) => readBody(req, 1000).then(() => res.end('ok'), error => { refused = error; res.writeHead(413).end() }))
  const port = await listen(server)
  t.after(() => { server.closeAllConnections(); server.close() })
  const req = request({ host: '127.0.0.1', port, method: 'POST' })
  req.on('error', () => {})
  req.end('x'.repeat(5000))
  const [res] = await once(req, 'response')
  assert.equal(res.statusCode, 413)
  assert.ok(refused instanceof BodyTooLarge)
})
