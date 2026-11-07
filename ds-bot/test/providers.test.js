import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install as installModels } from '../src/host/models.js'
import { checkKey, install, keyRefFor } from '../src/host/providers.js'

// A DSH with the official DeepSeek route, an account route, and the pi-ai adapter: its
// directory offers catalog providers, and its settings take path writes the way DSH's
// do, under a revision. Routes come and go with the pi-ai section.
function dsh({ keys = {}, readOnly = [], user = {}, base = {}, defaultSelection, catalog = { anthropic: ['claude-a', 'claude-b'], moonshotai: ['kimi-k3'] } } = {}) {
  const store = { ...keys }
  const writes = []
  const listeners = new Map()
  let revision = 0
  let pi = { user: structuredClone(user), base: structuredClone(base) }
  const piValue = () => ({ providers: { ...pi.base.providers, ...pi.user.providers } })
  const routes = () => Object.keys(piValue().providers)
  const services = {
    settings: {
      describe: () => [
        { ns: 'llm-deepseek', revision: 0, value: { apiKeyEnv: 'DEEPSEEK_API_KEY' }, user: {}, base: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
        { ns: 'llm-deepseek-account', revision: 0, value: {}, user: {}, base: {} },
        { ns: 'llm-pi-ai', revision, value: piValue(), user: structuredClone(pi.user), base: structuredClone(pi.base) },
      ],
      mutate: async (ns, ops, expected) => {
        if (expected !== revision) throw new Error(`settings namespace "${ns}" changed since it was read`)
        const next = structuredClone(pi.user)
        for (const op of ops) {
          const parent = op.path.slice(0, -1).reduce((value, key) => (value[key] ??= {}), next)
          if (op.op === 'set') parent[op.path.at(-1)] = op.value
          else delete parent[op.path.at(-1)]
        }
        for (const [id, profile] of Object.entries(next.providers ?? {})) {
          if (!(id in catalog) && !(profile.models?.length > 0)) throw new Error(`llm-pi-ai: provider "${id}" resolves no models`)
        }
        writes.push([ns, ops])
        pi = { ...pi, user: next }
        revision += 1
      },
    },
    credentials: {
      describe: async ref => ({ configured: ref in store, writable: !readOnly.includes(ref) }),
      set: async (ref, value) => { writes.push(['set', ref]); store[ref] = value },
      unset: async (ref) => { writes.push(['unset', ref]); delete store[ref] },
    },
  }
  const discovered = []
  if (defaultSelection !== undefined) services.agentDefaultModel = { currentSelection: () => defaultSelection }
  const ctx = {
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    get: name => services[name],
    llm: {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'deepseek-account', name: 'DeepSeek Account' }, ...routes().map(id => ({ id, name: piValue().providers[id].displayName ?? id }))],
      listModels: async (id) => {
        if (id === 'deepseek-official') return [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }]
        if (id === 'deepseek-account') return []
        const profile = piValue().providers[id]
        const models = (catalog[id] ?? profile.models ?? []).map(model => (typeof model === 'string' ? { id: model } : model))
        // The runtime's model list carries the id and the name, and nothing else.
        return models.map(model => ({ id: model.id, ...(model.name ? { name: model.name } : {}) }))
      },
      listConfigurableProviders: () => [
        { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
        { provider: 'deepseek-account', displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] },
        ...Object.keys(catalog).map(id => ({ provider: id, displayName: id, settingsNs: 'llm-pi-ai', settingsPath: ['providers', id], declared: false })),
        ...routes().filter(id => !(id in catalog)).map(id => ({ provider: id, displayName: piValue().providers[id].displayName ?? id, settingsNs: 'llm-pi-ai', settingsPath: ['providers', id], declared: true })),
      ],
      discoverModels: async (ns, request) => { discovered.push([ns, request]); return [{ id: 'relay-1', name: 'Relay One', contextWindow: 128000, inputModalities: ['text'] }, { id: 'relay-2' }] },
    },
  }
  const rt = { ctx, state: { bots: {} } }
  installModels(rt)
  install(rt)
  return { rt, store, writes, listeners, discovered }
}

const needing = async rt => (await rt.catalog({ fresh: true })).filter(entry => entry.needsKey).map(entry => entry.provider)
const row = (view, id) => view.providers.find(provider => provider.id === id)

