import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

import { FAILED_START_MISSES, failureStatus, startRosterPoll } from '../src/client/roster-poll.js'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))

// The sidebar renders as plain functions: the browser's React is a stand-in.
const react = {
  createContext: initial => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx },
  useContext: ctx => ctx.value,
  useCallback: fn => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {}, useState: initial => [initial, () => {}],
  useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id',
}
const { outputFiles } = await build({
  stdin: {
    contents: "export { TeamSidebar } from './src/client/sidebar.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: name => (name === 'react' ? react : {}), window: { innerWidth: 1280 } })
const { TeamSidebar } = module.exports

const settle = () => new Promise(resolve => setImmediate(resolve))

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

function hints(ui) {
  const roster = { bots: [], rooms: [], agents: [], byId: {}, ready: false }
  const tree = TeamSidebar({
    wide: true,
    actions: Object.fromEntries(['openSession', 'openAgent', 'openAgentSession', 'newAgentSession', 'openMenu', 'openPalette', 'openNewChat', 'toggleSidebar', 'clearUnread', 'setLeftDrawer', 'setSidebarWidth', 'setSidebarPref'].map(name => [name, () => {}])),
    useRoster: pick => pick(roster), useUi: pick => pick({ unread: {}, ...ui }), useRegistry: pick => pick({}),
    useSessions: pick => pick({ ids: [], byId: {} }), useUpdate: () => ({}),
  })
  const found = []
  const walk = node => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    const className = node.props?.className
    if (typeof className === 'string' && className.includes('bt-hint')) {
      found.push({ text: textOf(node.props.children), className, role: node.props?.role })
    }
    walk(node.props?.children)
  }
  walk(tree)
  return found
}

// A poll that is refused drives the failure hint, with the status in it.
async function refusedPoll(error) {
  const failures = []
  let recovered = 0
  const queue = []
  const poll = startRosterPoll({
    pull: async () => { throw error },
    onStartFailed: status => failures.push(status),
    onRecovered: () => { recovered += 1 },
    schedule: fn => { queue.push(fn); return queue.length },
    cancel: () => {},
  })
  poll.start()
  await settle()
  return {
    failures,
    recovered: () => recovered,
    async tick() { queue.shift()(); await settle() },
  }
}

test('a refused poll names the status it was refused with', () => {
  assert.equal(failureStatus(Object.assign(new Error('HTTP 401'), { code: 'HTTP_401' })), 'HTTP 401')
  assert.equal(failureStatus(Object.assign(new Error('HTTP 503'), { code: 'HTTP_503' })), 'HTTP 503')
  assert.equal(failureStatus(Object.assign(new Error('HTTP 404'), { code: 'HTTP_404' })), 'HTTP 404')
  // A network miss is the host reconnecting, not a start-up failure (#516).
  assert.equal(failureStatus(Object.assign(new Error('network'), { code: 'NETWORK' })), '')
  assert.equal(failureStatus(new Error('plain')), '')
})

test('a poll answered with 401 reports the failed start instead of waiting forever', async () => {
  const poll = await refusedPoll(Object.assign(new Error('HTTP 401'), { code: 'HTTP_401' }))
  for (let i = 0; i < FAILED_START_MISSES - 2; i += 1) await poll.tick()
  assert.deepEqual(poll.failures, [], 'a few refused answers are not a failed start')
  await poll.tick()
  assert.deepEqual(poll.failures, ['HTTP 401'])
})

test('a poll answered with 503 reports the failed start too', async () => {
  const poll = await refusedPoll(Object.assign(new Error('HTTP 503'), { code: 'HTTP_503' }))
  for (let i = 0; i < FAILED_START_MISSES - 1; i += 1) await poll.tick()
  assert.deepEqual(poll.failures, ['HTTP 503'])
})

test('a poll that cannot reach the host stays a reconnect', async () => {
  const poll = await refusedPoll(Object.assign(new Error('network error'), { code: 'NETWORK' }))
  for (let i = 0; i < FAILED_START_MISSES + 2; i += 1) await poll.tick()
  assert.deepEqual(poll.failures, [])
})

test('the roster coming back clears the failure', async () => {
  let failing = true
  const failures = []
  let recovered = 0
  const queue = []
  const poll = startRosterPoll({
    pull: async () => { if (failing) throw Object.assign(new Error('HTTP 503'), { code: 'HTTP_503' }) },
    onStartFailed: status => failures.push(status),
    onRecovered: () => { recovered += 1 },
    schedule: fn => { queue.push(fn); return queue.length },
    cancel: () => {},
  })
  poll.start()
  await settle()
  for (let i = 0; i < FAILED_START_MISSES - 1; i += 1) { queue.shift()(); await settle() }
  assert.deepEqual(failures, ['HTTP 503'])
  failing = false
  queue.shift()()
  await settle()
  assert.equal(recovered, 1)
})

test('the sidebar shows the failure with its status, not the endless wait', () => {
  const failed = hints({ bootFailed: true, bootFailure: 'HTTP 401' })
  assert.equal(failed.length, 1)
  assert.match(failed[0].text, /HTTP 401/)
  assert.match(failed[0].text, /could not start/)
  // The endless wait is gone.
  assert.doesNotMatch(failed[0].text, /Setting up your Main Bot/)
  // Marked like a failed host call on our pages: `.bt-error` with `role="alert"`.
  assert.match(failed[0].className, /bt-error/)
  assert.equal(failed[0].role, 'alert')
})

test('the sidebar keeps the wait while the API is still answering', () => {
  const waiting = hints({ bootFailed: false, bootFailure: '' })
  assert.equal(waiting.length, 1)
  assert.match(waiting[0].text, /Setting up your Main Bot/)
  // The wait is a progress note, not an error.
  assert.doesNotMatch(waiting[0].className, /bt-error/)
  assert.equal(waiting[0].role, undefined)
})
