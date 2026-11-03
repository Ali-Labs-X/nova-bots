// Rebrands the installed engine web shell at image build time.
//
// The shell is compiled into the @deepseek-ai/dsh package we install from npm, so
// the Nova Bots identity is applied here instead of in the plugin: the HTML head,
// the manifest and icons, the startup log, and the default sidebar brand module.
// Everything inside a conversation is left alone; the plugin and the runtime layer
// (nova-brand.js) cover interface copy.

import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_ROOT = process.env.DSH_ROOT ?? '/usr/local/lib/node_modules/@deepseek-ai/dsh'
const PACKAGES = join(DSH_ROOT, 'node_modules', '@deepseek-ai')
const DIST = join(PACKAGES, 'dsh-web-frontend', 'dist')
const BRAND = join(PACKAGES, 'dsh-client-ui-brand-official', 'lib', 'client.js')
const WEB_APP = join(PACKAGES, 'dsh-web-app', 'lib')

const fail = (message) => {
  console.error(`nova patch: ${message}`)
  process.exit(1)
}
const read = (path) => readFileSync(path, 'utf8')
const write = (path, text) => writeFileSync(path, text)
const replaceAll = (text, from, to) => text.split(from).join(to)

if (!existsSync(DIST)) fail(`web shell not found at ${DIST}`)

// ---- index.html ---------------------------------------------------------
const htmlPath = join(DIST, 'index.html')
let html = read(htmlPath)
html = html.replace(/<title>[^<]*<\/title>/, '<title>Nova Bots</title>')
html = html.replace(/[ \t]*<link rel="icon"[^>]*>\r?\n?/g, '')
html = html.replace(
  /<link rel="manifest" href="\.\/manifest\.webmanifest" \/>/,
  '<link rel="manifest" href="./manifest.webmanifest" />\n    <link rel="icon" type="image/svg+xml" href="./nova-icon.svg" />\n    <meta name="theme-color" content="#070A16" />',
)
html = html.replace(
  '</head>',
  '    <link rel="stylesheet" href="./nova-ui.css" />\n    <script defer src="./nova-brand.js"></script>\n  </head>',
)
if (!html.includes('nova-brand.js') || !html.includes('nova-ui.css')) fail('could not inject the Nova layer into index.html')
write(htmlPath, html)

// ---- icons and static assets -------------------------------------------
// Our own mark, under our own name. The shell's dark variant keeps the name
// the shell asks for, so the file it requests still holds our icon.
copyFileSync(join(HERE, 'nova-icon.svg'), join(DIST, 'nova-icon.svg'))
copyFileSync(join(HERE, 'nova-icon.svg'), join(DIST, 'favicon-dark.svg'))
copyFileSync(join(HERE, 'nova-ui.css'), join(DIST, 'nova-ui.css'))
copyFileSync(join(HERE, 'nova-brand.js'), join(DIST, 'nova-brand.js'))

