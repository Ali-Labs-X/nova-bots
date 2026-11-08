// The models page of Nova Bots: the providers the runtime serves, their keys and
// their models. It goes through the plugin's own channel, so it answers in every
// window — including a browser page, where the runtime's own Models page cannot
// load at all.
export const providerActions = call => ({
  providers: () => call('providers'),
  setProviderKey: (provider, value) => call('provider-key', { provider, value }),
  addProvider: body => call('provider-add', body),
  removeProvider: provider => call('provider-remove', { provider }),
  providerModels: body => call('provider-models', body),
})
