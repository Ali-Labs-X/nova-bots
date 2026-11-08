import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const react = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  createContext: initial => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx },
  useContext: ctx => ctx.value,
  useMemo: make => make(),
  useCallback: fn => fn,
  useId: () => 'dv-id',
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: current => ({ current }),
}

async function load(entry) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  })
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    require: name => {
      if (name === 'react') return react
      if (name === 'react-dom') return { createPortal: node => node }
      return {}
    },
  })
  return module.exports
}

const { pluginOwnsModels, modelsSectionOptions, installModelsSection, ModelsSection } = await load('../src/client/models-section.js')
const { providerActions } = await load('../src/client/provider-actions.js')
const { ModelChoiceDock } = await load('../src/client/model-menu.js')

function nodes(tree, match) {
  if (!tree || typeof tree !== 'object') return []
  return [...(match(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, match))]
}

// The slot ledger of a settings UI that already carries Nova's own Models entry.
function fakeSlots(entries) {
  const registered = []
  return {
    registered,
    ctx: {
      slots: {
        entries: () => entries,
        inject: (name, run) => { run(); return () => {} },
        register: (options, component) => { registered.push([options, component]); return () => {} },
      },
    },
  }
}

test("the plugin's page owns the models only where Nova's own page cannot load", () => {
  assert.equal(pluginOwnsModels({ isLoopback: false }), true)
  assert.equal(pluginOwnsModels({ isLoopback: true }), false)
  assert.equal(pluginOwnsModels(undefined), false)
})

test('the plugin takes the Models entry of another plugin, below its own entry', () => {
  const { ctx, registered } = fakeSlots([{ options: { id: 'models', order: 10, priority: 0 } }])
  installModelsSection(ctx, { host: { isLoopback: false }, face: () => ({ actions: {} }) })
  assert.equal(registered.length, 1)
  const [options, component] = registered[0]
  assert.equal(options.name, 'settings.section')
  assert.equal(options.id, 'models')
  assert.ok(options.priority < 0, `the plugin's entry takes the cell: ${options.priority}`)
  assert.equal(component, ModelsSection)
  // The entry that renders is the plugin's own page, not Nova's.
  const tree = ModelsSection({ actions: {} })
  assert.equal(nodes(tree, node => node.type?.name === 'ProvidersPage').length, 1)
})

test("Nova's own page keeps the Models entry on a page it can serve", () => {
  const { ctx, registered } = fakeSlots([{ options: { id: 'models', order: 10, priority: 0 } }])
  installModelsSection(ctx, { host: { isLoopback: true }, face: () => ({ actions: {} }) })
  assert.deepEqual(registered, [])
  assert.ok(modelsSectionOptions([]).priority < 0)
})

test('the models page saves through the plugin channel', async () => {
  const calls = []
  const actions = providerActions((endpoint, payload) => { calls.push([endpoint, payload]); return Promise.resolve({ available: true, providers: [] }) })
  await actions.providers()
  await actions.setProviderKey('minimax', 'secret-value')
  await actions.setProviderKey('minimax', null)
  await actions.addProvider({ custom: true, provider: 'my-loco', baseURL: 'http://127.0.0.1:8200/v1', api: 'openai-completions', models: [{ id: 'a' }] })
  await actions.providerModels({ baseURL: 'http://127.0.0.1:8200/v1', api: 'openai-completions' })
  await actions.removeProvider('my-loco')
  assert.deepEqual(calls.map(([endpoint, payload]) => [endpoint, payload === undefined ? undefined : JSON.parse(JSON.stringify(payload))]), [
    ['providers', undefined],
    ['provider-key', { provider: 'minimax', value: 'secret-value' }],
    ['provider-key', { provider: 'minimax', value: null }],
    ['provider-add', { custom: true, provider: 'my-loco', baseURL: 'http://127.0.0.1:8200/v1', api: 'openai-completions', models: [{ id: 'a' }] }],
    ['provider-models', { baseURL: 'http://127.0.0.1:8200/v1', api: 'openai-completions' }],
    ['provider-remove', { provider: 'my-loco' }],
  ])
})

const models = [
  { ref: 'official/flash', provider: 'official', providerName: 'DeepSeek', name: 'DeepSeek Flash' },
  { ref: 'local/flash', provider: 'local', providerName: 'Ollama', name: 'DeepSeek Flash' },
]

function dock(actions = {}) {
  const picked = []
  const bot = { id: 'chief', name: 'Chief' }
  const roster = { ready: true, byId: { chief: bot }, models, defaultModel: models[0].ref }
  const tree = ModelChoiceDock({
    sessionId: bot.id,
    useRoster: select => select(roster),
    actions: {
      updateBot: (id, patch) => { picked.push([id, patch.model]); return Promise.resolve() },
      ...actions,
    },
  })
  return { tree, picked }
}

test("a Bot's model is saved through the plugin channel", () => {
  const { tree, picked } = dock()
  const chip = nodes(tree, node => node.type === 'button' && node.props.className === 'bt-model-chip' && String(node.props.title).startsWith('official/flash'))
  assert.equal(chip.length, 1)
  chip[0].props.onClick()
  assert.deepEqual(picked, [['chief', 'official/flash']])
})

test('the models entry of the model menu opens the plugin own page', () => {
  let opened = 0
  let harness = 0
  const { tree } = dock({
    openModels: () => { opened += 1 },
    openHarnessSettings: () => { harness += 1 },
  })
  const manage = nodes(tree, node => node.type === 'button' && node.children.includes('Manage models'))
  assert.equal(manage.length, 1)
  manage[0].props.onClick()
  assert.equal(opened, 1)
  assert.equal(harness, 0)
})
