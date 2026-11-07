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
// A directive name is case-insensitive, and a page may carry the same directive twice.
const SCRIPT_SRC = /^script-src(\s|$)/iu
const SCRIPT_SRC_ELEM = /^script-src-elem(\s|$)/iu
const SCRIPT_SRC_ATTR = /^script-src-attr(\s|$)/iu

// The frame of a deep-view widget is built from srcDoc, so it inherits this policy: the
// frame's own 'unsafe-inline' meta cannot widen what the parent allows. Its one script
// reports the frame's height and takes the theme, so the page has to allow that script by
// its hash. The text is a constant of the package (deep-view@0.1.0,
// deep-view/src/react/frame.js:57-63: the report constant at 57-59, emitted into the
// script at 63), the same in every widget, so one hash covers them all; the test recomputes
// it from the installed package, so an upgrade that changes the script fails the suite
// instead of quietly breaking every widget. The reporter touches only its own frame
// document: it measures it with document.documentElement.getBoundingClientRect() and applies
// the theme variables with document.documentElement.style.setProperty. It reads no cookie
// and no storage, makes no fetch, and reaches the parent only through postMessage, so a
// sandboxed srcDoc frame cannot read the parent's DOM. Inside the frame the package's own
// FRAME_POLICY still holds (network 'none', form-action 'none', base-uri 'none'), so a
// widget's own scripts stay blocked as they were. The hash is in every policy the Host
// serves at this origin, because policyWithHashes writes it. Remove it when deep-view drops
// the frame script or when the widgets get an origin of their own.
const FRAME_SCRIPT_HASH = "'sha256-TVZuUzC0FWndTimxq1xE1m8oWb7sPIhF6U/2XJDkdUA='"

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
  const scriptSrc = ["'self'", ...hashes, FRAME_SCRIPT_HASH].join(' ')
  const indexes = []
  for (const [index, directive] of directives.entries()) {
    if (SCRIPT_SRC.test(directive)) indexes.push(index)
  }
  if (indexes.length === 0) directives.push(`script-src ${scriptSrc}`)
  // Every copy of the directive is rewritten: a page that carries it twice, or in
  // another case, must not keep a wider rule of its own.
  for (const index of indexes) directives[index] = `script-src ${scriptSrc}`
  // The two finer directives of CSP level 3 take precedence over script-src, so a page that
  // carries one of them could widen the script policy the page is served under. Neither is
  // used in our tree, so both are clamped to what script-src already implies.
  // script-src-elem gets the same list as script-src: 'none' there would block the Host's
  // own hashed inline scripts and the frame script of a widget.
  // script-src-attr gets 'none', which is what script-src already implies here, because the
  // script policy has no 'unsafe-inline'.
  for (const [index, directive] of directives.entries()) {
    if (SCRIPT_SRC_ELEM.test(directive)) directives[index] = `script-src-elem ${scriptSrc}`
    else if (SCRIPT_SRC_ATTR.test(directive)) directives[index] = "script-src-attr 'none'"
  }
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
