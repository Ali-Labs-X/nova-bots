// One-time migration for profiles that still carry the old plugin package.
// It backs up the profile, removes the old dependency and bundle entry, and
// lets the entrypoint install the Nova Bots package in its place.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [mode, profileArg] = process.argv.slice(2)
const profile = profileArg ?? '/data/profiles/web'
const packagePath = join(profile, 'package.json')
const lockPath = join(profile, 'pnpm-lock.yaml')
const modulesPath = join(profile, 'node_modules')
const backupDir = join(profile, '.nova-migration')
const backupPackage = join(backupDir, 'package.json')
const backupLock = join(backupDir, 'pnpm-lock.yaml')
const backupModules = join(backupDir, 'node_modules')

const readPackage = () => JSON.parse(readFileSync(packagePath, 'utf8'))
const writePackage = (value) => writeFileSync(packagePath, `${JSON.stringify(value, null, 2)}\n`)

if (mode === 'prepare') {
  if (!existsSync(packagePath)) process.exit(2)
  const pkg = readPackage()
  const bundles = pkg.dsh?.profile?.bundles ?? []
  if (!pkg.dependencies?.['ds-bot'] && !bundles.includes('ds-bot')) process.exit(2)

  rmSync(backupDir, { recursive: true, force: true })
  mkdirSync(backupDir, { recursive: true })
  copyFileSync(packagePath, backupPackage)
  if (existsSync(modulesPath)) renameSync(modulesPath, backupModules)
  if (existsSync(lockPath)) renameSync(lockPath, backupLock)

  if (pkg.dependencies) delete pkg.dependencies['ds-bot']
  if (Array.isArray(pkg.dsh?.profile?.bundles)) {
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((name) => name !== 'ds-bot')
  }
  writePackage(pkg)
  console.log('nova migration: profile prepared')
} else if (mode === 'finish') {
  rmSync(backupDir, { recursive: true, force: true })
  console.log('nova migration: profile finished')
} else if (mode === 'rollback') {
  if (!existsSync(backupPackage)) process.exit(0)
  rmSync(modulesPath, { recursive: true, force: true })
  rmSync(lockPath, { force: true })
  copyFileSync(backupPackage, packagePath)
  if (existsSync(backupModules)) renameSync(backupModules, modulesPath)
  if (existsSync(backupLock)) renameSync(backupLock, lockPath)
  rmSync(backupDir, { recursive: true, force: true })
  console.log('nova migration: profile rolled back')
} else {
  console.error('usage: migrate-plugin.mjs prepare|finish|rollback [profile]')
  process.exit(1)
}
