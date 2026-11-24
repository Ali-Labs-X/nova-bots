// The folders of the computer Nova Bots runs on, for the account whose engine is there.
//
// The app's page is served by the Bots' own container, so nothing that page draws can stand for
// the user's consent. A mount is asked for here and approved in a window of this server's own,
// with the account's password; the window does not share a browsing context with the app.
import { randomUUID } from 'node:crypto'
import { request } from 'node:http'

const PREFIX = '/api/v1/host/'
const TTL_MS = 5 * 60_000
const BODY_MAX = 16_384
const PENDING_MAX = 20

export const mountdClient = socketPath => (method, path, body) => new Promise((resolve, reject) => {
  const req = request({ socketPath, method, path, headers: { 'content-type': 'application/json' }, timeout: 20_000 }, (res) => {
    const chunks = []
    res.on('data', chunk => chunks.push(chunk))
    res.on('end', () => {
      try { resolve({ status: res.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) } catch (error) { reject(error) }
    })
  })
  req.on('timeout', () => req.destroy(new Error('timeout')))
  req.on('error', reject)
  req.end(body === undefined ? undefined : JSON.stringify(body))
})

const escape = text => String(text).replace(/[&<>"']/g, mark => `&#${mark.charCodeAt(0)};`)
const readBody = async (req) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_MAX) throw new Error('too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
// A browser names the page a request comes from; only this server's own pages may ask.
export const sameOrigin = (req) => {
  const origin = req.headers.origin
  if (typeof origin !== 'string') return false
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

const PAGE = (body, nonce) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova Bots approval</title><style nonce="${nonce}">
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070713;color:#f2f2fa;font:15px/1.5 system-ui,sans-serif}
main{width:min(430px,calc(100vw - 48px))}h1{font-size:20px;margin:0 0 10px}code{display:block;padding:10px 12px;margin:10px 0;border-radius:10px;background:#15152a;overflow-wrap:anywhere}
.warn{padding:10px 12px;border-radius:10px;background:#3a1520;color:#ffb4c0}input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #34345a;border-radius:10px;background:#101022;color:inherit;font:inherit}
.row{display:flex;gap:10px;margin-top:14px}button{flex:1;padding:11px;border:0;border-radius:999px;font:inherit;font-weight:600;cursor:pointer;background:#22223d;color:inherit}.go{background:#7c5cff;color:#fff}.err{color:#ff9aa8}p{color:#b9b9d0}
</style></head><body><main>${body}</main></body></html>`

export function createHostFolders({ auth, tenants, userOf, mountd, now = Date.now }) {
  const requests = new Map()
  const json = (res, status, value) => { res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
  const fail = (res, status, message) => json(res, status, { detail: { message } })
  const html = (res, status, body) => {
    const nonce = randomUUID()
    res.writeHead(status, {
      'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      'cross-origin-opener-policy': 'same-origin', 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff',
    })
    res.end(PAGE(body, nonce))
  }
  const live = (id, user) => {
    const found = requests.get(id)
    return found && found.userId === user.id && found.expires > now() ? found : undefined
  }
  const form = (entry, error = '') => `<h1>Let your Bots use this folder?</h1><code>${escape(entry.path)}</code>
${entry.risky ? '<p class="warn">This folder can hold keys, passwords or private settings. Bots could read them and send them away.</p>' : ''}
<p>${entry.mode === 'ro' ? 'Bots can read every file in it.' : 'Bots can read, change and delete every file in it.'} The Bots restart, which takes about half a minute and stops what they are doing.</p>
${error ? `<p class="err" role="alert">${escape(error)}</p>` : ''}
<form method="post"><label>Your Nova Bots password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
<div class="row"><button name="answer" value="deny" formnovalidate>Don't allow</button><button class="go" name="answer" value="allow">Allow</button></div></form>`

  async function approve(req, res, user, id) {
    const entry = live(id, user)
    if (entry === undefined || entry.state !== 'waiting') return html(res, 410, '<h1>This request is over</h1><p>Pick the folder again. You can close this window.</p>')
    if (req.method === 'GET') return html(res, 200, form(entry))
    if (req.method !== 'POST' || !sameOrigin(req)) return fail(res, 403, 'Not allowed')
    const answer = new URLSearchParams(await readBody(req))
    if (answer.get('answer') !== 'allow') {
      entry.state = 'denied'
      await auth.audit({ action: 'host-mount-denied', actor: user.email, target: entry.path, ok: true })
      return html(res, 200, '<h1>Not allowed</h1><p>Nothing changed. You can close this window.</p>')
    }
    const limit = auth.rateLimit(`host-mount:${user.id}`)
    if (!limit.allowed) return html(res, 429, form(entry, `Too many attempts. Try again in ${limit.retryAfter} seconds.`))
    const proof = await auth.authenticate(user.email, answer.get('password') ?? '')
    if (!proof || proof.forbidden) {
      await auth.audit({ action: 'host-mount-denied', actor: user.email, target: entry.path, ok: false, detail: { reason: 'password' } })
      return html(res, 403, form(entry, 'That password is not right.'))
    }
    auth.clearRateLimit(`host-mount:${user.id}`)
    // Two windows cannot both start it.
    if (entry.state !== 'waiting') return html(res, 410, '<h1>This request is over</h1>')
    entry.state = 'working'
    const made = await mountd('POST', '/mounts', { path: entry.path, mode: entry.mode }).catch(() => ({ status: 503, value: { error: 'The folder service is not running' } }))
    if (made.status !== 202) { entry.state = 'failed'; entry.error = made.value.error }
    await auth.audit({ action: 'host-mount', actor: user.email, target: entry.path, ok: made.status === 202, detail: { mode: entry.mode } })
    return made.status === 202 ? html(res, 200, '<h1>Allowed</h1><p>The folder is being connected. You can close this window.</p>')
      : html(res, 502, `<h1>It did not work</h1><p>${escape(entry.error)}</p>`)
  }

  async function progress(res, entry) {
    if (entry.state === 'working') {
      const { value } = await mountd('GET', '/status')
      if (value.path === entry.path && value.state !== 'working') { entry.state = value.state; entry.error = value.error }
      if (entry.state === 'done') entry.container = (await mountd('GET', `/inspect?path=${encodeURIComponent(entry.path)}`)).value.mounted?.container ?? null
    }
    return json(res, 200, { state: entry.state, error: entry.error ?? null, container: entry.container ?? null })
  }

  return async function handle(req, res, path, url) {
    const user = await userOf(req)
    if (!user) return fail(res, 401, 'Sign in first.')
    // Mounts go into the owner's engine; every other account's engine has no host folders.
    if ((await tenants?.store.byUser(user.id))?.kind !== 'legacy') return fail(res, 403, 'Not available for this account.')
    const name = path.slice(PREFIX.length)
    const approval = /^approve\/([0-9a-f-]{36})$/.exec(name)
    if (approval) return approve(req, res, user, approval[1])
    if (req.method !== 'GET' && !sameOrigin(req)) return fail(res, 403, 'Not allowed')
    const query = `?path=${encodeURIComponent(url.searchParams.get('path') ?? '')}`
    try {
      if (req.method === 'GET' && name === 'folders') return pass(res, await mountd('GET', `/folders${query}`))
      if (req.method === 'GET' && name === 'mounts') return pass(res, await mountd('GET', '/mounts'))
      if (req.method === 'GET' && name === 'mounts/status') return pass(res, await mountd('GET', '/status'))
      const asked = /^requests\/([0-9a-f-]{36})$/.exec(name)
      if (req.method === 'GET' && asked) {
        const entry = live(asked[1], user)
        return entry ? progress(res, entry) : fail(res, 404, 'This request is over')
      }
      if (req.method === 'POST' && name === 'requests') {
        const body = JSON.parse(await readBody(req))
        const mode = body.mode === 'ro' ? 'ro' : 'rw'
        const found = await mountd('GET', `/inspect?path=${encodeURIComponent(String(body.path ?? ''))}`)
        if (found.status !== 200) return pass(res, found)
        if (found.value.mounted) return json(res, 200, { state: 'done', container: found.value.mounted.container })
        for (const [id, entry] of requests) if (entry.expires <= now()) requests.delete(id)
        if (requests.size >= PENDING_MAX) return fail(res, 429, 'Too many requests are waiting')
        const id = randomUUID()
        requests.set(id, { userId: user.id, path: found.value.path, risky: found.value.risky, mode, state: 'waiting', expires: now() + TTL_MS })
        return json(res, 201, { id, state: 'waiting', approve: `${PREFIX}approve/${id}` })
      }
      if (req.method === 'DELETE' && name === 'mounts') {
        const gone = await mountd('DELETE', `/mounts${query}`)
        await auth.audit({ action: 'host-unmount', actor: user.email, target: url.searchParams.get('path'), ok: gone.status === 202 })
        return pass(res, gone)
      }
    } catch (error) {
      return fail(res, ['ENOENT', 'ECONNREFUSED'].includes(error.code) ? 503 : 400, ['ENOENT', 'ECONNREFUSED'].includes(error.code) ? 'The folder service is not running' : 'The request could not be read')
    }
    return fail(res, 404, 'Unknown endpoint.')
  }
  function pass(res, { status, value }) { return status >= 400 ? fail(res, status, value.error) : json(res, status, value) }
}
