#!/usr/bin/env node
// Nova Bots portal — the workspace's own front door.
//
// Two jobs, one process:
//
//   /api/v1/auth/…   the account API: email + password in, a session cookie out.
//                     The accounts live in their own database on the shared
//                     Postgres server; the design follows the Nova stack's
//                     pattern (bcrypt with a SHA-256 pre-hash, an HS256 access
//                     token in an HttpOnly cookie, a per-IP login rate limit)
//                     without depending on the Nova application for anything.
//
//   /api/v1/bots-admin/…  the admin API for the operator console (Nova Ops).
//                     It reads this product's own accounts, roster and service
//                     state, and it is protected by a token in a header
//                     rather than by a session.
//
//   /app/…            the bridge to the engine. The engine owns its own browser
//                     cookie, minted from a launch token. A request is let
//                     through when the engine already knows the browser; when
//                     the browser has a good session but no engine cookie, the
//                     launch token is injected so the engine can mint one.
//
// nginx sits in front of this process and serves the landing page, the login
// page and the static assets; it forwards the API and the app here.

import { createServer, request as httpRequest } from 'node:http'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { Auth } from './auth.mjs'
import { handleAdmin } from './admin.mjs'
import { clearEngineCookies, engineAccess, policyFromEnv, signupAllowed } from './gate.mjs'

const PORT = Number(process.env.NOVA_PORTAL_PORT ?? 13081)
const HOST = process.env.NOVA_PORTAL_HOST ?? '127.0.0.1'
const ENGINE = process.env.NOVA_ENGINE_URL ?? 'http://127.0.0.1:13083'
const TOKEN_FILE = process.env.NOVA_LAUNCH_TOKEN_FILE ?? '../docker/data/.launch-token'
const CONTAINER = process.env.NOVA_ENGINE_CONTAINER ?? 'nova-bots'
const COOKIE = 'access_token'

const auth = new Auth({
  databaseUrl: process.env.NOVA_DATABASE_URL ?? '',
  jwtSecret: process.env.NOVA_JWT_SECRET ?? '',
  tokenExpiryDays: Number(process.env.NOVA_TOKEN_EXPIRY_DAYS ?? 7),
})

// Who reaches the engine and who may sign up (see gate.mjs). Fails closed.
const POLICY = policyFromEnv()
const SUPPORT_CONTACT = process.env.NOVA_SUPPORT_CONTACT ?? 'jahanzaib@alilabs.com'

const clientIp = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return forwarded || (req.socket.remoteAddress ?? 'unknown')
}

const cookieValue = (header, name) => {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

// The engine's cookie is named after the authority it was minted for, so the
// name always starts the same way. Its presence means the engine knows the
// browser and no launch token is needed.
const hasEngineCookie = (req) => String(req.headers.cookie ?? '').split(';').some(part => part.trim().startsWith('dsh-auth-'))

// The engine only mints its browser cookie when the launch token is presented
// on the root path. Presentation on an API path is ignored, so the portal
// mints the cookie server-side first and then forwards it with the request.
const mintEngineCookie = (token, req) => new Promise(resolve => {
  const upstream = new URL('/?token=' + encodeURIComponent(token), ENGINE)
  const request = httpRequest(
    {
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: upstream.pathname + upstream.search,
      method: 'GET',
      headers: { host: req.headers.host ?? 'bots.alilabsx.com' },
    },
    upstreamResponse => {
      const cookies = upstreamResponse.headers['set-cookie']
      upstreamResponse.resume()
      resolve(Array.isArray(cookies) ? cookies : (cookies ? [cookies] : []))
    },
  )
  request.on('error', () => resolve([]))
  request.end()
})

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers })
  res.end(body)
}

const json = (res, status, value, headers = {}) => send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', ...headers })

const secureRequest = (req) => String(req.headers['x-forwarded-proto'] ?? '').toLowerCase() === 'https'

// ---- the account API ----------------------------------------------------

