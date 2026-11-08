// The scan's own package rule, guarded.
//
// The rule exists so the plugin cannot quietly fall back to a name the product no
// longer uses: the desktop app's profile bundles the plugin under its package name,
// the release publishes it under that name, and the update check reads the
// repository the package names. A rule that hard-coded the retired name was a stale
// expectation, not a finding, and it failed a correct package.
//
// These tests pin both halves: the scan accepts the package's current name, and it
// still refuses the retired one — and the name it demands is the package's own
// name, read from the package, so a rename cannot pass unnoticed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const scan = join(here, 'scan.mjs')
const currentName = JSON.parse(readFileSync(join(here, '..', 'ds-bot', 'package.json'), 'utf8')).name

// A tree with what the package rule reads and nothing else, so the other rules have
// nothing to say about it.
function treeWith(name) {
  const root = mkdtempSync(join(tmpdir(), 'scan-package-'))
  mkdirSync(join(root, 'ds-bot'), { recursive: true })
  writeFileSync(join(root, 'ds-bot', 'package.json'), JSON.stringify({
    name,
    version: '0.0.0',
    license: 'Apache-2.0',
    repository: { type: 'git', url: 'https://example.invalid/nova-bots.git' },
    homepage: 'https://example.invalid/nova-bots',
    bugs: { url: 'https://example.invalid/nova-bots/issues' },
    files: ['LICENSE'],
  }, null, 2))
  writeFileSync(join(root, 'ds-bot', 'LICENSE'), 'Apache-2.0\n')
  return root
}

// The must-fix findings of the package rule, the way the scan reports them.
function packageFindings(root) {
  const out = join(mkdtempSync(join(tmpdir(), 'scan-report-')), 'findings.json')
  try {
    execFileSync(process.execPath, [scan, root, '--json', out], { encoding: 'utf8' })
  } catch (error) {
    // The scan exits 1 when it has must-fix findings; that is what this test reads.
    if (error.status !== 1) throw error
  }
  return JSON.parse(readFileSync(out, 'utf8')).filter(finding => finding.level === 'must fix' && finding.id === 'package')
}

test('the scan accepts the package name the plugin carries', () => {
  assert.deepEqual(packageFindings(treeWith(currentName)), [])
})

test('the scan still refuses the retired package name, and asks for the current one', () => {
  const findings = packageFindings(treeWith('ds-bot'))
  assert.equal(findings.length, 1, 'the retired name is refused')
  assert.equal(findings[0].file, 'ds-bot/package.json')
  assert.equal(findings[0].text, `name is "ds-bot", expected "${currentName}"`)
})

// The rebrand once committed a runtime home (data/, with .credentials.yaml and
// .launch-token) and the scan did not notice.
test('the scan refuses a committed runtime home and its credentials', () => {
  const root = treeWith(currentName)
  mkdirSync(join(root, 'data', 'bot'), { recursive: true })
  writeFileSync(join(root, 'data', 'bot', 'state.json'), '{}')
  mkdirSync(join(root, 'docker', 'nova'), { recursive: true })
  writeFileSync(join(root, 'docker', 'nova', '.launch-token'), 'x')
  writeFileSync(join(root, 'docker', 'nova', '.credentials.yaml'), 'x')
  const out = join(mkdtempSync(join(tmpdir(), 'scan-report-')), 'findings.json')
  try { execFileSync(process.execPath, [scan, root, '--json', out]) } catch (error) { if (error.status !== 1) throw error }
  const files = JSON.parse(readFileSync(out, 'utf8')).filter(f => f.id === 'forbidden-file').map(f => f.file).sort()
  assert.deepEqual(files, ['data/bot/state.json', 'docker/nova/.credentials.yaml', 'docker/nova/.launch-token'])
})
