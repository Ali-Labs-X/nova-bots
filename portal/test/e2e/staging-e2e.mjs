// Browser end-to-end proof against a STAGING stack (never the live site):
// headless Chromium walks the product as a client would, with tenancy on.
//
//   cd portal && node test/e2e/staging-e2e.mjs
//
// It starts the staging stack (test/integration/stack.mjs: its own Postgres
// container and portal on 127.0.0.1:13181) plus an nginx front end
// (nbt-test-web, 127.0.0.1:13180, the production nginx config pointed at the
// staging portal), then:
//
//   sign-up page adapts to the mode -> sign up A through the form -> lands in
//   A's OWN freshly provisioned engine -> account page -> sign out -> sign in
//   again -> same workspace and data -> B signs up in another browser -> B's
//   own engine, none of A's bots; A's engine cookie planted in B's browser
//   changes nothing -> A is stopped -> A's next visit wakes it with its data.
//
// Screenshots and a step log land in test/e2e/.state/ (git-ignored); the
// tenant containers and volumes are removed at the end.
//
// PLAYWRIGHT: path to @playwright/test's index.mjs. It comes from the
// environment: the browser package is not a dependency of the portal, so the
// run says where it is instead of carrying one machine's path in the source.

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { docker, leftovers, start, stop } from '../integration/stack.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.NBT_E2E_OUT ?? join(HERE, '.state')
const PLAYWRIGHT = process.env.PLAYWRIGHT
if (!PLAYWRIGHT) throw new Error('PLAYWRIGHT is not set: point it at the @playwright/test entry of a Playwright install')
const PORTAL_PORT = 13181
const WEB_PORT = 13180
const WEB = `http://127.0.0.1:${WEB_PORT}`
const NGINX_IMAGE = 'nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'

mkdirSync(OUT, { recursive: true })
const { chromium } = await import(PLAYWRIGHT)
const lines = []
const log = (line) => { console.log(line); lines.push(line) }
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const assert = (ok, message) => {
  if (!ok) throw new Error(`ASSERTION FAILED: ${message}`)
  log(`   ok: ${message}`)
}

// The production nginx config, pointed at the staging portal and listening
// on the loopback only.
const stagingNginx = () => {
  const conf = readFileSync(join(HERE, '..', '..', 'nginx', 'nova-bots.conf'), 'utf8')
    .replace('server host.docker.internal:13081;', `server 127.0.0.1:${PORTAL_PORT};`)
    .replace(/upstream nova_bots_engine \{[^}]*\}\n/, '')
    .replace('proxy_pass http://nova_bots_engine;', 'proxy_pass http://nova_bots_portal;')
    .replace('listen 80;', `listen 127.0.0.1:${WEB_PORT};`)
    // Staging runs on a port: keep it in Host so it matches the browser's
    // Origin (production has no port, where $host and $http_host agree).
    .replaceAll('proxy_set_header Host $host;', 'proxy_set_header Host $http_host;')
  const path = join(OUT, 'nginx.conf')
  writeFileSync(path, conf)
  return path
}

