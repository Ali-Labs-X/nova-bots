// Who may reach the engine, and who may create an account.
//
// The engine is one workspace: one roster of Bots, one memory, one set of
// provider keys, and Bots with full access inside its container. Until every
// account has an engine of its own, reaching it means sharing all of that, so
// the rule fails closed: an account reaches the engine only when it is
// entitled to it, and the decision is made on every request from the portal
// session — never from the engine's own cookie, which a revoked, banned or
// logged-out account would otherwise keep using.
//
// Pure functions only, so the policy is testable without a server.

const list = (value) => String(value ?? '')
  .split(',')
  .map(item => item.trim().toLowerCase())
  .filter(Boolean)

// The engine's browser cookies are named after the authority they were minted
// for and always start with this prefix.
export const ENGINE_COOKIE_PREFIX = 'dsh-auth-'

export const policyFromEnv = (env = process.env) => ({
  // Roles allowed into the shared engine. Admins own the workspace.
  engineRoles: list(env.NOVA_ENGINE_ALLOWED_ROLES ?? 'admin'),
  // Individual accounts let in on top of the roles (e.g. a teammate).
  engineEmails: list(env.NOVA_ENGINE_ALLOWED_EMAILS),
  // closed: only the bootstrap account may sign up; open: anyone may.
  signupMode: String(env.NOVA_SIGNUP_MODE ?? 'closed').trim().toLowerCase() === 'open' ? 'open' : 'closed',
})

// 'ok' when the session is valid and the account may use the engine;
// otherwise the reason: 'no-session' (send to login) or 'not-entitled'
// (signed in, but held out of the shared engine).
export const engineAccess = (payload, user, policy) => {
  if (!payload || !user) return 'no-session'
  if (user.is_forbidden) return 'no-session'
  if ((user.token_version ?? 0) !== (payload.ver ?? 0)) return 'no-session'
  const role = String(user.system_role ?? '').toLowerCase()
  const email = String(user.email ?? '').toLowerCase()
  if (policy.engineRoles.includes(role) || policy.engineEmails.includes(email)) return 'ok'
  return 'not-entitled'
}

// The first account bootstraps the workspace and is always allowed.
export const signupAllowed = (policy, existingUsers) => existingUsers === 0 || policy.signupMode === 'open'

// Set-Cookie values that delete every engine cookie the browser sent, so an
// account held out of the engine cannot keep a cookie minted earlier.
export const clearEngineCookies = (cookieHeader) => String(cookieHeader ?? '')
  .split(';')
  .map(part => part.trim().split('=')[0])
  .filter(name => name.startsWith(ENGINE_COOKIE_PREFIX))
  .map(name => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`)

// Removes engine cookies from a Cookie header before it is forwarded, so the
// engine only ever sees a cookie the portal minted for an entitled session.
export const withoutEngineCookies = (cookieHeader) => String(cookieHeader ?? '')
  .split(';')
  .map(part => part.trim())
  .filter(part => part && !part.startsWith(ENGINE_COOKIE_PREFIX))
  .join('; ')
