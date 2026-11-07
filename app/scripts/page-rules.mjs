// The page the app window shows, and the rules that describe it.
//
// The app serves its own UI at the Host's origin (app/src/ui-patch.mjs), so the page under
// test is the app's own page and not the runtime's front end. The two pages have different
// class names, so the rules of one do not describe the other: src/mica.css describes the
// runtime's front end, and the classes of our own bundle describe the app's own page.

// The parts the app's own UI always renders (app/ui/src/app.js): the root of the page, the
// frame around the views, the sidebar with the team and the column with the conversation.
export const APP_UI_PARTS = ['#root', '.dsb-frame', '.dsb-side', '.dsb-side-list', '.dsb-main']

// The frame of the app's own bundle and the frame of the runtime's shell tell the pages
// apart. The runtime's front end has a root of its own (#root), so the root says nothing.
const APP_MARKER = '.dsb-frame'
const RUNTIME_MARKER = '[class*="_frame"]'

// The expression that names the page in the window: 'app', 'runtime' or 'unknown'.
export const pageKindExpression = `document.querySelector('${APP_MARKER}') !== null ? 'app' : document.querySelector('${RUNTIME_MARKER}') !== null ? 'runtime' : 'unknown'`

// The expression that reads the text the composer holds. A textarea keeps the typed text in
// its value and an editable field in its text; the text of the page holds neither, so the
// wait for the typed message has to ask the composer itself.
export const composerTextExpression = "(() => { const el = [...document.querySelectorAll('[role=textbox][contenteditable=true], textarea')].at(-1); if (el === undefined || el === null) return ''; return typeof el.value === 'string' ? el.value : (el.innerText ?? '') })()"

/**
 * The rules of a stylesheet: one list of selectors per rule, without the comments.
 * @param {string} css - the stylesheet.
 * @returns {string[][]} the selectors of every rule.
 */
export function cssRules(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{/gu)].map(([, selectors]) => selectors.split(',')
    .map(selector => selector.trim().replace(/::(?:before|after)$/u, ''))
    .filter(selector => selector !== '' && selector !== 'body'))
    .filter(rule => rule.length > 0)
}

// The rule that paints the material of the window through a surface, and the rule that
// paints it with a colour of the theme. The first one belongs to the window that has the
// material, the second one to every other window.
const MICA = '[data-mica]'

/**
 * The rules of a stylesheet with what they declare.
 * @param {string} css - the stylesheet.
 * @returns {{selectors: string[], text: string}[]} every rule.
 */
export function cssBlocks(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selectors, text]) => ({
    selectors: selectors.split(',').map(selector => selector.trim()).filter(selector => selector !== ''),
    text: text.trim(),
  }))
}

/**
 * Whether a rule paints a background that lets what is under it through: a colour mixed
 * with transparency. A gradient fades out over the surface under it and paints no colour of
 * its own, so it is not one.
 * @param {string} text - the declarations of a rule.
 * @returns {boolean} true when the rule paints a translucent background.
 */
export function translucentBackground(text) {
  return [...text.matchAll(/background(?:-color)?\s*:\s*([^;]+)/gu)]
    .some(([, value]) => value.includes('transparent') && !value.includes('gradient('))
}

/**
 * Whether a rule paints a background of its own: a colour of the theme, over everything
 * under it.
 * @param {string} text - the declarations of a rule.
 * @returns {boolean} true when the rule paints an opaque background.
 */
export function opaqueBackground(text) {
  return [...text.matchAll(/background(?:-color)?\s*:\s*([^;]+)/gu)]
    .some(([, value]) => value.trim() !== 'none' && !value.includes('transparent') && !value.includes('gradient('))
}

// A rule paints a surface when the surface is the last part of its selector, with or
// without a condition in front of it (html[data-mica] .dsb-side paints .dsb-side).
const paints = (selectors, surface) => selectors.some(selector => selector === surface || selector.endsWith(` ${surface}`))

/**
 * The value a stylesheet gives a custom property in the window that has the material.
 * @param {string} css - the stylesheet.
 * @param {string} name - the name of the custom property.
 * @returns {string|undefined} the value, or undefined when no rule sets it.
 */
export function micaVariable(css, name) {
  const blocks = cssBlocks(css).filter(block => block.selectors.some(selector => selector.includes(MICA)))
  for (const block of blocks) {
    const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'u').exec(block.text)
    if (match !== null) return match[1].trim()
  }
  return undefined
}

/**
 * How the stylesheet of our own UI paints its surfaces: whether a rule lets the material
 * of the window through them, and whether a rule paints them with a colour of the theme.
 * @param {string} css - the stylesheet of our own UI.
 * @param {string[]} surfaces - the selectors to report on.
 * @returns {Record<string, {mica: boolean, opaque: boolean, translucent: boolean}>} the treatment of every surface.
 */
export function surfaceTreatment(css, surfaces) {
  const blocks = cssBlocks(css)
  const report = {}
  for (const surface of surfaces) {
    const own = blocks.filter(block => paints(block.selectors, surface))
    const withMaterial = own.filter(block => block.selectors.some(selector => selector.includes(MICA)))
    const without = own.filter(block => !block.selectors.some(selector => selector.includes(MICA)))
    report[surface] = {
      mica: withMaterial.some(block => translucentBackground(block.text)),
      opaque: without.some(block => opaqueBackground(block.text)),
      translucent: without.some(block => translucentBackground(block.text)),
    }
  }
  return report
}
