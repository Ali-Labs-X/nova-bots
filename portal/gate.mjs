// Who may reach an engine, which engine, and who may create an account.
//
// Two modes, chosen by NOVA_TENANCY:
//
//   shared    (default) One engine is one workspace: one roster of Bots, one
//             memory, one set of provider keys, and Bots with full access
//             inside its container. Reaching it means sharing all of that, so
//             the rule fails closed: only entitled accounts (admins and an
//             explicit allowlist) are let in; everyone else is held out.
//
//   isolated  Every account has an engine of its own (tenants.mjs). A signed-in
//             account is routed ONLY to its own tenant's engine — entitlement
//             'own-tenant' — and nobody is routed to anybody else's.
//
// The decision is made on every request from the portal session — never from
// an engine's own cookie, which a revoked, banned or logged-out account would
// otherwise keep using. Engine cookies are held by the portal, never by the
// browser (see bridge.mjs), and the helpers below strip whatever engine cookie
// a browser still presents.
//
// Pure functions only, so the policy is testable without a server.

const list = (value) => String(value ?? '')
  .split(',')
  .map(item => item.trim().toLowerCase())
  .filter(Boolean)

// The engine's browser cookies are named after the authority they were minted
// for and always start with this prefix.
export const ENGINE_COOKIE_PREFIX = 'dsh-auth-'

// The portal's own session cookie. It is the sole authority and must never be
// forwarded to an engine: in isolated mode a tenant controls its own engine
// process, so anything forwarded there is visible to that tenant.
export const SESSION_COOKIE = 'access_token'

export const policyFromEnv = (env = process.env) => ({
  // shared: one engine for the entitled few; isolated: one engine per account.
  tenancy: String(env.NOVA_TENANCY ?? 'shared').trim().toLowerCase() === 'isolated' ? 'isolated' : 'shared',
  // Roles allowed into the shared engine. Admins own the workspace.
  engineRoles: list(env.NOVA_ENGINE_ALLOWED_ROLES ?? 'admin'),
  // Individual accounts let in on top of the roles (e.g. a teammate).
  engineEmails: list(env.NOVA_ENGINE_ALLOWED_EMAILS),
  // Roles that get a tenant of their own in isolated mode.
  tenantRoles: list(env.NOVA_TENANT_ALLOWED_ROLES ?? 'admin,user'),
  // closed: only the bootstrap account may sign up; open: anyone may — but
  // only when tenancy is isolated (see signupAllowed).
  signupMode: String(env.NOVA_SIGNUP_MODE ?? 'closed').trim().toLowerCase() === 'open' ? 'open' : 'closed',
  // Optional sign-up allowlists. Both empty means any address may sign up.
  signupEmails: list(env.NOVA_SIGNUP_ALLOWED_EMAILS),
  signupDomains: list(env.NOVA_SIGNUP_ALLOWED_DOMAINS).map(domain => domain.replace(/^@/, '')),
})

const sessionValid = (payload, user) => {
  if (!payload || !user) return false
  if (user.is_forbidden) return false
  if ((user.token_version ?? 0) !== (payload.ver ?? 0)) return false
  return true
}

// Where a request goes:
//   'no-session'    send to login
//   'not-entitled'  signed in, but held out
//   'shared'        the one shared engine (shared mode only)
//   'own-tenant'    the account's own engine and nothing else (isolated mode)
export const routeFor = (payload, user, policy) => {
  if (!sessionValid(payload, user)) return 'no-session'
  const role = String(user.system_role ?? '').toLowerCase()
  if (policy.tenancy === 'isolated') {
    return policy.tenantRoles.includes(role) ? 'own-tenant' : 'not-entitled'
  }
  const email = String(user.email ?? '').toLowerCase()
  if (policy.engineRoles.includes(role) || policy.engineEmails.includes(email)) return 'shared'
  return 'not-entitled'
}

// 'ok' when the session is valid and the account may use an engine;
// otherwise the reason (kept for callers that only need yes/no).
export const engineAccess = (payload, user, policy) => {
  const route = routeFor(payload, user, policy)
  return route === 'shared' || route === 'own-tenant' ? 'ok' : route
}

export const signupEmailAllowed = (policy, email) => {
  const address = String(email ?? '').trim().toLowerCase()
  if (!policy.signupEmails.length && !policy.signupDomains.length) return true
  if (policy.signupEmails.includes(address)) return true
  const domain = address.includes('@') ? address.slice(address.lastIndexOf('@') + 1) : ''
  return Boolean(domain) && policy.signupDomains.includes(domain)
}

// The first account bootstraps the workspace and is always allowed. Later
// accounts only when sign-up is open AND every account gets an isolated
// engine: an open sign-up in front of a shared engine would hand strangers
// the operator's workspace.
export const signupAllowed = (policy, existingUsers, email = '') => {
  if (existingUsers === 0) return true
  if (policy.tenancy !== 'isolated' || policy.signupMode !== 'open') return false
  return signupEmailAllowed(policy, email)
}

const cookieName = (part) => part.trim().split('=')[0].trim()

// Set-Cookie values that delete every engine cookie the browser sent, so an
// account cannot keep a cookie minted earlier (or for another workspace).
export const clearEngineCookies = (cookieHeader) => String(cookieHeader ?? '')
  .split(';')
  .map(cookieName)
  .filter(name => name.startsWith(ENGINE_COOKIE_PREFIX))
  .map(name => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`)

// Removes engine cookies from a Cookie header.
export const withoutEngineCookies = (cookieHeader) => String(cookieHeader ?? '')
  .split(';')
  .map(part => part.trim())
  .filter(part => part && !part.startsWith(ENGINE_COOKIE_PREFIX))
  .join('; ')

// The Cookie header an engine receives: the browser's own non-sensitive
// cookies, minus every engine cookie it presented and minus the portal
// session, plus the one engine cookie the portal minted for THIS engine.
export const upstreamCookieHeader = (cookieHeader, engineCookie) => {
  const kept = String(cookieHeader ?? '')
    .split(';')
    .map(part => part.trim())
    .filter(part => part && !part.startsWith(ENGINE_COOKIE_PREFIX) && cookieName(part) !== SESSION_COOKIE)
  if (engineCookie) kept.push(String(engineCookie).split(';')[0].trim())
  return kept.join('; ')
}

// Set-Cookie headers from an engine, minus the ones only the portal may set:
// an engine must not plant its own cookie in the browser (the portal holds
// it) and must never touch the portal session.
export const filterUpstreamSetCookies = (setCookie) => {
  const values = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : [])
  return values.filter(value => {
    const name = cookieName(String(value).split(';')[0])
    return !name.startsWith(ENGINE_COOKIE_PREFIX) && name !== SESSION_COOKIE
  })
}
