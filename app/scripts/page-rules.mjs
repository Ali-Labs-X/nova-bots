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
