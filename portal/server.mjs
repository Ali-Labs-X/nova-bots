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
//   /app/…            the bridge to an engine. The portal session decides, on
//                     every request, which engine the account may reach (see
//                     gate.mjs): the shared engine (NOVA_TENANCY=shared, the
//                     entitled few) or the account's OWN tenant engine
//                     (NOVA_TENANCY=isolated, tenants.mjs). The engine cookie
//                     is minted and held by the portal (bridge.mjs); the
//                     browser never holds one.
//
// nginx sits in front of this process and serves the landing page, the login
// page and the static assets; it forwards the API and the app here.

import { createServer } from 'node:http'
import { Auth } from './auth.mjs'
import { handleAdmin } from './admin.mjs'
import { EngineCookieJar, mintEngineCookie, proxyHttp, proxyUpgrade, redirectToApp } from './bridge.mjs'
import { LaunchTokenPool } from './launch-token.mjs'
import { clearEngineCookies, policyFromEnv, routeFor, signupAllowed } from './gate.mjs'
import { capacityPage, failedPage, heldPage, provisioningPage } from './pages.mjs'
import { Tenants, tenancyConfigFromEnv } from './tenants.mjs'

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

// The sign-in page adapts to this: when sign-up is closed it offers "Request
// access" instead of a form that would only refuse.
const setupStatus = async (req, res) => {
  const count = await auth.countUsers()
  json(res, 200, {
    needs_setup: count === 0,
    has_users: count > 0,
    signup_open: count === 0 || POLICY.signupMode === 'open',
    tenancy: POLICY.tenancy,
    support_contact: SUPPORT_CONTACT,
  })
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
  if (!signupAllowed(POLICY, count, email)) {
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
  // With tenancy on, the account's own workspace is allocated now and created
  // on first access. Never the shared engine.
  if (tenants) {
    await tenants.ensureRow(user).catch(error => console.error(`portal: tenant allocation for a new account failed: ${error.message}`))
  }
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
  // The password change ends every session, including open live feeds.
  closeUserSockets(user.id)
  json(res, 200, { ok: true })
}

// ---- the engine bridge --------------------------------------------------

// The shared engine's launch token. The engine writes it to a file when it
// starts, but it re-mints it when the profile reloads, and the file keeps the
// old value until the next start; the container log has the token the engine
// serves with. The pool tries the file token first, then the log's tokens,
// newest first, and keeps the one the engine accepted.
const launchTokens = new LaunchTokenPool({ file: TOKEN_FILE, container: CONTAINER })

// Engine cookies live here, per engine and per Host; never in the browser.
const jar = new EngineCookieJar()

const sharedTarget = {
  key: 'shared',
  url: ENGINE,
  cookie: (host, { fresh = false } = {}) => jar.get({
    key: 'shared',
    url: ENGINE,
    host,
    fresh,
    mint: url => launchTokens.mint(url, host, mintEngineCookie),
  }),
  invalidate: () => {
    launchTokens.invalidate()
    jar.invalidate('shared')
  },
}

// One engine per account, when tenancy is isolated.
const tenants = POLICY.tenancy === 'isolated'
  ? new Tenants({
    pool: auth.pool,
    config: tenancyConfigFromEnv(),
    jar,
    legacyToken: () => launchTokens.current(),
    legacyMint: (url, host) => launchTokens.mint(url, host, mintEngineCookie),
    audit: (entry) => auth.audit(entry),
  })
  : null

// Open live feeds per account, so revoking the sessions, forbidding the
// account or changing the password also ends the feeds already open.
const userSockets = new Map()

const closeUserSockets = (userId) => {
  for (const socket of userSockets.get(String(userId)) ?? []) socket.destroy()
  userSockets.delete(String(userId))
}

const trackSocket = (userId, socket) => {
  const id = String(userId)
  if (!userSockets.has(id)) userSockets.set(id, new Set())
  userSockets.get(id).add(socket)
  socket.once('close', () => userSockets.get(id)?.delete(socket))
}

// The portal session decides every request (see gate.mjs).
const sessionFor = async (req) => {
  const payload = auth.verifyToken(cookieValue(req.headers.cookie, COOKIE))
  const user = payload ? await auth.findById(payload.sub) : null
  return { user, route: routeFor(payload, user, POLICY) }
}

const page = (req, res, status, html, extra = {}) => {
  const headers = { 'set-cookie': clearEngineCookies(req.headers.cookie), ...extra }
  if (req.headers.accept?.includes('text/html')) {
    return send(res, status, html, { ...headers, 'content-type': 'text/html; charset=utf-8' })
  }
  return null
}

const holdOut = (req, res) => {
  if (page(req, res, 403, heldPage(SUPPORT_CONTACT)) !== null) return
  json(res, 403, { detail: { code: 'workspace_not_ready', message: 'Your private workspace is not ready yet.' } }, { 'set-cookie': clearEngineCookies(req.headers.cookie) })
}

const toLogin = (req, res) => {
  if (req.headers.accept?.includes('text/html')) {
    res.writeHead(302, { location: '/login', 'set-cookie': clearEngineCookies(req.headers.cookie), 'cache-control': 'no-store' })
    return res.end()
  }
  send(res, 401, 'Sign in first.', { 'content-type': 'text/plain; charset=utf-8', 'set-cookie': clearEngineCookies(req.headers.cookie) })
}

const tenantUnavailable = (req, res, error) => {
  const capacity = error?.code === 'CAPACITY'
  const html = capacity ? capacityPage(SUPPORT_CONTACT) : failedPage(SUPPORT_CONTACT)
  if (page(req, res, 503, html, { 'retry-after': capacity ? '20' : '30' }) !== null) return
  json(res, 503, { detail: { code: capacity ? 'capacity' : 'workspace_unavailable', message: capacity ? 'All workspaces are busy right now.' : 'Your workspace could not start.' } }, { 'retry-after': capacity ? '20' : '30' })
}

const bridge = async (req, res) => {
  const { user, route } = await sessionFor(req)
  if (route === 'no-session') return toLogin(req, res)
  if (route === 'not-entitled') return holdOut(req, res)
  if (route === 'shared') return proxyHttp(req, res, sharedTarget)

  // own-tenant: the account's own engine and nothing else. A page load while
  // the engine is created or woken shows a page that refreshes; API calls wait.
  try {
    if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
      const readiness = await tenants.readiness(user)
      if (!readiness.ready) {
        if (readiness.status === 'capacity' || readiness.status === 'failed') {
          return tenantUnavailable(req, res, { code: readiness.status === 'capacity' ? 'CAPACITY' : 'FAILED' })
        }
        return page(req, res, 202, provisioningPage(SUPPORT_CONTACT, { first: readiness.status === 'first' }), { 'retry-after': '3' })
      }
    }
    const target = await tenants.targetFor(user)
    return proxyHttp(req, res, target)
  } catch (error) {
    console.error(`portal: workspace for an account is unavailable: ${error.message}`)
    return tenantUnavailable(req, res, error)
  }
}

