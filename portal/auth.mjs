// Nova Bots auth — the workspace's own account store.
//
// The design follows the pattern the Nova stack uses (a local email/password
// provider, bcrypt hashes with a SHA-256 pre-hash, a short-lived HS256 access
// token in an HttpOnly cookie, a per-IP login rate limit), but the code and
// the database are Nova Bots' own: the accounts live in their own database on
// the shared Postgres server, and nothing here calls the Nova application.

import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

const HASH_PREFIX = '$dfv2$'

// bcrypt truncates at 72 bytes; hashing the digest first keeps every byte of
// the password in play. The digest is 44 base64 characters, well inside it.
const preHash = (password) => createHash('sha256').update(password, 'utf8').digest('base64')

export const hashPassword = (password) => `${HASH_PREFIX}${bcrypt.hashSync(preHash(password), bcrypt.genSaltSync(10)).toString('utf8')}`

export const verifyPassword = (plain, hashed) => {
  try {
    if (typeof hashed !== 'string' || hashed.length === 0) return false
    const value = hashed.startsWith(HASH_PREFIX) ? hashed.slice(HASH_PREFIX.length) : hashed
    return bcrypt.compareSync(preHash(plain), value)
  } catch {
    return false
  }
}

// The JWT is a plain HS256 token: header, payload, signature.
const base64url = (value) => Buffer.from(value).toString('base64url')

