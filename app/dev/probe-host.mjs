// Live probe: boot the app's own Host with the UI overlay in place, then ask the Host for
// its launch URL and look at what it actually serves.
//
// What it proves: that the Host answers the launch URL with the app's own index.html and
// mints its session cookie on that response, that the app's assets and the Bot channel
// answer from that same origin, and that the page's own script policy allows exactly the
// boot scripts the Host injected into it and nothing else.
//
// The unit tests cannot answer this: the point of the fix is what the Host serves at
// runtime, not what the code says it should serve.
//
// How to run it, from app/: `npm run runtime`, `npm run build`, then `node dev/probe-host.mjs`.
// It writes to a data directory of its own and never touches the user's data.
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const uiIndex = join(appDir, 'ui', 'dist', 'index.html')
const runtimeDir = join(appDir, 'build', 'runtime')

if (!existsSync(uiIndex)) {
  console.error(`Nova Bots: the app's own UI is not built (${uiIndex}); run "npm run build" in app/`)
  process.exit(1)
}
if (!existsSync(join(runtimeDir, 'primary-runtime', 'runtime.json'))) {
  console.error(`Nova Bots: the pinned runtime is missing (${runtimeDir}); run "npm run runtime" in app/`)
  process.exit(1)
}

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

const home = mkdtempSync(join(tmpdir(), 'novabots-probe-'))
const child = fork(join(appDir, 'src', 'host.mjs'), [join(appDir, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')], {
  cwd: appDir,
  env: {
    ...process.env,
    DSH_HOME: home,
    DS_BOT_PORT: '0',
    DS_BOT_APP: '1',
    DS_BOT_RUNTIME_DIR: runtimeDir,
    NOVA_BOTS_UI_INDEX: uiIndex,
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
let log = ''
child.stdout.on('data', data => { log += String(data); process.stdout.write(`[host] ${data}`) })
child.stderr.on('data', data => { log += String(data); process.stderr.write(`[host!] ${data}`) })
const stop = () => { if (!child.killed) child.kill('SIGTERM') }
process.on('exit', stop)

const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`the Host did not report a launch URL\n${log}`)), 180_000)
  child.on('message', (message) => {
    if (message?.type === 'ready') { clearTimeout(timer); resolve(message.url) }
    if (message?.type === 'fatal') { clearTimeout(timer); reject(new Error(`fatal: ${message.message}\n${message.diagnostic ?? ''}`)) }
  })
  child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the Host stopped (exit ${code})\n${log}`)) })
})
const origin = new URL('/', url)

const launch = await fetch(url, { redirect: 'manual' })
const cookie = launch.headers.get('set-cookie')?.split(';')[0] ?? ''
check('the launch URL answers with a session cookie', launch.status === 303 && cookie !== '', `status ${launch.status}`)

const page = await fetch(origin, { headers: { cookie }, redirect: 'manual' })
const body = await page.text()
const ours = readFileSync(uiIndex, 'utf8')
const title = /<title>([^<]*)<\/title>/u.exec(ours)?.[1] ?? ''
const script = /src="\.\/([^"]+\.js)"/u.exec(ours)?.[1] ?? ''
check('the Host serves the app\'s own index', page.status === 200 && title !== '' && body.includes(`<title>${title}</title>`), `status ${page.status}`)
check('the index carries the app\'s own bundle', script !== '' && body.includes(script))

for (const asset of [script, /href="\.\/([^"]+\.css)"/u.exec(ours)?.[1] ?? '']) {
  if (asset === '') continue
  const response = await fetch(new URL(asset, origin), { headers: { cookie } })
  check(`the asset ${asset} is served`, response.status === 200, `status ${response.status}`)
}

const call = async (headers) => {
  const response = await fetch(new URL('/api/bot', origin), {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ endpoint: 'no-such-endpoint' }),
  })
  return response.status
}
check('the Bot channel answers with the cookie', await call({ cookie }) === 200)
check('the Bot channel refuses without the cookie', await call({}) === 401)

// What the runtime injects into the served index, and what the page's own policy allows.
const inline = body.match(/<script(?![^>]*\bsrc=)[^>]*>/gu) ?? []
const oursInline = ours.match(/<script(?![^>]*\bsrc=)[^>]*>/gu) ?? []
const policy = /content="([^"]*default-src[^"]*)"/u.exec(ours)?.[1] ?? ''
const scriptSrc = /script-src ([^;]*)/u.exec(policy)?.[1] ?? ''
console.log(`inline scripts in the served index: ${inline.length} (the app's own index has ${oursInline.length})`)
console.log(`the app's policy script-src: ${scriptSrc}`)
console.log('the injected names:', [...body.matchAll(/globalThis\.([A-Za-z0-9_]+) =/gu)].map(m => m[1]).join(', ') || '(none)')

// The served page's own policy: the Host hashes its injected scripts into it.
const servedPolicy = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/u.exec(body)?.[1] ?? ''
const servedScriptSrc = /script-src ([^;]*)/u.exec(servedPolicy)?.[1] ?? ''
const hashes = servedScriptSrc.split(/\s+/u).filter(token => token.startsWith("'sha256-"))
const servedInline = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gu)].map(match => match[1])
const hashOf = text => createHash('sha256').update(text, 'utf8').digest('base64')

check('the served page does not allow inline scripts', !servedScriptSrc.includes("'unsafe-inline'"), servedScriptSrc)
check('the served page allows no wildcard', !servedScriptSrc.includes('*'), servedScriptSrc)
check('the served policy keeps the same-origin scripts', servedScriptSrc.includes("'self'"))
check('every inline script is hashed', hashes.length === servedInline.length,
  `${hashes.length} hash(es) for ${servedInline.length} inline script(s)`)
check('every hash matches its script', servedInline.every(script => hashes.includes(`'sha256-${hashOf(script)}'`)))
const policyAt = body.indexOf('<meta http-equiv="Content-Security-Policy"')
const firstScriptAt = body.search(/<script(?![^>]*\bsrc=)[^>]*>/u)
check('the policy comes before the first inline script', policyAt !== -1 && (firstScriptAt === -1 || policyAt < firstScriptAt),
  `policy at ${policyAt}, first script at ${firstScriptAt}`)

stop()
if (failures.length > 0) {
  console.error(`Nova Bots: ${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('Nova Bots: the window serves the app\'s own UI from the Host')
process.exit(0)
