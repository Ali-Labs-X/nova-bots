import { createElement as h, Fragment, useState } from 'react'
import { ProvidersPage } from './providers-page.js'
import { SetSection } from './set-section.js'
import { freePriority } from './surface.js'
import { hostText, t } from './i18n.js'

// The runtime's Models settings page reads the Host's settings mirror. A page that
// is not the engine's own loopback has none: there the Host keeps the settings in
// memory, the mirror has no view, and the page can never load. The plugin's own page
// goes through the plugin's channel and answers in every window, so on such a page
// it takes the Models entry. On a loopback page the runtime's page keeps its seat.
export const pluginOwnsModels = host => host?.isLoopback === false

// The Models entry of the settings, at a priority below the runtime's own entry:
// the lowest priority renders first and takes the entry.
export const modelsSectionOptions = entries => ({
  name: 'settings.section',
  id: 'models',
  order: 10,
  priority: freePriority(entries, { priority: -100, id: 'models' }),
})

// The plugin's page as a section of another plugin's settings. A refusal from the
// host shows as a line under the page, the way the plugin's own dialog shows it.
export function ModelsSection({ actions }) {
  const [error, setError] = useState('')
  const run = promise => Promise.resolve(promise)
    .then(() => { setError(''); return true })
    .catch((failure) => { setError(hostText(failure?.message ?? String(failure))); return false })
  return h(Fragment, null,
    error ? h('div', { className: 'bt-error', role: 'alert', style: { padding: 0 } }, error) : null,
    h(ProvidersPage, { actions, run, Section: SetSection }))
}

// Register the plugin's page as the Models section of the settings of another
// plugin. Nothing is registered on a page the runtime's own page can serve.
export function installModelsSection(ctx, { host, face, label = () => t('Models') }) {
  if (!pluginOwnsModels(host)) return undefined
  return ctx.slots.inject('settings.section', () => ctx.slots.register({
    ...modelsSectionOptions(ctx.slots.entries('settings.section')),
    label,
    inject: face,
  }, ModelsSection))
}