test('models of a provider whose API key is set nowhere need the key', async () => {
  const user = { providers: { moonshotai: { apiKeyEnv: 'MOONSHOTAI_API_KEY' }, bedrock: {} } }
  const catalog = { moonshotai: ['kimi-k3'], bedrock: ['nova'] }
  assert.deepEqual(await needing(dsh({ user, catalog }).rt), ['deepseek-official', 'moonshotai'])
  assert.deepEqual(await needing(dsh({ user, catalog, keys: { DEEPSEEK_API_KEY: 'k' } }).rt), ['moonshotai'])
  // A route without a key reference authenticates some other way.
  assert.ok((await dsh({ user, catalog }).rt.catalog()).some(entry => entry.provider === 'bedrock' && !entry.needsKey))
})

test('without DSH settings or credentials no model needs a key, and there is no Models page', async () => {
  const { rt } = dsh()
  rt.ctx.get = () => undefined
  assert.deepEqual(await needing(rt), [])
  assert.deepEqual(await rt.providersView(), { available: false })
})

test('the page lists the providers set up and the ones DSH can add', async () => {
  const { rt } = dsh({ keys: { DEEPSEEK_API_KEY: 'k' }, user: { providers: { moonshotai: { apiKeyEnv: 'MOONSHOTAI_API_KEY' } } } })
  const view = await rt.providersView()
  assert.deepEqual(view.providers.map(provider => [provider.id, provider.key, provider.removable, provider.models.length]), [
    ['deepseek-official', { configured: true, writable: true }, false, 1],
    ['moonshotai', { configured: false, writable: true }, true, 1],
  ])
  // The account route has no key and no models before a sign-in.
  assert.equal(row(view, 'deepseek-account'), undefined)
  assert.deepEqual(view.addable, [{ id: 'anthropic', name: 'anthropic' }])
  assert.deepEqual(view.protocols, ['openai-completions', 'openai-responses', 'anthropic-messages'])
})

test('a saved API key goes to the provider\'s reference and frees its models', async () => {
  const { rt, store, writes } = dsh()
  await rt.setProviderKey('deepseek-official', '  sk-test  ')
  assert.deepEqual(writes, [['set', 'DEEPSEEK_API_KEY']])
  assert.equal(store.DEEPSEEK_API_KEY, 'sk-test')
  assert.deepEqual(await needing(rt), [])
  await rt.clearProviderKey('deepseek-official')
  assert.equal('DEEPSEEK_API_KEY' in store, false)
  await assert.rejects(rt.setProviderKey('deepseek-account', 'sk-test'), /deepseek-account takes no API key here/)
})

test('a key set outside Nova Bots is not overwritten or removed', async () => {
  const { rt, writes } = dsh({ keys: { DEEPSEEK_API_KEY: 'k' }, readOnly: ['DEEPSEEK_API_KEY'] })
  await assert.rejects(rt.setProviderKey('deepseek-official', 'sk-test'), /set outside Nova Bots/)
  await assert.rejects(rt.clearProviderKey('deepseek-official'), /set outside Nova Bots/)
  assert.deepEqual(writes, [])
  assert.deepEqual(row(await rt.providersView(), 'deepseek-official').key, { configured: true, writable: false })
})

test('a provider from DSH\'s list goes in with the key DSH\'s own page would name', async () => {
  const { rt, store, writes } = dsh()
  const view = await rt.addProvider({ provider: 'moonshotai', key: 'sk-kimi' })
  assert.deepEqual(writes, [['llm-pi-ai', [{ op: 'set', path: ['providers', 'moonshotai'], value: { apiKeyEnv: 'MOONSHOTAI_API_KEY' } }]], ['set', 'MOONSHOTAI_API_KEY']])
  assert.equal(store.MOONSHOTAI_API_KEY, 'sk-kimi')
  assert.deepEqual(row(view, 'moonshotai').models.map(model => model.ref), ['moonshotai/kimi-k3'])
  assert.equal(view.addable.some(entry => entry.id === 'moonshotai'), false)
  await assert.rejects(rt.addProvider({ provider: 'moonshotai', key: 'sk-kimi' }), /moonshotai is already set up/)
  await assert.rejects(rt.addProvider({ provider: 'deepseek-official' }), /already set up/)
  await assert.rejects(rt.addProvider({ provider: 'nowhere' }), /Nova offers no provider nowhere/)
})