const sign = (payload, secret) => {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = createHash('sha256').update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

export class Auth {
  constructor({ databaseUrl, jwtSecret, tokenExpiryDays = 7, rateLimitMax = 5, rateLimitWindowMs = 300000 }) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 4 })
    this.jwtSecret = jwtSecret
    this.tokenExpiryDays = tokenExpiryDays
    this.rateLimitMax = rateLimitMax
    this.rateLimitWindowMs = rateLimitWindowMs
    this.attempts = new Map()
  }

  // The schema is small on purpose: accounts, and the audit trail the admin
  // API reads. The tables live in their own database on the shared Postgres
  // server.
  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email           varchar(320) NOT NULL UNIQUE,
        password_hash   varchar(128),
        system_role     varchar(16) NOT NULL DEFAULT 'user',
        token_version   integer NOT NULL DEFAULT 0,
        needs_setup     boolean NOT NULL DEFAULT false,
        is_forbidden    boolean NOT NULL DEFAULT false,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        last_sign_in_at timestamptz
      )
    `)
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_nb_users_email ON users (lower(email))')
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id         bigserial PRIMARY KEY,
        at         timestamptz NOT NULL DEFAULT now(),
        action     varchar(48) NOT NULL,
        actor      varchar(320),
        target     varchar(320),
        ok         boolean NOT NULL DEFAULT true,
        ip         varchar(64),
        detail     jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `)
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_nb_audit_at ON audit_log (at DESC)')
  }

  async countUsers() {
    const { rows } = await this.pool.query('SELECT count(*)::int AS count FROM users')
    return rows[0]?.count ?? 0
  }

  async findByEmail(email) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email])
    return rows[0] ?? null
  }

  async findById(id) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id])
    return rows[0] ?? null
  }

  async createUser({ email, password, systemRole = 'user', needsSetup = false }) {
    const hash = password ? hashPassword(password) : null
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, password_hash, system_role, needs_setup)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email, hash, systemRole, needsSetup],
    )
    return rows[0]
  }

  async setPassword(id, password) {
    const hash = hashPassword(password)
    await this.pool.query(
      'UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1',
      [id, hash],
    )
  }

  async touchSignIn(id) {
    await this.pool.query('UPDATE users SET last_sign_in_at = now() WHERE id = $1', [id])
  }

  // The account columns the admin API is allowed to see. The password hash is
  // not among them, so it cannot reach an answer by accident.
  async listUsers() {
    const { rows } = await this.pool.query(
      `SELECT id, email, system_role, needs_setup, is_forbidden, token_version, created_at, last_sign_in_at
         FROM users
        ORDER BY created_at DESC`,
    )
    return rows
  }

  // The studio order: the last sign-in first, the accounts that never signed
  // in at the end.
  async listUsersByActivity() {
    const { rows } = await this.pool.query(
      `SELECT id, email, system_role, needs_setup, is_forbidden, token_version, created_at, last_sign_in_at
         FROM users
        ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC`,
    )
    return rows
  }

  async userMetrics() {
    const { rows } = await this.pool.query(`
      SELECT count(*)::int AS total,
             (count(*) FILTER (WHERE system_role = 'admin'))::int AS admins,
             (count(*) FILTER (WHERE is_forbidden))::int AS forbidden,
             (count(*) FILTER (WHERE last_sign_in_at > now() - interval '7 days'))::int AS active7d,
             (count(*) FILTER (WHERE needs_setup))::int AS setup
        FROM users
    `)
    const row = rows[0] ?? {}
    return {
      total: row.total ?? 0,
      admins: row.admins ?? 0,
      forbidden: row.forbidden ?? 0,
      active7d: row.active7d ?? 0,
      setup: row.setup ?? 0,
    }
  }

  // Forbidding an account ends its sessions, so the token version moves with
  // it: a session signed with the old version stops working at once.
  async setForbidden(id, forbidden) {
    const { rows } = await this.pool.query(
      `UPDATE users
          SET is_forbidden = $2, token_version = token_version + 1, updated_at = now()
        WHERE id = $1
        RETURNING id, email, system_role, needs_setup, is_forbidden, token_version, created_at, last_sign_in_at`,
      [id, forbidden],
    )
    return rows[0] ?? null
  }

  async bumpTokenVersion(id) {
    const { rows } = await this.pool.query(
      `UPDATE users
          SET token_version = token_version + 1, updated_at = now()
        WHERE id = $1
        RETURNING id, email, system_role, needs_setup, is_forbidden, token_version, created_at, last_sign_in_at`,
      [id],
    )
    return rows[0] ?? null
  }

  // The audit trail is written on the side: an entry that cannot be stored
  // must never break the action it describes.
  async audit({ action, actor = null, target = null, ok = true, ip = null, detail = {} }) {
    try {
      await this.pool.query(
        `INSERT INTO audit_log (action, actor, target, ok, ip, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [action, actor, target, ok, ip, JSON.stringify(detail ?? {})],
      )
      return true
    } catch (error) {
      console.error(`audit: could not write the "${action}" entry: ${error?.message ?? error}`)
      return false
    }
  }

  // The sign-in trail is the part of the audit log the sign-in handler wrote.
  // The actor is the address as it was typed, so the match is case
  // insensitive: the same account must show its own history.
  async signInHistory(email, limit = 50) {
    const { rows } = await this.pool.query(
      `SELECT at, ip, ok, detail->>'reason' AS reason
         FROM audit_log
        WHERE action IN ('sign-in', 'sign-in-failed') AND lower(actor) = lower($1)
        ORDER BY at DESC, id DESC
        LIMIT $2`,
      [email, limit],
    )
    return rows.map(row => ({
      at: row.at,
      ip: row.ip,
      ok: row.ok,
      reason: row.reason ?? null,
    }))
  }

  async countSignIns(email) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS count
         FROM audit_log
        WHERE action IN ('sign-in', 'sign-in-failed') AND lower(actor) = lower($1)`,
      [email],
    )
    return rows[0]?.count ?? 0
  }

  // How many sign-ins the product has seen, and when the last one was.
  async signInMetrics() {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS sign_ins, max(at) AS last_active
         FROM audit_log
        WHERE action = 'sign-in' AND ok`,
    )
    const row = rows[0] ?? {}
    return {
      signIns: row.sign_ins ?? 0,
      lastActive: row.last_active ? new Date(row.last_active).toISOString() : null,
    }
  }

  async auditEntries(limit = 200) {
    const { rows } = await this.pool.query(
      `SELECT at, action, actor, target, ok, ip, detail
         FROM audit_log
        ORDER BY at DESC, id DESC
        LIMIT $1`,
      [limit],
    )
    return rows.map(row => ({
      at: row.at,
      action: row.action,
      actor: row.actor ?? null,
      target: row.target ?? null,
      ok: row.ok,
      ip: row.ip ?? null,
      detail: row.detail ?? {},
    }))
  }

  // A short window per client address; five tries, then a five minute wait.
  // A window per key: the sign-in limit is per address, the sign-up limit is
  // per address as well but slower and counted separately.
  rateLimit(key, max = this.rateLimitMax, windowMs = this.rateLimitWindowMs) {
    const now = Date.now()
    const entry = this.attempts.get(key)
    if (!entry || now - entry.first > windowMs) {
      this.attempts.set(key, { first: now, count: 1 })
      return { allowed: true, remaining: max - 1 }
    }
    entry.count += 1
    if (entry.count > max) {
      return { allowed: false, retryAfter: Math.ceil((windowMs - (now - entry.first)) / 1000) }
    }
    return { allowed: true, remaining: max - entry.count }
  }

  clearRateLimit(ip) {
    this.attempts.delete(ip)
  }

  // A passwordless account (an OAuth or imported user) cannot sign in here.
  async authenticate(email, password) {
    const user = await this.findByEmail(email)
    if (!user || !user.password_hash) return null
    if (!verifyPassword(password, user.password_hash)) return null
    if (user.is_forbidden) return { forbidden: true, user }
    return user
  }

  issueToken(user) {
    const now = Math.floor(Date.now() / 1000)
    const expiry = now + this.tokenExpiryDays * 24 * 3600
    return {
      token: sign({ sub: String(user.id), exp: expiry, iat: now, ver: user.token_version ?? 0 }, this.jwtSecret),
      expiresIn: this.tokenExpiryDays * 24 * 3600,
    }
  }

  // The token must carry the user's current version, so a password change
  // ends every session that was signed with the old one.
  verifyToken(token) {
    if (typeof token !== 'string') return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, body, signature] = parts
    const expected = createHash('sha256').update(`${header}.${body}`).digest('base64url')
    if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) return null
    let payload
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch {
      return null
    }
    const now = Math.floor(Date.now() / 1000)
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null
    if (typeof payload.iat !== 'number' || payload.iat > now + 60) return null
    if (typeof payload.sub !== 'string') return null
    return payload
  }
}

// Compare without leaking the length of the answer through timing.
const timingSafeEqual = (a, b) => {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0)
  }
  return diff === 0
}
