import { createElement as h, Fragment, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, FolderIcon } from './icons.js'
import { folderName, useFolderPicker } from './folder-picker.js'
import { Caret, useAnchoredMenu } from './model-menu.js'
import { t } from './i18n.js'

const Tick = ({ on }) => h('span', { className: 'bt-model-tick', 'aria-hidden': true }, on ? h(CheckIcon) : null)

// Where a Bot, or every member of a group, works. `value` is the saved folder; without
// one a Bot works in the team workspace and a group member in its own folder. `onPick`
// gets the chosen path, or '' for that default. `team` is the menu for the team workspace
// itself, which has no default.
export function FolderMenu({ value, group = false, team = false, actions, onPick, wide = false, disabled = false }) {
  const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu()
  const [info, setInfo] = useState(null)
  const fallback = group ? t("Each Bot's own folder") : t('Team workspace')
  const toggle = () => {
    if (isOpen) { close(); return }
    // Projects added in Nova meanwhile show up, so opening asks again.
    void Promise.resolve(actions.folders()).then(setInfo).catch(() => setInfo(last => last ?? { team: null, folders: [] }))
    open()
  }
  const choose = (path) => {
    close()
    if (path !== (value ?? '')) void onPick(path)
  }
  const picker = useFolderPicker({
    value, title: team ? t('Choose the team workspace') : t('Choose a working folder'), fallback: team ? null : fallback, actions,
    onPick: path => (path === (value ?? '') ? undefined : onPick(path)),
  })
  const known = info?.folders ?? []
  const folders = value && !known.some(folder => folder.path === value) ? [{ path: value, title: folderName(value) }, ...known] : known
  const listView = h('div', { key: 'list', className: 'bt-folder-view' },
    team ? null : h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': !value, title: group ? undefined : info?.team ?? undefined, onClick: () => choose('') },
      h('span', { className: 'bt-menu-label' }, fallback), h(Tick, { on: !value })),
    folders.length > 0 ? h('div', { className: 'bt-model-group', role: 'presentation' }, t('Folders')) : null,
    folders.map(folder => h('button', { key: folder.path, type: 'button', role: 'menuitemradio', 'aria-checked': folder.path === value, title: folder.path, onClick: () => choose(folder.path) },
      h('span', { className: 'bt-folder-copy' }, h('span', { className: 'bt-menu-label' }, folder.title), h('span', { className: 'bt-folder-path' }, folder.path)),
      h(Tick, { on: folder.path === value }))),
    h('div', { className: 'bt-menu-sep', role: 'separator' }),
    h('button', { type: 'button', role: 'menuitem', onClick: () => { close(); void picker.open() } }, h(FolderIcon), h('span', { className: 'bt-menu-label' }, t('Choose a folder…'))))
  return h(Fragment, null,
    h('button', {
      ref: button, type: 'button', className: 'bt-model-trigger', 'data-wide': wide || undefined,
      'aria-haspopup': 'menu', 'aria-expanded': isOpen, 'aria-label': team ? t('Team workspace: {folder}', { folder: value ?? '' }) : t('Working folder: {folder}', { folder: value ?? fallback }),
      title: value, onClick: toggle, disabled,
    },
    h('span', { className: 'bt-model-copy' },
      h('span', { className: 'bt-model-name' }, value ? folderName(value) : fallback),
      value ? h('span', { className: 'bt-model-provider' }, value) : null),
    h(Caret)),
    shownPlace ? createPortal(h('div', { ref: menu, className: `bt-menu bt-model-menu bt-folder-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`, role: 'menu', 'aria-label': team ? t('Team workspace') : t('Working folder'), style: shownPlace, 'data-leaving': leaving || undefined },
      listView), document.body) : null,
    picker.dialog)
}

export const FOLDER_CSS = `
.bt-folder-view{display:flex;flex-direction:column;gap:2px;animation:bt-veil-in .14s ease-out}
.bt-folder-copy{flex:1;display:flex;flex-direction:column;min-width:0}
.bt-folder-copy .bt-menu-label{flex:none}
.bt-folder-path{min-width:0;font-size:11px;line-height:14px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-model-trigger:disabled{opacity:.6;cursor:default}
@media (prefers-reduced-motion:reduce){.bt-folder-view{animation:none}}
`
