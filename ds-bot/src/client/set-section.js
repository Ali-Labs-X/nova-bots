import { createElement as h } from 'react'

// The card a settings page is built from: a title and the rows inside it. The rows
// carry a label, a hint and the control that changes the setting.
export function SetSection({ title, className = '', children }) {
  return h('section', { className: `bt-set-section ${className}`.trim() }, h('h3', null, title), h('div', { className: 'bt-set-card' }, children))
}

export function SetRow({ label, hint, children, className = '' }) {
  return h('div', { className: `bt-set-row ${className}`.trim() },
    h('div', { className: 'bt-set-copy' }, h('span', null, label), hint ? h('span', { className: 'bt-set-hint' }, hint) : null),
    children ? h('div', { className: 'bt-set-control' }, children) : null)
}