const login = async (req, res) => {
  const body = await readBody(req)
  const form = new URLSearchParams(body.toString())
  const email = (form.get('username') ?? form.get('email') ?? '').trim()
  const password = form.get('password') ?? ''

  if (!email || !password) return json(res, 400, { detail: { code: 'invalid_credentials', message: 'Enter your email and password.' } })

  const ip = clientIp(req)
  const limit = auth.rateLimit(`signin:${ip}`)
  if (!limit.allowed) {
    await auth.audit({ action: 'sign-in-failed', actor: email, ok: false, ip, detail: { reason: 'rate-limited' } })
    return json(res, 429, { detail: { code: 'too_many_attempts', message: `Too many attempts. Try again in ${limit.retryAfter} seconds.` } })
  }

  const result = await auth.authenticate(email, password)
  if (!result) {
    await auth.audit({ action: 'sign-in-failed', actor: email, ok: false, ip, detail: { reason: 'invalid-credentials' } })
    return json(res, 401, { detail: { code: 'invalid_credentials', message: 'Incorrect email or password.' } })
  }
  if (result.forbidden) {
    await auth.audit({ action: 'sign-in-failed', actor: email, ok: false, ip, detail: { reason: 'forbidden' } })
    return json(res, 403, { detail: { code: 'not_authenticated', message: 'Account is forbidden. Contact support.' } })
  }

  auth.clearRateLimit(`signin:${ip}`)
  await auth.touchSignIn(result.id)
  await auth.audit({
    action: 'sign-in',
    actor: email,
    target: result.id ?? result.user?.id ?? null,
    ok: true,
    ip,
    detail: {},
  })
  const { token, expiresIn } = auth.issueToken(result)
  const cookie = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secureRequest(req) ? 'Secure' : '',
    `Max-Age=${expiresIn}`,
  ].filter(Boolean).join('; ')
  json(res, 200, { expires_in: expiresIn, needs_setup: result.needs_setup === true }, { 'set-cookie': cookie })
}

const me = async (req, res) => {
  const token = cookieValue(req.headers.cookie, COOKIE)
  const payload = auth.verifyToken(token)
  if (!payload) return json(res, 401, { detail: { code: 'not_authenticated', message: 'Not signed in.' } })
  const user = await auth.findById(payload.sub)
  if (!user || user.is_forbidden) return json(res, 401, { detail: { code: 'not_authenticated', message: 'Not signed in.' } })
  if ((user.token_version ?? 0) !== (payload.ver ?? 0)) {
    return json(res, 401, { detail: { code: 'not_authenticated', message: 'The session ended. Sign in again.' } })
  }
  const credits = await auth.credits(user.id)
  json(res, 200, {
    id: user.id,
    email: user.email,
    system_role: user.system_role,
    needs_setup: user.needs_setup,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    plan: credits?.plan ?? user.plan ?? 'free',
    bonus_daily_tokens: credits?.bonus_daily_tokens ?? 0,
    bonus_expires_at: credits?.bonus_expires_at ?? null,
    daily_limit: credits?.total_daily ?? 250000,
  })
}

const logout = async (req, res) => {
  const cookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  json(res, 200, { ok: true }, { 'set-cookie': cookie })
}

const setupStatus = async (req, res) => {
  json(res, 200, { needs_setup: (await auth.countUsers()) === 0, has_users: (await auth.countUsers()) > 0 })
}

const register = async (req, res) => {
  const body = await readBody(req)
  const form = new URLSearchParams(body.toString())
  const email = (form.get('email') ?? '').trim().toLowerCase()
  const password = form.get('password') ?? ''
  if (!email || !password) return json(res, 400, { detail: { message: 'Enter an email and a password.' } })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { detail: { message: 'That does not look like an email address.' } })
  if (password.length < 8) return json(res, 400, { detail: { message: 'Use at least 8 characters.' } })

  // Signing up is open, but not unlimited: five accounts per address per hour.
  const ip = clientIp(req)
  const limit = auth.rateLimit(`signup:${ip}`, 5, 3600000)
  if (!limit.allowed) {
    return json(res, 429, { detail: { message: `Too many accounts from this address. Try again in ${limit.retryAfter} seconds.` } })
  }

  // Accounts are by invitation unless sign-up is explicitly opened; the first
  // account still bootstraps the workspace.
  const count = await auth.countUsers()
  if (!signupAllowed(POLICY, count)) {
    await auth.audit({ action: 'sign-up-refused', actor: email, ok: false, ip, detail: { reason: 'signup-closed' } })
    return json(res, 403, { detail: { code: 'signup_closed', message: `Nova Bots is invitation-only for now. Contact ${SUPPORT_CONTACT} for access.` } })
  }

  const existing = await auth.findByEmail(email)
  if (existing) return json(res, 409, { detail: { message: 'That address already has an account.' } })

  // The first account owns the workspace; every later one is a plain member.
  const user = await auth.createUser({
    email,
    password,
    systemRole: count === 0 ? 'admin' : 'user',
    needsSetup: count !== 0,
  })
  const { token, expiresIn } = auth.issueToken(user)
  await auth.audit({ action: 'sign-up', actor: email, target: String(user.id), ip, detail: { role: user.system_role } })
  const cookie = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secureRequest(req) ? 'Secure' : '',
    `Max-Age=${expiresIn}`,
  ].filter(Boolean).join('; ')
  json(res, 200, { id: user.id, email: user.email, needs_setup: user.needs_setup }, { 'set-cookie': cookie })
}