test('a blank key keeps a key that is already there, else leaves the route without one', async () => {
  const { rt, writes } = dsh({ keys: { ANTHROPIC_API_KEY: 'k' } })
  await rt.addProvider({ provider: 'anthropic', key: '' })
  await rt.addProvider({ provider: 'moonshotai' })
  assert.deepEqual(writes.map(([, ops]) => ops[0].value), [{ apiKeyEnv: 'ANTHROPIC_API_KEY' }, {}])
})

test('a custom API goes in with its endpoint, protocol and the models picked', async () => {
  const { rt, store, writes } = dsh()
  await rt.addProvider({
    custom: true, provider: 'relay', name: ' My relay ', api: 'openai-completions', baseURL: ' https://relay.example/v1 ', key: 'sk-relay',
    models: [{ id: 'relay-1', name: 'Relay One', contextWindow: 128000, inputModalities: ['text'] }, 'relay-2'],
  })
  assert.deepEqual(writes[0], ['llm-pi-ai', [{ op: 'set', path: ['providers', 'relay'], value: {
    displayName: 'My relay', api: 'openai-completions', baseURL: 'https://relay.example/v1', apiKeyEnv: 'RELAY_API_KEY',
    models: [{ id: 'relay-1', name: 'Relay One', contextWindow: 128000, input: ['text'] }, { id: 'relay-2' }],
  } }]])
  assert.equal(store.RELAY_API_KEY, 'sk-relay')
  const view = await rt.providersView()
  assert.deepEqual([row(view, 'relay').name, row(view, 'relay').custom, row(view, 'relay').removable], ['My relay', true, true])
})

test('a custom API is refused before anything is written when it cannot serve', async () => {
  const { rt, writes } = dsh()
  const custom = { custom: true, provider: 'relay', api: 'openai-completions', baseURL: 'https://relay.example/v1', models: ['m'] }
  await assert.rejects(rt.addProvider({ ...custom, provider: 'My Relay' }), /lowercase letters, digits and dashes/)
  await assert.rejects(rt.addProvider({ ...custom, provider: 'anthropic' }), /Nova already offers anthropic/)
  await assert.rejects(rt.addProvider({ ...custom, api: 'grpc' }), /protocol must be one of/)
  await assert.rejects(rt.addProvider({ ...custom, baseURL: 'relay.example' }), /http or https/)
  await assert.rejects(rt.addProvider({ ...custom, baseURL: 'ftp://relay.example' }), /http or https/)
  await assert.rejects(rt.addProvider({ ...custom, models: [] }), /at least one model/)
  await assert.rejects(rt.addProvider({ ...custom, models: ['m', ' m '] }), /same id/)
  await assert.rejects(rt.addProvider({ ...custom, key: 'KEY=sk' }), /NAME=value/)
  assert.deepEqual(writes, [])
})

test('fetching models asks DSH about the endpoint, with the typed key for that question only', async () => {
  const { rt, discovered, store } = dsh()
  const models = await rt.discoverModels({ baseURL: 'https://relay.example/v1', api: 'openai-completions', key: 'sk-relay' })
  assert.deepEqual(discovered, [['llm-pi-ai', { baseURL: 'https://relay.example/v1', api: 'openai-completions', apiKey: 'sk-relay' }]])
  assert.deepEqual(models, [{ id: 'relay-1', name: 'Relay One', contextWindow: 128000, inputModalities: ['text'] }, { id: 'relay-2' }])
  assert.deepEqual(store, {})
  // A provider DSH ships is answered from its own catalog.
  await rt.discoverModels({ provider: 'anthropic' })
  assert.deepEqual(discovered.at(-1), ['llm-pi-ai', { provider: 'anthropic' }])
})

test('a model the profile marks as embedding is no chat model, and is listed as one', async () => {
  const user = { providers: { 'llama-cpp': { api: 'openai-completions', baseURL: 'http://127.0.0.1:8200/v1', models: [{ id: 'smollm2-135m-instruct', name: 'SmolLM2' }, { id: 'bge-small-en-v1.5', name: 'bge', embedding: true }] } } }
  const { rt } = dsh({ user })
  const catalog = await rt.catalog({ fresh: true })
  // The provider still serves it, so the catalog still has it, tagged.
  assert.deepEqual(catalog.filter(entry => entry.provider === 'llama-cpp').map(entry => [entry.ref, entry.embedding === true]), [
    ['llama-cpp/smollm2-135m-instruct', false],
    ['llama-cpp/bge-small-en-v1.5', true],
  ])
  // No picker offers it: the list the client gets and the list the tools offer.
  assert.deepEqual(rt.cachedChatModels().filter(entry => entry.provider === 'llama-cpp').map(entry => entry.ref), ['llama-cpp/smollm2-135m-instruct'])
  assert.deepEqual((await rt.chatModels()).filter(entry => entry.provider === 'llama-cpp').map(entry => entry.ref), ['llama-cpp/smollm2-135m-instruct'])
  // The page lists it once, marked.
  assert.deepEqual(row(await rt.providersView(), 'llama-cpp').models, [
    { ref: 'llama-cpp/smollm2-135m-instruct', name: 'SmolLM2' },
    { ref: 'llama-cpp/bge-small-en-v1.5', name: 'bge', embedding: true },
  ])
})

