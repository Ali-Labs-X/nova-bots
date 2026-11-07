// Nova Bots admin API — the operator console's view of the product.
//
// The console (Nova Ops) reads this over HTTP under /api/v1/bots-admin. It is
// Nova Bots' own API: the accounts come from Nova Bots' own database, the
// roster comes from Nova Bots' own engine and its saved state, and nothing
// here reads the Nova application.
//
// Every request carries the X-Nova-Bots-Token header. The token is stored in
// portal.env and compared in constant time; it is never logged and never
// appears in an answer.

import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const ADMIN_TOKEN = process.env.NOVA_ADMIN_TOKEN ?? ''
const ENGINE = process.env.NOVA_ENGINE_URL ?? 'http://127.0.0.1:13083'
const WEB_PORT = Number(process.env.NOVA_PORT ?? 13080)
const PUBLIC_URL = process.env.NOVA_PUBLIC_URL ?? 'https://bots.alilabsx.com/'
const PROBE_TIMEOUT_MS = 1500
const PREFIX = '/api/v1/bots-admin/'

// The product's own files: the plugin's version and the engine's saved state.
const PLUGIN_PACKAGE = new URL('../ds-bot/package.json', import.meta.url)
const ENGINE_STATE = new URL('../docker/data/bot/state.json', import.meta.url)

const json = (res, status, value) => {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

// The comparison runs over digests, so it does not depend on the length of
// the token and its timing does not depend on how many characters matched.
const digest = (value) => createHash('sha256').update(String(value ?? '')).digest()

const authorised = (req) => {
  if (!ADMIN_TOKEN) return false
  const header = req.headers['x-nova-bots-token']
  const provided = Array.isArray(header) ? header[0] : header
  if (typeof provided !== 'string' || provided.length === 0) return false
  return timingSafeEqual(digest(provided), digest(ADMIN_TOKEN))
}

// The account as the console sees it. The password hash never leaves the
// database for these endpoints.
const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  system_role: row.system_role,
  needs_setup: row.needs_setup,
  is_forbidden: row.is_forbidden,
  token_version: row.token_version,
  created_at: row.created_at,
  last_sign_in_at: row.last_sign_in_at,
  plan: row.plan ?? 'free',
  bonus_daily_tokens: row.bonus_daily_tokens ?? 0,
  bonus_expires_at: row.bonus_expires_at ? new Date(row.bonus_expires_at).toISOString() : null,
  daily_limit_override: row.daily_limit_override ?? null,
})

// ---- the service overview ------------------------------------------------

