// The Bot browsers' wiring, shared by every window with a browser bridge.
import { serveBrowserReads } from './bot-browsers.js'

export function followBrowsers({ browsers, roster, ui, call }) {
  let stopReads = null
  const sync = () => {
    const snapshot = roster.getSnapshot()
    if (!snapshot.ready) return
    const on = snapshot.browser === true
    if (on && !stopReads) stopReads = serveBrowserReads({ browsers, post: call })
    if (!on && stopReads) { stopReads(); stopReads = null }
    // A Bot deleted here or in another window takes its guests and saved tabs along.
    void browsers.retain(snapshot.bots.map(bot => bot.id))
    // A panel open on the browser view without a browsable subject falls back
    // to the details view.
    ui.set(state => (state.details && state.view === 'browser' && (!on || !snapshot.byId[state.details]) ? { ...state, view: 'details' } : state))
  }
  sync()
  const offRoster = roster.subscribe(sync)
  return () => { offRoster(); stopReads?.(); browsers.dispose() }
}

export function browserActions({ browsers, bridge, roster, ui, call, yieldBrowser }) {
  return {
    // The globe button: the Bot's active tab in the browser view, or a new tab.
    openBrowser: (id) => {
      const bot = roster.getSnapshot().byId[id]
      if (!bot) return
      browsers.ensureTabs(bot.id)
      if (browsers.tabs.getSnapshot()[bot.id]?.active == null) browsers.openTab(bot.id)
      ui.set(state => ({ ...state, details: id, view: 'browser', renaming: false, tab: null, panelYield: yieldBrowser(state) }))
    },
    // '+' on the strip or the drawer's new-tab card: a blank tab in the browser view.
    browserNewTab: (id) => {
      const bot = roster.getSnapshot().byId[id]
      if (!bot) return null
      browsers.ensureTabs(bot.id)
      const tabId = browsers.openTab(bot.id)
      ui.set(state => ({ ...state, details: id, view: 'browser', renaming: false, tab: null, panelYield: yieldBrowser(state) }))
      return tabId
    },
    // A drawer card: its tab active, the panel on the browser view.
    browserPick: (id, tabId) => {
      const bot = roster.getSnapshot().byId[id]
      if (!bot) return
      browsers.activate(bot.id, tabId)
      ui.set(state => ({ ...state, details: id, view: 'browser', panelYield: yieldBrowser(state) }))
    },
    browserEnsure: botId => browsers.ensureTabs(botId),
    browserCloseTab: (botId, tabId) => browsers.closeTab(botId, tabId),
    browserActivate: (botId, tabId) => browsers.activate(botId, tabId),
    browserShow: (tabId, box) => browsers.show(tabId, box),
    browserNavigate: (tabId, input) => browsers.navigate(tabId, input),
    browserCommand: (tabId, name) => browsers.command(tabId, name),
    browserFocus: (tabId) => browsers.focus(tabId),
    browserTakeover: bridge.views ? async botId => {
      const result = await call('browser-takeover', { botId })
      await bridge.views.hold(botId, true)
      return result
    } : undefined,
    browserStop: bridge.views ? async botId => {
      const result = await call('browser-stop', { botId })
      await bridge.views.hold(botId, true)
      return result
    } : undefined,
    // `answer` is a handoff card's { callId, outcome }; the panel's Give back sends none.
    browserGiveBack: bridge.views ? async (botId, answer = {}) => {
      const result = await call('browser-give-back', { botId, ...answer })
      await bridge.views.hold(botId, false)
      return result
    } : undefined,
    // Cookie imports, only where the bridge offers them (the desktop app): a file or an
    // installed browser's profile is previewed, then applied into the Bot's storage key.
    browserImport: typeof bridge.importSources === 'function' ? {
      sources: () => bridge.importSources(),
      pick: () => bridge.importPick(),
      live: (source, close) => bridge.importLive(source, close),
      apply: (botId, pending) => bridge.importApply(`bot:${botId}`, pending),
      cancel: (pending) => bridge.importCancel(pending),
    } : null,
  }
}