const changePassword = async (req, res) => {
  const token = cookieValue(req.headers.cookie, COOKIE)
  const payload = auth.verifyToken(token)
  if (!payload) return json(res, 401, { detail: { message: 'Not signed in.' } })
  const body = await readBody(req)
  const form = new URLSearchParams(body.toString())
  const current = form.get('current_password') ?? ''
  const next = form.get('new_password') ?? ''
  if (next.length < 8) return json(res, 400, { detail: { message: 'Use at least 8 characters.' } })
  const user = await auth.findById(payload.sub)
  if (!user || !(await auth.authenticate(user.email, current))) {
    return json(res, 401, { detail: { message: 'The current password is not right.' } })
  }
  await auth.setPassword(user.id, next)
  json(res, 200, { ok: true })
}

// ---- the engine bridge --------------------------------------------------

let launchToken = null
let launchTokenAt = 0

// The engine writes its launch token to a file when it starts. The file is
// read per request and cached for a few seconds, so a restarted engine is
// picked up without a restart of this process. When the file is not there
// (an engine that predates the patch), the token is taken from the container
// log instead.
const tokenFor = async () => {
  if (launchToken && Date.now() - launchTokenAt < 5000) return launchToken
  try {
    const text = await readFile(TOKEN_FILE, 'utf8')
    const value = text.trim()
    if (value) {
      launchToken = value
      launchTokenAt = Date.now()
      return launchToken
    }
  } catch { /* the file is not there; try the log */ }
  launchToken = await tokenFromLog()
  if (launchToken) launchTokenAt = Date.now()
  return launchToken
}

const tokenFromLog = () => new Promise(resolve => {
  execFile('docker', ['logs', '--tail', '40', CONTAINER], { timeout: 8000 }, (error, stdout, stderr) => {
    if (error && !stdout && !stderr) return resolve(null)
    const match = `${stdout}${stderr}`.match(/token=([A-Za-z0-9._-]{16,})/)
    resolve(match ? match[1] : null)
  })
})

