#!/usr/bin/env node
// Gives every existing account its own tenant — never the shared engine —
// and maps the shared engine to its owner (the admin).
//
//   node tenants-backfill.mjs --dry-run      # show what would happen, change nothing
//   node tenants-backfill.mjs                # create the tenants table and rows (ports)
//   node tenants-backfill.mjs --provision    # ...and create each container + volumes (not started)
//
// Reads the same env as the portal (portal.env): NOVA_DATABASE_URL and the
// NOVA_TENANT_* settings. Accounts created later get their tenant at sign-up,
// and the portal runs the same backfill on every start with tenancy on, so
// running this is optional; it lets the operator see the mapping first.

import pg from 'pg'
import { Tenants, tenancyConfigFromEnv } from './tenants.mjs'
import { EngineCookieJar } from './bridge.mjs'

const args = new Set(process.argv.slice(2))
const databaseUrl = process.env.NOVA_DATABASE_URL
if (!databaseUrl) {
  console.error('NOVA_DATABASE_URL must be set (source portal.env first)')
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
const config = tenancyConfigFromEnv()

try {
  if (args.has('--dry-run')) {
    const users = (await pool.query('SELECT id, email, system_role, is_forbidden, created_at FROM users ORDER BY created_at')).rows
    const exists = (await pool.query("SELECT to_regclass('public.tenants') AS t")).rows[0].t !== null
    const mapped = exists ? new Map((await pool.query('SELECT user_id, kind, container FROM tenants')).rows.map(r => [r.user_id, r])) : new Map()
    const legacyOwner = config.legacyEmail
      ? users.find(u => u.email.toLowerCase() === config.legacyEmail)
      : users.find(u => u.system_role === 'admin')
    console.log(`tenants table: ${exists ? 'present' : 'will be created'}; shared engine "${config.legacyContainer}" -> ${legacyOwner?.email ?? '(no admin found)'}`)
    for (const user of users) {
      const row = mapped.get(user.id)
      const plan = user.is_forbidden ? 'skip (forbidden)'
        : row ? `exists (${row.kind}, ${row.container})`
        : user.id === legacyOwner?.id ? 'map to the shared engine (legacy)'
        : `new isolated tenant (${config.prefix}<id>)`
      console.log(`  ${user.system_role.padEnd(5)} ${user.email.padEnd(44)} ${plan}`)
    }
    process.exit(0)
  }
  const tenants = new Tenants({
    pool,
    config,
    jar: new EngineCookieJar(),
    legacyToken: async () => null,
    audit: async (entry) => {
      await pool.query('INSERT INTO audit_log (action, actor, target, ok, ip, detail) VALUES ($1, $2, $3, true, $4, $5)',
        [entry.action, entry.actor ?? 'backfill', entry.target ?? null, 'cli', JSON.stringify(entry.detail ?? {})]).catch(() => {})
    },
  })
  await tenants.migrate()
  const result = await tenants.backfill({ provision: args.has('--provision') })
  console.log(JSON.stringify({
    legacy: result.legacy,
    created: result.created.map(c => c.email),
    existing: result.existing.map(c => `${c.email} (${c.kind})`),
    provisioned: result.provisioned.length,
    failed: result.failed,
  }, null, 2))
  process.exit(result.failed.length ? 2 : 0)
} finally {
  await pool.end().catch(() => {})
}
