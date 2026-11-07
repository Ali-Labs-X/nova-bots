// Integration test with real docker: two accounts, two isolated engines.
//
//   cd portal && npm run test:integration
//
// Needs: docker, the engine image (nova-bots:local, or NOVA_TENANT_IMAGE),
// and the Postgres image (pgvector/pgvector:pg16, or NBT_PG_IMAGE). Everything
// it creates is named nbt-test-* and is removed at the end, pass or fail. It
// never talks to the live portal, engine or database.
//
// Evidence lines are printed with an "EVIDENCE" prefix (no secrets: tokens
// and cookies are only ever compared, or shown as a short SHA-256 prefix).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { connect } from 'node:net'
import { docker, leftovers, start, stop } from './stack.mjs'

const PORT = Number(process.env.NBT_PORTAL_PORT ?? 13181)
const IDLE_MINUTES = Number(process.env.NBT_IDLE_MINUTES ?? 1)
let stack
const evidence = (...parts) => console.log('EVIDENCE', ...parts)
const fingerprint = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const http = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const target = new URL(url)
  const req = request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method, headers }, res => {
    let data = ''
    res.on('data', chunk => { data += chunk })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
  })
  req.on('error', reject)
  if (body) req.write(body)
  req.end()
})

// Raw WebSocket handshake: resolves with the status line the server answered.
const wsHandshake = (port, path, headers = {}) => new Promise(resolve => {
  const socket = connect(port, '127.0.0.1')
  let data = ''
  let opened = false
  const done = (value) => { socket.destroy(); resolve(value) }
  socket.on('connect', () => {
    const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')
    socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${extra}\r\n`)
  })
  socket.on('data', chunk => {
    data += chunk
    if (!opened && data.includes('\r\n')) {
      opened = true
      done(data.split('\r\n')[0])
    }
  })
  socket.on('close', () => { if (!opened) resolve(data.split('\r\n')[0] || 'closed without answer') })
  socket.on('error', () => {})
  setTimeout(() => done(data.split('\r\n')[0] || 'timeout'), 8000)
})

// An open WebSocket through the portal, to see it closed by the portal.
const wsOpen = (path, cookie) => new Promise(resolve => {
  const socket = connect(PORT, '127.0.0.1')
  let data = ''
  socket.on('connect', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\ncookie: ${cookie}\r\n\r\n`))
  socket.on('data', chunk => {
    data += chunk
    if (data.includes('\r\n\r\n')) resolve({ socket, status: data.split('\r\n')[0] })
  })
  socket.on('error', () => {})
})

const account = (label) => ({ email: `${label}-${Date.now()}@nbt-test.example`, password: `pw-${label}-${Math.random().toString(36).slice(2)}` })