test('a Bot already pointed at an embedding model keeps it, and the provider answers', async () => {
  const user = { providers: { 'llama-cpp': { api: 'openai-completions', baseURL: 'http://127.0.0.1:8200/v1', models: [{ id: 'smollm2-135m-instruct', name: 'SmolLM2' }, { id: 'bge-small-en-v1.5', name: 'bge', embedding: true }] } } }
  const { rt } = dsh({ user })
  // The plugin does not refuse over a mark it cannot verify: the Bot keeps its model
  // and the provider's own error is what it hears.
  assert.equal(await rt.desiredModel({ model: 'llama-cpp/bge-small-en-v1.5' }), 'llama-cpp/bge-small-en-v1.5')
  // The picker does not offer it as a chat model.
  await assert.rejects(rt.resolveModel('llama-cpp/bge-small-en-v1.5'), /is an embedding model, not a chat model/)
  await assert.rejects(rt.resolveModel('bge-small-en-v1.5'), /is an embedding model, not a chat model/)
})

test('an embedding model is never the default model', async () => {
  const user = { providers: { 'llama-cpp': { api: 'openai-completions', baseURL: 'http://127.0.0.1:8200/v1', models: [{ id: 'bge-small-en-v1.5', name: 'bge', embedding: true }, { id: 'smollm2-135m-instruct', name: 'SmolLM2' }] } } }
  const { rt } = dsh({ user })
  await rt.catalog({ fresh: true })
  assert.notEqual(rt.cachedDefault(), 'llama-cpp/bge-small-en-v1.5')
  assert.ok(rt.cachedChatModels().some(entry => entry.ref === rt.cachedDefault()))
  // Not even when the profile's own default is the embedding model.
  const chosen = dsh({ user, defaultSelection: { provider: 'llama-cpp', model: 'bge-small-en-v1.5' } })
  await chosen.rt.catalog({ fresh: true })
  assert.notEqual(chosen.rt.cachedDefault(), 'llama-cpp/bge-small-en-v1.5')
  assert.ok(chosen.rt.cachedChatModels().some(entry => entry.ref === chosen.rt.cachedDefault()))
})

test('a profile id that differs from the runtime id by case or spacing leaves the model a chat model', async () => {
  const user = { providers: { 'llama-cpp': { api: 'openai-completions', baseURL: 'http://127.0.0.1:8200/v1', models: [{ id: ' BGE-Small-En-V1.5 ', name: 'bge', embedding: true }] } } }
  const { rt } = dsh({ user, catalog: { 'llama-cpp': ['bge-small-en-v1.5'] } })
  const catalog = await rt.catalog({ fresh: true })
  assert.deepEqual(catalog.filter(entry => entry.provider === 'llama-cpp').map(entry => [entry.ref, entry.embedding === true]), [['llama-cpp/bge-small-en-v1.5', false]])
  assert.deepEqual((await rt.chatModels()).filter(entry => entry.provider === 'llama-cpp').map(entry => entry.ref), ['llama-cpp/bge-small-en-v1.5'])
})

test('a mark that is not the strict boolean true leaves the model a chat model', async () => {
  const models = [{ id: 'm-false', embedding: false }, { id: 'm-string', embedding: 'false' }, { id: 'm-one', embedding: 1 }, { id: 'm-text', embedding: 'true' }]
  const { rt } = dsh({ user: { providers: { relay: { api: 'openai-completions', baseURL: 'https://relay.example/v1', models } } } })
  const catalog = await rt.catalog({ fresh: true })
  assert.deepEqual(catalog.filter(entry => entry.provider === 'relay').map(entry => [entry.ref, entry.embedding === true]), models.map(model => [`relay/${model.id}`, false]))
  assert.deepEqual((await rt.chatModels()).filter(entry => entry.provider === 'relay').map(entry => entry.ref), models.map(model => `relay/${model.id}`))
  assert.deepEqual(row(await rt.providersView(), 'relay').models.map(model => model.ref), models.map(model => `relay/${model.id}`))
})