// WebSocket and other upgrades (the live feed): the same rule as the HTTP
// bridge — no socket without an entitled session, and only to its own engine.
const upgrade = async (req, socket, head) => {
  socket.on('error', () => socket.destroy())
  try {
    const { user, route } = await sessionFor(req)
    if (route === 'shared') {
      return proxyUpgrade(req, socket, head, sharedTarget, { onOpen: s => trackSocket(user.id, s) })
    }
    if (route !== 'own-tenant') return socket.destroy()
    const target = await tenants.targetFor(user)
    await proxyUpgrade(req, socket, head, target, {
      onOpen: s => {
        trackSocket(user.id, s)
        tenants.socketOpened(target.tenantId, s)
      },
      onClose: s => tenants.socketClosed(target.tenantId, s),
    })
  } catch {
    socket.destroy()
  }
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
      return handleAdmin(req, res, path, { auth, clientIp, tenants, closeUserSockets, policy: POLICY })
    }

    // The engine's page needs the trailing slash: /app answers with a
    // redirect to /app/, and /app/… is bridged as it is.
    if (path === '/app' && (req.method === 'GET' || req.method === 'HEAD')) return redirectToApp(req, res)
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
if (tenants) {
  await tenants.migrate()
  // Every existing account gets its own tenant row (created lazily on first
  // access); the admin keeps the shared engine as its tenant.
  const backfill = await tenants.backfill()
  console.log(`portal: tenancy isolated — ${backfill.created.length} tenants allocated, ${backfill.existing.length} existing, legacy ${backfill.legacy ? 'mapped' : 'not mapped'}`)
  const { orphans } = await tenants.reconcile().catch(error => {
    console.error(`portal: tenant reconcile failed: ${error.message}`)
    return { orphans: [] }
  })
  if (orphans.length) console.warn(`portal: tenant containers without a row: ${orphans.join(', ')}`)
  tenants.startReaper()
}
server.listen(PORT, HOST, () => {
  console.log(`Nova Bots portal on http://${HOST}:${PORT} (tenancy ${POLICY.tenancy}, shared engine ${ENGINE})`)
})
