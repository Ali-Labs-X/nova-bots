// Compatibility identifiers are kept here so released installs can upgrade in place.
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const PRODUCT_NAME = 'Nova Bots'
export const APP_ID = 'io.github.alilabsx.novabots'
// The names of the releases before this one, newest first: an installed app keeps the
// data folder and the keychain entry of the name it was installed with.
export const LEGACY_PRODUCT_NAMES = ['DS Bot', 'DeepSeek Bot']
export const LEGACY_PRODUCT_NAME = LEGACY_PRODUCT_NAMES[0]
export const LEGACY_ENGINE = 'deepseek-bot-engine'
// The artifact names of the releases before this one, newest first: an update client
// that was released before the rename waits for a file of its own name.
export const LEGACY_ARTIFACT_PREFIXES = ['DS-Bot', 'DeepSeek-Bot']
export const LEGACY_ARTIFACT_PREFIX = LEGACY_ARTIFACT_PREFIXES[0]

/** Keep the shell data and Chromium encryption identity of an existing installation. */
export function configureIdentity(app, { env = process.env, platform = process.platform, exists = existsSync, mkdir = mkdirSync } = {}) {
  const current = app.getPath('userData')
  const explicit = env.DS_BOT_SHELL_DATA
  // An explicitly isolated run must never discover an installed application.
  const legacy = explicit || env.DS_BOT_HOME ? undefined : LEGACY_PRODUCT_NAMES
    .map(name => ({ name, path: join(app.getPath('appData'), name) }))
    .find(entry => exists(entry.path))
  const reuse = legacy !== undefined && !exists(join(current, 'locations.json'))
  const userData = explicit || (reuse ? legacy.path : current)
  mkdir(userData, { recursive: true })
  app.setPath('userData', userData)
  app.setPath('sessionData', userData)
  if (platform === 'win32') app.setAppUserModelId(APP_ID)
  // Electron 44 captures this name for OSCrypt before ready. Restore the visible name
  // before creating menus or windows; the captured keychain identity stays unchanged.
  if (reuse && platform !== 'win32') {
    app.setName(legacy.name)
    app.once('ready', () => { app.setName(PRODUCT_NAME) })
  }
  return { userData, legacy: reuse }
}