// ---- web app manifest ---------------------------------------------------
const manifestPath = join(DIST, 'manifest.webmanifest')
const manifest = JSON.parse(read(manifestPath))
manifest.name = 'Nova Bots'
manifest.short_name = 'Nova'
manifest.description = 'A team of long-lived Bots that work together'
manifest.theme_color = '#070A16'
manifest.background_color = '#070A16'
// The shell's manifest pointed at its own icon; ours is the one now.
manifest.icons = [{ src: 'nova-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// ---- default sidebar brand module --------------------------------------
if (!existsSync(BRAND)) fail(`brand module not found at ${BRAND}`)
copyFileSync(join(HERE, 'brand-module.js'), BRAND)

// ---- startup log and engine-facing copy --------------------------------
if (existsSync(WEB_APP)) {
  for (const name of readdirSync(WEB_APP)) {
    if (!name.endsWith('.js')) continue
    const path = join(WEB_APP, name)
    let text = read(path)
    const before = text
    text = replaceAll(text, 'dsh web', 'Nova Bots')
    text = replaceAll(text, 'DeepSeek Harness', 'Nova Bots')
    if (text !== before) write(path, text)
  }
}

// The CLI's own warnings and help are the last place the old name can surface
// outside a conversation. Only display strings change; the `dsh` entry point
// stays for compatibility inside the image.
const CORE = join(DSH_ROOT, 'lib')
if (existsSync(CORE)) {
  for (const name of readdirSync(CORE)) {
    if (!name.endsWith('.js')) continue
    const path = join(CORE, name)
    let text = read(path)
    const before = text
    text = replaceAll(text, '"dsh: ', '"Nova Bots: ')
    text = replaceAll(text, "'dsh: ", "'Nova Bots: ")
    text = replaceAll(text, '`dsh: ', '`Nova Bots: ')
    text = replaceAll(text, 'program.name("dsh")', 'program.name("nova")')
    text = replaceAll(text, 'DeepSeek Harness', 'Nova Bots')
    if (text !== before) write(path, text)
  }
}

// ---- the sign-in page ----------------------------------------------------
// An unauthenticated request gets a plain text line from the engine. The
// Nova Bots workspace gets a real sign-in page instead: the same dark aurora
// look as the app, with the token field the login URL uses. API requests keep
// the short text answer.
const CONNECTION = join(PACKAGES, 'dsh-client-connection', 'lib', 'index.js')
if (existsSync(CONNECTION)) {
  let text = read(CONNECTION)
  const unauthorized = /writeUnauthorized\(req, res\) \{\s*res\.writeHead\(401, \{\s*"cache-control": "no-store",\s*"content-type": "text\/plain; charset=utf-8"\s*\}\);\s*res\.end\(req\.method === "HEAD" \? void 0 : "[^"]*"\);\s*\}/
  if (!unauthorized.test(text)) fail('could not find the unauthorized response in the connection module')
  if (!text.includes('NOVA_LOGIN_PAGE')) {
    const page = JSON.stringify(read(join(HERE, 'login.html')))
    const replacement = [
      'writeUnauthorized(req, res) {',
      '\t\tconst accept = String(req.headers?.["accept"] ?? "");',
      '\t\tif (req.method === "GET" && accept.includes("text/html")) {',
      '\t\t\tres.writeHead(401, {',
      '\t\t\t\t"cache-control": "no-store",',
      '\t\t\t\t"content-type": "text/html; charset=utf-8"',
      '\t\t\t});',
      '\t\t\tres.end(NOVA_LOGIN_PAGE);',
      '\t\t\treturn;',
      '\t\t}',
      '\t\tres.writeHead(401, {',
      '\t\t\t"cache-control": "no-store",',
      '\t\t\t"content-type": "text/plain; charset=utf-8"',
      '\t\t});',
      '\t\tres.end(req.method === "HEAD" ? void 0 : "Nova Bots: sign in to continue.\\n");',
      '\t}',
    ].join('\n')
    text = text.replace(unauthorized, replacement)
    text = `const NOVA_LOGIN_PAGE = ${page};\n${text}`
    write(CONNECTION, text)
  }
}

// ---- the launch token file ----------------------------------------------
// The engine prints a login token when it starts, and the token changes with
// every start. The portal in front of the engine needs it to sign a browser
// in, so the engine also writes it to a file it can read.
if (existsSync(WEB_APP)) {
  const webApp = join(WEB_APP, 'index.js')
  if (existsSync(webApp)) {
    let text = read(webApp)
    if (!text.includes('NOVA_LAUNCH_TOKEN_FILE')) {
      const lines = text.split('\n')
      const at = lines.findIndex(line => line.includes('if (config.printUrl) console.log('))
      if (at !== -1) {
        lines.splice(at + 1, 0, [
          '\t\t\ttry {',
          '\t\t\t\tconst novaFs = process.getBuiltinModule("node:fs");',
          '\t\t\t\tconst novaToken = new URL(authenticatedUrl).searchParams.get("token");',
          '\t\t\t\tif (novaToken) novaFs.writeFileSync(process.env.NOVA_LAUNCH_TOKEN_FILE ?? "/data/.launch-token", novaToken, { mode: 0o600 });',
          '\t\t\t} catch {}',
        ].join('\n'))
        write(webApp, lines.join('\n'))
      }
    }
  }
}

console.log('nova patch: web shell, manifest, icons, sign-in page and startup log are branded')
