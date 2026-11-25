import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const image = process.argv[2] ?? 'ds-bot:local'
const name = `ds-bot-test-${randomUUID()}`
const data = `${name}-data`
const workspace = `${name}-workspace`
const containers = new Set()
const volumes = []

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  })
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`docker ${args[0]} failed (${result.status}): ${result.error?.message ?? result.stderr}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result
}

function mounts() {
  return [
    '--mount', `type=volume,src=${data},dst=/data`,
    '--mount', `type=volume,src=${workspace},dst=/workspace`,
  ]
}

function run(args) {
  const container = `${name}-${containers.size}`
  containers.add(container)
  return docker(['run', '--rm', '--name', container, '--network', 'none', ...mounts(), ...args])
}

function shell(script) {
  return run(['--entrypoint', '/bin/sh', image, '-eu', '-c', script])
}

function startHelp(uid, gid) {
  run(['-e', `PUID=${uid}`, '-e', `PGID=${gid}`, image, '--help'])
}

function checkDataOwner(uid, gid) {
  shell(`
    test -z "$(find -P /data -xdev \\( ! -uid ${uid} -o ! -gid ${gid} \\) -print -quit)"
    test "$(stat -c %a /data/profiles/web/package.json)" = 600
    test "$(cat /data/review-state.txt)" = preserved
    test "$(stat -c %u:%g /workspace)" = 2345:2346
    test "$(stat -c %u:%g /workspace/keep.txt)" = 2345:2346
    test "$(cat /workspace/keep.txt)" = untouched
  `)
}

async function answers(container) {
  const probe = `
    const response = await fetch('http://127.0.0.1:3080/');
    if (![200, 401].includes(response.status)) throw new Error('Unexpected HTTP status: ' + response.status);
  `
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (docker(['exec', container, 'node', '--input-type=module', '-e', probe], { allowFailure: true }).status === 0) return true
    await setTimeout(300)
  }
  return false
}

// What the team answers to `state`: null when this engine may change it.
function readOnly(container) {
  return JSON.parse(docker(['exec', container, 'node', '--input-type=module', '-e', `
    import { readFileSync } from 'node:fs'
    const token = readFileSync('/data/.launch-token', 'utf8').trim()
    const login = await fetch('http://127.0.0.1:3080/?token=' + token, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = await fetch('http://127.0.0.1:3080/api/bot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ endpoint: 'state', payload: {} }),
    })
    console.log(JSON.stringify((await response.json()).value.readOnly))
  `]).stdout)
}

try {
  for (const volume of [data, workspace]) {
    docker(['volume', 'create', volume])
    volumes.push(volume)
  }

  shell(`
    test "$(stat -c %a /usr/local/bin/entrypoint.sh)" = 755
    /bin/sh -n /usr/local/bin/entrypoint.sh
  `)
  startHelp(1000, 1000)
  shell(`
    test "$(stat -c %u:%g /data/profiles/web/package.json)" = 1000:1000
    printf preserved > /data/review-state.txt
    chmod 600 /data/review-state.txt
    chown 1000:1000 /data/review-state.txt
    printf untouched > /workspace/keep.txt
    chown 2345:2346 /workspace /workspace/keep.txt
    ln -s /workspace /data/workspace-link
    ln -s /workspace/keep.txt /data/file-link
    ln -s /missing-target /data/dangling-link
  `)
  console.log('PASS: executable entrypoint and first start')

  startHelp(1234, 1234)
  checkDataOwner(1234, 1234)
  console.log('PASS: UID/GID migration preserves data and workspace link targets')

  startHelp(1234, 1235)
  checkDataOwner(1234, 1235)
  shell(`
    mkdir -p /data/restored
    printf restored > /data/restored/private.txt
    chmod 700 /data/restored
    chmod 600 /data/restored/private.txt
    chown -R 3456:3457 /data/restored
  `)
  startHelp(1234, 1235)
  checkDataOwner(1234, 1235)
  console.log('PASS: group-only migration and restored files with mixed ownership')

  const server = `${name}-web`
  containers.add(server)
  docker([
    'run', '--detach', '--rm', '--name', server, '--network', 'none', ...mounts(),
    '-e', 'PUID=1234', '-e', 'PGID=1235', '-e', 'DSH_TELEMETRY_DISABLED=1',
    '-e', 'NOVA_LAUNCH_TOKEN_FILE=/data/.launch-token', image,
  ])
  assert.ok(await answers(server), 'web server must answer HTTP after ownership migration')
  const processOwner = docker(['exec', server, 'stat', '-c', '%u:%g', '/proc/1']).stdout.trim()
  assert.equal(processOwner, '1234:1235', 'web process must run under the new identity')
  const identity = docker(['exec', server, 'gosu', 'node', 'id']).stdout
  assert.match(identity, /uid=1234\(node\) gid=1235\(node\)/)
  docker(['exec', server, 'gosu', 'node', '/bin/sh', '-eu', '-c', `
    test "$(cat /data/review-state.txt)" = preserved
    test "$(cat /data/restored/private.txt)" = restored
    test -w /data/profiles/web/package.json
  `])
  console.log('PASS: web startup and private data access under the new identity')

  // The socket never answers a ping, like a browser whose answer waits behind a
  // long download. The engine's default gives it up within six seconds.
  const silentBrowser = `
    import { readFileSync } from 'node:fs'
    import { connect } from 'node:net'
    const token = readFileSync('/data/.launch-token', 'utf8').trim()
    const login = await fetch('http://127.0.0.1:3080/?token=' + token, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const socket = connect(3080, '127.0.0.1')
    socket.write(['GET /api/remote.mux HTTP/1.1', 'Host: 127.0.0.1:3080', 'Origin: http://127.0.0.1:3080', 'Cookie: ' + cookie,
      'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: ' + Buffer.alloc(16).toString('base64'), '', ''].join('\\r\\n'))
    let answer = ''
    socket.on('data', chunk => { answer += chunk.toString('latin1') })
    socket.on('error', () => {})
    socket.on('close', () => { console.error('closed after: ' + answer.slice(0, 40)); process.exit(1) })
    setTimeout(() => { if (!answer.startsWith('HTTP/1.1 101')) { console.error(answer.slice(0, 80)); process.exit(1) } process.exit(0) }, 12_000)
  `
  docker(['exec', server, 'node', '--input-type=module', '-e', silentBrowser])
  console.log('PASS: a browser that is slow to answer keeps its connection')
  docker(['stop', '--time', '15', server])

  // Started the way the portal starts an account's engine (portal/tenants.mjs).
  const tenant = `${name}-tenant`
  containers.add(tenant)
  docker([
    'run', '--detach', '--name', tenant, '--hostname', 'nova-bots', '--network', 'none', ...mounts(),
    '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'DAC_OVERRIDE',
    '--security-opt', 'no-new-privileges',
    '-e', 'PUID=1234', '-e', 'PGID=1235', '-e', 'DSH_TELEMETRY_DISABLED=1',
    '-e', 'NOVA_LAUNCH_TOKEN_FILE=/data/.launch-token', image,
  ])
  assert.ok(await answers(tenant), 'web server must answer HTTP with the capabilities of an account')

  const zombies = docker(['exec', tenant, '/bin/sh', '-c', `
    for i in 1 2 3 4 5; do (sleep 0.3 &); done
    sleep 1.5
    cat /proc/[0-9]*/status 2>/dev/null | grep -c '^State:.Z' || true
  `]).stdout.trim()
  assert.equal(zombies, '0', 'processes that outlive their command must not stay as zombies')
  console.log('PASS: left-behind processes are collected')

  const stopping = Date.now()
  docker(['stop', '--time', '15', tenant])
  const stopped = docker(['inspect', '--format', '{{.State.ExitCode}}', tenant]).stdout.trim()
  assert.equal(stopped, '0', 'the engine must end by itself when the container stops')
  assert.ok(Date.now() - stopping < 14_000, 'the engine must get the stop signal')
  console.log('PASS: the engine stops by itself without CAP_KILL')

  docker(['start', tenant])
  assert.ok(await answers(tenant), 'web server must answer HTTP after a restart')
  assert.equal(readOnly(tenant), null, 'the team must be open for changes')
  docker(['kill', tenant])
  // The pid in the lock a killed engine leaves behind belongs to another process
  // once the container's processes are numbered from 1 again.
  shell(`
    test -s /data/bot/state.lock
    node -e '
      const { readFileSync, writeFileSync } = require("node:fs")
      const lock = JSON.parse(readFileSync("/data/bot/state.lock", "utf8"))
      writeFileSync("/data/bot/state.lock", JSON.stringify({ ...lock, pid: 1 }))
    '
  `)
  docker(['start', tenant])
  assert.ok(await answers(tenant), 'web server must answer HTTP after it was killed')
  assert.equal(readOnly(tenant), null, 'a killed engine must not keep its own team read-only')
  console.log('PASS: an engine that was killed opens its team again at once')
} finally {
  for (const container of containers) {
    docker(['rm', '--force', container], { allowFailure: true })
  }
  for (const volume of volumes) {
    docker(['volume', 'rm', volume])
  }
}
