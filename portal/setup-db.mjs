#!/usr/bin/env node
// Prepare the Nova Bots account database on the shared Postgres server.
//
//   node setup-db.mjs
//
// Three steps:
//   1. create the `nova_bots` database if it is not there yet
//   2. create the `users` table
//   3. import the accounts that already exist, so the same email and password
//      work here as everywhere else on this machine
//
// The import reads once and writes into Nova Bots' own database. After it
// runs, nothing here depends on the other application's tables any more.

import { Client } from 'pg'
import { Auth } from './auth.mjs'

const adminUrl = process.env.NOVA_ADMIN_DATABASE_URL
const databaseUrl = process.env.NOVA_DATABASE_URL
const sourceUrl = process.env.NOVA_SOURCE_DATABASE_URL

if (!adminUrl || !databaseUrl) {
  console.error('NOVA_ADMIN_DATABASE_URL and NOVA_DATABASE_URL must be set')
  process.exit(1)
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '')

// 1. the database itself
const admin = new Client({ connectionString: adminUrl })
await admin.connect()
const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName])
if (existing.rowCount === 0) {
  await admin.query(`CREATE DATABASE "${databaseName}"`)
  console.log(`created the database ${databaseName}`)
} else {
  console.log(`the database ${databaseName} exists`)
}
await admin.end()

// 2. the table
const auth = new Auth({ databaseUrl, jwtSecret: process.env.NOVA_JWT_SECRET || 'setup-db-does-not-sign-sessions' })
await auth.migrate()
console.log('the users table is ready')

// 3. the accounts that already exist
if (sourceUrl) {
  const source = new Client({ connectionString: sourceUrl })
  await source.connect()
  const { rows } = await source.query(
    `SELECT id, email, password_hash, system_role, token_version, needs_setup, is_forbidden, created_at, last_sign_in_at
       FROM users`,
  )
  await source.end()

  let imported = 0
  let skipped = 0
  for (const row of rows) {
    if (!/^[0-9a-f-]{36}$/i.test(String(row.id))) {
      skipped += 1
      continue
    }
    const result = await auth.pool.query(
      `INSERT INTO users (id, email, password_hash, system_role, token_version, needs_setup, is_forbidden, created_at, last_sign_in_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()), $9)
       ON CONFLICT (email) DO NOTHING`,
      [row.id, row.email, row.password_hash, row.system_role ?? 'user', row.token_version ?? 0,
        row.needs_setup === true, row.is_forbidden === true, row.created_at, row.last_sign_in_at],
    )
    if (result.rowCount > 0) imported += 1
    else skipped += 1
  }
  console.log(`imported ${imported} accounts, skipped ${skipped}`)
}

await auth.pool.end()
