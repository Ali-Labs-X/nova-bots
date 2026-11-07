// Model providers and their API keys, for a window that has no Nova Models page of its
// own. Nova keeps all of it: a provider route in the settings of the adapter that serves
// it, the route's key in Nova's credential store under the reference the route names.
// The providers to add are the ones Nova's directory of configurable providers offers.

const PI_AI = 'llm-pi-ai'
const ROUTE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
// The wire protocols Nova's pi-ai adapter serves on a route it ships nothing about.
export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
const MAX_MODELS = 500

// The reference Nova's own Models page derives for a route's key, so a provider added
// here and one added there read the same key.
export const keyRefFor = provider => `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

// What an HTTP header can carry, like Nova's own key check: a pasted `NAME=value` line
// or a quoted value would be stored as the key and refused by the provider.
export function checkKey(value) {
  const key = typeof value === 'string' ? value.trim() : ''
  if (key === '') throw invalid('Enter the API key')
  if (/^[A-Za-z_][A-Za-z0-9_]*=[^=]/.test(key)) throw invalid('Paste only the key, not a NAME=value line')
  if (/^(["']).*\1$/.test(key)) throw invalid('Paste the key without quotes')
  if (!/^[\x21-\x7E]+$/.test(key)) throw invalid('An API key has no spaces or special characters')
  return key
}

function checkEndpoint(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  let url
  try { url = new URL(text) } catch { throw invalid('Enter the endpoint as an http or https address') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('Enter the endpoint as an http or https address')
  return text
}

// A model as the route stores it: what discovery told about it, under pi-ai's names.
function modelEntry(model) {
  const id = typeof model === 'string' ? model.trim() : typeof model?.id === 'string' ? model.id.trim() : ''
  if (id === '') throw invalid('Every model needs an id')
  const whole = value => (Number.isInteger(value) && value > 0 ? value : undefined)
  return {
    id,
    ...(typeof model?.name === 'string' && model.name.trim() !== '' ? { name: model.name.trim() } : {}),
    ...(whole(model?.contextWindow) ? { contextWindow: model.contextWindow } : {}),
    ...(whole(model?.maxTokens) ? { maxTokens: model.maxTokens } : {}),
    ...(Array.isArray(model?.inputModalities) && model.inputModalities.length > 0 ? { input: model.inputModalities.filter(kind => typeof kind === 'string') } : {}),
    // A model that serves embeddings rather than chat. Only the strict boolean true is
    // a flag, and the key is left out when there is none: a profile without it stays
    // exactly as it was.
    ...(model?.embedding === true ? { embedding: true } : {}),
  }
}

export function install(rt) {
  const { ctx } = rt

  const seams = () => {
    const settings = ctx.get?.('settings')
    const credentials = ctx.get?.('credentials')
    return settings && credentials && ctx.llm.listConfigurableProviders ? { settings, credentials } : undefined
  }
  const usable = () => {
    const found = seams()
    if (found === undefined) throw invalid('This Nova cannot set up model providers')
    return found
  }
  const sections = settings => new Map(settings.describe({ redactSecrets: true }).map(section => [section.ns, section]))
  const profileOf = (entry, map, layer = 'value') => entry.settingsPath.reduce((value, key) => value?.[key], map.get(entry.settingsNs)?.[layer])
  const refOf = profile => (typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv !== '' ? profile.apiKeyEnv : undefined)
  const entryOf = provider => ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)

  // Per provider route, the credential its Nova settings name as its API key. A
  // provider with none authenticates some other way.
  function keyRefs() {
    const found = seams()
    if (found === undefined) return new Map()
    const map = sections(found.settings)
    const refs = new Map()
    for (const entry of ctx.llm.listConfigurableProviders()) {
      const ref = refOf(profileOf(entry, map))
      if (ref !== undefined) refs.set(entry.provider, ref)
    }
    return refs
  }

  async function missingKeys(providers) {
    let refs
    try { refs = keyRefs() } catch { return new Set() }
    const missing = new Set()
    await Promise.all(providers.filter(id => refs.has(id)).map(async (id) => {
      const info = await seams().credentials.describe(refs.get(id)).catch(() => undefined)
      if (info?.configured === false) missing.add(id)
    }))
    return missing
  }

  // The models a stored provider profile marks as embedding models, per provider. The
  // profile is Nova's own, where the route is set up: the runtime does not carry the
  // flag into its model list. Only the strict boolean true is a flag.
  function markedModels(map) {
    const models = new Map()
    for (const entry of ctx.llm.listConfigurableProviders()) {
      const profile = profileOf(entry, map)
      const list = Array.isArray(profile?.models) ? profile.models : []
      const marked = list.filter(model => model?.embedding === true).map(model => ({ id: model.id, name: model.name ?? model.id }))
      if (marked.length > 0) models.set(entry.provider, marked)
    }
    return models
  }

  // The embedding models of every provider, as the model catalog reads them. A provider
  // whose profile cannot be read marks no model: a chat model is never lost to a
  // settings service that did not answer.
  function embeddingModels() {
    const found = seams()
    if (found === undefined) return new Map()
    try { return markedModels(sections(found.settings)) } catch { return new Map() }
  }

  // The providers set up in Nova, with their models and key state, and the ones Nova
  // can add. A provider with no key and no models (Nova's account route before a
  // sign-in) is left out.
  async function providersView() {
    const found = seams()
    if (found === undefined) return { available: false }
    const map = sections(found.settings)
    const catalog = await rt.catalog({ fresh: true })
    const providers = []
    const addable = []
    for (const entry of ctx.llm.listConfigurableProviders()) {
      const profile = profileOf(entry, map)
      if (entry.settingsNs === PI_AI && profile === undefined) {
        if (entry.declared !== true) addable.push({ id: entry.provider, name: entry.displayName })
        continue
      }
      const ref = refOf(profile)
      // Every model the provider serves, each once; the embedding models are marked, so
      // the user sees that they exist and that they are not chat models.
      const models = catalog.filter(model => model.provider === entry.provider)
        .map(model => ({ ref: model.ref, name: model.name, ...(model.embedding === true ? { embedding: true } : {}) }))
      if (ref === undefined && models.length === 0 && entry.error === undefined) continue
      const info = ref === undefined ? undefined : await found.credentials.describe(ref).catch(() => undefined)
      providers.push({
        id: entry.provider,
        name: entry.displayName,
        models,
        key: ref === undefined ? null : { configured: info?.configured === true, writable: info?.writable !== false },
        removable: entry.settingsNs === PI_AI && profileOf(entry, map, 'user') !== undefined && profileOf(entry, map, 'base') === undefined,
        custom: entry.declared === true,
        ...(entry.error ? { error: entry.error } : {}),
      })
    }
    // The ones that come with the setup first, then the added ones as Nova lists them.
    providers.sort((a, b) => Number(a.removable) - Number(b.removable))
    return { available: true, providers, addable, protocols: PROTOCOLS }
  }

  async function writableRef(provider) {
    const ref = keyRefs().get(provider)
    if (ref === undefined) throw invalid(`${provider} takes no API key here`)
    if ((await usable().credentials.describe(ref)).writable === false) throw invalid(`The API key for ${provider} is set outside Nova Bots and cannot be changed here`)
    return ref
  }

  // A key is only ever written; nothing here reads one back.
  async function setProviderKey(provider, value) {
    const key = checkKey(value)
    await usable().credentials.set(await writableRef(provider), key)
    rt.dropCatalog()
  }

  async function clearProviderKey(provider) {
    await usable().credentials.unset(await writableRef(provider))
    rt.dropCatalog()
  }

  // `provider` from Nova's directory, or a route the user declares (`custom`) for an
  // endpoint Nova ships nothing about. The route goes in first, then its key, as Nova's
  // own Models page does it: a failed key write leaves a provider that asks for one.
  async function addProvider(body) {
    const { settings, credentials } = usable()
    const provider = String(body.provider ?? '').trim()
    const map = sections(settings)
    const entry = entryOf(provider)
    if (entry !== undefined && (entry.settingsNs !== PI_AI || profileOf(entry, map) !== undefined)) throw invalid(`${provider} is already set up`)
    const custom = body.custom === true
    if (!custom && (entry === undefined || entry.declared === true)) throw invalid(`Nova offers no provider ${provider}`)
    if (custom && !ROUTE_ID.test(provider)) throw invalid('A provider id is lowercase letters, digits and dashes, starting with a letter')
    if (custom && entry !== undefined) throw invalid(`Nova already offers ${provider}; add it from its list`)
    const key = typeof body.key === 'string' && body.key.trim() !== '' ? checkKey(body.key) : undefined
    const ref = keyRefFor(provider)
    const info = await credentials.describe(ref)
    if (key !== undefined && info.writable === false) throw invalid(`The API key for ${provider} is set outside Nova Bots and cannot be changed here`)
    // A blank key keeps a key that is already there, else the provider's own sign-in.
    const keyed = key !== undefined || info.configured === true
    const profile = custom ? customProfile(body) : {}
    if (keyed) profile.apiKeyEnv = ref
    await settings.mutate(PI_AI, [{ op: 'set', path: entry?.settingsPath ?? ['providers', provider], value: profile }], map.get(PI_AI)?.revision)
    if (key !== undefined) await credentials.set(ref, key)
    rt.dropCatalog()
    return providersView()
  }

  function customProfile(body) {
    if (!PROTOCOLS.includes(body.api)) throw invalid(`The protocol must be one of ${PROTOCOLS.join(', ')}`)
    const models = Array.isArray(body.models) ? body.models.slice(0, MAX_MODELS).map(modelEntry) : []
    if (models.length === 0) throw invalid('Add at least one model')
    if (new Set(models.map(model => model.id)).size !== models.length) throw invalid('Two models have the same id')
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    return { ...(name ? { displayName: name } : {}), api: body.api, baseURL: checkEndpoint(body.baseURL), models }
  }

  // The models an endpoint (or a provider Nova ships) says it serves. The key typed for
  // the question goes with it and is not stored.
  async function discoverModels(body) {
    usable()
    const provider = typeof body.provider === 'string' && body.provider !== '' ? body.provider : undefined
    const request = provider !== undefined && entryOf(provider)?.declared === false
      ? { provider }
      : {
          baseURL: checkEndpoint(body.baseURL),
          ...(PROTOCOLS.includes(body.api) ? { api: body.api } : {}),
          ...(typeof body.key === 'string' && body.key.trim() !== '' ? { apiKey: checkKey(body.key) } : {}),
        }
    const models = await ctx.llm.discoverModels(PI_AI, request)
    return models.slice(0, MAX_MODELS).map(model => ({
      id: model.id,
      ...(model.name ? { name: model.name } : {}),
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      ...(model.inputModalities ? { inputModalities: [...model.inputModalities] } : {}),
    }))
  }

  // Only a route the user added goes; its key goes with it when it is the one this page
  // derives and no other provider names it.
  async function removeProvider(provider) {
    const { settings, credentials } = usable()
    const map = sections(settings)
    const entry = entryOf(provider)
    if (entry === undefined || entry.settingsNs !== PI_AI || profileOf(entry, map) === undefined) throw invalid(`${provider} is not set up`)
    if (profileOf(entry, map, 'user') === undefined || profileOf(entry, map, 'base') !== undefined) throw invalid(`${provider} comes with this setup and cannot be removed`)
    const ref = refOf(profileOf(entry, map))
    const shared = [...keyRefs()].some(([other, otherRef]) => other !== provider && otherRef === ref)
    await settings.mutate(PI_AI, [{ op: 'unset', path: entry.settingsPath }], map.get(PI_AI)?.revision)
    if (ref === keyRefFor(provider) && !shared) {
      const info = await credentials.describe(ref)
      if (info.configured && info.writable) await credentials.unset(ref)
    }
    rt.dropCatalog()
    return providersView()
  }

  Object.assign(rt, { keyRefs, missingKeys, providersView, setProviderKey, clearProviderKey, addProvider, discoverModels, removeProvider, embeddingModels })
}
