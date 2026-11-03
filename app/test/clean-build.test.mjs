import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// The app's UI imports the plugin's client source from ../ds-bot (ds-bot/src/client),
// and that source imports packages the plugin declares (deep-view/react). A clean
// checkout has no ds-bot/node_modules, so those imports can only resolve from the
// app's own node_modules -- which vite's resolve.dedupe is there to arrange.
// Without it the release build fails the same way CI would:
//   Rolldown failed to resolve import "deep-view/react" from ds-bot/src/client/widget-cell.js
// So the build is checked here in a copy of the tree that has no node_modules anywhere.

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(appDir, '..')

// The tree as it stands, tracked files plus the untracked ones that are not ignored:
// the working tree is what the branch ships, not only what is committed.
function trackedFiles(root) {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' })
  if (listed.status !== 0) return null
  return listed.stdout.split('\0').filter(Boolean)
}

function copyTree(root, out) {
  const files = trackedFiles(root)
  if (files === null) return false
  for (const file of files) {
    const from = join(root, file)
    if (!existsSync(from)) continue
    const to = join(out, file)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  return true
}

// npm ci needs the network. When there is none the test says so and stops
// instead of failing a build that was never attempted.
function networkFailure(result) {
  const text = `${result.stderr || ''}${result.stdout || ''}`
  return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|EAI_NONAME|ECONNRESET|network|registry/i.test(text)
}

// npm test runs every test in this folder, and this one installs packages and
// builds the app: it needs the network and a couple of minutes. So it stands
// apart from the ordinary gate and runs when it is asked for:
//   NOVA_APP_CLEAN_BUILD=1 npm test
test('the app builds in a tree that has no node_modules anywhere', { timeout: 20 * 60 * 1000 }, (t) => {
  if (process.env.NOVA_APP_CLEAN_BUILD !== '1') {
    t.skip('set NOVA_APP_CLEAN_BUILD=1 to run it: it installs packages and builds the app')
    return
  }
  const npm = spawnSync('npm', ['--version'], { encoding: 'utf8' })
  if (npm.status !== 0) {
    t.skip('npm is not available here')
    return
  }

  const out = mkdtempSync(join(tmpdir(), 'nova-app-clean-build-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))

  if (!copyTree(repoRoot, out)) {
    t.skip('the tree is not a git checkout, so the clean copy cannot be made')
    return
  }
  // The point of the copy: the plugin directory has no modules of its own.
  assert.equal(existsSync(join(out, 'ds-bot', 'node_modules')), false, 'the copy still has ds-bot/node_modules')
  assert.equal(existsSync(join(out, 'app', 'node_modules')), false, 'the copy still has app/node_modules')

  const installed = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: join(out, 'app'),
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
  })
  if (installed.status !== 0) {
    if (networkFailure(installed)) {
      t.skip(`npm ci could not reach the registry: ${(installed.stderr || '').trim().split('\n').slice(-1)[0]}`)
      return
    }
    assert.fail(`npm ci failed in the clean copy:\n${(installed.stderr || installed.stdout || '').trim().split('\n').slice(-20).join('\n')}`)
  }

  // The app's own deep-view must be the one the plugin requires, and it must be
  // the one the build resolves: the plugin directory has none.
  const appPkg = JSON.parse(readFileSync(join(out, 'app', 'package.json'), 'utf8'))
  const pluginPkg = JSON.parse(readFileSync(join(out, 'ds-bot', 'package.json'), 'utf8'))
  assert.equal(appPkg.dependencies['deep-view'], pluginPkg.dependencies['deep-view'],
    'the app and the plugin must ask for the same deep-view')
  assert.equal(existsSync(join(out, 'app', 'node_modules', 'deep-view')), true,
    'deep-view was not installed in the app')

  const built = spawnSync(process.execPath, [join('node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: join(out, 'app'),
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
  })
  if (built.status !== 0) {
    const log = `${(built.stderr || built.stdout || '').trim()}`
    assert.fail(`the UI did not build in the clean copy:\n${log.split('\n').slice(-25).join('\n')}`)
  }

  const assets = join(out, 'app', 'ui', 'dist', 'assets')
  assert.equal(existsSync(join(out, 'app', 'ui', 'dist', 'index.html')), true, 'the build wrote no index.html')
  const bundle = readdirSync(assets).filter(name => name.endsWith('.js'))
    .map(name => readFileSync(join(assets, name), 'utf8')).join('\n')
  assert.match(bundle, /dv-view-frame/, 'the deep-view widget code is missing from the built UI')
})
