import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import { createMounts, handler } from '../../ops/mountd.mjs'
import { createHostFolders, mountdClient, sameOrigin } from '../host-folders.mjs'

// Under the home folder: a folder in /tmp is not one that may be mounted.
let root, server, mountServer, base, calls, mounted, kind, user, audit, failStart, tries
const owner = { id: 1, email: 'owner@example.com' }
before(async () => {
  root = mkdtempSync(join(homedir(), '.nova-host-test-'))
  for (const name of ['share/site', 'other/docs', 'data/bot', 'we,ird']) mkdirSync(join(root, name), { recursive: true })
  symlinkSync(join(root, 'data'), join(root, 'other/link'))
  const run = async ([action, path, target]) => {
    calls.push([action, path, target].filter(Boolean).join(' '))
    if (action === 'mounts-list') return mounted.join('\n')
    if (action === 'mount') mounted.push(`${path}:${target}`)
    if (action === 'unmount') mounted = mounted.filter(entry => !entry.startsWith(`${path}:`))
    if (action === 'start' && failStart) { failStart = false; throw new Error('start failed') }
    return ''
  }
  const api = createMounts({ run, home: root, share: join(root, 'share'), own: [join(root, 'data')], ready: async () => true, sleep: async () => {} })
  mountServer = createServer(handler(api)).listen(join(root, 's'))
  const auth = {
    rateLimit: () => ({ allowed: ++tries <= 3, retryAfter: 9 }), clearRateLimit: () => { tries = 0 },
    authenticate: async (email, password) => (password === 'right' ? { id: 1 } : null),
    audit: async (row) => { audit.push(row) },
  }
  const handle = createHostFolders({ auth, tenants: { store: { byUser: async () => ({ kind }) } }, userOf: async () => user, mountd: mountdClient(join(root, 's')) })
  server = createServer((req, res) => { const url = new URL(req.url, 'http://x'); void handle(req, res, url.pathname, url) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close(); mountServer.close(); rmSync(root, { recursive: true, force: true }) })
beforeEach(() => { calls = []; mounted = []; kind = 'legacy'; user = owner; audit = []; failStart = false; tries = 0 })

const call = async (method, name, { body, origin = base, form } = {}) => {
  const response = await fetch(`${base}/api/v1/host/${name}`, {
    method, headers: { ...(origin ? { origin } : {}), 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(form) : body && JSON.stringify(body),
  })
  const text = await response.text()
  let value
  try { value = JSON.parse(text) } catch { value = text }
  return { status: response.status, value, headers: response.headers }
}
const ask = path => call('POST', 'requests', { body: { path } })
const settle = async (id) => {
  for (let i = 0; i < 50; i += 1) {
    const { value } = await call('GET', `requests/${id}`)
    if (value.state !== 'working') return value
    await new Promise(done => setTimeout(done, 10))
  }
  throw new Error('still working')
}

test('only the owner of the engine on this computer gets in', async () => {
  user = undefined
  assert.equal((await call('GET', 'folders')).status, 401)
  user = owner
  kind = 'managed'
  for (const name of ['folders', 'mounts']) assert.equal((await call('GET', name)).status, 403)
  assert.equal((await ask(join(root, 'other'))).status, 403)
})

test('a request from another site, or from none, changes nothing', async () => {
  for (const origin of ['https://evil.example', null]) {
    assert.equal((await call('POST', 'requests', { body: { path: join(root, 'other') }, origin })).status, 403)
    assert.equal((await call('DELETE', 'mounts?path=/x', { origin })).status, 403)
  }
  assert.equal(sameOrigin({ headers: { origin: 'null', host: 'x' } }), false)
})

test('folders are listed as the picker reads them', async () => {
  const { value } = await call('GET', `folders?path=${encodeURIComponent(root)}`)
  assert.deepEqual(value.entries.map(entry => entry.name), ['data', 'other', 'share', 'we,ird'])
  assert.equal(value.mounted, null)
  assert.equal((await call('GET', `folders?path=${encodeURIComponent(join(root, 'share/site'))}`)).value.mounted.container, '/host/site')
})

test('a folder the Bots already see needs no approval', async () => {
  const { status, value } = await ask(join(root, 'share/site'))
  assert.deepEqual([status, value.container], [200, '/host/site'])
  assert.equal(calls.includes('start'), false)
})

test('data folders, links into them, system folders and odd names are refused', async () => {
  for (const path of [join(root, 'data'), join(root, 'data/bot'), root, join(root, 'other/link'), join(root, 'we,ird'), '/', '/etc', '/home', 'relative', join(root, 'none')]) {
    assert.equal((await ask(path)).status, 400, path)
  }
})

test('a mount takes the password, in a page the app cannot draw or frame', async () => {
  const path = join(root, 'other/docs')
  const { value: { id, approve } } = await ask(path)
  assert.equal(calls.some(line => line.startsWith('mount ')), false)
  const page = await call('GET', approve.slice('/api/v1/host/'.length))
  assert.match(page.value, /other\/docs/)
  assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin')
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  const wrong = await call('POST', `approve/${id}`, { form: { answer: 'allow', password: 'wrong' } })
  assert.equal(wrong.status, 403)
  assert.equal((await call('POST', `approve/${id}`, { form: { answer: 'allow', password: 'right' }, origin: 'https://evil.example' })).status, 403)
  assert.equal(calls.some(line => line.startsWith('mount ')), false)
  assert.equal((await call('POST', `approve/${id}`, { form: { answer: 'allow', password: 'right' } })).status, 200)
  assert.deepEqual(await settle(id), { state: 'done', error: null, container: path })
  assert.ok(calls.includes(`mount ${path} ${path}`) && calls.includes('start'))
  assert.equal((await call('POST', `approve/${id}`, { form: { answer: 'allow', password: 'right' } })).status, 410)
  assert.deepEqual(audit.map(row => [row.action, row.ok]), [['host-mount-denied', false], ['host-mount', true]])
})

test('denying changes nothing; guesses are limited; another account cannot answer', async () => {
  const first = (await ask(join(root, 'other'))).value.id
  user = { id: 2, email: 'b@example.com' }
  assert.equal((await call('GET', `approve/${first}`)).status, 410)
  user = owner
  assert.equal((await call('POST', `approve/${first}`, { form: { answer: 'deny' } })).status, 200)
  assert.equal((await settle(first)).state, 'denied')
  const second = (await ask(join(root, 'other'))).value.id
  for (let i = 0; i < 3; i += 1) await call('POST', `approve/${second}`, { form: { answer: 'allow', password: 'x' } })
  assert.equal((await call('POST', `approve/${second}`, { form: { answer: 'allow', password: 'right' } })).status, 429)
  assert.equal(calls.some(line => line.startsWith('mount ')), false)
})

test('a mount that does not come up is taken back', async () => {
  const path = join(root, 'other')
  const { id } = (await ask(path)).value
  failStart = true
  await call('POST', `approve/${id}`, { form: { answer: 'allow', password: 'right' } })
  assert.equal((await settle(id)).state, 'failed')
  assert.deepEqual(mounted, [])
})

test('a read-only folder is mounted so, and can be taken away', async () => {
  const path = join(root, 'other')
  const { id } = (await call('POST', 'requests', { body: { path, mode: 'ro' } })).value
  await call('POST', `approve/${id}`, { form: { answer: 'allow', password: 'right' } })
  await settle(id)
  assert.deepEqual((await call('GET', 'mounts')).value.mounts, [{ host: path, container: path, mode: 'ro' }])
  assert.equal((await call('DELETE', `mounts?path=${encodeURIComponent(path)}`)).status, 202)
})
