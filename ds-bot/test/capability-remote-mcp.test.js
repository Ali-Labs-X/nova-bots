import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const team = () => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief', name: 'Chief', capabilities: [], createdAt: 1 },
    worker: { id: 'worker', sessionId: 'worker', name: 'Worker', capabilities: [], createdAt: 2 },
  },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  revision: 1,
})

const makeHome = state => {
  const home = mkdtempSync(join(tmpdir(), 'dsb-remote-mcp-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  return home
}

const remote = (name, url) => ({ name, kind: 'mcp', description: 'Remote service', transport: 'streamable-http', url, headers: {} })

function testAgent(id, mounts, skills) {
  const disposers = []
  const skillMap = new Map()
  skills.set(id, skillMap)
  const agentCtx = {
    effect(execute) {
      const dispose = execute()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    plugin(plugin, config) {
      const record = { plugin, config, sessionId: id, disposed: false }
      mounts.push(record)
      return { await: async () => {}, dispose: () => { record.disposed = true } }
    },
    dispose() { for (const dispose of disposers.reverse()) dispose() },
  }
  return { id, session: { id }, ctx: agentCtx }
}

async function setup() {
  const home = makeHome(team())
  const mounts = []
  const skills = new Map()
  const mcpPlugin = { name: 'mcp-client', apply() {} }
  const loader = { import: async () => ({ default: mcpPlugin }), unwrapExports: exports => exports.default }
  const ctx = fakeContext({ services: { loader } })
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  ctx.sessionTitle = { rename: async () => {} }
  rt.resolveAgent = async sessionId => ({ session: { id: sessionId } })
  await rt.load()
  return {
    home,
    ctx,
    rt,
    mounts,
    skills,
    mcpPlugin,
    async dispose() {
      ctx.dispose()
      await rt.scheduleCapabilitiesReconcile()
      await new Promise(resolve => setImmediate(resolve))
      rmSync(home, { recursive: true, force: true, maxRetries: 5 })
    },
  }
}

// Saves a remote MCP, attaches it to Chief, lets the reconciler try to mount it.
async function saveAndMount(env, name, url) {
  const { rt, ctx, mounts, skills } = env
  const saved = await rt.capabilitySave(remote(name, url), { botId: 'chief' })
  await rt.changeCapabilityAttachment('attach', { name, bot: rt.state.bots.chief.name }, 'chief')
  ctx.emit('agent/created', { agent: testAgent('chief', mounts, skills) })
  await rt.scheduleCapabilitiesReconcile()
  return saved
}

const mountsFor = (env, name) => env.mounts.filter(mount => mount.config?.serverName === name)

test('a remote MCP is not approved just because it was saved, and it does not mount before approval', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  const saved = await saveAndMount(env, 'exa', 'https://mcp.exa.test/mcp')
  assert.equal(saved.approved, false, 'a remote MCP must not be approved on save')
  assert.equal(env.rt.state.capabilities.items.exa.approved, false)
  assert.equal(mountsFor(env, 'exa').length, 0, 'an unapproved remote MCP must not mount')
  assert.equal(env.rt.capabilityStatusesView().chief.exa.state, 'needs-approval')
})

test('a remote MCP on a plain http address is refused and nothing is saved', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  await assert.rejects(
    env.rt.capabilitySave(remote('exa', 'http://mcp.exa.test/mcp'), { botId: 'chief' }),
    /https/i,
    'a remote MCP must refuse a plain http address',
  )
  assert.equal(env.rt.state.capabilities.items.exa, undefined, 'a refused remote MCP must not be saved')
  assert.equal(env.mounts.length, 0)
})

test('a remote MCP can be approved and then mounts', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  await saveAndMount(env, 'exa', 'https://mcp.exa.test/mcp')
  await env.rt.capabilityEndpoint('capability-approve', { name: 'exa' })
  assert.equal(env.rt.state.capabilities.items.exa.approved, true)
  await env.rt.scheduleCapabilitiesReconcile()
  const mounted = mountsFor(env, 'exa')
  assert.equal(mounted.length, 1, 'an approved remote MCP must mount')
  assert.equal(mounted[0].config.url, 'https://mcp.exa.test/mcp')
  assert.equal(env.rt.capabilityStatusesView().chief.exa.state, 'ready')
})

test('a remote MCP whose URL changed must be approved again before it mounts again', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  const { rt } = env
  await saveAndMount(env, 'exa', 'https://mcp.exa.test/mcp')
  await rt.capabilityEndpoint('capability-approve', { name: 'exa' })
  await rt.scheduleCapabilitiesReconcile()
  assert.equal(mountsFor(env, 'exa').length, 1)

  const changed = await rt.capabilitySave(remote('exa', 'https://mcp2.exa.test/mcp'), { botId: 'chief' })
  assert.equal(changed.approved, false, 'a changed remote MCP must need approval again')
  await rt.scheduleCapabilitiesReconcile()
  assert.equal(
    mountsFor(env, 'exa').filter(mount => mount.config.url === 'https://mcp2.exa.test/mcp').length,
    0,
    'a changed remote MCP must not mount before it is approved again',
  )
  assert.equal(rt.capabilityStatusesView().chief.exa.state, 'needs-approval')

  await rt.capabilityEndpoint('capability-approve', { name: 'exa' })
  await rt.scheduleCapabilitiesReconcile()
  const live = mountsFor(env, 'exa').filter(mount => !mount.disposed)
  assert.equal(live.length, 1)
  assert.equal(live[0].config.url, 'https://mcp2.exa.test/mcp')
  const old = mountsFor(env, 'exa').find(mount => mount.config.url === 'https://mcp.exa.test/mcp')
  assert.equal(old.disposed, true, 'the mount of the old URL must be disposed')
})
