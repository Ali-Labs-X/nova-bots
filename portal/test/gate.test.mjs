import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearEngineCookies, engineAccess, filterUpstreamSetCookies, policyFromEnv, routeFor, signupAllowed, upstreamCookieHeader, withoutEngineCookies } from '../gate.mjs'

const policy = policyFromEnv({})
const admin = { email: 'Owner@Example.com', system_role: 'admin', token_version: 2 }
const member = { email: 'client@example.com', system_role: 'user', token_version: 0 }

test('fails closed by default: shared tenancy, admins only, sign-up closed', () => {
  assert.equal(policy.tenancy, 'shared')
  assert.deepEqual(policy.engineRoles, ['admin'])
  assert.deepEqual(policy.engineEmails, [])
  assert.equal(policy.signupMode, 'closed')
})

test('an admin with a current session reaches the engine', () => {
  assert.equal(engineAccess({ ver: 2 }, admin, policy), 'ok')
})

test('a plain member is signed in but held out of the shared engine', () => {
  assert.equal(engineAccess({ ver: 0 }, member, policy), 'not-entitled')
})

test('no session, a banned account or a revoked session never reaches the engine', () => {
  assert.equal(engineAccess(null, admin, policy), 'no-session')
  assert.equal(engineAccess({ ver: 2 }, null, policy), 'no-session')
  assert.equal(engineAccess({ ver: 2 }, { ...admin, is_forbidden: true }, policy), 'no-session')
  // Changing the password bumps token_version; the old session must stop working.
  assert.equal(engineAccess({ ver: 1 }, admin, policy), 'no-session')
})

test('an allowlisted email is let in, matched case-insensitively', () => {
  const custom = policyFromEnv({ NOVA_ENGINE_ALLOWED_EMAILS: ' CLIENT@example.com , other@x.io' })
  assert.equal(engineAccess({ ver: 0 }, member, custom), 'ok')
})

test('sign-up: the bootstrap account is always allowed, later ones only when open', () => {
  assert.equal(signupAllowed(policy, 0), true)
  assert.equal(signupAllowed(policy, 3), false)
  assert.equal(signupAllowed(policyFromEnv({ NOVA_SIGNUP_MODE: 'OPEN' }), 3, 'a@b.io'), true)
  assert.equal(signupAllowed(policyFromEnv({ NOVA_TENANCY: 'isolated', NOVA_SIGNUP_MODE: 'open' }), 3, 'a@b.io'), true)
  assert.equal(signupAllowed(policyFromEnv({ NOVA_TENANCY: 'isolated' }), 3, 'a@b.io'), false)
  // Anything that is not exactly "open" stays closed.
  assert.equal(signupAllowed(policyFromEnv({ NOVA_SIGNUP_MODE: 'yes' }), 3), false)
})

test('an account created by an open sign-up in shared mode is still held out of the shared engine', () => {
  const open = policyFromEnv({ NOVA_SIGNUP_MODE: 'open' })
  assert.equal(routeFor({ ver: 0 }, { email: 'new@x.io', system_role: 'user', token_version: 0 }, open), 'not-entitled')
})

test('sign-up allowlists: exact addresses and domains, case-insensitive', () => {
  const p = policyFromEnv({ NOVA_TENANCY: 'isolated', NOVA_SIGNUP_MODE: 'open', NOVA_SIGNUP_ALLOWED_EMAILS: 'vip@gmail.com', NOVA_SIGNUP_ALLOWED_DOMAINS: '@Client.com, partner.io' })
  assert.equal(signupAllowed(p, 3, 'VIP@gmail.com'), true)
  assert.equal(signupAllowed(p, 3, 'someone@client.com'), true)
  assert.equal(signupAllowed(p, 3, 'x@partner.io'), true)
  assert.equal(signupAllowed(p, 3, 'other@gmail.com'), false)
  assert.equal(signupAllowed(p, 3, 'x@evilclient.com'), false)
  assert.equal(signupAllowed(p, 3, 'x@client.com.evil.io'), false)
})

test('isolated tenancy: every valid session is routed to its own tenant, never the shared engine', () => {
  const isolated = policyFromEnv({ NOVA_TENANCY: 'isolated', NOVA_ENGINE_ALLOWED_EMAILS: 'client@example.com' })
  assert.equal(routeFor({ ver: 0 }, member, isolated), 'own-tenant')
  assert.equal(routeFor({ ver: 2 }, admin, isolated), 'own-tenant')
  // The shared-engine allowlist means nothing in isolated mode.
  assert.notEqual(routeFor({ ver: 0 }, member, isolated), 'shared')
  assert.equal(routeFor({ ver: 1 }, admin, isolated), 'no-session')
  assert.equal(routeFor({ ver: 0 }, { ...member, is_forbidden: true }, isolated), 'no-session')
  const adminsOnly = policyFromEnv({ NOVA_TENANCY: 'isolated', NOVA_TENANT_ALLOWED_ROLES: 'admin' })
  assert.equal(routeFor({ ver: 0 }, member, adminsOnly), 'not-entitled')
})

test('shared tenancy routes exactly as before', () => {
  assert.equal(routeFor({ ver: 2 }, admin, policy), 'shared')
  assert.equal(routeFor({ ver: 0 }, member, policy), 'not-entitled')
})

test('upstream cookies: browser engine cookies and the portal session never reach an engine', () => {
  const header = 'access_token=SESSION; dsh-auth-abc=FROM_OTHER_TENANT; theme=dark; dsh-auth-x=1'
  assert.equal(upstreamCookieHeader(header, 'dsh-auth-abc=MINE; Path=/; HttpOnly'), 'theme=dark; dsh-auth-abc=MINE')
  assert.equal(upstreamCookieHeader('access_token=S', null), '')
})

test('engine Set-Cookie for engine cookies or the session is dropped', () => {
  const kept = filterUpstreamSetCookies(['dsh-auth-abc=v; Path=/', 'access_token=evil; Path=/', 'theme=light; Path=/'])
  assert.deepEqual(kept, ['theme=light; Path=/'])
  assert.deepEqual(filterUpstreamSetCookies(undefined), [])
})

test('engine cookies are cleared and stripped, the portal session is kept', () => {
  const header = 'access_token=abc; dsh-auth-x=1; theme=dark; dsh-auth-bots.alilabsx.com=2'
  assert.deepEqual(clearEngineCookies(header).map(c => c.split('=')[0]), ['dsh-auth-x', 'dsh-auth-bots.alilabsx.com'])
  assert.ok(clearEngineCookies(header).every(c => c.includes('Max-Age=0')))
  assert.equal(withoutEngineCookies(header), 'access_token=abc; theme=dark')
})
