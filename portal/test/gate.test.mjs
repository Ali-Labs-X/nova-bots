import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearEngineCookies, engineAccess, policyFromEnv, signupAllowed, withoutEngineCookies } from '../gate.mjs'

const policy = policyFromEnv({})
const admin = { email: 'Owner@Example.com', system_role: 'admin', token_version: 2 }
const member = { email: 'client@example.com', system_role: 'user', token_version: 0 }

test('fails closed by default: admins only, sign-up closed', () => {
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
  assert.equal(signupAllowed(policyFromEnv({ NOVA_SIGNUP_MODE: 'OPEN' }), 3), true)
  // Anything that is not exactly "open" stays closed.
  assert.equal(signupAllowed(policyFromEnv({ NOVA_SIGNUP_MODE: 'yes' }), 3), false)
})

test('engine cookies are cleared and stripped, the portal session is kept', () => {
  const header = 'access_token=abc; dsh-auth-x=1; theme=dark; dsh-auth-bots.alilabsx.com=2'
  assert.deepEqual(clearEngineCookies(header).map(c => c.split('=')[0]), ['dsh-auth-x', 'dsh-auth-bots.alilabsx.com'])
  assert.ok(clearEngineCookies(header).every(c => c.includes('Max-Age=0')))
  assert.equal(withoutEngineCookies(header), 'access_token=abc; theme=dark')
})