const register = async ({ email, password }) => {
  const res = await http(`${stack.base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', host: `127.0.0.1:${PORT}` },
    body: new URLSearchParams({ email, password }).toString(),
  })
  assert.equal(res.status, 200, res.body)
  const cookie = [].concat(res.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('access_token='))
  assert.ok(cookie)
  return { cookie, id: JSON.parse(res.body).id }
}

const openWorkspace = async (cookie) => {
  const statuses = []
  for (let i = 0; i < 90; i += 1) {
    const res = await http(`${stack.base}/app/`, { headers: { cookie, accept: 'text/html', host: `127.0.0.1:${PORT}` } })
    statuses.push(res.status)
    if (res.status === 200) return { statuses, body: res.body }
    await sleep(1500)
  }
  throw new Error(`workspace never became ready: ${statuses.join(',')}`)
}

const engineState = async (cookie, extraCookie = '') => {
  const res = await http(`${stack.base}/app/api/bot`, {
    method: 'POST',
    headers: { cookie: [cookie, extraCookie].filter(Boolean).join('; '), 'content-type': 'application/json', host: `127.0.0.1:${PORT}` },
    body: JSON.stringify({ endpoint: 'state', payload: null }),
  })
  assert.equal(res.status, 200, res.body.slice(0, 200))
  return JSON.parse(res.body).value
}

const admin = (path, { method = 'GET', body } = {}) => http(`${stack.base}/api/v1/bots-admin/${path}`, {
  method,
  headers: { 'x-nova-bots-token': stack.adminToken, 'content-type': 'application/json', host: `127.0.0.1:${PORT}` },
  body: body ? JSON.stringify(body) : undefined,
}).then(res => ({ status: res.status, json: JSON.parse(res.body || '{}') }))

const tenantOf = async (email) => (await admin('tenants')).json.tenants.find(t => t.email === email)

const inspect = async (name) => JSON.parse(await docker(['inspect', name]))[0]

const mintDirect = async (port) => {
  const container = (await docker(['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}'])).split('\n')[0]
  const token = await docker(['exec', '-u', 'node', container, 'cat', '/data/.launch-token'])
  const res = await http(`http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`, { headers: { host: 'localhost' } })
  return { token, cookie: [].concat(res.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('dsh-auth-')) }
}

const A = account('alpha')
const B = account('bravo')
const S = {}

before(async () => {
  await stop()
  stack = await start({ portalPort: PORT, idleMinutes: IDLE_MINUTES })
  evidence(`staging portal ${stack.base}, tenancy isolated, idle stop after ${IDLE_MINUTES} min`)
}, { timeout: 180000 })

after(async () => {
  await stop()
  const left = await leftovers()
  evidence('cleanup: leftover nbt-test-* objects', JSON.stringify(left))
  assert.deepEqual(left, { containers: [], volumes: [], networks: [] })
}, { timeout: 180000 })

test('sign-up provisions an isolated engine per account, lazily on first access', { timeout: 300000 }, async () => {
  const setup = JSON.parse((await http(`${stack.base}/api/v1/auth/setup-status`)).body)
  assert.equal(setup.signup_open, true)
  Object.assign(S, { a: await register(A), b: await register(B) })
  const before = await tenantOf(A.email)
  assert.equal(before.state, 'new')
  evidence(`A signed up; tenant ${before.id} allocated on port ${before.port}, state ${before.state} (no container yet)`)
  const wa = await openWorkspace(S.a.cookie)
  const wb = await openWorkspace(S.b.cookie)
  evidence(`A /app/ statuses ${wa.statuses.join(' ')} (202 = provisioning page, 200 = own engine)`)
  evidence(`B /app/ statuses ${wb.statuses.join(' ')}`)
  assert.equal(wa.statuses[0], 202)
  assert.match(wa.body, /Nova Bots/)
  S.ta = await tenantOf(A.email)
  S.tb = await tenantOf(B.email)
  assert.equal(S.ta.state, 'running')
  assert.notEqual(S.ta.container, S.tb.container)
  evidence(`A -> ${S.ta.container} :${S.ta.port}; B -> ${S.tb.container} :${S.tb.port}`)
})

test("each session sees only its own engine's workspace", { timeout: 60000 }, async () => {
  S.sa = await engineState(S.a.cookie)
  S.sb = await engineState(S.b.cookie)
  evidence(`A sees workspaceId ${S.sa.workspaceId}, main bot ${S.sa.mainBotId}`)
  evidence(`B sees workspaceId ${S.sb.workspaceId}, main bot ${S.sb.mainBotId}`)
  assert.notEqual(S.sa.workspaceId, S.sb.workspaceId)
  assert.notEqual(S.sa.mainBotId, S.sb.mainBotId)
  const aBots = new Set(S.sa.bots.map(b => b.id))
  assert.ok(S.sb.bots.every(b => !aBots.has(b.id)), "B must not see any of A's bots")
})

test('each tenant has its own volumes and launch token, hardened container, no provider key', { timeout: 60000 }, async () => {
  const [ia, ib] = [await inspect(S.ta.container), await inspect(S.tb.container)]
  for (const info of [ia, ib]) {
    assert.deepEqual(info.HostConfig.CapDrop, ['ALL'])
    assert.deepEqual(info.HostConfig.CapAdd.map(c => c.replace(/^CAP_/, '')).sort(), ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID'])
    assert.ok(info.HostConfig.SecurityOpt.includes('no-new-privileges'))
    assert.ok(info.HostConfig.Memory > 0 && info.HostConfig.PidsLimit > 0 && info.HostConfig.NanoCpus > 0)
    assert.ok(info.Mounts.every(m => m.Type === 'volume'), 'named volumes only')
    assert.ok(!JSON.stringify(info.Mounts).includes('docker.sock'))
    assert.ok(Object.values(info.HostConfig.PortBindings).flat().every(b => b.HostIp === '127.0.0.1'))
    assert.ok(!info.Config.Env.some(e => /^(DEEPSEEK_API_KEY|MINIMAX_API_KEY|FIREWORKS_API_KEY)=/.test(e)), 'no operator provider key')
    assert.equal(info.HostConfig.LogConfig.Config['max-size'], '10m')
  }
  const volumes = (info) => info.Mounts.map(m => m.Name).sort()
  assert.equal(volumes(ia).filter(v => volumes(ib).includes(v)).length, 0, 'no shared volume')
  const [ta, tb] = [await docker(['exec', '-u', 'node', S.ta.container, 'cat', '/data/.launch-token']), await docker(['exec', '-u', 'node', S.tb.container, 'cat', '/data/.launch-token'])]
  assert.ok(ta && tb && ta !== tb)
  evidence(`volumes A ${volumes(ia).join(',')} | B ${volumes(ib).join(',')}`)
  evidence(`launch token fingerprints A ${fingerprint(ta)} B ${fingerprint(tb)} (distinct)`)
  evidence(`A caps drop ${ia.HostConfig.CapDrop} add ${ia.HostConfig.CapAdd.join(',')}; ${ia.HostConfig.SecurityOpt}; mem ${ia.HostConfig.Memory} pids ${ia.HostConfig.PidsLimit}`)
})

test("A's engine cookie is useless on B: HTTP and WebSocket, direct and through the portal", { timeout: 60000 }, async () => {
  const mintedA = await mintDirect(S.ta.port)
  assert.ok(mintedA.cookie)
  // Direct to B's engine.
  const direct = await http(`http://127.0.0.1:${S.tb.port}/api/bot`, { method: 'POST', headers: { host: 'localhost', cookie: mintedA.cookie, 'content-type': 'application/json' }, body: '{"endpoint":"state","payload":null}' })
  const control = await http(`http://127.0.0.1:${S.ta.port}/api/bot`, { method: 'POST', headers: { host: 'localhost', cookie: mintedA.cookie, 'content-type': 'application/json' }, body: '{"endpoint":"state","payload":null}' })
  evidence(`A cookie on A engine (control): HTTP ${control.status}; A cookie on B engine: HTTP ${direct.status}`)
  assert.equal(control.status, 200)
  assert.equal(direct.status, 401)
  const wsControl = await wsHandshake(S.ta.port, '/api/remote.mux', { cookie: mintedA.cookie })
  const wsDirect = await wsHandshake(S.tb.port, '/api/remote.mux', { cookie: mintedA.cookie })
  evidence(`WS A cookie on A engine (control): "${wsControl}"; A cookie on B engine: "${wsDirect}"`)
  assert.match(wsControl, / 101 /)
  assert.doesNotMatch(wsDirect, / 101 /)
  // Through the portal: B's session carrying A's engine cookie still lands in B.
  const viaPortal = await engineState(S.b.cookie, mintedA.cookie)
  evidence(`B session + A engine cookie via portal -> workspaceId ${viaPortal.workspaceId} (B's own)`)
  assert.equal(viaPortal.workspaceId, S.sb.workspaceId)
  // No session at all, only A's engine cookie: refused (HTTP and WS).
  const anon = await http(`${stack.base}/app/api/bot`, { method: 'POST', headers: { cookie: mintedA.cookie, 'content-type': 'application/json', host: `127.0.0.1:${PORT}` }, body: '{"endpoint":"state","payload":null}' })
  const wsAnon = await wsHandshake(PORT, '/app/api/remote.mux', { cookie: mintedA.cookie })
  evidence(`no portal session + A engine cookie via portal: HTTP ${anon.status}, WS "${wsAnon}"`)
  assert.equal(anon.status, 401)
  assert.doesNotMatch(wsAnon, / 101 /)
  const wsB = await wsHandshake(PORT, '/app/api/remote.mux', { cookie: `${S.b.cookie}; ${mintedA.cookie}` })
  evidence(`B session WS via portal: "${wsB}"`)
  assert.match(wsB, / 101 /)
})

