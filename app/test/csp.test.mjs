// The policy of the page: the app's own UI is served by the Host, and the runtime injects
// its own inline boot scripts (contact config, ModuleLoader, boot payload, connection
// recovery, theme) into that index. Inline scripts must not be allowed as a whole: the page
// renders bot chat and web content, so 'unsafe-inline' in script-src would reopen XSS.
//
// The way out is the runtime's own public hook: webServer.tapIndex. The tap sees the served
// index, hashes every inline script the Host injected (sha256, base64) and writes exactly
// those hashes into the page's own policy, per response. So the policy allows the Host's
// scripts and nothing else, and it stays correct when the injected text changes.
//
// This test pins that: 'unsafe-inline' in script-src is a failure, the tap hashes every
// inline script, the other directives do not widen, and the policy comes first in <head>
// (the Host splices its rows right after the opening <head> tag).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const policyOf = html => {
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/u.exec(html)
  assert.ok(meta !== null, 'the page carries a Content-Security-Policy')
  const directives = new Map()
  for (const part of meta[1].split(';')) {
    const tokens = part.trim().split(/\s+/u).filter(token => token !== '')
    if (tokens.length === 0) continue
    directives.set(tokens[0], tokens.slice(1))
  }
  return directives
}

const inlineScripts = html => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gu)].map(match => match[1])
const hashOf = text => createHash('sha256').update(text, 'utf8').digest('base64')

const source = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')

test('the page does not allow inline scripts', () => {
  const policy = policyOf(source)
  assert.deepEqual(policy.get('script-src'), ['\'self\''], 'script-src may not allow inline scripts')
  assert.equal(policy.get('script-src')?.includes('\'unsafe-inline\''), false)
  assert.equal(policy.get('script-src')?.some(source_ => source_.includes('*')), false)
})

test('the page allows only the Host\'s own hashed scripts', () => {
  const policy = policyOf(source)
  assert.equal(policy.get('default-src')?.includes('*'), false)
  assert.equal(policy.get('connect-src')?.includes('*'), false)
  for (const [directive, sources] of policy) {
    assert.equal(sources.includes('*'), false, `${directive} may not allow a wildcard`)
    // Styles stay inline: the Host injects a style row of its own.
    assert.equal(sources.includes('\'unsafe-inline\''), directive === 'style-src', `${directive} may not allow inline`)
  }
})

test('the policy comes first in the head, so it governs the injected rows', () => {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/u.exec(source)
  assert.ok(head !== null, 'the page has a head')
  const first = /<([a-zA-Z][a-zA-Z0-9-]*)/u.exec(head[1].trim())
  assert.equal(first?.[1], 'meta', 'the first thing in the head is not an element')
  const meta = /<meta\s+http-equiv="Content-Security-Policy"/u.exec(head[1])
  assert.ok(meta !== null, 'the head carries no Content-Security-Policy')
  const firstScript = head[1].indexOf('<script')
  assert.equal(firstScript === -1 || meta.index < firstScript, true, 'the policy comes after a script')
})

test('the built page does not allow inline scripts either', (t) => {
  const built = new URL('../ui/dist/index.html', import.meta.url)
  if (!existsSync(built)) {
    t.skip('the page is not built here')
    return
  }
  const policy = policyOf(readFileSync(built, 'utf8'))
  assert.equal(policy.get('script-src')?.includes('\'unsafe-inline\''), false, 'the built page allows inline scripts')
  assert.equal(policy.get('script-src')?.includes('*'), false)
})

test('the tap hashes every inline script and widens nothing else', async () => {
  const module = await import('../src/csp.mjs').catch(() => null)
  assert.ok(module !== null, 'app/src/csp.mjs is missing')
  const tap = module.cspTap ?? Object.values(module).find(value => typeof value === 'function')
  assert.equal(typeof tap, 'function', 'app/src/csp.mjs exports no transform')
  const page = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob: https:; connect-src \'self\'">',
    '<title>Nova Bots</title>',
    '</head>',
    '<body>',
    '<script>globalThis.__DSH_BOOT__ = { a: 1 }</script>',
    '<script>globalThis.__DSH_THEME__ = "dark"</script>',
    '<script type="module" src="./assets/index.js"></script>',
    '</body>',
    '</html>',
  ].join('\n')

  // The tap may be exported as a factory (cspTap) or as the transform itself.
  let served = await tap(page)
  if (typeof served === 'function') served = await served(page)
  const html = typeof served === 'string' ? served : String(served)
  const policy = policyOf(html)
  const scriptSrc = policy.get('script-src') ?? []

  assert.equal(scriptSrc.includes('\'unsafe-inline\''), false, 'the tap allows inline scripts')
  assert.equal(scriptSrc.includes('*'), false, 'the tap allows a wildcard')
  assert.equal(scriptSrc.includes('\'self\''), true, 'the tap drops the same-origin scripts')

  const scripts = inlineScripts(html)
  assert.equal(scripts.length, 2, 'the tap changed the scripts of the page')
  const hashes = scriptSrc.filter(source_ => source_.startsWith('\'sha256-') && source_.endsWith('\''))
  assert.equal(hashes.length, scripts.length, 'the tap does not hash every inline script')
  for (const script of scripts) {
    assert.equal(hashes.includes(`'sha256-${hashOf(script)}'`), true, 'a hash does not match its script')
  }
  // The external script is same-origin, so it is covered by 'self' and gets no hash.
  assert.equal(/<script type="module" src="\.\/assets\/index\.js"><\/script>/u.test(html), true)

  assert.deepEqual(policy.get('default-src'), ['\'self\''])
  assert.deepEqual(policy.get('connect-src'), ['\'self\''])
  assert.deepEqual(policy.get('img-src'), ['\'self\'', 'data:', 'blob:', 'https:'])
  assert.deepEqual(policy.get('style-src'), ['\'self\'', '\'unsafe-inline\''])

  const head = /<head[^>]*>([\s\S]*?)<\/head>/u.exec(html)
  assert.ok(head !== null)
  const meta = /<meta\s+http-equiv="Content-Security-Policy"/u.exec(head[1])
  assert.ok(meta !== null, 'the tap dropped the policy')
  assert.equal(head[1].trimStart().startsWith('<meta http-equiv="Content-Security-Policy"'), true,
    'the policy does not come first in the head')
})
