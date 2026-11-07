// A throwaway staging stack for the integration and browser tests:
//
//   nbt-test-pg            Postgres in a container (its own database; never
//                          the live nova_bots database)
//   portal (child process) server.mjs on 127.0.0.1:<port>, NOVA_TENANCY=isolated,
//                          sign-up open, tenant prefix nbt-test-t-, its own
//                          tenant network, port range and docker label instance
//
// Everything docker-side is named nbt-test-* and removed by stop().
//
//   node test/integration/stack.mjs up      # start and leave running
//   node test/integration/stack.mjs down    # remove everything nbt-test-*

import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, openSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTAL_DIR = join(HERE, '..', '..')
const STATE_DIR = join(HERE, '.state')
const STATE_FILE = join(STATE_DIR, 'stack.json')

export const PREFIX = 'nbt-test-'
const PG = `${PREFIX}pg`
const PG_IMAGE = process.env.NBT_PG_IMAGE ?? 'pgvector/pgvector:pg16'
const PG_PORT = Number(process.env.NBT_PG_PORT ?? 15499)

export const docker = (args, { timeout = 120000, allowFail = false } = {}) => new Promise((resolve, reject) => {
  execFile('docker', args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && !allowFail) return reject(new Error(`docker ${args.join(' ')}: ${stderr || error.message}`))
    resolve(String(stdout).trim())
  })
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, { timeoutMs = 60000, every = 500, what = 'condition' } = {}) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch { /* not yet */ }
    await sleep(every)
  }
  throw new Error(`timed out waiting for ${what}`)
}

export const stackEnv = ({ portalPort, pgPassword, jwtSecret, adminToken, secretKey, exportDir, idleMinutes }) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NOVA_PORTAL_HOST: '127.0.0.1',
  NOVA_PORTAL_PORT: String(portalPort),
  NOVA_DATABASE_URL: `postgres://postgres:${pgPassword}@127.0.0.1:${PG_PORT}/nova_bots_staging`,
  NOVA_JWT_SECRET: jwtSecret,
  NOVA_ADMIN_TOKEN: adminToken,
  NOVA_TENANCY: 'isolated',
  NOVA_SIGNUP_MODE: 'open',
  NOVA_SUPPORT_CONTACT: 'jahanzaib@alilabs.com',
  NOVA_TENANT_INSTANCE: 'nbt-test',
  NOVA_TENANT_PREFIX: `${PREFIX}t-`,
  NOVA_TENANT_NETWORK: `${PREFIX}tenants`,
  NOVA_TENANT_BRIDGE_NAME: 'nbt-test-br0',
  NOVA_TENANT_PORT_BASE: process.env.NBT_TENANT_PORT_BASE ?? '14600',
  NOVA_TENANT_PORT_COUNT: '50',
  NOVA_TENANT_MAX_RUNNING: '4',
  NOVA_TENANT_MAX_TOTAL: '10',
  NOVA_TENANT_IDLE_MINUTES: String(idleMinutes ?? 30),
  NOVA_TENANT_REAP_INTERVAL_MS: '5000',
  NOVA_TENANT_MEMORY: '1536m',
  NOVA_TENANT_CPUS: '1.0',
  NOVA_TENANT_SECRET_KEY: secretKey,
  NOVA_TENANT_EXPORT_DIR: exportDir,
  NOVA_TENANT_TRUSTED_HOST: 'localhost,127.0.0.1',
  // The staging stack has no shared engine; nothing points at the live one.
  NOVA_ENGINE_URL: 'http://127.0.0.1:9',
  NOVA_ENGINE_CONTAINER: `${PREFIX}no-shared-engine`,
  NOVA_LAUNCH_TOKEN_FILE: join(STATE_DIR, 'no-shared-token'),
  NOVA_LEGACY_TENANT_EMAIL: 'nobody-legacy@nbt-test.invalid',
})

export const start = async ({ portalPort = 13181, idleMinutes } = {}) => {
  mkdirSync(STATE_DIR, { recursive: true })
  const exportDir = join(STATE_DIR, 'exports')
  mkdirSync(exportDir, { recursive: true })
  const secrets = {
    pgPassword: randomBytes(12).toString('hex'),
    jwtSecret: randomBytes(32).toString('base64url'),
    adminToken: randomBytes(24).toString('base64url'),
    secretKey: randomBytes(32).toString('base64url'),
  }
  await docker(['rm', '-f', PG], { allowFail: true })
  await docker(['run', '-d', '--name', PG, '--label', 'nova-bots.instance=nbt-test',
    '-e', `POSTGRES_PASSWORD=${secrets.pgPassword}`, '-e', 'POSTGRES_DB=nova_bots_staging',
    '-p', `127.0.0.1:${PG_PORT}:5432`, PG_IMAGE])
  await waitFor(async () => (await docker(['exec', PG, 'pg_isready', '-U', 'postgres', '-d', 'nova_bots_staging'], { allowFail: true })).includes('accepting'), { what: 'postgres' })
  await sleep(1500)

  const env = stackEnv({ portalPort, exportDir, idleMinutes, ...secrets })
  const log = openSync(join(STATE_DIR, 'portal.log'), 'a')
  const child = spawn(process.execPath, ['server.mjs'], { cwd: PORTAL_DIR, env, stdio: ['ignore', log, log], detached: true })
  child.unref()
  const base = `http://127.0.0.1:${portalPort}`
  await waitFor(async () => (await fetch(`${base}/health`)).ok, { what: 'staging portal' })
  const state = { pid: child.pid, base, portalPort, adminToken: secrets.adminToken, exportDir }
  writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 })
  return { ...state, child }
}

export const stop = async () => {
  if (existsSync(STATE_FILE)) {
    try {
      const { pid } = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
      process.kill(pid, 'SIGTERM')
    } catch { /* already gone */ }
  }
  // Only nbt-test-* objects are ever touched.
  const containers = (await docker(['ps', '-aq', '--filter', `name=^${PREFIX}`], { allowFail: true })).split('\n').filter(Boolean)
  if (containers.length) await docker(['rm', '-f', ...containers], { allowFail: true })
  const volumes = (await docker(['volume', 'ls', '-q', '--filter', `name=^${PREFIX}`], { allowFail: true })).split('\n').filter(Boolean)
  if (volumes.length) await docker(['volume', 'rm', '-f', ...volumes], { allowFail: true })
  const networks = (await docker(['network', 'ls', '-q', '--filter', `name=^${PREFIX}`], { allowFail: true })).split('\n').filter(Boolean)
  if (networks.length) await docker(['network', 'rm', ...networks], { allowFail: true })
  rmSync(STATE_FILE, { force: true })
}

export const leftovers = async () => ({
  containers: (await docker(['ps', '-a', '--format', '{{.Names}}', '--filter', `name=^${PREFIX}`], { allowFail: true })).split('\n').filter(Boolean),
  volumes: (await docker(['volume', 'ls', '-q', '--filter', `name=^${PREFIX}`], { allowFail: true })).split('\n').filter(Boolean),
  networks: (await docker(['network', 'ls', '--format', '{{.Name}}', '--filter', `name=^${PREFIX}`], { allowFail: true })).split('\n').filter(Boolean),
})

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2]
  if (command === 'up') {
    const state = await start({ portalPort: Number(process.argv[3] ?? 13181) })
    console.log(`staging portal at ${state.base} (pid ${state.pid}); state in ${STATE_FILE}`)
  } else if (command === 'down') {
    await stop()
    console.log('removed', JSON.stringify(await leftovers()))
  } else {
    console.log('usage: node test/integration/stack.mjs up [port] | down')
  }
}