const proxy = (req, res, { engineCookies = [], retried = false } = {}) => {
  const url = new URL(req.url ?? '/', 'http://portal.local')
  // The app is served under /app, the engine lives at the root.
  const path = url.pathname.startsWith('/app/') ? url.pathname.slice(4) || '/' : url.pathname
  const upstream = new URL(path + url.search, ENGINE)
  const headers = { ...req.headers, host: req.headers.host ?? 'bots.alilabsx.com' }
  delete headers['accept-encoding']
  if (engineCookies.length) {
    const minted = engineCookies.map(cookie => String(cookie).split(';')[0]).filter(Boolean).join('; ')
    headers.cookie = [headers.cookie, minted].filter(Boolean).join('; ')
  }
  const request = httpRequest(
    {
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: upstream.pathname + upstream.search,
      method: req.method,
      headers,
    },
    upstreamResponse => {
      // An engine that no longer knows the browser sends 401. A stale engine
      // cookie (left over from an older host, port or expiry) is the usual
      // cause: mint a fresh one from the portal session and retry once before
      // giving up.
      if (upstreamResponse.statusCode === 401 && !retried) {
        upstreamResponse.resume()
        const payload = auth.verifyToken(cookieValue(req.headers.cookie, COOKIE))
        const user = payload ? auth.findById(payload.sub) : null
        Promise.resolve(user).then(async resolved => {
          if (resolved && !resolved.is_forbidden && (resolved.token_version ?? 0) === (payload.ver ?? 0)) {
            const token = await tokenFor()
            if (token) {
              const minted = await mintEngineCookie(token, req)
              if (minted.length) {
                return proxy(req, res, { engineCookies: minted, retried: true })
              }
            }
          }
          res.setHeader('set-cookie', 'dsh-auth-x=; Path=/; Max-Age=0')
          if (req.headers.accept?.includes('text/html')) {
            res.writeHead(302, { location: '/login' })
            return res.end()
          }
          res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
          return res.end('Sign in first.')
        }).catch(() => {
          res.setHeader('set-cookie', 'dsh-auth-x=; Path=/; Max-Age=0')
          if (req.headers.accept?.includes('text/html')) {
            res.writeHead(302, { location: '/login' })
            return res.end()
          }
          res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
          return res.end('Sign in first.')
        })
        return
      }
      if (upstreamResponse.statusCode === 401) {
        upstreamResponse.resume()
        res.setHeader('set-cookie', 'dsh-auth-x=; Path=/; Max-Age=0')
        if (req.headers.accept?.includes('text/html')) {
          res.writeHead(302, { location: '/login' })
          return res.end()
        }
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
        return res.end('Sign in first.')
      }
      const responseHeaders = { ...upstreamResponse.headers }
      if (engineCookies.length) {
        const existing = responseHeaders['set-cookie']
        responseHeaders['set-cookie'] = Array.isArray(existing)
          ? existing.concat(engineCookies)
          : (existing ? [existing, ...engineCookies] : engineCookies)
      }
      res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
      upstreamResponse.pipe(res)
    },
  )
  request.on('error', (error) => {
    // A reset from the engine must not take the portal with it.
    if (res.headersSent) return res.destroy()
    send(res, 502, 'The Nova Bots engine is not reachable.')
  })
  req.pipe(request)
}

