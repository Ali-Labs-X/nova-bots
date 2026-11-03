import { ACCENT_INKS, INKS, isHex, luminance } from './inks.js'
import { SHAPES, markupCache, maskCache } from './characters.js'
import { createSource } from './sources.js'

// -------------------------------------------------------------------------
// Themes. A theme names eight colors per mode; every `--bt-*` variable and the shell
// tokens derive from them, so a registered theme recolors the whole team UI.

const THEME_KEYS = ['bg', 'sidebar', 'bubble', 'card', 'text', 'user', 'userText', 'accent']
// The Nova theme paints the whole shell, not only the team surface: deep space
// panels, an aurora wash, and one violet-to-cyan accent for every primary action.
const NOVA_CSS = `
/* Nova Galaxy: deep-space panels, a slow aurora, and a field of quiet stars. */
html body{background:var(--bt-main)}
html body[data-ds-dark-theme]{
  background:
    radial-gradient(1200px 760px at 6% -14%, rgba(124,92,255,.26), transparent 60%),
    radial-gradient(980px 680px at 104% -6%, rgba(34,211,238,.17), transparent 58%),
    radial-gradient(820px 640px at 52% 118%, rgba(236,47,107,.11), transparent 62%),
    radial-gradient(520px 520px at 74% 18%, rgba(94,231,247,.08), transparent 70%),
    var(--bt-main);
  background-attachment:fixed;
}
html body:not([data-ds-dark-theme]){
  background:
    radial-gradient(900px 600px at 6% -10%, rgba(124,92,255,.14), transparent 60%),
    radial-gradient(760px 520px at 104% 0%, rgba(34,211,238,.12), transparent 55%),
    var(--bt-main);
  background-attachment:fixed;
}
/* The star field sits behind the app, never over it. */
html body .nova-stars{
  position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.55;
  background-image:
    radial-gradient(1.2px 1.2px at 22px 34px,rgba(255,255,255,.9),transparent 60%),
    radial-gradient(1px 1px at 118px 86px,rgba(196,181,253,.65),transparent 60%),
    radial-gradient(1.4px 1.4px at 206px 178px,rgba(94,231,247,.6),transparent 60%),
    radial-gradient(1px 1px at 302px 58px,rgba(255,255,255,.55),transparent 60%),
    radial-gradient(1px 1px at 72px 252px,rgba(255,255,255,.45),transparent 60%),
    radial-gradient(1.6px 1.6px at 342px 302px,rgba(139,124,255,.7),transparent 60%),
    radial-gradient(1px 1px at 168px 338px,rgba(255,255,255,.5),transparent 60%);
  background-size:380px 380px;
  animation:nova-twinkle 12s ease-in-out infinite alternate,nova-drift 180s linear infinite;
}
html body .nova-stars::after{
  content:"";position:absolute;inset:0;opacity:.5;
  background-image:
    radial-gradient(1.6px 1.6px at 60px 80px,rgba(255,255,255,.8),transparent 60%),
    radial-gradient(1.1px 1.1px at 250px 40px,rgba(94,231,247,.65),transparent 60%),
    radial-gradient(1.2px 1.2px at 460px 210px,rgba(255,255,255,.6),transparent 60%),
    radial-gradient(1.8px 1.8px at 540px 420px,rgba(167,139,250,.7),transparent 60%),
    radial-gradient(1px 1px at 340px 520px,rgba(255,255,255,.45),transparent 60%);
  background-size:620px 620px;
  animation:nova-drift-reverse 240s linear infinite;
}
html body #root{position:relative;z-index:1}
/* Glass side rail and settings surface. */
html body [class*="_sidebarCol"]{
  background:linear-gradient(180deg,color-mix(in srgb,var(--bt-sidebar) 92%,transparent),color-mix(in srgb,var(--bt-sidebar) 80%,transparent))!important;
  backdrop-filter:blur(22px) saturate(1.15);
  border-right:1px solid var(--bt-line);
}
html body .bt-settings{
  background:linear-gradient(180deg,color-mix(in srgb,var(--bt-card) 96%,transparent),color-mix(in srgb,var(--bt-main) 92%,transparent))!important;
  box-shadow:0 40px 120px -30px rgba(0,0,0,.7),0 0 0 1px rgba(139,124,255,.12),0 0 90px -30px rgba(109,94,252,.45),inset 0 1px 0 rgba(255,255,255,.05)!important;
}
/* The wordmark is the brand: an aurora that keeps moving, quietly. */
.bt-brand{font-weight:650!important;letter-spacing:-.02em!important}
.bt-brand svg,.bt-brand img{filter:drop-shadow(0 0 10px rgba(139,124,255,.5))}
.bt-brand-name{
  background:linear-gradient(100deg,#f4f1ff 0%,#c4b5fd 20%,#8b7cff 42%,#5ee7f7 66%,#f4f1ff 100%);
  background-size:220% auto;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  animation:nova-shimmer 8s linear infinite;
}
html body:not([data-ds-dark-theme]) .bt-brand-name{
  background:linear-gradient(100deg,#2b2350 0%,#5b46d6 50%,#0e8ea8 100%);
  background-size:220% auto;
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
/* Composer: floating glass with an accent bloom on focus. */
html body [data-composer-card]{
  background:color-mix(in srgb,var(--bt-main) 76%,transparent)!important;
  backdrop-filter:blur(18px) saturate(1.1);
  box-shadow:0 18px 50px -18px rgba(2,6,23,.8),inset 0 1px 0 rgba(255,255,255,.045),0 0 0 1px rgba(139,124,255,.12)!important;
  transition:box-shadow .3s ease,border-color .3s ease;
}
html body [data-composer-card]:focus-within{
  border-color:color-mix(in srgb,var(--bt-accent) 60%,transparent)!important;
  box-shadow:0 18px 60px -18px rgba(2,6,23,.85),0 0 0 3px color-mix(in srgb,var(--bt-accent) 18%,transparent),0 0 42px -8px rgba(139,124,255,.55),inset 0 1px 0 rgba(255,255,255,.07)!important;
}
/* Primary actions carry the aurora and a light sweep. */
html body button[class*="_primary"],html body [data-composer-card] button[class*="_primary"]{
  position:relative;isolation:isolate;overflow:hidden;
  background:linear-gradient(135deg,#9b8cff 0%,#6d5efc 52%,#22d3ee 135%)!important;
  box-shadow:0 8px 24px -8px rgba(109,94,252,.8),inset 0 1px 0 rgba(255,255,255,.18);
  transition:transform .18s ease,box-shadow .18s ease,filter .18s ease;
}
html body button[class*="_primary"]::after,html body [data-composer-card] button[class*="_primary"]::after{
  content:"";position:absolute;inset:0;pointer-events:none;
  transform:translateX(-130%) skewX(-18deg);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);
  transition:transform .65s ease;
}
html body button[class*="_primary"]:hover,html body [data-composer-card] button[class*="_primary"]:hover{
  transform:translateY(-1px);
  box-shadow:0 12px 34px -8px rgba(109,94,252,.95),0 0 28px rgba(94,231,247,.22),inset 0 1px 0 rgba(255,255,255,.22);
}
html body button[class*="_primary"]:hover::after,html body [data-composer-card] button[class*="_primary"]:hover::after{transform:translateX(130%) skewX(-18deg)}
/* Soft actions glow at the edge instead of shouting. */
html body .bt-soft{transition:box-shadow .2s ease,border-color .2s ease,background .2s ease}
html body .bt-soft:hover{
  border-color:color-mix(in srgb,var(--bt-accent) 42%,transparent)!important;
  box-shadow:0 0 0 1px color-mix(in srgb,var(--bt-accent) 18%,transparent),0 0 24px -8px color-mix(in srgb,var(--bt-accent) 55%,transparent);
}
/* The active place in the interface gets a quiet halo. */
html body [aria-current="page"],html body [data-active="true"]{
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--bt-accent) 22%,transparent),0 0 20px -8px color-mix(in srgb,var(--bt-accent) 55%,transparent);
}
/* Selection and scrollbar, quietly in the same family. */
html body ::selection{background:color-mix(in srgb,var(--bt-accent) 34%,transparent)}
html body *{scrollbar-color:color-mix(in srgb,var(--bt-ink) 22%,transparent) transparent}
@keyframes nova-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes nova-twinkle{0%{opacity:.34}100%{opacity:.68}}
@keyframes nova-drift{0%{background-position:0 0}100%{background-position:-380px 260px}}
@keyframes nova-drift-reverse{0%{background-position:0 0}100%{background-position:620px -420px}}
@media (prefers-reduced-motion:reduce){
  html body .nova-stars,html body .nova-stars::after,.bt-brand-name,html body button[class*="_primary"]::after{animation:none!important}
}
`