test('tenants cannot reach each other over the network; files stay in their own volume', { timeout: 60000 }, async () => {
  const ipB = (await inspect(S.tb.container)).NetworkSettings.Networks['nbt-test-tenants'].IPAddress
  const gateway = (await inspect(S.tb.container)).NetworkSettings.Networks['nbt-test-tenants'].Gateway
  const probe = async (url) => docker(['exec', S.ta.container, 'sh', '-c', `curl -s -m 4 -o /dev/null -w '%{http_code}' ${url}; echo " exit=$?"`], { allowFail: true })
  const toB = await probe(`http://${ipB}:3080/`)
  const toBPort = await probe(`http://${gateway}:${S.tb.port}/`)
  evidence(`from A: B container ${ipB}:3080 -> ${toB}; host gateway ${gateway}:${S.tb.port} -> ${toBPort}`)
  assert.match(toB, /^000 exit=(7|28)/)
  assert.match(toBPort, /^000 exit=(7|28)/)
  await docker(['exec', '-u', 'node', S.ta.container, 'sh', '-c', 'echo alpha-private > /workspace/alpha-secret.txt && echo alpha-data > /data/alpha-marker.txt'])
  const inB = await docker(['exec', S.tb.container, 'sh', '-c', 'test -e /workspace/alpha-secret.txt && echo FOUND; test -e /data/alpha-marker.txt && echo FOUND; grep -rl alpha-private /workspace /data 2>/dev/null; echo checked'])
  evidence(`B's container looking for A's files: ${inB.includes('FOUND') || inB.includes('/') ? 'FOUND' : 'not present'}`)
  assert.equal(inB, 'checked')
})

