// The window draws the plugin's own views, so every action they call must exist here too. A
// missing one is a control that throws when it is used; those listed are only reached through
// something the window does not have, or behind a check for the action.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const CLIENT = '../../ds-bot/src/client/'
const ELSEWHERE = new Set([
  // DSH's own updates, accounts, settings, terminal, files and Agent Sessions.
  'checkUpdate', 'installOwnApp', 'checkOwnApp', 'openOwnApp', 'installUpdate', 'openAppUpdates', 'installDshUpdate',
  'openHarnessSettings', 'openHarnessOnboarding', 'canSignIn', 'signInEntry', 'closeSignIn', 'accountT', 'seatAccount', 'ownsModels',
  'newTerminal', 'openFiles', 'canOpenTerminal', 'canOpenFiles', 'referenceChat',
  'addAgent', 'removeAgent', 'openAgent', 'beginAgentRename', 'endAgentRename', 'archiveAgentSession', 'renameAgentSession',
  'openAgentSession', 'newAgentSession', 'isAgentSession',
  // DSH's frame and its classic mode.
  'setSurface', 'selectPanel', 'setPanelYield', 'setLeftDrawer', 'setSidebarPref', 'setSidebarWidth', 'toggleLeftHidden',
])

test('every action the shared views call exists in the window', () => {
  const own = read('../ui/src/team.js') + read(`${CLIENT}team-actions.js`) + read(`${CLIENT}browser-actions.js`)
  const missing = new Set()
  for (const name of readdirSync(new URL(CLIENT, import.meta.url))) {
    if (!name.endsWith('.js') || name === 'index.js') continue
    for (const [, action] of read(CLIENT + name).matchAll(/\bactions\??\.(\w+)/g)) {
      if (!ELSEWHERE.has(action) && !new RegExp(`\\b${action}(?::|,| *\\(| =)`).test(own)) missing.add(`${name}: ${action}`)
    }
  }
  assert.deepEqual([...missing], [])
})
