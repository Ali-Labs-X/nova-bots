// The page's own script policy, hashed per response. The Host serves the app's own UI and
// injects its own boot scripts into the served index: its boot payload, its module loader, the
// theme script, the connection recovery. Those blocks follow the user's state (the theme
// preference, the module graph), so a hash list frozen at build time stops matching the first
// time the user switches the theme. The Host renders the page and then runs the index taps
// (webServer.tapIndex); this tap is one of them, so it sees the finished page and writes the
// hashes of exactly those blocks into the page's own policy. The page keeps a strict script
// policy: an inline script is allowed only as the hash of the Host's own block, and
// 'unsafe-inline' is nowhere.
import { createHash } from 'node:crypto'

const META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/u
const HEAD = /<head(?:\s[^>]*)?>/iu
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu

/**
 * The hashes of the inline scripts of a served page, one per script.
 * @param {string} html - the served page.
 * @returns {string[]} the CSP source expressions, each `'sha256-…'`
 */
export function scriptHashes(html) {
  const hashes = []
  for (const [, attributes, text] of html.matchAll(SCRIPT)) {
    // A script with a source is same-origin and needs no hash.
    if (/\bsrc\s*=/u.test(attributes)) continue
    hashes.push(`'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`)
  }
  return hashes
}

/**
 * The page's policy with the hashes of its inline scripts in the script directive.
 * @param {string} content - the content of the page's policy meta.
 * @param {string[]} hashes - the hashes of the inline scripts.
 * @returns {string} the new content of the policy meta
 */
export function policyWithHashes(content, hashes) {
  const directives = content.split(';').map(directive => directive.trim()).filter(directive => directive !== '')
  const scriptSrc = ["'self'", ...hashes].join(' ')
  const script = directives.find(directive => directive.startsWith('script-src'))
  if (script === undefined) directives.push(`script-src ${scriptSrc}`)
  else directives[directives.indexOf(script)] = `script-src ${scriptSrc}`
  return directives.join('; ')
}

/**
 * The index transform that keeps the page's script policy exact: it hashes the inline
 * scripts the Host injected and puts the policy first inside the head, so that it governs
 * them (the Host splices its rows right after the opening head tag).
 * @param {string} html - the served page.
 * @returns {string} the page with its own policy
 */
export function cspTransform(html) {
  const meta = META.exec(html)
  const hashes = scriptHashes(html)
  const content = policyWithHashes(meta === null ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'" : meta[1], hashes)
  const tag = `<meta http-equiv="Content-Security-Policy" content="${content}">`
  const withoutMeta = meta === null ? html : html.replace(meta[0], '')
  const head = HEAD.exec(withoutMeta)
  if (head === null) return tag + withoutMeta
  const at = head.index + head[0].length
  return withoutMeta.slice(0, at) + tag + withoutMeta.slice(at)
}

/**
 * The index tap for the Host's web server.
 * @returns {(html: string) => string} the transform the web server runs on every index response
 */
export function cspTap() {
  return cspTransform
}