test('DNS and egress: a tenant resolves and reaches the internet through explicit resolvers; the firewall plan blocks host and private ranges', { timeout: 240000 }, async () => {
  const info = await inspect(S.ta.container)
  assert.deepEqual(info.HostConfig.Dns, ['1.1.1.1', '1.0.0.1'])
  const egress = await docker(['exec', S.ta.container, 'sh', '-c', "curl -s -m 15 -o /dev/null -w '%{http_code}' https://api.openai.com/v1/models; echo \" exit=$?\""], { allowFail: true })
  evidence(`tenant A (--dns ${info.HostConfig.Dns.join(',')}) -> https://api.openai.com/v1/models: ${egress}`)
  assert.match(egress, /^[1-5]\d\d exit=0/)

  // The firewall rules, applied by ops/tenant-firewall.sh itself (lab-apply:
  // the same ordered plan on the lab container's OUTPUT chain, the network
  // gateway standing in for the host). The host firewall itself needs root.
  const network = JSON.parse(await docker(['network', 'inspect', 'nbt-test-tenants']))[0]
  const gateway = network.IPAM.Config[0].Gateway
  const script = new URL('../../../ops/tenant-firewall.sh', import.meta.url).pathname
  const routerDns = process.env.NBT_ROUTER_DNS ?? '10.162.159.131'
  const hostPort = process.env.NBT_HOST_PROBE_PORT ?? '13081'
  const labs = { 'nbt-test-fwlab': ['--dns', '1.1.1.1', '--dns', '1.0.0.1'], 'nbt-test-fwlab-nodns': [] }
  const results = {}
  try {
    for (const [name, dns] of Object.entries(labs)) {
      await docker(['run', '-d', '--name', name, '--network', 'nbt-test-tenants', '--cap-add', 'NET_ADMIN', ...dns,
        '-v', `${script}:/fw.sh:ro`, '--label', 'nova-bots.instance=nbt-test', 'alpine:3', 'sleep', '600'])
      await docker(['exec', name, 'apk', 'add', '--no-cache', '-q', 'iptables', 'curl'], { timeout: 180000 })
    }
    const probe = (name) => docker(['exec', name, 'sh', '-c', [
      `nc -z -w 3 ${gateway} ${hostPort} && echo host=open || echo host=blocked`,
      'nc -z -w 3 172.17.0.1 8080 && echo docker0=open || echo docker0=blocked',
      `nc -z -w 3 ${routerDns} 53 && echo lan=open || echo lan=blocked`,
      'nslookup -timeout=4 api.openai.com >/dev/null 2>&1 && echo dns=ok || echo dns=fail',
      "echo https=$(curl -s -m 12 -o /dev/null -w '%{http_code}' https://api.openai.com/v1/models)",
    ].join('; ')], { allowFail: true, timeout: 90000 }).then(out => Object.fromEntries(out.split('\n').filter(l => l.includes('=')).map(l => l.split('='))))
    results.before = await probe('nbt-test-fwlab')
    for (const name of Object.keys(labs)) {
      await docker(['exec', '-e', `GATEWAY=${gateway}`, '-e', 'RESOLVERS=1.1.1.1 1.0.0.1', name, 'sh', '/fw.sh', 'lab-apply'])
    }
    results.after = await probe('nbt-test-fwlab')
    results.afterNoDns = await probe('nbt-test-fwlab-nodns')
  } finally {
    await docker(['rm', '-f', ...Object.keys(labs)], { allowFail: true })
  }
  evidence(`firewall lab BEFORE rules (--dns 1.1.1.1): ${JSON.stringify(results.before)}`)
  evidence(`firewall lab AFTER rules  (--dns 1.1.1.1): ${JSON.stringify(results.after)}`)
  evidence(`firewall lab AFTER rules  (no --dns, host upstream ${routerDns}): ${JSON.stringify(results.afterNoDns)}`)
  assert.equal(results.after.host, 'blocked')
  assert.equal(results.after.docker0, 'blocked')
  assert.equal(results.after.lan, 'blocked')
  assert.equal(results.after.dns, 'ok')
  assert.match(results.after.https, /^[1-5]\d\d$/)
})