// WebSocket and other upgrades (the live feed) go through the same gate as
// the rest of the app: a browser with a good portal session but no engine
// cookie gets one minted first, so the upgrade is not rejected.
const upgrade = async (req, socket, head) => {
  const attempt = async (engineCookies = [], retried = false) => {
    const url = new URL(req.url ?? '/', 'http://portal.local')
    // The app is served under /app, the engine lives at the root.
    const path = url.pathname.startsWith('/app/') ? url.pathname.slice(4) || '/' : url.pathname
    const upstream = new URL(path + url.search, ENGINE)
    const headers = { ...req.headers, host: req.headers.host ?? 'bots.alilabsx.com' }
    delete headers['accept-encoding']
    if (engineCookies.length) {
      const minted = engineCookies.map(cookie => String(cookie).split(';')[0]).filter(Boolean).join('; ')
      headers.cookie = [headers.cookie, minted].filter(Boolean).join('; ')
    }

    // When no engine cookie is present at all, mint one first.
    if (!engineCookies.length && !hasEngineCookie(req) && !retried) {
      const payload = auth.verifyToken(cookieValue(req.headers.cookie, COOKIE))
      const user = payload ? await auth.findById(payload.sub) : null
      if (user && !user.is_forbidden && (user.token_version ?? 0) === (payload.ver ?? 0)) {
        const token = await tokenFor()
        if (token) {
          const minted = await mintEngineCookie(token, req)
          if (minted.length) return attempt(minted, true)
        }
      }
      socket.destroy()
      return
    }

    const request = httpRequest({
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: upstream.pathname + upstream.search,
      method: req.method,
      headers,
    })
    request.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      const responseHeaders = Object.entries(upstreamResponse.headers)
        .filter(([key]) => !['transfer-encoding', 'content-length', 'connection', 'upgrade'].includes(key.toLowerCase()))
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n')
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`)
      if (upstreamHead?.length) socket.unshift(upstreamHead)
      upstreamSocket.pipe(socket).pipe(upstreamSocket)
    })
    request.on('response', async (upstreamResponse) => {
      upstreamResponse.resume()
      if (upstreamResponse.statusCode === 401 && !retried) {
        const payload = auth.verifyToken(cookieValue(req.headers.cookie, COOKIE))
        const user = payload ? await auth.findById(payload.sub) : null
        if (user && !user.is_forbidden && (user.token_version ?? 0) === (payload.ver ?? 0)) {
          const token = await tokenFor()
          if (token) {
            const minted = await mintEngineCookie(token, req)
            if (minted.length) return attempt(minted, true)
          }
        }
      }
      socket.destroy()
    })
    request.on('error', () => socket.destroy())
    socket.on('close', () => console.log(`portal: socket closed for ${req.url}`))
    socket.on('error', () => socket.destroy())
    if (head?.length) request.write(head)
    request.end()
  }
  try {
    // Same rule as the HTTP bridge: no socket without an entitled session.
    const { access } = await accessFor(req)
    if (access !== 'ok') return socket.destroy()
    await attempt()
  } catch {
    socket.destroy()
  }
}

// The portal session decides every request, including ones that carry an
// engine cookie: the engine's cookie says the engine knows the browser, not
// that the account behind it is still allowed in (see gate.mjs).
const accessFor = async (req) => {
  const payload = auth.verifyToken(cookieValue(req.headers.cookie, COOKIE))
  const user = payload ? await auth.findById(payload.sub) : null
  return { user, access: engineAccess(payload, user, POLICY) }
}

const heldPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova Bots</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070814;color:#e6e8ff;font:16px/1.6 system-ui,sans-serif}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .5rem}a{color:#7cc4ff}</style></head>
<body><main><h1>Your workspace is being prepared</h1><p>Your account is signed in. A private Nova Bots workspace is set up for each account; yours is not ready yet.</p><p>Questions: <a href="mailto:${SUPPORT_CONTACT}">${SUPPORT_CONTACT}</a> · <a href="/account">Account</a></p></main></body></html>`

const holdOut = (req, res) => {
  const headers = { 'set-cookie': clearEngineCookies(req.headers.cookie) }
  if (req.headers.accept?.includes('text/html')) {
    return send(res, 403, heldPage, { ...headers, 'content-type': 'text/html; charset=utf-8' })
  }
  json(res, 403, { detail: { code: 'workspace_not_ready', message: 'Your private workspace is not ready yet.' } }, headers)
}

const bridge = async (req, res) => {
  const { access } = await accessFor(req)
  if (access === 'not-entitled') return holdOut(req, res)
  if (access === 'ok') {
    if (hasEngineCookie(req)) return proxy(req, res)
    const token = await tokenFor()
    if (token) {
      const engineCookies = await mintEngineCookie(token, req)
      if (engineCookies.length) return proxy(req, res, { engineCookies })
    }
    return send(res, 503, 'The Nova Bots engine is not reachable.', { 'content-type': 'text/plain; charset=utf-8' })
  }
  if (req.headers.accept?.includes('text/html')) {
    res.writeHead(302, { location: '/login', 'set-cookie': clearEngineCookies(req.headers.cookie) })
    return res.end()
  }
  send(res, 401, 'Sign in first.', { 'content-type': 'text/plain; charset=utf-8', 'set-cookie': clearEngineCookies(req.headers.cookie) })
}

// ---- the server ---------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname

  try {
    if (path.startsWith('/api/v1/auth/')) {
      if (path === '/api/v1/auth/login/local' && req.method === 'POST') return login(req, res)
      if (path === '/api/v1/auth/me' && req.method === 'GET') return me(req, res)
      if (path === '/api/v1/auth/logout' && req.method === 'POST') return logout(req, res)
      if (path === '/api/v1/auth/setup-status' && req.method === 'GET') return setupStatus(req, res)
      if (path === '/api/v1/auth/register' && req.method === 'POST') return register(req, res)
      if (path === '/api/v1/auth/change-password' && req.method === 'POST') return changePassword(req, res)
      return json(res, 404, { detail: { message: 'Unknown endpoint.' } })
    }

    if (path.startsWith('/api/v1/bots-admin/') || path === '/api/v1/bots-admin') {
      return handleAdmin(req, res, path, { auth, clientIp })
    }

    if (path === '/app' || path.startsWith('/app/')) return bridge(req, res)

    if (path === '/health') return send(res, 200, 'ok', { 'content-type': 'text/plain; charset=utf-8' })

    // Everything else is the engine's own surface (assets, plugin bundles,
    // its own API calls): it goes through the same gate as the app.
    return bridge(req, res)
  } catch (error) {
    send(res, 500, `The portal failed: ${error?.message ?? error}`, { 'content-type': 'text/plain; charset=utf-8' })
  }
})

server.on('upgrade', upgrade)

await auth.migrate()
server.listen(PORT, HOST, () => {
  console.log(`Nova Bots portal on http://${HOST}:${PORT} (engine ${ENGINE})`)
})