let browser
let stack
const pages = []
try {
  await stop()
  stack = await start({ portalPort: PORTAL_PORT })
  await docker(['run', '-d', '--name', 'nbt-test-web', '--network', 'host',
    '-v', `${stagingNginx()}:/etc/nginx/conf.d/default.conf:ro`,
    '-v', `${join(HERE, '..', '..', 'public')}:/srv:ro`, NGINX_IMAGE])
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`${WEB}/login`)).ok) break } catch { /* not yet */ }
    await sleep(250)
  }
  log(`staging: web ${WEB} -> portal ${stack.base} (NOVA_TENANCY=isolated, NOVA_SIGNUP_MODE=open)`)

  browser = await chromium.launch({ headless: true })
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  pages.push(['A', pageA], ['B', pageB])
  for (const [who, page] of pages) page.on('pageerror', error => log(`   ${who} page error: ${error.message}`))
  const responses = []
  for (const [who, page] of [['A', pageA], ['B', pageB]]) {
    page.on('response', r => {
      const path = new URL(r.url()).pathname
      if (path.startsWith('/api/v1/auth/') || path === '/app/' || path === '/login') responses.push(`${who} ${r.status()} ${r.request().method()} ${path}`)
    })
  }
  let n = 0
  const shot = async (page, label) => {
    n += 1
    const name = `${String(n).padStart(2, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.png`
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.screenshot({ path: join(OUT, name) })
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)
    log(`[${name}] ${label}\n     url=${new URL(page.url()).pathname}  text="${text}"`)
  }
  const state = async (page) => {
    let last
    for (let i = 0; i < 15; i += 1) {
      last = await page.evaluate(async () => {
        try {
          const r = await fetch('/app/api/bot', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'state', payload: null }) })
          const text = await r.text()
          if (!r.ok) return { status: r.status, text: text.slice(0, 160) }
          const v = JSON.parse(text).value
          return { status: r.status, workspaceId: v.workspaceId, bots: v.bots.map(b => `${b.name}:${b.id.slice(-8)}`) }
        } catch (error) {
          return { status: 0, text: String(error) }
        }
      }).catch(error => ({ status: -1, text: String(error) }))
      if (last.status === 200) return last
      await sleep(2000)
    }
    throw new Error(`engine state not readable: ${JSON.stringify(last)}`)
  }
  const waitForEngine = async (page, label) => {
    let sawProvisioning = false
    for (let i = 0; i < 120; i += 1) {
      const text = await page.locator('body').innerText().catch(() => '')
      if (/Setting up your|Waking up your/.test(text)) {
        if (!sawProvisioning) await shot(page, `${label} provisioning page`)
        sawProvisioning = true
      } else if (/Orion/.test(text)) {
        break
      }
      await sleep(1000)
    }
    await sleep(2000)
    return sawProvisioning
  }
  const signIn = async (page, email, password) => {
    await page.goto(`${WEB}/login`)
    await page.fill('#email', email)
    await page.fill('#password', password)
    await Promise.all([page.waitForURL(/\/app\//, { timeout: 20000 }), page.click('#submit')])
  }

  // The accounts are created by this run, so their passwords are made for this run:
  // a value in the source is a value that is in every clone of it.
  const A = { email: `alpha-${Date.now()}@nbt-test.example`, password: `Alpha-staging-${randomUUID()}` }
  const B = { email: `bravo-${Date.now()}@nbt-test.example`, password: `Bravo-staging-${randomUUID()}` }

  // 1. Closed mode UI: the page offers "Request access" (setup-status says closed).
  await pageA.route('**/api/v1/auth/setup-status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ needs_setup: false, has_users: true, signup_open: false, support_contact: 'jahanzaib@alilabs.com' }) }))
  await pageA.goto(`${WEB}/login`)
  await shot(pageA, 'login when sign-up is closed shows Request access')
  assert(await pageA.locator('#request-access').isVisible() && !(await pageA.locator('#to-signup').isVisible()), 'closed mode: "Request access" shown, "Create one" hidden')
  assert(!(await pageA.locator('body').innerText()).includes('imported accounts'), 'no internal "imported accounts" copy')
  await pageA.unroute('**/api/v1/auth/setup-status')

  // 2. Open mode: sign up A through the form.
  await pageA.goto(`${WEB}/login`)
  await shot(pageA, 'login when sign-up is open shows Create one')
  assert(await pageA.locator('#to-signup').isVisible(), 'open mode: "Create one" shown')
  await pageA.click('#to-signup')
  await pageA.fill('#email', A.email)
  await pageA.fill('#password', A.password)
  await pageA.fill('#confirm', A.password)
  await shot(pageA, 'A fills the sign-up form')
  await Promise.all([pageA.waitForURL(/\/app\//, { timeout: 20000 }), pageA.click('#submit')])
  const provisioned = await waitForEngine(pageA, 'A first visit')
  assert(provisioned, 'A saw the provisioning page while its engine was created')
  await shot(pageA, 'A lands in its own Nova Bots engine')
  const tenantsAfterA = JSON.parse(await docker(['ps', '--filter', 'name=nbt-test-t-', '--format', '{{json .Names}}']).then(out => `[${out.split('\n').filter(Boolean).join(',')}]`))
  log(`   tenant containers running: ${tenantsAfterA.join(', ')}`)
  const sA = await state(pageA)
  log(`   A workspace ${sA.workspaceId} bots ${sA.bots.join(', ')}`)
  assert(sA.status === 200 && tenantsAfterA.length === 1, 'A is served by one freshly provisioned nbt-test-t-* engine')

  // A's own data: a file in A's workspace volume.
  const containerA = tenantsAfterA[0]
  await docker(['exec', '-u', 'node', containerA, 'sh', '-c', 'echo "A private notes" > /workspace/alpha-notes.txt'])

  // 3. Account page, sign out, sign in again.
  await pageA.goto(`${WEB}/account`)
  await shot(pageA, 'A account page')
  await pageA.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST' }))
  await pageA.goto(`${WEB}/app/`)
  await shot(pageA, 'A after sign-out is sent to sign-in')
  assert(new URL(pageA.url()).pathname === '/login', 'signed out: /app/ redirects to /login')
  await signIn(pageA, A.email, A.password)
  await waitForEngine(pageA, 'A after sign-in')
  await shot(pageA, 'A signed in again - same workspace')
  const sA2 = await state(pageA)
  assert(sA2.workspaceId === sA.workspaceId, `same workspace after sign-in again (${sA2.workspaceId})`)

  // 4. B signs up in another browser: B's own engine, none of A's bots.
  await pageB.goto(`${WEB}/login`)
  await shot(pageB, 'B opens the sign-in page')
  await pageB.click('#to-signup')
  await pageB.fill('#email', B.email)
  await pageB.fill('#password', B.password)
  await pageB.fill('#confirm', B.password)
  await Promise.all([pageB.waitForURL(/\/app\//, { timeout: 20000 }), pageB.click('#submit')])
  await waitForEngine(pageB, 'B first visit')
  await shot(pageB, 'B lands in its own Nova Bots engine')
  const sB = await state(pageB)
  log(`   B workspace ${sB.workspaceId} bots ${sB.bots.join(', ')}`)
  assert(sB.workspaceId !== sA.workspaceId, 'B has a different workspace than A')
  assert(sB.bots.every(b => !sA.bots.includes(b)), "B sees none of A's bots")
  const containers = (await docker(['ps', '--filter', 'name=nbt-test-t-', '--format', '{{.Names}}'])).split('\n').filter(Boolean)
  const containerB = containers.find(c => c !== containerA)
  const bLooks = await docker(['exec', containerB, 'sh', '-c', 'cat /workspace/alpha-notes.txt 2>&1; ls /workspace'], { allowFail: true })
  assert(!bLooks.includes('A private notes'), "A's file does not exist in B's engine")

  // 5. A's engine cookie, planted in B's browser, changes nothing.
  const portA = Number((await docker(['port', containerA, '3080'])).split(':').pop())
  const tokenA = await docker(['exec', '-u', 'node', containerA, 'cat', '/data/.launch-token'])
  const minted = await fetch(`http://127.0.0.1:${portA}/?token=${encodeURIComponent(tokenA)}`, { redirect: 'manual', headers: { host: '127.0.0.1' } })
  const cookieA = minted.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('dsh-auth-'))
  const [name, ...rest] = cookieA.split('=')
  await contextB.addCookies([{ name, value: rest.join('='), domain: '127.0.0.1', path: '/' }])
  await pageB.goto(`${WEB}/app/`)
  await waitForEngine(pageB, 'B with A cookie')
  await shot(pageB, 'B with A engine cookie planted still sees only B')
  const sB2 = await state(pageB)
  assert(sB2.workspaceId === sB.workspaceId, "B's browser carrying A's engine cookie still reaches only B's workspace")
  const remaining = (await contextB.cookies()).filter(c => c.name.startsWith('dsh-auth-'))
  assert(remaining.length === 0, 'the portal deleted the planted engine cookie from B\'s browser')

  // 6. A leaves (tab closed), its engine is stopped (as the idle reaper does);
  // A's next visit wakes it with its data. While a tab is open its live feed
  // reconnects and would start the engine again, which is the intended
  // behaviour for an active user.
  await pageA.goto('about:blank')
  await sleep(1000)
  const stopRes = await fetch(`${stack.base}/api/v1/bots-admin/tenants`, { headers: { 'x-nova-bots-token': stack.adminToken } }).then(r => r.json())
  const tenantA = stopRes.tenants.find(t => t.email === A.email)
  await fetch(`${stack.base}/api/v1/bots-admin/tenants/${tenantA.id}/stop`, { method: 'POST', headers: { 'x-nova-bots-token': stack.adminToken } })
  const running = JSON.parse(await docker(['inspect', '--format', '{{json .State.Running}}', containerA]))
  assert(running === false, 'A engine is stopped')
  await pageA.goto(`${WEB}/app/`)
  const woke = await waitForEngine(pageA, 'A wake')
  assert(woke, 'A saw the waking page')
  await shot(pageA, 'A after restart - workspace back')
  const sA3 = await state(pageA)
  const notes = await docker(['exec', '-u', 'node', containerA, 'cat', '/workspace/alpha-notes.txt'])
  assert(sA3.workspaceId === sA.workspaceId && notes === 'A private notes', 'after stop + restart A has the same workspace and its file')

  log('\nauth/app responses:\n  ' + responses.join('\n  '))
  log('\nRESULT: PASS')
} catch (error) {
  log(`\nRESULT: FAIL ${error.stack ?? error}`)
  for (const [who, page] of pages) {
    await page.screenshot({ path: join(OUT, `failure-${who}.png`) }).catch(() => {})
    log(`   ${who} at ${page.url()}: ${(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`)
  }
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  await stop()
  log(`cleanup: leftover nbt-test-* objects ${JSON.stringify(await leftovers())}`)
  writeFileSync(join(OUT, 'steps.log'), `${lines.join('\n')}\n`)
}
