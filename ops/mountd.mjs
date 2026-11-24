// nova-mountd: lists this computer's folders and mounts one into the Bots' container. It runs as
// the user, listens on a unix socket only that user can open, and is asked only by the portal,
// which checks who is asking. A mount recreates the container, as `nova-bots.sh start` does.
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LIST_MAX = 2000
const READY_TRIES = 90
// The container keeps its own folders everywhere else.
const PLACES = ['/home', '/mnt', '/media', '/srv', '/opt']
const SENSITIVE = /^(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.config|\.local|\.password-store|\.mozilla|\.nova|\.claude|vaultwarden|snap)$/
const bad = (message, code = 'invalid') => Object.assign(new Error(message), { code })
export const within = (inner, outer) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep)

export function createMounts({ run, home = homedir(), share, own = [], ready, sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
  let job = null
  const mounts = async () => (await run(['mounts-list'])).split('\n').filter(Boolean).map((line) => {
    const [host, container, mode] = line.split(':')
    return { host, container, mode: mode === 'ro' ? 'ro' : 'rw' }
  })

  // Links are followed first, so a name cannot stand for another folder.
  async function clean(input) {
    if (typeof input !== 'string' || !isAbsolute(input)) throw bad('Give the full path of a folder')
    let path
    try { path = await realpath(input) } catch { throw bad('There is no such folder') }
    if (!(await stat(path)).isDirectory()) throw bad('That is a file, not a folder')
    return path
  }
  async function mountable(input) {
    const path = await clean(input)
    // The names go through .env and compose, which give these a meaning.
    if (/[\n\r:,#"'$\\`]/.test(path)) throw bad('The folder name has a character that cannot be mounted')
    if (!PLACES.some(place => within(path, place)) || PLACES.includes(path)) throw bad('System folders cannot be mounted')
    if (path === '/home/node' || within(path, '/home/node')) throw bad('System folders cannot be mounted')
    if (own.some(dir => within(path, dir) || within(dir, path))) throw bad('This folder holds the data of Nova Bots, so Bots cannot work there')
    return path
  }
  const risky = path => within(home, path) || path.split(sep).some(part => SENSITIVE.test(part))
  // Where the container already shows a folder of this computer.
  async function inContainer(path) {
    const all = [...(share ? [{ host: share, container: '/host', mode: 'rw' }] : []), ...await mounts()]
    const found = all.filter(mount => within(path, mount.host)).sort((a, b) => b.host.length - a.host.length)[0]
    return found ? { container: found.container + path.slice(found.host.length), mode: found.mode } : null
  }

  async function list(input) {
    const path = await clean(input || home)
    let entries
    try { entries = await readdir(path, { withFileTypes: true }) } catch { throw bad('This folder cannot be read') }
    const folders = entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    const crumbs = []
    for (let at = path; ; at = dirname(at)) {
      crumbs.unshift({ name: at === dirname(at) ? at : basename(at), path: at, hidden: false })
      if (at === dirname(at)) break
    }
    return {
      path, home, crumbs, truncated: folders.length > LIST_MAX, mounted: await inContainer(path),
      entries: folders.slice(0, LIST_MAX).map(entry => ({ name: entry.name, path: join(path, entry.name), hidden: entry.name.startsWith('.') })),
    }
  }
  async function inspect(input) {
    const path = await mountable(input)
    return { path, risky: risky(path), mounted: await inContainer(path) }
  }

  function start(work, path) {
    if (job?.state === 'working') throw bad('Another folder is being mounted', 'busy')
    const mine = job = { state: 'working', path, startedAt: Date.now() }
    mine.done = work().then(() => { mine.state = 'done' }, (error) => { mine.state = 'failed'; mine.error = error.message })
    return mine
  }
  async function up(container) {
    await run(['start'])
    for (let tries = 0; tries < READY_TRIES; tries += 1) {
      if (await ready(container)) return
      await sleep(1000)
    }
    throw bad('The Bots did not come back with the folder')
  }
  async function add(input, mode) {
    const path = await mountable(input)
    if (mode !== 'rw' && mode !== 'ro') throw bad('The mode is rw or ro')
    if (await inContainer(path)) return { state: 'done', path }
    return start(async () => {
      await run(['mount', path, mode === 'ro' ? `${path}:ro` : path])
      try { await up(path) } catch (error) {
        await run(['unmount', path])
        await up(undefined)
        throw error
      }
    }, path)
  }
  async function remove(input) {
    if (!(await mounts()).some(mount => mount.host === input)) throw bad('This folder is not mounted')
    return start(async () => { await run(['unmount', input]); await up(undefined) }, input)
  }
  const status = () => (job ? { state: job.state, path: job.path, error: job.error ?? null } : { state: 'idle' })
  return { list, inspect, add, remove, mounts, status }
}

export function handler(api) {
  return async (req, res) => {
    const answer = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    try {
      const url = new URL(req.url, 'http://mountd')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      const key = `${req.method} ${url.pathname}`
      const path = url.searchParams.get('path') ?? body.path
      if (key === 'GET /folders') return answer(200, await api.list(path))
      if (key === 'GET /inspect') return answer(200, await api.inspect(path))
      if (key === 'GET /mounts') return answer(200, { mounts: await api.mounts() })
      if (key === 'GET /status') return answer(200, api.status())
      if (key === 'POST /mounts') { const job = await api.add(path, body.mode); return answer(202, { state: job.state, path: job.path }) }
      if (key === 'DELETE /mounts') { const job = await api.remove(path); return answer(202, { state: job.state, path: job.path }) }
      return answer(404, { error: 'Unknown' })
    } catch (error) {
      return answer(error.code === 'busy' ? 409 : 400, { error: error.message })
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exec = (file, args, timeout = 300_000) => new Promise((done, fail) => execFile(file, args, { timeout, maxBuffer: 4 << 20 }, (error, stdout) => (error ? fail(new Error(`${basename(file)} ${args[0]} failed`)) : done(stdout))))
  const script = join(ROOT, 'nova-bots.sh')
  const share = (await exec(script, ['share-path'])).trim()
  const dir = process.env.RUNTIME_DIRECTORY ?? join(process.env.XDG_RUNTIME_DIR, 'nova-mountd')
  const socket = join(dir, 'sock')
  const api = createMounts({
    run: args => exec(script, args),
    share: share ? await realpath(share) : undefined,
    own: [join(ROOT, 'docker', 'data'), join(ROOT, 'portal')],
    ready: async (container) => {
      try {
        await exec('docker', ['exec', '-u', 'node', 'nova-bots', 'test', '-d', container ?? '/workspace'], 10_000)
        const answer = await fetch(process.env.NOVA_ENGINE_URL ?? 'http://127.0.0.1:13083', { redirect: 'manual', signal: AbortSignal.timeout(2000) })
        await answer.body?.cancel()
        return true
      } catch { return false }
    },
  })
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (existsSync(socket)) rmSync(socket)
  createServer(handler(api)).listen(socket, () => { chmodSync(socket, 0o600); console.log(`nova-mountd on ${socket}`) })
}
