import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CapacityError, containerArgs, secretBox, tenancyConfigFromEnv, Tenants } from '../tenants.mjs'
import { EngineCookieJar } from '../bridge.mjs'
import { Auth } from '../auth.mjs'
import { createHash } from 'node:crypto'

const config = tenancyConfigFromEnv({})
const tenant = { id: '11111111-2222-3333-4444-555555555555', container: 'nova-bots-t-11111111-2222-3333-4444-555555555555', volume: 'nova-bots-t-11111111-2222-3333-4444-555555555555-data', port: 14100, limits: {} }

const pairs = (args, flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []))

test('tenant containers are hardened: no caps beyond four, no-new-privileges, limits, loopback port', () => {
  const args = containerArgs({ tenant, config })
  assert.deepEqual(pairs(args, '--cap-drop'), ['ALL'])
  assert.deepEqual(pairs(args, '--cap-add').sort(), ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID'])
  assert.deepEqual(pairs(args, '--security-opt'), ['no-new-privileges'])
  assert.deepEqual(pairs(args, '--publish'), ['127.0.0.1:14100:3080'])
  assert.deepEqual(pairs(args, '--memory'), ['1536m'])
  assert.deepEqual(pairs(args, '--memory-swap'), ['1536m'])
  assert.deepEqual(pairs(args, '--pids-limit'), ['512'])
  assert.deepEqual(pairs(args, '--cpus'), ['1.0'])
  assert.ok(pairs(args, '--log-opt').includes('max-size=10m'))
  assert.ok(pairs(args, '--label').includes(`nova-bots.tenant=${tenant.id}`))
  assert.ok(pairs(args, '--env').includes('BOT_ROOT=0'))
})

test('tenant containers get no docker socket, no host folder, no host gateway and no provider key', () => {
  const args = containerArgs({ tenant, config })
  const volumes = pairs(args, '--volume')
  assert.deepEqual(volumes, [`${tenant.volume}:/data`, `${tenant.volume}-work:/workspace`])
  assert.ok(volumes.every(v => !v.startsWith('/')), 'only named volumes')
  assert.ok(!args.join(' ').includes('docker.sock'))
  assert.ok(!args.includes('--add-host') && !args.includes('--privileged'))
  assert.ok(!args.some(a => /API_KEY/.test(a)))
  assert.ok(!args.includes('--env-file'))
})

test('per-tenant limits override the defaults; names are validated', () => {
  const args = containerArgs({ tenant: { ...tenant, limits: { memory: '3g', cpus: '2', pids: 1024 } }, config })
  assert.deepEqual(pairs(args, '--memory'), ['3g'])
  assert.deepEqual(pairs(args, '--cpus'), ['2'])
  assert.throws(() => containerArgs({ tenant: { ...tenant, container: '--privileged' }, config }))
  assert.throws(() => containerArgs({ tenant: { ...tenant, volume: '/var/run/docker.sock' }, config }))
})

test('assigned provider keys are sealed with AES-GCM and need the key to open', () => {
  assert.equal(secretBox(''), null)
  assert.equal(secretBox('short'), null)
  const box = secretBox('x'.repeat(40))
  const sealed = box.seal({ DEEPSEEK_API_KEY: 'sk-secret' })
  assert.ok(!sealed.includes('sk-secret'))
  assert.deepEqual(box.open(sealed), { DEEPSEEK_API_KEY: 'sk-secret' })
  assert.throws(() => secretBox('y'.repeat(40)).open(sealed))
  const parts = sealed.split('.')
  parts[3] = Buffer.from('tampered').toString('base64url')
  assert.throws(() => box.open(parts.join('.')))
})

// A provisioner with an in-memory store and docker, for the lifecycle rules.
const fakeProvisioner = ({ maxRunning = 2, idleMinutes = 30 } = {}) => {
  const rows = new Map()
  const containers = new Map()
  const t = new Tenants({
    pool: {},
    config: { ...config, maxRunning, idleMinutes },
    jar: new EngineCookieJar({ mint: async () => 'dsh-auth-x=1' }),
    audit: async () => {},
    log: { error() {} },
    docker: {
      inspect: async name => ({ exists: containers.has(name), running: containers.get(name) === 'running' }),
      run: async args => {
        if (args[0] === 'start') containers.set(args[1], 'running')
        if (args[0] === 'stop') containers.set(args.at(-1), 'stopped')
        return ''
      },
      readFile: async () => 'tok',
    },
  })
  t.store = {
    byId: async id => rows.get(id) ?? null,
    update: async (id, fields) => { rows.set(id, { ...rows.get(id), ...fields }); return rows.get(id) },
  }
  t.runningManaged = async () => [...rows.values()].filter(r => r.state === 'running').map(r => r.id)
  t.provision = async row => { containers.set(row.container, 'stopped'); return { exists: true, running: false } }
  const add = (id, state = 'new') => {
    const row = { id, kind: 'managed', container: `c-${id}`, volume: `v-${id}`, port: 1, state }
    rows.set(id, row)
    if (state === 'running') containers.set(row.container, 'running')
    return row
  }
  return { t, rows, containers, add }
}

test('lazy start: a missing container is created and started, concurrent requests share one start', async () => {
  const { t, add, containers } = fakeProvisioner()
  const row = add('a')
  const [one, two] = await Promise.all([t.ensureRunning(row), t.ensureRunning(row)])
  assert.equal(one.state, 'running')
  assert.equal(two.state, 'running')
  assert.equal(containers.get('c-a'), 'running')
})

test('hard cap: the least recently active idle tenant is stopped to make room; open feeds are never evicted', async () => {
  const { t, add, containers } = fakeProvisioner({ maxRunning: 2 })
  add('old', 'running'); add('busy', 'running')
  t.activity.set('old', 1000); t.activity.set('busy', 500)
  t.socketOpened('busy', { destroy() {} })
  t.activity.set('busy', 500)
  await t.ensureRunning(add('new'))
  assert.equal(containers.get('c-old'), 'stopped')
  assert.equal(containers.get('c-busy'), 'running')
  assert.equal(containers.get('c-new'), 'running')
  // Everything left is busy: the next start is refused, not forced.
  t.socketOpened('new', { destroy() {} })
  await assert.rejects(t.ensureRunning(add('fourth')), CapacityError)
})

test('idle stop: only tenants idle past the limit with no open feed are stopped', async () => {
  const { t, add, containers } = fakeProvisioner({ idleMinutes: 30 })
  add('idle', 'running'); add('fresh', 'running'); add('feed', 'running')
  const now = Date.now()
  t.activity.set('idle', now - 31 * 60000)
  t.activity.set('fresh', now - 5 * 60000)
  t.activity.set('feed', now - 90 * 60000)
  t.socketOpened('feed', { destroy() {} })
  t.activity.set('feed', now - 90 * 60000)
  const stopped = await t.reap(now)
  assert.deepEqual(stopped, ['idle'])
  assert.equal(containers.get('c-idle'), 'stopped')
  assert.equal(containers.get('c-fresh'), 'running')
})

test('the legacy (shared) engine is never stopped or recreated by the provisioner', async () => {
  const { t } = fakeProvisioner()
  await assert.rejects(t.stop({ id: 'l', kind: 'legacy' }), /not managed/)
  await assert.rejects(t.assignKey({ id: 'l', kind: 'legacy' }, { DEEPSEEK_API_KEY: 'x' }), /docker\/.env/)
  assert.equal((await t.ensureRunning({ id: 'l', kind: 'legacy' })).kind, 'legacy')
})

test('only allowlisted provider env names can be assigned', async () => {
  const { t, add } = fakeProvisioner()
  t.box = secretBox('k'.repeat(40))
  await assert.rejects(t.assignKey(add('k'), { LD_PRELOAD: '/x.so' }), /not an assignable key/)
  await assert.rejects(t.assignKey(add('k2'), { DEEPSEEK_API_KEY: 'a\nINJECT=1' }), /one-line/)
})

test('sessions are HMAC-signed: an unkeyed (forged) token is rejected, a wrong secret is rejected', () => {
  const auth = new Auth({ databaseUrl: 'postgres://invalid/none', jwtSecret: 's'.repeat(32) })
  const { token } = auth.issueToken({ id: 'u1', token_version: 0 })
  assert.equal(auth.verifyToken(token).sub, 'u1')
  // The old, unkeyed construction.
  const [header, body] = token.split('.')
  const forgedBody = Buffer.from(JSON.stringify({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), ver: 0 })).toString('base64url')
  const unkeyed = createHash('sha256').update(`${header}.${forgedBody}`).digest('base64url')
  assert.equal(auth.verifyToken(`${header}.${forgedBody}.${unkeyed}`), null)
  const other = new Auth({ databaseUrl: 'postgres://invalid/none', jwtSecret: 't'.repeat(32) })
  assert.equal(other.verifyToken(token), null)
  assert.equal(auth.verifyToken(`${header}.${body}.`), null)
  assert.throws(() => new Auth({ databaseUrl: 'postgres://invalid/none', jwtSecret: '' }))
  auth.pool.end(); other.pool.end()
})
