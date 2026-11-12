import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const fresh = () => `ghp_${randomBytes(16).toString('hex')}`
const answer = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: { m1: { id: 'm1', sessionId: 'm1', name: 'Chief', role: 'Chief of Staff', instructions: '', createdAt: 1 } },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

const teamHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'dsb-connector-account-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  return home
}

const setup = ({ github = { api: 'https://gh.test' } } = {}) => {
  const home = teamHome()
  const mounts = []
  const plugin = { name: 'mcp-client', apply() {} }
  const loader = {
    import: async name => { assert.equal(name, '@deepseek-ai/dsh-mcp-client'); return { default: plugin } },
    unwrapExports: exports => exports.default,
  }
  const ctx = fakeContext({ services: { loader } })
  ctx.plugin = (given, config) => {
    const mount = { config, disposed: false }
    mounts.push(mount)
    return { await: async () => {}, dispose: () => { mount.disposed = true } }
  }
  capture(ctx)
  apply(ctx, { home, github })
  return { ctx, home, mounts }
}

function capture(ctx) {
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (route) => { ctx.route = route; return register(route) }
}

async function call(ctx, endpoint, payload) {
  const response = await ctx.route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
  return response.json()
}

// The account name shown on the page must never carry markup, control characters or a
// runaway length, and it must be the name the service itself reported.
const SAFE = /^[A-Za-z0-9._-]+$/

test('the account name from the probe is sanitised before it is stored or shown', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  const raw = '<script>alert(1)</script>octo'
  globalThis.fetch = async () => answer(200, { login: raw })
  const { ctx, home } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const token = fresh()
  const connected = await call(ctx, 'connector-connect', { id: 'github', token })
  assert.equal(connected.ok, true, JSON.stringify(connected))
  const [github] = connected.value
  assert.equal(typeof github.account, 'string')
  assert.match(github.account, SAFE, 'the account name must be a plain name')
  assert.ok(github.account.length <= 64, `the account name must be short, got ${github.account.length}`)
  assert.ok(!github.account.includes('<'), 'the account name must not carry markup')
  assert.ok(!github.account.includes('>'), 'the account name must not carry markup')
  const saved = readFileSync(join(home, 'state.json'), 'utf8')
  assert.ok(!saved.includes(raw), 'the raw account name must not be written to disk')
  assert.ok(!saved.includes('<script>'), 'no markup from the probe may be written to disk')
  assert.ok(!saved.includes(token), 'the token must not be written to disk')
})

test('a control character or an overlong account name is filtered', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  globalThis.fetch = async () => answer(200, { login: `octo\n\t${'x'.repeat(400)}` })
  const { ctx, home } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const connected = await call(ctx, 'connector-connect', { id: 'github', token: fresh() })
  assert.equal(connected.ok, true, JSON.stringify(connected))
  const [github] = connected.value
  assert.match(github.account, SAFE)
  assert.ok(github.account.length <= 64, `the account name must be short, got ${github.account.length}`)
  assert.ok(!/[\r\n\t]/.test(github.account), 'the account name must not carry control characters')
})

test('an account name that is entirely invalid is refused: no empty account, no secret, no mount', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  globalThis.fetch = async () => answer(200, { login: '###<<<>>>' })
  const { ctx, home, mounts } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const token = fresh()
  const refused = await call(ctx, 'connector-connect', { id: 'github', token })
  assert.equal(refused.ok, false, JSON.stringify(refused))
  assert.match(refused.error.message, /GitHub/, 'the error must name the service')
  const state = await call(ctx, 'state', {})
  assert.deepEqual(state.value.secrets, [], 'no secret may be saved for a refused account')
  assert.deepEqual(state.value.connectors, [{ id: 'github', name: 'GitHub', state: 'off', account: null }])
  assert.equal(mounts.length, 0, 'nothing may be mounted')
  assert.ok(!readFileSync(join(home, 'state.json'), 'utf8').includes(token))
})

test('the account name comes from the probe, not from the request', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  globalThis.fetch = async () => answer(200, { login: 'octo' })
  const { ctx, home } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const connected = await call(ctx, 'connector-connect', { id: 'github', token: fresh(), account: 'someone-else', login: 'someone-else' })
  assert.equal(connected.ok, true, JSON.stringify(connected))
  assert.equal(connected.value[0].account, 'octo')
})

// The no-regression statement: a user who connects GitHub today still gets the same row,
// the same account label and the same mounted server.
test('a normal GitHub connection is unchanged: same row, same account label, same mounted server', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  globalThis.fetch = async () => answer(200, { login: 'octo' })
  const { ctx, home, mounts } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const token = fresh()
  const connected = await call(ctx, 'connector-connect', { id: 'github', token })
  assert.equal(connected.ok, true, JSON.stringify(connected))
  assert.deepEqual(connected.value, [{ id: 'github', name: 'GitHub', state: 'ready', account: 'octo' }])
  assert.equal(mounts.length, 1)
  assert.equal(mounts[0].config.serverName, 'github', 'the tool namespace must stay mcp__github__')
  assert.equal(mounts[0].config.transport, 'streamable-http')
  assert.equal(mounts[0].config.url, 'https://api.githubcopilot.com/mcp/')
  assert.equal(mounts[0].config.headers.Authorization, `Bearer ${token}`)
  const state = await call(ctx, 'state', {})
  assert.deepEqual(state.value.secrets.map(secret => [secret.name, secret.scope]), [['GITHUB_TOKEN', []]])
  assert.ok(!readFileSync(join(home, 'state.json'), 'utf8').includes(token))
})