test('revoking sessions ends an open live feed', { timeout: 60000 }, async () => {
  const { socket, status } = await wsOpen('/app/api/remote.mux', S.b.cookie)
  assert.match(status, / 101 /)
  const closed = new Promise(resolve => socket.on('close', () => resolve(true)))
  assert.equal((await admin(`users/${S.b.id}/revoke-sessions`, { method: 'POST' })).status, 200)
  assert.equal(await Promise.race([closed, sleep(5000).then(() => false)]), true)
  const after = await http(`${stack.base}/app/api/bot`, { method: 'POST', headers: { cookie: S.b.cookie, 'content-type': 'application/json', host: `127.0.0.1:${PORT}` }, body: '{}' })
  evidence(`after revoke: open WS closed by the portal; old session -> HTTP ${after.status}`)
  assert.equal(after.status, 401)
})

test('idle stop, then lazy restart keeps the tenant data', { timeout: 400000 }, async () => {
  const deadline = Date.now() + (IDLE_MINUTES * 60000) + 90000
  let state
  while (Date.now() < deadline) {
    state = await inspect(S.ta.container)
    if (!state.State.Running) break
    await sleep(3000)
  }
  assert.equal(state.State.Running, false, 'the idle tenant was stopped by the reaper')
  const row = await tenantOf(A.email)
  evidence(`A idle-stopped by the reaper: container running=${state.State.Running}, tenant state ${row.state}`)
  assert.equal(row.state, 'stopped')
  const woke = await openWorkspace(S.a.cookie)
  evidence(`A /app/ after idle stop: ${woke.statuses.join(' ')} (202 = waking page)`)
  const again = await engineState(S.a.cookie)
  evidence(`A after restart: workspaceId ${again.workspaceId} (same: ${again.workspaceId === S.sa.workspaceId})`)
  assert.equal(again.workspaceId, S.sa.workspaceId)
  const kept = await docker(['exec', '-u', 'node', S.ta.container, 'cat', '/workspace/alpha-secret.txt'])
  assert.equal(kept, 'alpha-private')
})

test('admin: list, delete with export removes container and volumes', { timeout: 300000 }, async () => {
  const list = await admin('tenants')
  assert.equal(list.status, 200)
  evidence(`admin tenants: ${list.json.tenants.map(t => `${t.email.split('-')[0]}=${t.state}`).join(', ')}; capacity ${JSON.stringify(list.json.capacity)}`)
  assert.ok(list.json.tenants.every(t => !('provider_secret' in t)))
  const removed = await admin(`tenants/${S.ta.id}/delete`, { method: 'POST', body: { export: true } })
  assert.equal(removed.status, 200, JSON.stringify(removed.json))
  assert.ok(removed.json.exported?.endsWith('.tar.gz'))
  const gone = await docker(['ps', '-a', '--filter', `name=${S.ta.container}`, '--format', '{{.Names}}'])
  const volumes = await docker(['volume', 'ls', '-q', '--filter', `name=${S.ta.container}`])
  evidence(`A deleted: export written (${removed.json.exported.split('/').pop()}), container left: "${gone}", volumes left: "${volumes}"`)
  assert.equal(gone, '')
  assert.equal(volumes, '')
  const audit = (await admin('audit')).json.entries.map(e => e.action)
  for (const action of ['tenant-allocate', 'tenant-provision', 'tenant-start', 'tenant-stop', 'tenant-delete']) assert.ok(audit.includes(action), action)
  evidence(`audit actions recorded: ${[...new Set(audit.filter(a => a.startsWith('tenant') || a.startsWith('admin-tenant')))].join(', ')}`)
})
