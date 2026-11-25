// The folder picker: the system's own chooser where the window or the host has one, else this
// dialog, which walks the folders of the machine the Bots run on.
import { createElement as h, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscape } from './overlay-hooks.js'
import { CheckIcon, ChevronRightIcon, CloseIcon, FolderIcon, PlusIcon, SearchIcon } from './icons.js'
import { hostText, t } from './i18n.js'

// The last segment of a host path, Windows or POSIX; a root keeps its own spelling.
export const folderName = path => String(path).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(path)

// Where to start from, each folder once: the host's own places, then the team's and the known ones.
export function pickerPlaces(info, home, withTeam = true) {
  const places = [
    ...(info?.places ?? []),
    ...(withTeam && info?.team ? [{ path: info.team, title: t('Team workspace') }] : []),
    ...(home ? [{ path: home, title: t('Home folder') }] : []),
    ...(info?.folders ?? []),
  ]
  return places.filter((place, index) => places.findIndex(other => other.path === place.path) === index)
}

// The computer behind the container, through the server in front of it (portal/host-folders.mjs).
async function hostCall(api, method, name, body) {
  const response = await fetch(`${api}${name}`, { method, cache: 'no-store', credentials: 'same-origin', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(value.detail?.message ?? `HTTP ${response.status}`), { status: response.status })
  return value
}
const wait = ms => new Promise(done => setTimeout(done, ms))

function PickerDialog({ value, title, info, fallback, actions, onPick, onClose }) {
  const api = info.hostApi
  const [mode, setMode] = useState('rw')
  const [asking, setAsking] = useState('')
  const [mounts, setMounts] = useState([])
  const open = useRef(true)
  useEffect(() => () => { open.current = false }, [])
  const [listing, setListing] = useState(null)
  const [path, setPath] = useState(value ?? '')
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useState(false)
  const [naming, setNaming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const ticket = useRef(0)
  const home = useRef(undefined)
  useEscape(onClose)
  // Only the latest request's answer counts.
  const go = async (next) => {
    const mine = ++ticket.current
    setBusy(true)
    setProblem('')
    try {
      const found = api ? await hostCall(api, 'GET', `folders?path=${encodeURIComponent(next ?? '')}`) : await actions.folderList(next)
      if (mine !== ticket.current) return false
      home.current = found.home
      setListing(found)
      setPath(found.path)
      setFilter('')
      setNaming(null)
      return true
    } catch (failure) {
      if (mine === ticket.current) setProblem(failure?.message ?? String(failure))
      return false
    } finally {
      if (mine === ticket.current) setBusy(false)
    }
  }
  // A container path says nothing on the computer's side, so browsing starts at its home there.
  const start = api ? info.hostStart : value ?? info.places?.[0]?.path ?? info.team
  useEffect(() => { if (api) void hostCall(api, 'GET', 'mounts').then(found => setMounts(found.mounts)).catch(() => {}) }, [])
  useEffect(() => { void go(start).then(ok => { if (!ok && start !== undefined) void go(undefined) }) }, [])
  // A folder the Bots cannot see yet is asked for; the answer is given in the server's own window.
  // The container restarts for it, so the Bots are away for a while.
  const connect = async (folder) => {
    if (!api || folder === '') return folder
    const popup = listing.mounted ? null : window.open('about:blank', '_blank', 'width=520,height=600')
    try {
      const asked = await hostCall(api, 'POST', 'requests', { path: folder, mode })
      if (asked.container) { popup?.close(); return asked.container }
      if (!popup) throw new Error(t('Allow popups for this site, then try again.'))
      popup.location.replace(asked.approve)
      setAsking(t('Waiting for your approval in the other window…'))
      for (;;) {
        await wait(1500)
        if (!open.current) throw new Error('closed')
        let now
        try { now = await hostCall(api, 'GET', `requests/${asked.id}`) } catch (failure) { if (failure.status === 404) throw failure; continue }
        if (now.state === 'working') setAsking(t('Connecting the folder. The Bots restart…'))
        if (now.state === 'denied') throw new Error(t('You did not allow this folder.'))
        if (now.state === 'failed') throw new Error(now.error)
        if (now.state === 'done') return now.container
      }
    } finally { setAsking('') }
  }
  const save = async (path, tries = 20) => {
    for (;;) {
      try { return await onPick(path) } catch (failure) {
        tries -= 1
        if (!api || tries === 0 || failure?.code) throw failure
        await wait(2000)
      }
    }
  }
  const disconnect = async (mount) => {
    try { await hostCall(api, 'DELETE', `mounts?path=${encodeURIComponent(mount.host)}`); setMounts(now => now.filter(other => other.host !== mount.host)) } catch (failure) { setProblem(failure.message) }
  }
  const choose = async (folder) => {
    setBusy(true)
    setProblem('')
    try {
      await save(await connect(folder))
      onClose()
    } catch (failure) {
      setProblem(failure?.message ?? String(failure))
      setBusy(false)
    }
  }
  const create = async (event) => {
    event.preventDefault()
    if (!naming?.trim()) return
    try { await go((await actions.folderCreate(listing.path, naming.trim())).path) } catch (failure) { setProblem(failure?.message ?? String(failure)) }
  }
  const rows = (listing?.entries ?? []).filter(entry => (hidden || !entry.hidden) && entry.name.toLowerCase().includes(filter.trim().toLowerCase()))
  return createPortal(h('div', { className: 'bt-fpick-layer' },
    h('div', { className: 'bt-scrim', onMouseDown: onClose }),
    h('div', { className: 'bt-fpick', role: 'dialog', 'aria-modal': true, 'aria-label': title },
      h('header', null, h('h2', null, title), h('button', { type: 'button', 'aria-label': t('Close'), onClick: onClose }, h(CloseIcon))),
      h('nav', { 'aria-label': t('Places') },
        fallback ? h('button', { type: 'button', className: 'bt-fpick-place', onClick: () => choose('') }, h('span', null, fallback), value ? null : h(CheckIcon)) : null,
        (api ? hostPlaces(home.current) : pickerPlaces(info, home.current, !fallback || fallback !== t('Team workspace'))).map(place => h('button', { key: place.path, type: 'button', className: 'bt-fpick-place', title: place.path, 'aria-current': listing?.path === place.path || undefined, onClick: () => go(place.path) }, h(FolderIcon), h('span', null, place.title))),
        mounts.length > 0 ? h('small', null, t('Connected folders')) : null,
        mounts.map(mount => h('span', { key: mount.host, className: 'bt-fpick-mount' },
          h('button', { type: 'button', className: 'bt-fpick-place', title: mount.host, onClick: () => go(mount.host) }, h(FolderIcon), h('span', null, folderName(mount.host))),
          h('button', { type: 'button', 'aria-label': t('Disconnect {folder}', { folder: folderName(mount.host) }), title: t('Disconnect. The Bots restart.'), onClick: () => disconnect(mount) }, h(CloseIcon))))),
      h('section', null,
        h('form', { className: 'bt-fpick-path', onSubmit: (event) => { event.preventDefault(); void go(path.trim()) } },
          h('input', { value: path, spellCheck: false, 'aria-label': t('Folder path'), onChange: event => setPath(event.target.value) })),
        h('div', { className: 'bt-fpick-crumbs', 'aria-label': t('Location') }, (listing?.crumbs ?? []).map((crumb, index) => h('span', { key: crumb.path },
          index > 0 ? h(ChevronRightIcon) : null, h('button', { type: 'button', onClick: () => go(crumb.path) }, crumb.name)))),
        h('div', { className: 'bt-fpick-tools' },
          h('label', { className: 'bt-fpick-search' }, h(SearchIcon), h('input', { type: 'search', autoFocus: true, value: filter, placeholder: t('Filter folders'), 'aria-label': t('Filter folders'), onChange: event => setFilter(event.target.value) })),
          api ? null : h('button', { type: 'button', disabled: listing === null, onClick: () => setNaming(now => (now === null ? '' : null)) }, h(PlusIcon), t('New folder'))),
        naming === null ? null : h('form', { className: 'bt-fpick-path', onSubmit: create },
          h('input', { autoFocus: true, value: naming, placeholder: t('Name of the new folder'), 'aria-label': t('Name of the new folder'), onChange: event => setNaming(event.target.value) }),
          h('button', { type: 'submit', disabled: naming.trim() === '' }, t('Create'))),
        asking ? h('p', { role: 'status', className: 'bt-shimmer' }, asking) : null,
        problem ? h('p', { className: 'bt-fpick-problem', role: 'alert' }, hostText(problem)) : null,
        h('ul', { className: 'bt-fpick-list', 'aria-busy': busy }, rows.map(entry => h('li', { key: entry.path },
          h('button', { type: 'button', onClick: () => go(entry.path) }, h(FolderIcon), h('span', null, entry.name), h(ChevronRightIcon)))),
        listing !== null && rows.length === 0 ? h('li', { className: 'bt-fpick-none' }, filter ? t('No results') : t('No folders inside.')) : null,
        listing?.truncated ? h('li', { className: 'bt-fpick-none' }, t('Some folders are not shown.')) : null)),
      h('footer', null,
        h('label', null, h('input', { type: 'checkbox', checked: hidden, onChange: event => setHidden(event.target.checked) }), t('Show hidden folders')),
        api && listing && !listing.mounted ? h('select', { value: mode, 'aria-label': t('What Bots may do there'), onChange: event => setMode(event.target.value) }, h('option', { value: 'rw' }, t('Can edit')), h('option', { value: 'ro' }, t('Read only'))) : null,
        h('span', { className: 'bt-fpick-here', title: listing?.path }, listing ? folderName(listing.path) : ''),
        h('button', { type: 'button', onClick: onClose }, t('Cancel')),
        h('button', { type: 'button', className: 'bt-fpick-use', disabled: busy || listing === null, onClick: () => choose(listing.path) }, api && listing && !listing.mounted ? t('Ask to use this folder') : t('Use this folder'))))), document.body)
}

// `open()` asks for a folder; `dialog` is what to render. `onPick` gets the path, or '' for the
// default that `fallback` names, and rejects when the host refuses the folder.
export function useFolderPicker({ value, title, fallback, actions, onPick }) {
  const [info, setInfo] = useState(null)
  const asking = useRef(false)
  const open = async () => {
    if (asking.current) return
    asking.current = true
    try {
      if (typeof globalThis.dsBotApp?.pickFolder === 'function') {
        const path = await globalThis.dsBotApp.pickFolder(value)
        if (path) await onPick(path)
        return
      }
      const found = await actions.folders()
      // An account without the computer behind it keeps the container's own folders.
      if (found.hostApi) {
        const here = await hostCall(found.hostApi, 'GET', 'folders?path=').catch(() => null)
        if (here === null) found.hostApi = null
      }
      if (found.hostApi || found.picker !== 'native') { setInfo(found); return }
      const path = await actions.folderPick()
      if (path) await onPick(path)
    } catch (failure) {
      actions.reportError(failure, 'folder')
    } finally {
      asking.current = false
    }
  }
  const dialog = info === null ? null : h(PickerDialog, { value, title, info, fallback, actions, onPick, onClose: () => setInfo(null) })
  return { open, dialog }
}

export const hostPlaces = home => (home ? [{ path: home, title: t('Home folder') }, ...['Desktop', 'Documents', 'Downloads'].map(name => ({ path: `${home}/${name}`, title: name }))] : [])

export const PICKER_CSS = `
.bt-fpick nav small{padding:10px 8px 2px;color:var(--bt-ink-3)}
.bt-fpick-mount{display:flex}
.bt-fpick footer select{height:30px;border:1px solid var(--bt-line);border-radius:8px;background:var(--bt-card);color:inherit;font:inherit}
.bt-fpick-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:70;display:flex;align-items:center;justify-content:center;font-family:var(--bt-font);font-size:13px;line-height:18px;color:var(--bt-ink)}
.bt-fpick{position:relative;display:grid;grid-template:auto 1fr auto/190px 1fr;width:min(760px,calc(100vw - 32px));height:min(560px,calc(100vh - 64px));border:.5px solid var(--bt-line-2);border-radius:18px;background:var(--bt-main);overflow:hidden}
.bt-fpick button{display:inline-flex;align-items:center;gap:8px;min-width:0;border:0;border-radius:8px;padding:6px 8px;background:none;color:inherit;font:inherit;cursor:pointer}
.bt-fpick button:hover,.bt-fpick [aria-current]{background:var(--bt-hover)}
.bt-fpick button:disabled{opacity:.45;cursor:default}
.bt-fpick svg{flex:none}
.bt-fpick header{grid-column:1/-1;display:flex;align-items:center;padding:12px 14px 12px 20px;border-bottom:.5px solid var(--bt-line)}
.bt-fpick h2{flex:1;margin:0;font-size:16px;line-height:24px;font-weight:600}
.bt-fpick nav{display:flex;flex-direction:column;gap:2px;padding:10px;overflow:auto;background:var(--bt-sidebar);border-right:.5px solid var(--bt-line)}
.bt-fpick-place{width:100%;text-align:left}
.bt-fpick :is(.bt-fpick-place,.bt-fpick-list button) span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.bt-fpick section{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0;padding:12px 16px 0}
.bt-fpick-path,.bt-fpick-tools{display:flex;gap:8px}
.bt-fpick :is(.bt-fpick-path input,.bt-fpick-search){flex:1;min-width:0;height:34px;padding:0 10px;border:1px solid var(--bt-line);border-radius:10px;background:var(--bt-card);color:inherit;font:inherit;box-sizing:border-box}
.bt-fpick-search{display:flex;align-items:center;gap:8px;color:var(--bt-ink-2)}
.bt-fpick .bt-fpick-search input{flex:1;min-width:0;border:0;outline:0!important;box-shadow:none!important;background:none;color:var(--bt-ink);font:inherit}
.bt-fpick :is(.bt-fpick-path input:focus,.bt-fpick-search:focus-within){outline:0;border-color:var(--bt-accent)}
.bt-fpick-crumbs{display:flex;flex-wrap:wrap;color:var(--bt-ink-2)}
.bt-fpick-crumbs span{display:inline-flex;align-items:center}
.bt-fpick-crumbs button{padding:2px 5px}
.bt-fpick-crumbs svg{width:12px;height:12px}
.bt-fpick-list{flex:1;min-height:0;margin:0 -6px;padding:0 0 8px;overflow:auto;list-style:none}
.bt-fpick-list[aria-busy=true]{opacity:.5}
.bt-fpick-list button{width:100%;padding:8px}
.bt-fpick-none{padding:24px 8px;text-align:center;color:var(--bt-ink-3)}
.bt-fpick-problem{margin:0;color:var(--bt-danger);overflow-wrap:anywhere}
.bt-fpick footer{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:.5px solid var(--bt-line)}
.bt-fpick footer label{display:inline-flex;align-items:center;gap:6px;color:var(--bt-ink-2)}
.bt-fpick-here{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--bt-ink-2)}
.bt-fpick .bt-fpick-use{padding:8px 16px;border-radius:999px;background:var(--bt-accent);color:var(--bt-accent-ink);font-weight:500}
.bt-composer-folder{display:inline-flex;align-items:center;min-width:0;max-width:200px;margin:0 4px}
.bt-composer-folder button{display:inline-flex;align-items:center;gap:6px;min-width:0;height:28px;padding:0 8px;border:0;border-radius:999px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer}
.bt-composer-folder button:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-composer-folder button svg{flex:none;width:15px;height:15px}
.bt-composer-folder span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-composer-folder[data-set] button:first-child{background:color-mix(in srgb,var(--bt-accent) 12%,transparent);color:var(--bt-accent)}
@media(max-width:600px){.bt-fpick{grid-template:auto auto 1fr auto/1fr}.bt-fpick nav{flex-direction:row;border-right:0;border-bottom:.5px solid var(--bt-line)}.bt-fpick-place{width:auto;flex:none}.bt-fpick footer label,.bt-fpick-here{display:none}.bt-fpick footer{justify-content:flex-end}}
`
