import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Arch } from 'electron-builder'
import { archProblem, beforePack, officeRuntimeRequest } from '../scripts/before-pack.mjs'
import { runtimeTarget } from '../scripts/prepare-runtime.mjs'

test('a build for the architecture of this Node goes on', async () => {
  assert.equal(archProblem({ target: 'arm64', platform: 'darwin', host: 'arm64' }), undefined)
  assert.equal(archProblem({ target: 'x64', platform: 'win32', host: 'x64' }), undefined)
  const asked = []
  const built = []
  const packager = { projectDir: 'app-dir', appInfo: { version: '0.0.0' } }
  await beforePack({ arch: Arch[process.arch], electronPlatformName: process.platform, packager },
    async (request) => { asked.push(request) },
    async () => { built.push(true) })
  assert.equal(asked.length, 1)
  assert.equal(asked[0].target, runtimeTarget(process.platform, process.arch))
  assert.equal(asked[0].output, join('app-dir', 'build', 'runtime'))
  assert.equal(built.length, 1, 'the UI is built before the files are collected')
})

test('a build for another architecture stops and says where to build it', async () => {
  assert.equal(archProblem({ target: 'x64', platform: 'darwin', host: 'arm64' }),
    'This Node runs on arm64, so npm installed arm64 native modules, and an x64 app with them would not start. Install the dependencies and build on an Intel Mac, or under Rosetta with an x64 Node.')
  assert.match(archProblem({ target: 'arm64', platform: 'darwin', host: 'x64' }), /build on a Mac with Apple silicon\.$/)
  assert.match(archProblem({ target: 'x64', platform: 'win32', host: 'arm64' }), /build with an x64 Node\.$/)
  assert.match(archProblem({ target: 'universal', platform: 'darwin', host: 'arm64' }), /Build one app per architecture\./)
  const other = process.arch === 'x64' ? 'arm64' : 'x64'
  await assert.rejects(beforePack({ arch: Arch[other], electronPlatformName: process.platform }), new RegExp(`an ${other} app with them would not start`))
})

test('a requested universal build stops before packing either architecture', async () => {
  // electron-builder's MacPackager.doUniversalPack packs x64 then arm64: the hook sees a concrete
  // arch each time, and the universal request only shows in packager.packagerOptions.targets.
  const packager = { packagerOptions: { targets: new Map([[{ nodeName: 'darwin' }, new Map([[Arch.universal, ['dmg']]])]]) } }
  await assert.rejects(beforePack({ arch: Arch.x64, electronPlatformName: 'darwin', packager }), /Build one app per architecture\./)
  await assert.rejects(beforePack({ arch: Arch.arm64, electronPlatformName: 'darwin', packager }), /Build one app per architecture\./)
})

test('electron-builder runs the check before it packs', () => {
  assert.match(readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'), /^beforePack: \.\/scripts\/before-pack\.mjs$/m)
})

test('the package carries the app\'s own UI, in the asar and unpacked beside it', () => {
  const config = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  // The Host serves app/ui/dist, so the package must contain the built dist.
  assert.match(config, /^\s+- ui\/dist\/\*\*$/m, 'the built UI is not in the packaged files')
  // The Host is a plain Node process and cannot read inside the asar, so the dist must be
  // unpacked next to it; app/src/main.mjs points at app.asar.unpacked for exactly that.
  assert.match(config, /^asarUnpack:\r?\n(?:[^\n]*\r?\n)*?\s+- ui\/dist\/\*\*$/m, 'the built UI is not unpacked from the asar')
})

test('the release builds the UI once, in beforePack', () => {
  // electron-builder's beforePack hook builds the UI (buildUi), so a separate build step in
  // the release workflow would build it a second time.
  const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.equal(/- run: npm run build$/mu.test(workflow), false, 'the workflow builds the UI a second time')
})

test('the Office payload goes next to the asar for a platform the lock pins', () => {
  const request = officeRuntimeRequest({ arch: Arch.x64, electronPlatformName: 'win32', packager: { projectDir: 'app-dir', appInfo: { version: '9.9.9' } } })
  assert.equal(request.target, 'win-x64')
  assert.equal(request.version, '9.9.9')
  assert.equal(request.output, join('app-dir', 'build', 'runtime'))
  assert.throws(() => officeRuntimeRequest({ arch: Arch.arm64, electronPlatformName: 'win32', packager: { projectDir: 'app-dir' } }), /No Office runtime payload for win32 arm64/)
  assert.match(readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'), /from: build\/runtime\/primary-runtime\r?\n\s+to: primary-runtime/u)
})
