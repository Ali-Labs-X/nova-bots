// The Memory Bank: what the team, every Bot and every group keeps, in one place to search,
// add to, edit and remove from. Its styles stand alone, so classic Agent mode, where the
// Bot skin is off, shows the same dialog.
import { createElement as h, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { bankEntries, bankMarkdown, bankPlaces } from './memory-bank-model.js'
import { useEscape } from './overlay-hooks.js'
import { hostText, t } from './i18n.js'
import { CloseIcon, MemoryIcon, PencilIcon, PlusIcon, TrashIcon } from './icons.js'

function Entry({ place, entry, showPlace, save, remove }) {
  const [draft, setDraft] = useState(null)
  const [sure, setSure] = useState(false)
  const commit = async () => { if (await save(place, entry, draft)) setDraft(null) }
  if (draft !== null) {
    return h('li', { className: 'bt-bank-entry' },
      h('textarea', { autoFocus: true, rows: 3, value: draft, 'aria-label': t('Edit entry'), onChange: event => setDraft(event.target.value) }),
      h('button', { type: 'button', disabled: draft.trim() === '', onClick: commit }, t('Save')),
      h('button', { type: 'button', onClick: () => setDraft(null) }, t('Cancel')))
  }
  return h('li', { className: 'bt-bank-entry' },
    h('span', { className: 'bt-bank-copy' }, entry.text,
      h('small', null, [showPlace ? place.name : null, entry.topic, entry.added].filter(Boolean).join(' · '))),
    h('button', { type: 'button', 'aria-label': t('Edit entry'), title: t('Edit entry'), onClick: () => setDraft(entry.text) }, h(PencilIcon)),
    h('button', { type: 'button', 'aria-label': sure ? t('Click again to remove') : t('Remove from memory'), title: t('Remove from memory'), onBlur: () => setSure(false), onClick: () => (sure ? remove(place, entry) : setSure(true)) },
      sure ? t('Remove') : h(TrashIcon)))
}

export function MemoryBank({ start, roster, actions }) {
  const places = bankPlaces(roster)
  const owners = [...new Set(places.map(place => place.id))]
  const [selected, setSelected] = useState(places.some(place => place.key === start) ? start : places[0]?.key)
  const [views, setViews] = useState({})
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)
  useEscape(actions.closeMemoryBank)
  useEffect(() => {
    let stop = false
    for (const id of owners) {
      actions.memoryView(id).then(view => { if (!stop) setViews(all => ({ ...all, [id]: view })) })
        .catch(failure => { if (!stop) setError(failure?.message ?? String(failure)) })
    }
    return () => { stop = true }
  }, [owners.join(' ')])
  const apply = async (place, work) => {
    setError('')
    try {
      const view = await work
      setViews(all => ({ ...all, [place.id]: view }))
      return true
    } catch (failure) {
      setError(failure?.message ?? String(failure))
      return false
    }
  }
  const save = (place, entry, text) => apply(place, actions.memorySave(place.id, { scope: place.scope, topic: entry.topic, match: entry.text, text }))
  const remove = (place, entry) => apply(place, actions.memoryForget(place.id, entry))
  const place = places.find(item => item.key === selected)
  const showHistory = async () => {
    if (history !== null) { setHistory(null); return }
    try { setHistory((await actions.memoryHistory(place.id)).filter(row => row.scope === place.scope)) } catch (failure) { setError(failure?.message ?? String(failure)) }
  }
  const undo = async (row) => {
    if (await apply(place, actions.memoryUndo(place.id, row.id))) setHistory((await actions.memoryHistory(place.id)).filter(item => item.scope === place.scope))
  }
  const download = () => {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([bankMarkdown(places, views)], { type: 'text/markdown' }))
    link.download = 'memory-bank.md'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }
  const add = async (event) => {
    event.preventDefault()
    if (adding.trim() === '' || place === undefined) return
    if (await apply(place, actions.memorySave(place.id, { scope: place.scope, text: adding }))) setAdding('')
  }
  const shown = useMemo(() => bankEntries(places, views, { selected, query }), [roster, views, selected, query])
  const countOf = item => (views[item.id]?.entries ?? []).filter(entry => entry.scope === item.scope).length
  const loading = place !== undefined && views[place.id] === undefined && error === ''
  return h('div', { className: 'bt-bank-layer' },
    h('div', { className: 'bt-bank-scrim', onMouseDown: actions.closeMemoryBank }),
    h('div', { className: 'bt-bank', role: 'dialog', 'aria-modal': true, 'aria-label': t('Memory Bank') },
      h('header', null, h(MemoryIcon), h('h2', null, t('Memory Bank')),
        h('input', { type: 'search', value: query, placeholder: t('Search all memory'), 'aria-label': t('Search all memory'), onChange: event => setQuery(event.target.value) }),
        h('button', { type: 'button', disabled: place === undefined, 'aria-pressed': history !== null, onClick: showHistory }, t('History')),
        h('button', { type: 'button', onClick: download }, t('Export')),
        h('button', { type: 'button', 'aria-label': t('Close memory'), onClick: actions.closeMemoryBank }, h(CloseIcon))),
      h('nav', { 'aria-label': t('Memory') }, places.map(item => h('button', {
        key: item.key, type: 'button', 'aria-current': item.key === selected && query === '' ? 'true' : undefined,
        onClick: () => { setSelected(item.key); setQuery(''); setHistory(null) },
      }, h('span', null, item.name), h('small', null, countOf(item))))),
      h('section', null,
        error ? h('p', { className: 'bt-bank-error', role: 'alert' }, hostText(error)) : null,
        history !== null ? h('ul', { 'aria-label': t('History') }, history.length === 0 ? h('li', null, t('No changes yet')) : history.map(row => h('li', { key: row.id, className: 'bt-bank-entry' },
          h('span', { className: 'bt-bank-copy' }, row.before ? h('del', null, row.before) : null, row.before && row.after ? ' ' : null, row.after, h('small', null, [row.by, row.topic].filter(Boolean).join(' · '))),
          h('button', { type: 'button', onClick: () => undo(row) }, t('Undo'))))) : null,
        history !== null ? null : loading ? h('p', null, t('Loading…')) : shown.length === 0 ? h('p', null, query ? t('No results') : t('Nothing saved yet')) : null,
        history !== null ? null : h('ul', null, shown.map(({ place: at, entry }) => h(Entry, { key: `${at.key}:${entry.topic ?? ''}:${entry.text}`, place: at, entry, showPlace: query !== '', save, remove }))),
        history === null && query === '' && place ? h('form', { onSubmit: add },
          h('input', { value: adding, placeholder: t('Add to memory'), 'aria-label': t('Add to memory'), onChange: event => setAdding(event.target.value) }),
          h('button', { type: 'submit', 'aria-label': t('Add'), disabled: adding.trim() === '' }, h(PlusIcon))) : null)))
}

