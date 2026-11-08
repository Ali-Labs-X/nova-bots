// The window talks to the Host at the Host's own origin: the page is served by the runtime's
// own frontend-static seat out of app/ui/dist and answers on the Host's address, so the
// launch URL, the session cookie and the relative API calls of the plugin all keep working.
// The rework that served the page over a `nova-bots://` scheme is gone, and this test keeps
// it gone: no custom scheme, no window that loads one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import { state } from './helpers/fake-electron.mjs'
import { state as hostState } from './helpers/fake-host-process.mjs'
import { startApp, trayMenu, waitFor, window } from './helpers/app-harness.mjs'
import { installHooks } from './helpers/register.mjs'

await installHooks()

before(async () => { await startApp() })

test('the main process registers no scheme of its own', () => {
  assert.deepEqual(state.protocols ?? {}, {}, 'no custom protocol is registered')
})

test('the window is served by the Host at its own origin', async () => {
  await waitFor(() => state.windows.length > 0, 'open the window')
  const win = window()
  hostState.release()
  await waitFor(() => win.loaded.some(url => url.includes('token=')), 'reach the Host')
  assert.ok(win.loaded.some(url => url.startsWith('http://127.0.0.1:')), 'the page comes from the Host')
})

test('no window ever loads a nova-bots:// page', async () => {
  await waitFor(() => state.windows.length > 0, 'open the window')
  const urls = state.windows.flatMap(win => win.loaded)
  assert.deepEqual(urls.filter(url => url.startsWith('nova-bots://')), [], 'no page of the custom scheme')
})

test('the source of the main process knows no custom scheme', () => {
  const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8')
  assert.equal(source.includes('nova-bots://'), false, 'the scheme is gone from the source')
  assert.equal(source.includes('registerBufferProtocol'), false, 'no protocol handler is registered')
  assert.equal(/protocol.*from 'electron'/u.test(source), false, 'electron\'s protocol is not imported')
})

test('the app ends', async () => {
  trayMenu().at(-1).click()
  await waitFor(() => state.quits > 0, 'end the app')
  await waitFor(() => state.tray.destroyed === true, 'take the tray away')
})