test('a provider without a stored model list keeps every model it serves', async () => {
  const { rt } = dsh()
  const catalog = await rt.catalog({ fresh: true })
  assert.ok(catalog.some(entry => entry.ref === 'deepseek-official/deepseek-flash'))
  assert.deepEqual(row(await rt.providersView(), 'deepseek-official').models, [{ ref: 'deepseek-official/deepseek-flash', name: 'DeepSeek Flash' }])
})

test('the stored profile keeps the mark only when it is the boolean true', async () => {
  const { rt, writes } = dsh()
  await rt.addProvider({
    custom: true, provider: 'relay', api: 'openai-completions', baseURL: 'https://relay.example/v1',
    models: [{ id: 'r-1' }, { id: 'r-2', embedding: true }, { id: 'r-3', embedding: false }],
  })
  assert.deepEqual(writes[0][1][0].value.models, [{ id: 'r-1' }, { id: 'r-2', embedding: true }, { id: 'r-3' }])
})

test('removing a provider takes its key along unless another provider names it', async () => {
  const user = { providers: { moonshotai: { apiKeyEnv: 'MOONSHOTAI_API_KEY' }, kimi: { apiKeyEnv: 'MOONSHOTAI_API_KEY', api: 'openai-completions', baseURL: 'https://k.example/v1', models: [{ id: 'k' }] }, relay: { apiKeyEnv: 'RELAY_API_KEY', api: 'openai-completions', baseURL: 'https://r.example/v1', models: [{ id: 'r' }] } } }
  const { rt, store } = dsh({ user, keys: { MOONSHOTAI_API_KEY: 'a', RELAY_API_KEY: 'b' } })
  await rt.removeProvider('moonshotai')
  assert.equal(store.MOONSHOTAI_API_KEY, 'a')
  const view = await rt.removeProvider('relay')
  assert.equal('RELAY_API_KEY' in store, false)
  assert.deepEqual(view.providers.map(provider => provider.id), ['deepseek-official', 'kimi'])
  await assert.rejects(rt.removeProvider('relay'), /relay is not set up/)
  await assert.rejects(rt.removeProvider('deepseek-official'), /not set up/)
})

test('a route that comes with the setup stays', async () => {
  const { rt } = dsh({ base: { providers: { moonshotai: { apiKeyEnv: 'MOONSHOTAI_API_KEY' } } } })
  assert.equal(row(await rt.providersView(), 'moonshotai').removable, false)
  await assert.rejects(rt.removeProvider('moonshotai'), /comes with this setup/)
})

test('a changed credential drops the cached catalog', async () => {
  const { rt, store, listeners } = dsh()
  assert.deepEqual(await needing(rt), ['deepseek-official'])
  store.DEEPSEEK_API_KEY = 'k'
  assert.deepEqual((await rt.catalog()).filter(entry => entry.needsKey).map(entry => entry.provider), ['deepseek-official'])
  listeners.get('credentials/reference-updated')()
  assert.deepEqual((await rt.catalog()).filter(entry => entry.needsKey).map(entry => entry.provider), [])
})

test('an API key is what an HTTP header carries, without a NAME= or quotes', () => {
  assert.equal(checkKey(' sk-abc '), 'sk-abc')
  assert.equal(checkKey('YWJj=='), 'YWJj==')
  assert.throws(() => checkKey('   '), /Enter the API key/)
  assert.throws(() => checkKey(undefined), /Enter the API key/)
  assert.throws(() => checkKey('DEEPSEEK_API_KEY=sk-abc'), /not a NAME=value line/)
  assert.throws(() => checkKey('"sk-abc"'), /without quotes/)
  assert.throws(() => checkKey('sk abc'), /no spaces/)
  assert.throws(() => checkKey('sk-密钥'), /no spaces/)
})

test('a route\'s key reference follows DSH\'s own Models page', () => {
  assert.equal(keyRefFor('moonshotai'), 'MOONSHOTAI_API_KEY')
  assert.equal(keyRefFor('my-gateway2'), 'MY_GATEWAY2_API_KEY')
})