// Classic Agent mode has no Bot overlays, so this one draws the dialog there.
export function ClassicMemoryBank({ useSurface, useUi, useRoster, actions }) {
  const mode = useSurface(value => value.mode)
  const bank = useUi(value => value.memoryBank)
  const roster = useRoster(value => value)
  return mode === 'agent' && bank ? createPortal(h(MemoryBank, { key: bank.token, start: bank.id, roster, actions }), document.body) : null
}

// Beside the way back to the team in classic Agent mode.
export function ClassicMemoryButton({ wide, useSurface, useRoster, actions }) {
  const mode = useSurface(value => value.mode)
  const on = useRoster(value => value.ready && value.memory !== false)
  if (mode !== 'agent' || !on) return null
  return h('button', { type: 'button', className: 'bt-return', 'aria-label': t('Memory Bank'), title: t('Memory Bank'), onClick: () => actions.openMemoryBank() },
    h(MemoryIcon), wide ? h('span', { className: 'bt-return-name' }, t('Memory Bank')) : null)
}

export const BANK_CSS = `
.bt-bank-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:62;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:20px;color-scheme:light;color:var(--bt-ink,CanvasText)}
body[data-ds-dark-theme] .bt-bank-layer{color-scheme:dark}
.bt-bank-scrim{position:absolute;inset:0;background:color-mix(in srgb,CanvasText 28%,transparent)}
.bt-bank{position:relative;display:grid;grid-template:auto 1fr/210px 1fr;width:min(880px,calc(100vw - 32px));height:min(680px,calc(100vh - 64px));border-radius:18px;overflow:hidden;background:var(--bt-main,Canvas);border:1px solid color-mix(in srgb,currentColor 15%,transparent)}
.bt-bank header{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent)}
.bt-bank h2{margin:0;font-size:16px;flex:1}
.bt-bank nav{overflow:auto;padding:8px;border-right:1px solid color-mix(in srgb,currentColor 10%,transparent)}
.bt-bank nav button{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left}
.bt-bank nav button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-bank section{overflow:auto;padding:12px 16px;min-width:0}
.bt-bank ul{list-style:none;margin:0;padding:0}
.bt-bank-entry{display:flex;align-items:center;gap:6px;padding:8px 0;border-bottom:1px solid color-mix(in srgb,currentColor 8%,transparent)}
.bt-bank-copy{flex:1;min-width:0;overflow-wrap:anywhere}
.bt-bank small{display:block;opacity:.6;font-size:12px}
.bt-bank button{border:0;border-radius:8px;padding:6px 8px;background:none;color:inherit;font:inherit;cursor:pointer}
.bt-bank button:is(:hover,[aria-current]){background:color-mix(in srgb,currentColor 9%,transparent)}
.bt-bank button:disabled{opacity:.4;cursor:default}
.bt-bank :is(input,textarea){flex:1;min-width:0;max-width:100%;padding:7px 10px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;background:none;color:inherit;font:inherit;box-sizing:border-box}
.bt-bank header input{max-width:260px}
.bt-bank form{display:flex;gap:8px;padding-top:12px}
.bt-bank-error{color:var(--bt-danger,currentColor)}
@media(max-width:600px){.bt-bank{grid-template:auto auto 1fr/1fr}.bt-bank nav{display:flex;border-right:0}.bt-bank nav button{width:auto;flex:none}}
`
