// Released macOS and deb clients require the legacy asset name before showing an update.
// Publish an alias of the new payload under every name they know; all normal downloads
// use Nova-Bots-*.
import { copyFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { LEGACY_ARTIFACT_PREFIXES } from '../src/legacy.mjs'

for (const file of process.argv.slice(2)) {
  const name = basename(file)
  if (!/^Nova-Bots-.+-(?:mac-(?:arm64|x64)\.zip|linux-amd64\.deb)$/u.test(name)) throw new Error(`Unsupported release alias: ${name}`)
  for (const prefix of LEGACY_ARTIFACT_PREFIXES) {
    const alias = join(dirname(file), name.replace(/^Nova-Bots/u, prefix))
    copyFileSync(file, alias)
    console.log(alias)
  }
}