// Any answer from the engine means it is up, so the state call is enough: it
// is the cheapest endpoint the engine answers.
const probeEngine = async () => {
  try {
    const response = await fetch(`${ENGINE}/api/bot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: null }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    await response.body?.cancel()
    return 'running'
  } catch {
    return 'stopped'
  }
}

// The web front end is nginx in front of the portal; a short timeout keeps
// the overview quick when it is down.
const probeWeb = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    await response.body?.cancel()
    return 'running'
  } catch {
    return 'stopped'
  }
}

let cachedVersion = null
let cachedVersionAt = 0

// The plugin version moves with a release, not with a request: a minute of
// caching keeps the overview cheap without showing a stale number for long.
const pluginVersion = async () => {
  if (cachedVersion && Date.now() - cachedVersionAt < 60000) return cachedVersion
  try {
    const text = await readFile(PLUGIN_PACKAGE, 'utf8')
    const version = JSON.parse(text)?.version
    if (typeof version === 'string' && version.length > 0) cachedVersion = version
  } catch {
    // A missing package file leaves the version unknown, not broken.
  }
  cachedVersionAt = Date.now()
  return cachedVersion ?? '0.0.0'
}

// The roster comes from the engine's saved state, so the console sees the
// team as the engine knows it. A state file that cannot be read is an empty
// team, never an error.
const botTeam = async () => {
  let state = null
  try {
    state = JSON.parse(await readFile(ENGINE_STATE, 'utf8'))
  } catch {
    state = null
  }
  const bots = state && typeof state.bots === 'object' && state.bots !== null ? Object.entries(state.bots) : []
  const mainIds = Array.isArray(state?.mainBotIds) ? state.mainBotIds : []
  const main = bots.find(([key, bot]) => mainIds.includes(key) || mainIds.includes(bot?.id))
  return {
    total: bots.length,
    main: main?.[1]?.name ?? '',
    names: bots.map(([, bot]) => bot?.name).filter(name => typeof name === 'string' && name.length > 0),
  }
}

const overview = async (res, auth) => {
  const [engine, web, version, bots, users] = await Promise.all([
    probeEngine(),
    probeWeb(),
    pluginVersion(),
    botTeam(),
    auth.userMetrics(),
  ])
  json(res, 200, {
    service: { engine, portal: 'running', web, publicUrl: PUBLIC_URL, version },
    users,
    bots,
  })
}

// ---- the accounts --------------------------------------------------------

const listUsers = async (res, auth) => {
  json(res, 200, { users: (await auth.listUsers()).map(publicUser) })
}

// The studio view sorts by the last sign-in, with the accounts that never
// signed in at the end.
const studio = async (res, auth) => {
  const [users, metrics] = await Promise.all([auth.listUsersByActivity(), auth.signInMetrics()])
  json(res, 200, { users: users.map(publicUser), metrics })
}

const userDetail = async (res, auth, id) => {
  const user = await auth.findById(id)
  if (!user) return json(res, 404, { detail: { message: 'No such account.' } })
  const [signIns, recentSignIns] = await Promise.all([
    auth.signInHistory(user.email, 50),
    auth.countSignIns(user.email),
  ])
  json(res, 200, { user: publicUser(user), signIns, recentSignIns })
}

// Forbidding an account ends its sessions, so the token version moves with
// it: a session signed with the old version stops working at once.
const setForbidden = async (res, auth, id, forbidden, ip, ctx) => {
  const user = await auth.setForbidden(id, forbidden)
  if (!user) return json(res, 404, { detail: { message: 'No such account.' } })
  if (forbidden) {
    ctx.closeUserSockets?.(user.id)
    // A forbidden account's engine stops at once; its data is kept.
    const tenant = ctx.tenants ? await ctx.tenants.store.byUser(user.id) : null
    if (tenant?.kind === 'managed') await ctx.tenants.stop(tenant, { reason: 'account-forbidden', actor: 'admin' }).catch(() => {})
  }
  await auth.audit({
    action: forbidden ? 'user-forbid' : 'user-unforbid',
    actor: 'admin',
    target: user.email,
    ok: true,
    ip,
    detail: { user_id: user.id, is_forbidden: forbidden },
  })
  json(res, 200, { ok: true, user: publicUser(user) })
}

// Revoking the sessions only moves the token version: the account itself is
// untouched and can sign in again straight away.
const revokeSessions = async (res, auth, id, ip, ctx) => {
  const user = await auth.bumpTokenVersion(id)
  if (!user) return json(res, 404, { detail: { message: 'No such account.' } })
  ctx.closeUserSockets?.(user.id)
  await auth.audit({
    action: 'sessions-revoke',
    actor: 'admin',
    target: user.email,
    ok: true,
    ip,
    detail: { user_id: user.id },
  })
  json(res, 200, { ok: true })
}

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const setPlan = async (res, auth, id, req, ip) => {
  const body = await readBody(req)
  const form = new URLSearchParams(body)
  const plan = (form.get('plan') ?? '').trim() || ( (() => { try { return JSON.parse(body).plan } catch { return '' } })() )
  const user = await auth.setPlan(id, plan)
  if (!user) return json(res, 404, { detail: { message: 'No such account.' } })
  await auth.audit({ action: 'plan-set', actor: 'admin', target: user.email, ok: true, ip, detail: { user_id: user.id, plan: user.plan } })
  json(res, 200, { ok: true, user: publicUser(user) })
}

const grantBonus = async (res, auth, id, req, ip) => {
  const body = await readBody(req)
  let daily = 0, days = 7
  try {
    const parsed = JSON.parse(body)
    daily = parsed.daily_bonus_tokens ?? parsed.daily ?? 0
    days = parsed.days ?? 7
  } catch {
    const form = new URLSearchParams(body)
    daily = Number(form.get('daily_bonus_tokens') ?? 0)
    days = Number(form.get('days') ?? 7)
  }
  const user = await auth.grantBonus(id, daily, days)
  if (!user) return json(res, 404, { detail: { message: 'No such account.' } })
  await auth.audit({ action: 'bonus-grant', actor: 'admin', target: user.email, ok: true, ip, detail: { user_id: user.id, daily_bonus_tokens: user.bonus_daily_tokens } })
  json(res, 200, { ok: true, user: publicUser(user) })
}

const clearBonus = async (res, auth, id, ip) => {
  const user = await auth.clearBonus(id)
  if (!user) return json(res, 404, { detail: { message: 'No such account.' } })
  await auth.audit({ action: 'bonus-clear', actor: 'admin', target: user.email, ok: true, ip, detail: { user_id: user.id } })
  json(res, 200, { ok: true, user: publicUser(user) })
}

const auditLog = async (res, auth) => {
  json(res, 200, { entries: await auth.auditEntries(200) })
}

// ---- the tenants ---------------------------------------------------------

const readJson = (req) => new Promise((resolve) => {
  const chunks = []
  let size = 0
  req.on('data', chunk => {
    size += chunk.length
    if (size > 64 * 1024) req.destroy()
    else chunks.push(chunk)
  })
  req.on('end', () => {
    try {
      resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
    } catch {
      resolve(null)
    }
  })
  req.on('error', () => resolve(null))
})

const needTenancy = (res, ctx) => {
  if (ctx.tenants) return false
  json(res, 409, { detail: { message: 'Tenancy is not enabled (NOVA_TENANCY=isolated).' } })
  return true
}

const listTenants = async (res, ctx) => {
  if (needTenancy(res, ctx)) return
  const tenants = await ctx.tenants.usage()
  const running = tenants.filter(t => t.kind === 'managed' && t.state === 'running').length
  json(res, 200, {
    tenants,
    capacity: { running, max_running: ctx.tenants.config.maxRunning, total: tenants.filter(t => t.kind === 'managed').length, max_total: ctx.tenants.config.maxTotal, idle_minutes: ctx.tenants.config.idleMinutes },
  })
}

const tenantAction = async (req, res, ctx, id, action, ip) => {
  if (needTenancy(res, ctx)) return
  const tenant = await ctx.tenants.store.byId(id)
  if (!tenant) return json(res, 404, { detail: { message: 'No such tenant.' } })
  const audit = (name, ok, detail = {}) => ctx.auth.audit({ action: name, actor: 'admin', target: tenant.id, ok, ip, detail })
  try {
    if (!action && req.method === 'GET') {
      const [row] = (await ctx.tenants.usage()).filter(t => t.id === tenant.id)
      return json(res, 200, { tenant: row })
    }
    if (action === 'start' && req.method === 'POST') {
      await ctx.tenants.start(tenant, { actor: 'admin' })
    } else if (action === 'stop' && req.method === 'POST') {
      await ctx.tenants.stop(tenant, { reason: 'admin', actor: 'admin' })
    } else if (action === 'delete' && req.method === 'POST') {
      const body = await readJson(req)
      const result = await ctx.tenants.remove(tenant, { exportData: body?.export === true, actor: 'admin' })
      await audit('admin-tenant-delete', true, { exported: Boolean(result.exported) })
      return json(res, 200, { ok: true, exported: result.exported })
    } else if (action === 'key' && req.method === 'POST') {
      // { "env": { "DEEPSEEK_API_KEY": "sk-…" } } assigns; { "clear": true } removes.
      const body = await readJson(req)
      if (!body) return json(res, 400, { detail: { message: 'Send JSON.' } })
      await ctx.tenants.assignKey(tenant, body.clear === true ? null : body.env, { actor: 'admin' })
    } else if (action === 'limits' && req.method === 'POST') {
      const body = await readJson(req)
      if (!body) return json(res, 400, { detail: { message: 'Send JSON.' } })
      await ctx.tenants.setLimits(tenant, body, { actor: 'admin' })
    } else {
      return json(res, 404, { detail: { message: 'Unknown endpoint.' } })
    }
    await audit(`admin-tenant-${action}`, true)
    const [row] = (await ctx.tenants.usage()).filter(t => t.id === tenant.id)
    return json(res, 200, { ok: true, tenant: row ?? null })
  } catch (error) {
    await audit(`admin-tenant-${action ?? 'read'}`, false, { error: String(error.message).slice(0, 200) })
    return json(res, error.code === 'CAPACITY' ? 503 : 400, { detail: { message: error.message } })
  }
}

const backfillTenants = async (req, res, ctx, ip) => {
  if (needTenancy(res, ctx)) return
  const body = await readJson(req)
  const result = await ctx.tenants.backfill({ provision: body?.provision === true })
  await ctx.auth.audit({ action: 'admin-tenant-backfill', actor: 'admin', ok: result.failed.length === 0, ip, detail: { created: result.created.length, failed: result.failed.length } })
  json(res, 200, result)
}

// Deleting an account removes its tenant first (optionally exporting its
// data), then the account. The audit trail keeps the history.
const deleteUser = async (req, res, ctx, id, ip) => {
  const user = await ctx.auth.findById(id)
  if (!user) return json(res, 404, { detail: { message: 'No such account.' } })
  const body = await readJson(req)
  let exported = null
  try {
    ctx.closeUserSockets?.(user.id)
    const tenant = ctx.tenants ? await ctx.tenants.store.byUser(user.id) : null
    if (tenant) exported = (await ctx.tenants.remove(tenant, { exportData: body?.export === true, actor: 'admin' })).exported
    await ctx.auth.pool.query('DELETE FROM users WHERE id = $1', [user.id])
  } catch (error) {
    await ctx.auth.audit({ action: 'user-delete', actor: 'admin', target: user.email, ok: false, ip, detail: { error: String(error.message).slice(0, 200) } })
    return json(res, 400, { detail: { message: error.message } })
  }
  await ctx.auth.audit({ action: 'user-delete', actor: 'admin', target: user.email, ok: true, ip, detail: { user_id: user.id, exported: Boolean(exported) } })
  json(res, 200, { ok: true, exported })
}

// ---- the router ----------------------------------------------------------

export const handleAdmin = async (req, res, path, ctx) => {
  const { auth, clientIp } = ctx
  if (!authorised(req)) {
    return json(res, 401, { detail: { message: 'Not authorised.' } })
  }

  const ip = clientIp(req)
  const rest = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : ''

  if (rest === 'overview' && req.method === 'GET') return overview(res, auth)
  if (rest === 'users' && req.method === 'GET') return listUsers(res, auth)
  if (rest === 'users/studio' && req.method === 'GET') return studio(res, auth)
  if (rest === 'audit' && req.method === 'GET') return auditLog(res, auth)
  if (rest === 'tenants' && req.method === 'GET') return listTenants(res, ctx)
  if (rest === 'tenants/backfill' && req.method === 'POST') return backfillTenants(req, res, ctx, ip)

  const tenantRoute = rest.match(/^tenants\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/)
  if (tenantRoute) return tenantAction(req, res, ctx, tenantRoute[1], tenantRoute[2], ip)

  const userRoute = rest.match(/^users\/([^/]+)(?:\/([a-z-]+))?$/)
  if (userRoute) {
    let id = userRoute[1]
    try {
      id = decodeURIComponent(id)
    } catch {
      // An id that cannot be decoded simply does not match an account.
    }
    const action = userRoute[2]
    if (!action && req.method === 'GET') return userDetail(res, auth, id)
    if (action === 'forbid' && req.method === 'POST') return setForbidden(res, auth, id, true, ip, ctx)
    if (action === 'unforbid' && req.method === 'POST') return setForbidden(res, auth, id, false, ip, ctx)
    if (action === 'revoke-sessions' && req.method === 'POST') return revokeSessions(res, auth, id, ip, ctx)
    if (action === 'delete' && req.method === 'POST') return deleteUser(req, res, ctx, id, ip)
    if (action === 'plan' && req.method === 'POST') return setPlan(res, auth, id, req, ip)
    if (action === 'grant' && req.method === 'POST') return grantBonus(res, auth, id, req, ip)
    if (action === 'clear-bonus' && req.method === 'POST') return clearBonus(res, auth, id, ip)
  }

  return json(res, 404, { detail: { message: 'Unknown endpoint.' } })
}