const THEMES = {
  nova: {
    label: 'Nova Galaxy',
    light: { bg: '#f7f8fd', sidebar: '#eef1fb', bubble: '#e7ebf9', card: '#ffffff', text: '#111528', user: '#6d5efc', userText: '#ffffff', accent: '#6d5efc' },
    dark: { bg: '#070a16', sidebar: '#0b1022', bubble: '#111a33', card: '#0e1530', text: '#e9edfb', user: '#6d5efc', userText: '#ffffff', accent: '#8b7cff' },
    css: NOVA_CSS,
  },
  mono: {
    label: 'Mono',
    light: { bg: '#ffffff', sidebar: '#f9f9f9', bubble: '#f0f0f0', card: '#ffffff', text: '#0d0d0d', user: '#0d0d0d', userText: '#ffffff', accent: '#0d0d0d' },
    dark: { bg: '#0f0f0f', sidebar: '#171717', bubble: '#242424', card: '#1c1c1c', text: '#f4f4f4', user: '#f4f4f4', userText: '#0f0f0f', accent: '#f4f4f4' },
  },
  paper: {
    label: 'Paper',
    light: { bg: '#faf9f5', sidebar: '#f3f0e8', bubble: '#ebe7dc', card: '#ffffff', text: '#1f1e1b', user: '#2b2a26', userText: '#faf9f5', accent: '#d97757' },
    dark: { bg: '#1f1e1b', sidebar: '#262521', bubble: '#34322d', card: '#2a2925', text: '#f3f0e8', user: '#f3f0e8', userText: '#1f1e1b', accent: '#e08a6d' },
  },
}
// Text on the accent: near-black or white, whichever has the higher WCAG contrast.
// (L + .05)² > 1.05 × (L(#141414) + .05) is "dark ink reads better".
const DARK_INK = '#141414'
const accentInk = accent => ((luminance(accent) + 0.05) ** 2 > 1.05 * (luminance(DARK_INK) + 0.05) ? DARK_INK : '#ffffff')
const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(',')},${alpha})`
function themeVars(mode, dark, accent = mode.accent) {
  return {
    '--bt-ink': mode.text, '--bt-ink-2': rgba(mode.text, 0.6), '--bt-ink-3': rgba(mode.text, 0.36),
    '--bt-bubble': mode.bubble, '--bt-sidebar': mode.sidebar, '--bt-main': mode.bg, '--bt-card': mode.card,
    '--bt-line': rgba(mode.text, 0.08), '--bt-line-2': rgba(mode.text, 0.15),
    '--bt-hover': dark ? 'rgba(160,160,160,.12)' : 'rgba(119,119,119,.09)',
    '--bt-active': dark ? 'rgba(160,160,160,.2)' : 'rgba(119,119,119,.17)',
    '--bt-accent': accent, '--bt-accent-ink': accentInk(accent),
    '--bt-user': mode.user, '--bt-user-ink': mode.userText,
    '--bt-tag-bg': rgba(mode.text, dark ? 0.09 : 0.06), '--bt-tag-ink': rgba(mode.text, 0.58),
  }
}
const declarations = vars => Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(';')
// A preset accent is saved as its light value; in dark mode it takes the preset's dark
// value, as Bot names do, so Charcoal does not vanish on a dark background. A custom
// accent is the same in both modes. A preset is matched the way Settings marks it.
const darkAccent = (accent) => {
  const ink = ACCENT_INKS.find(id => INKS[id][0] === accent)
  return ink === undefined ? accent : INKS[ink][1]
}
// `html body` outranks the base sheet's `body` rules without !important.
export const themeCss = (theme, accent) => `html body{${declarations(themeVars(theme.light, false, accent ?? theme.light.accent))}}
html body[data-ds-dark-theme]{${declarations(themeVars(theme.dark, true, darkAccent(accent) ?? theme.dark.accent))}}
${theme.css ?? ''}`
export const shellTokens = ({ light, dark }) => ({
  '--dsw-alias-bg-base': { light: light.bg, dark: dark.bg },
  '--dsw-specific-sidebar-fill': { light: light.sidebar, dark: dark.sidebar },
  '--dsw-specific-input-major': { light: light.bg, dark: dark.sidebar },
  '--dsw-alias-label-primary': { light: light.text, dark: dark.text },
  '--dsw-alias-label-secondary': { light: rgba(light.text, 0.74), dark: rgba(dark.text, 0.74) },
  '--dsw-alias-label-tertiary': { light: rgba(light.text, 0.6), dark: rgba(dark.text, 0.6) },
})

// Other plugins add character shapes and themes through `window.dshBot`, or queue
// calls on `window.dshBotQueue` before this plugin loads. A shape draws only its
// body; the eyes are cut out where `eyes.at` says, so it gets every state motion free.
const customThemes = {}
export const registry = createSource(0)
const isPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
export function registerShape(id, shape) {
  if (typeof id !== 'string' || !/^[a-z][\w-]{0,31}$/.test(id)) throw new Error('Shape ids are lowercase words')
  if (typeof shape?.body !== 'function' || typeof shape.body('#000') !== 'string') throw new Error('A shape needs body(paint) returning SVG markup')
  const at = shape.eyes?.at
  if (!Array.isArray(at) || at.length !== 2 || !at.every(isPoint)) throw new Error('A shape needs eyes.at: two [x, y] points')
  const size = Number.isFinite(shape.size) && shape.size > 0 ? shape.size : 100
  const pick = (key, fallback) => (Number.isFinite(shape.eyes[key]) ? shape.eyes[key] : fallback)
  const eyes = at.map(([x, y]) => [x, y, pick('w', size * 0.1), pick('h', size * 0.23), pick('tilt', -27)])
  const previous = SHAPES[id]
  SHAPES[id] = {
    label: String(shape.label ?? id),
    size,
    body: shape.body,
    eyes,
    ...(typeof shape.wrap === 'string' ? { wrap: shape.wrap } : {}),
  }
  const refresh = () => {
    markupCache.clear()
    maskCache.delete(id)
    registry.set(value => value + 1)
  }
  refresh()
  return () => {
    if (previous) SHAPES[id] = previous
    else delete SHAPES[id]
    refresh()
  }
}
export function registerTheme(id, theme) {
  if (typeof id !== 'string' || !/^[a-z][\w-]{0,31}$/.test(id)) throw new Error('Theme ids are lowercase words')
  for (const mode of ['light', 'dark']) {
    for (const key of THEME_KEYS) if (!isHex(theme?.[mode]?.[key])) throw new Error(`Theme ${mode}.${key} must be a #rrggbb color`)
  }
  const previous = customThemes[id]
  customThemes[id] = { label: String(theme.label ?? id), light: theme.light, dark: theme.dark, css: typeof theme.css === 'string' ? theme.css : '' }
  registry.set(value => value + 1)
  return () => {
    if (previous) customThemes[id] = previous
    else delete customThemes[id]
    registry.set(value => value + 1)
  }
}
export const allThemes = () => ({ ...THEMES, ...customThemes })

// How chat messages are drawn; a value the plugin does not know reads as the default.
// A width is a percent of the column: the bubbles' in either layout, the text's in the
// flat one.
export const MESSAGE_WIDTH = { min: 50, max: 100, step: 5 }
const percent = (value, initial) => (Number.isInteger(value) && value >= MESSAGE_WIDTH.min && value <= MESSAGE_WIDTH.max ? value : initial)
export const layoutOf = prefs => (prefs?.layout === 'flat' ? 'flat' : 'bubble')
export const thinkingShown = prefs => prefs?.thinking === true
export const widthOf = prefs => percent(prefs?.width, 80)
export const flatWidthOf = prefs => percent(prefs?.flatWidth, 100)
