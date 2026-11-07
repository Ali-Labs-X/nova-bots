// The app's own UI, served by the Host at the Host's own origin. The runtime's static
// frontend plugin (@deepseek-ai/dsh-host-frontend-static) claims the webserver's fallback
// seat and serves a dist directory; the runtime's own web front end (the `web-runtime`
// row) holds that seat with the runtime's dist. The dist is workspace knowledge of the
// composing application, and the app is that application: the app's own `ui/dist` takes
// the seat through a `--patch` overlay the app writes into its own data area next to the
// profiles (`<runtime home>/profiles/ui.patch.yml`), which the runtime reads only through
// `patchFiles`. The window then loads the Host's launch URL as before: the Host answers
// it with the app's own index.html and mints the cookie on that response, so the page is
// same-origin and the plugin's own relative channel calls work unchanged.
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'

export const UI_PATCH_NAME = 'ui.patch.yml'

/**
 * The overlay rows that put the app's own UI in the webserver's fallback seat.
 * @param {string} uiIndex - the absolute path of the app's own index.html
 * @returns {import('@deepseek-ai/cordis-plugin-include').PatchOptions[]}
 */
export function uiPatch(uiIndex) {
  return [
    // The runtime's own front end holds the seat with the runtime's dist; the app's UI
    // takes it over. A disabled row is not a failure: the runtime's startup audit skips
    // a disabled entry, so the seat's old owner may go without failing the boot.
    { id: 'web-runtime', disabled: true },
    // The runtime's dev-context bundle waits for the `webApp` service that the row above
    // takes away, so it stays pending and the Host warns on every launch. Its two prompt
    // paragraphs describe a harness checkout and a web surface, which a packaged desktop
    // app has neither of.
    { id: 'harness-dev-context', disabled: true },
    { insert: [{ id: 'frontend-static', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: uiIndex } }] },
  ]
}

/**
 * Write the overlay next to the profiles and report it for `patchFiles`; without the
 * app's own index (a build that has no UI yet), drop a stale one from an earlier launch
 * so that the runtime's own front end answers the window.
 * @param {import('@deepseek-ai/dsh-app-boot').Profile} profile
 * @param {string} [uiIndex] - the absolute path of the app's own index.html
 * @returns {string[]} the `patchFiles` argument for this launch
 */
export function reconcileUiPatch(profile, uiIndex = process.env.NOVA_BOTS_UI_INDEX) {
  const file = join(dirname(profile.dir), UI_PATCH_NAME)
  if (uiIndex === undefined || uiIndex === '' || !existsSync(uiIndex)) {
    rmSync(file, { force: true })
    return []
  }
  writeFileSync(file, stringify(uiPatch(uiIndex)), 'utf8')
  return [file]
}
