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

// The script deep-view puts in the frame of a widget, read from the installed package, so
// the hash the policy carries cannot drift away from it: a deep-view release that changes
// the script fails this suite instead of quietly breaking every widget.
const frameScriptText = async (html = '', vars = {}) => {
  const { frameDocument } = await import('deep-view/react')
  const doc = frameDocument(html, vars)
  const match = /<script>([\s\S]*?)<\/script>/u.exec(doc)
  assert.ok(match !== null, 'deep-view builds no frame script')
  return match[1]
}
const frameScriptHash = async (html = '', vars = {}) => `'sha256-${hashOf(await frameScriptText(html, vars))}'`

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
  // The page's own scripts, plus the one constant script of the deep-view frame, which
  // lives in the frame's document and is not one of the page's scripts.
  const frameHash = await frameScriptHash()
  assert.equal(hashes.length, scripts.length + 1, 'the tap does not hash every inline script')
  for (const script of scripts) {
    assert.equal(hashes.includes(`'sha256-${hashOf(script)}'`), true, 'a hash does not match its script')
  }
  // The script directive is an exact list: the same origin, the page's own scripts and the
  // frame script, and nothing else.
  assert.deepEqual([...scriptSrc].sort(), ["'self'", ...scripts.map(script => `'sha256-${hashOf(script)}'`), frameHash].sort(),
    'the script directive allows something else')
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

test('a directive in another case, or carried twice, is rewritten as well', async () => {
  const module = await import('../src/csp.mjs').catch(() => null)
  assert.ok(module !== null, 'app/src/csp.mjs is missing')
  const tap = module.cspTap ?? Object.values(module).find(value => typeof value === 'function')
  const page = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; SCRIPT-SRC \'self\' \'unsafe-inline\'; script-src \'unsafe-inline\'; script-src \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'">',
    '</head>',
    '<body>',
    '<script>globalThis.__DSH_BOOT__ = { a: 1 }</script>',
    '</body>',
    '</html>',
  ].join('\n')

  let served = await tap(page)
  if (typeof served === 'function') served = await served(page)
  const html = typeof served === 'string' ? served : String(served)
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/u.exec(html)
  assert.ok(meta !== null, 'the tap dropped the policy')
  const scriptDirectives = meta[1].split(';').map(directive => directive.trim())
    .filter(directive => /^script-src(\s|$)/iu.test(directive))
  // Neither the other case nor the second copy may keep a rule of its own.
  assert.equal(scriptDirectives.length, 3, 'the tap dropped a copy of the directive')
  for (const directive of scriptDirectives) {
    assert.equal(directive.startsWith('script-src \'self\' '), true, directive)
    assert.equal(directive.includes('unsafe-inline'), false, directive)
    assert.equal(directive.includes('*'), false, directive)
    // The frame script is allowed in every copy of the directive.
    assert.equal(directive.includes(await frameScriptHash()), true, directive)
  }
  // The style directive is untouched: styles stay inline.
  assert.equal(meta[1].includes('style-src \'self\' \'unsafe-inline\''), true)
})

test('the served policy allows the frame script of deep-view by the hash of the installed package', async () => {
  const module = await import('../src/csp.mjs')
  const tap = module.cspTap()
  const page = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob: https:; connect-src \'self\'">',
    '</head>',
    '<body>',
    '<script>globalThis.__DSH_BOOT__ = { a: 1 }</script>',
    '</body>',
    '</html>',
  ].join('\n')

  const policy = policyOf(tap(page))
  const scriptSrc = policy.get('script-src') ?? []
  const expected = await frameScriptHash()

  assert.equal(scriptSrc.includes(expected), true, 'the served policy does not allow the frame script')
  assert.equal(scriptSrc.includes('\'unsafe-inline\''), false, 'the served policy allows inline scripts')
  assert.equal(scriptSrc.includes('*'), false, 'the served policy allows a wildcard')
  // The script directive is an exact list: the same origin, the page's own script and the
  // frame script, and nothing else.
  assert.deepEqual([...scriptSrc].sort(), ["'self'", `'sha256-${hashOf('globalThis.__DSH_BOOT__ = { a: 1 }')}'`, expected].sort(),
    'the script directive allows something else')
  // The other directives are not touched by the frame hash.
  assert.deepEqual(policy.get('style-src'), ['\'self\'', '\'unsafe-inline\''], 'the style directive changed')
  assert.deepEqual(policy.get('default-src'), ['\'self\''])
  assert.deepEqual(policy.get('connect-src'), ['\'self\''])
  assert.deepEqual(policy.get('img-src'), ['\'self\'', 'data:', 'blob:', 'https:'])
})

test('the frame script does not depend on the widget, so one hash covers every widget', async () => {
  const benign = await frameScriptText('<p>a chart</p>')
  const hostile = await frameScriptText('<script>alert(1)</script><img src="x" onerror="alert(1)">')
  // The widget's own markup is not part of the script, so the hash of one widget is the
  // hash of every widget. If a deep-view release started to interpolate the widget into the
  // script, this fails and the fix has to be redesigned rather than re-pinned.
  assert.equal(hostile, benign, 'the frame script depends on the widget')
  assert.equal(await frameScriptHash('<p>another widget</p>'), await frameScriptHash())
  // The theme variables are written into the frame's own style rule, not into its script,
  // so even a hostile value leaves the script and its hash untouched.
  const hostileVars = { ink: '</script><script>alert(1)</script>', card: "');alert(1);//" }
  assert.equal(await frameScriptText('<p>a chart</p>', hostileVars), benign, 'the frame script depends on the theme variables')
  assert.equal(await frameScriptHash('<p>a chart</p>', hostileVars), await frameScriptHash(), 'the frame script hash depends on the theme variables')
})
