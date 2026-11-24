import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { call } from '../../../ds-bot/src/client/api.js'
import { Bubbles, ChatRows, Shimmer } from '../../../ds-bot/src/client/cells.js'
import { commandOf, commandsFor, runCommand } from '../../../ds-bot/src/client/commands.js'
import { ComposerFolder, ComposerPlus, ComposerVoice } from '../../../ds-bot/src/client/composer.js'
import { t } from '../../../ds-bot/src/client/i18n.js'
import { ArrowUpIcon } from '../../../ds-bot/src/client/icons.js'
import { mentionRows } from '../../../ds-bot/src/client/at-menu.js'
import { HandoffDock } from '../../../ds-bot/src/client/handoff-card.js'
import { LearningDock } from '../../../ds-bot/src/client/learning-card.js'
import { MemberDock } from '../../../ds-bot/src/client/member-status.js'
import { SecretDock } from '../../../ds-bot/src/client/secret-card.js'
import { parseSideLine, submitSide } from '../../../ds-bot/src/client/side-model.js'
import { WidgetDock } from '../../../ds-bot/src/client/widget-cell.js'
import { ModelChoiceDock } from '../../../ds-bot/src/client/model-menu.js'
import { PendingQuestion } from '../../../ds-bot/src/client/questions.js'

// The chat follows its end while the user is this close to it.
const FOLLOW_PX = 80
const sameItem = (a, b) => a.kind === b.kind && a.time === b.time && a.text === b.text

// A Bot's own chat: pages from the `chat` endpoint, new entries and the reply being
// written from the feed. Entries that arrive while the first page loads wait for it.
function useChat(botId, part, feed) {
  const [view, setView] = useState({ sessionId: null, items: [], cursor: null, loading: botId !== undefined, failed: false })
  const [stream, setStream] = useState(null)
  const [pending, setPending] = useState([])
  const ready = useRef(false)
  const early = useRef([])
  const busy = useRef(false)
  const keep = useRef(null)

  const load = useCallback(async (cursor, scroller) => {
    if (busy.current || botId === undefined) return
    busy.current = true
    if (cursor === undefined) ready.current = false
    setView(current => ({ ...current, loading: true, failed: false }))
    try {
      const page = await call('chat', { botId, ...(cursor ? { cursor } : {}) })
      if (cursor === undefined) {
        const later = early.current.filter(entry => entry.sessionId === page.sessionId && !page.items.some(item => sameItem(item, entry.item)))
        early.current = []
        ready.current = true
        setView({ sessionId: page.sessionId, items: [...page.items, ...later.map(entry => entry.item)], cursor: page.cursor, loading: false, failed: false })
      } else {
        // Content added above the viewport would push the view down; keep its distance from the end.
        if (scroller) keep.current = scroller.scrollHeight - scroller.scrollTop
        setView(current => ({ ...current, items: [...page.items, ...current.items], cursor: page.cursor, loading: false }))
      }
    } catch {
      ready.current = cursor !== undefined || ready.current
      setView(current => ({ ...current, loading: false, failed: true }))
    } finally {
      busy.current = false
    }
  }, [botId])

  // A new part starts the chat over.
  useEffect(() => { void load(undefined) }, [load, part])

  useEffect(() => feed.on((event, data) => {
    // The feed came back after a break: entries may have been missed.
    if (event === 'hello') { if (ready.current) void load(undefined); return }
    if (botId === undefined || data?.botId !== botId) return
    if (event === 'message') {
      if (!ready.current) { early.current.push(data); return }
      setView(current => (data.sessionId !== current.sessionId || current.items.some(item => sameItem(item, data.item)) ? current : { ...current, items: [...current.items, data.item] }))
      if (data.item.kind === 'user') {
        setPending((list) => {
          const at = list.findIndex(entry => entry.text === data.item.text)
          return at < 0 ? list : [...list.slice(0, at), ...list.slice(at + 1)]
        })
      }
      if (data.item.kind === 'bot') setStream(null)
    } else if (event === 'stream') {
      if (data.phase === 'start') setStream({ attemptId: data.attemptId, text: '' })
      else if (data.phase === 'end') setStream(current => (current?.attemptId === data.attemptId ? null : current))
      else setStream(current => (current?.attemptId === data.attemptId ? { ...current, text: current.text + data.text } : current))
    }
  }), [feed, botId, load])

  // Shown at once: the message can come back on the feed before the request returns.
  const send = async (text, files, actions, sessionId) => {
    const entry = { kind: 'user', text, time: Date.now() }
    setPending(list => [...list, entry])
    actions.noteSent(sessionId)
    try {
      await actions.send(sessionId, text, files)
    } catch (error) {
      setPending(list => list.filter(item => item !== entry))
      throw error
    }
  }
  return { view, stream, pending, load, send, keep }
}

// What the Bot views' voice button asks of a composer (DSH's composer in the plugin):
// where the caret is, and text put in there.
function useInput(field, setText) {
  return useMemo(() => ({
    captureInsertion: () => (field.current ? { start: field.current.selectionStart, end: field.current.selectionEnd } : null),
    insertText: (value, at) => setText((current) => {
      const start = Math.min(at?.start ?? current.length, current.length)
      return current.slice(0, start) + value + current.slice(Math.max(start, at?.end ?? start))
    }),
  }), [field, setText])
}

const readFile = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve({ name: file.name, mediaType: file.type, data: String(reader.result).split(',')[1] ?? '' })
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

function Composer({ sessionId, placeholder, disabled, running, onSend, actions, useUi, useRoster }) {
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const roster = useRoster(state => state)
  const field = useRef(null)
  const [files, setFiles] = useState([])
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(text)
  const people = mention ? mentionRows(roster, sessionId, mention[1]) ?? [] : []
  const add = async (list) => {
    try {
      const read = await Promise.all([...list].map(readFile))
      setFiles(now => [...now, ...read])
    } catch (failure) { setError(failure.message) }
  }
  // A dropped folder is where to work; dropped files go with the message.
  const drop = (event) => {
    event.preventDefault()
    const entry = event.dataTransfer.items?.[0]?.webkitGetAsEntry?.()
    const [file] = event.dataTransfer.files
    if (!entry?.isDirectory) { void add(event.dataTransfer.files); return }
    const workDir = globalThis.dsBotApp?.pathForFile?.(file)
    const room = roster.roomsById[sessionId]
    const bot = roster.byId[sessionId]
    if (!workDir || !(room ?? bot)) { setError(t('The folder path is not available here.')); return }
    void (room ? actions.updateRoom(room.id, { workDir }) : actions.updateBot(bot.id, { workDir })).catch(failure => setError(failure.message))
  }
  const matches = /^\/[a-z]*$/.test(text) ? commandsFor(roster, sessionId, text) : []
  const inputActions = useInput(field, setText)
  useLayoutEffect(() => {
    const node = field.current
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [text])
  useEffect(() => { if (!disabled) field.current?.focus() }, [sessionId, disabled])
  const submit = async () => {
    const value = text.trim()
    if ((value === '' && files.length === 0) || disabled) return
    setError(null)
    setText('')
    setFiles([])
    try {
      const side = parseSideLine(value)
      const command = commandOf(roster, sessionId, value)
      if (side && roster.byId[sessionId]) {
        await submitSide({ call: actions.sideCall, roster, sessionId, args: side.args, attachments: files, open: chatId => actions.openSideChat(sessionId, chatId) })
      } else if (command && files.length === 0) await runCommand(command, { roster, sessionId, actions })
      else await onSend(value, files)
    } catch (failure) {
      setText(current => (current === '' ? value : current))
      setFiles(files)
      setError(failure.message)
    }
  }
  return h('div', { className: 'dsb-composer-wrap' },
    error ? h('p', { className: 'dsb-composer-error', role: 'alert' }, error) : null,
    people.length ? h('div', { className: 'dsb-commands', role: 'listbox', 'aria-label': t('Bots') }, people.map(row => h('button', {
      key: row.text, type: 'button', role: 'option', 'aria-selected': false,
      onClick: () => { setText(now => now.slice(0, now.length - mention[1].length - 1) + row.text); field.current?.focus() },
    }, h('b', null, row.text.trim()), h('span', null, row.bot?.role ?? '')))) : null,
    files.length ? h('div', { className: 'dsb-files' }, files.map((file, index) => h('button', { key: index, type: 'button', title: t('Remove file'), 'aria-label': `${t('Remove file')} ${file.name}`, onClick: () => setFiles(now => now.filter((_, at) => at !== index)) }, file.name, ' ×'))) : null,
    matches.length ? h('div', { className: 'dsb-commands', role: 'listbox', 'aria-label': t('Commands') }, matches.map(command => h('button', {
      key: command.name, type: 'button', role: 'option', 'aria-selected': false,
      onClick: () => { setText(`/${command.name}`); field.current?.focus() },
    }, h('b', null, `/${command.name}`), h('span', null, command.hint())))) : null,
    h('div', { className: 'dsb-composer', 'data-composer-card': '', onDragOver: event => event.preventDefault(), onDrop: drop, 'data-multiline': text.includes('\n') || undefined },
      h('div', { className: 'dsb-composer-tools' },
        h('input', { type: 'file', multiple: true, hidden: true, 'aria-label': t('Attach files'), onChange: (event) => { void add(event.target.files); event.target.value = '' } }), h(ComposerPlus, { sessionId, inputActions, useRoster, actions }), h(ComposerFolder, { sessionId, useRoster, useUi, actions })),
      h('div', { className: 'dsb-composer-input', 'data-input-scroll': '' },
        h('textarea', {
          ref: field,
          rows: 1,
          value: text,
          disabled,
          placeholder,
          'aria-label': placeholder,
          'data-composer-input': '',
          onChange: event => setText(event.target.value),
          onPaste: (event) => { if (event.clipboardData.files.length) { event.preventDefault(); void add(event.clipboardData.files) } },
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          },
        })),
      h('div', { className: 'dsb-composer-trailing' },
        h(ComposerVoice, { sessionId, inputActions, actions, useUi }),
        running ? h('button', { type: 'button', className: 'dsb-stop', 'aria-label': t('Stop'), title: t('Stop'), onClick: () => { void actions.stopChat(roster.byId[sessionId]?.id).catch(failure => setError(failure.message)) } }, t('Stop')) : null,
        h('button', { type: 'button', className: 'dsb-send', disabled: disabled || (text.trim() === '' && files.length === 0), 'aria-label': t('Send message'), title: t('Send message'), onClick: () => { void submit() } }, h(ArrowUpIcon)))))
}

// One conversation in the main view, drawn with the Bot views' own rows, cards and docks.
export function Chat({ sessionId, team }) {
  const { actions, hooks, chat: feed } = team
  const roster = hooks.useRoster(value => value)
  const bot = roster.byId[sessionId]
  const name = bot?.name ?? roster.roomsById[sessionId]?.name ?? ''
  const { view, stream, pending, load, send, keep } = useChat(bot?.id, sessionId, feed)
  const scroller = useRef(null)
  const follow = useRef(true)
  const question = roster.questions?.[sessionId]
  const running = hooks.useSessionStatus(map => map.get(sessionId)?.running === true)

  useLayoutEffect(() => {
    const node = scroller.current
    if (keep.current !== null) {
      node.scrollTop = node.scrollHeight - keep.current
      keep.current = null
    } else if (follow.current) node.scrollTop = node.scrollHeight
  }, [view.items, stream, pending, running, question])

  const onScroll = () => {
    const node = scroller.current
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_PX
  }
  const earlier = view.loading && view.sessionId !== null ? h(Shimmer, null, t('Loading earlier messages…'))
    : view.failed ? h('button', { type: 'button', className: 'bt-soft', onClick: () => load(view.cursor ?? undefined, scroller.current) }, t('Couldn’t load earlier messages · Retry'))
      : view.cursor ? h('button', { type: 'button', className: 'bt-soft', onClick: () => load(view.cursor, scroller.current) }, t('Load earlier')) : null
  const waiting = bot?.waiting === true

  const docks = { ...hooks, sessionId, actions }
  return h('div', { className: 'dsb-chat' },
    h('div', { ref: scroller, className: 'dsb-scroll', 'data-conversation-scroll': '', onScroll },
      h('div', { className: 'dsb-column' },
        earlier ? h('div', { className: 'bt-earlier-top' }, earlier) : null,
        h('div', { className: 'dsb-flow', 'data-chat-flow': '', role: 'feed', 'aria-label': name, 'aria-busy': view.loading },
          h(ChatRows, { items: view.items, sessionId, roster, actions, useUi: hooks.useUi, clock: true }),
          pending.length ? h('div', { className: 'dsb-pending' }, h(ChatRows, { items: pending, sessionId, roster, actions })) : null,
          stream?.text ? h(Bubbles, { texts: [stream.text], roster, selfId: bot?.id, actions, streaming: true, sessionId }) : null,
          // The Bot views' activity row (from the header pill) draws itself in here.
          h('div', { 'data-chat-running': '' }),
          question ? h(PendingQuestion, { key: JSON.stringify([sessionId, question.id]), sessionId, question, actions, inline: true }) : null))),
    h('div', { className: 'dsb-composer-root' },
      h(MemberDock, docks),
      h(ModelChoiceDock, { sessionId, useRoster: hooks.useRoster, actions }),
      h(WidgetDock, docks),
      h(SecretDock, docks),
      h(HandoffDock, docks),
      h(LearningDock, docks),
      h(Composer, {
        sessionId,
        disabled: waiting,
        running: running && bot !== undefined,
        placeholder: waiting ? t('Pick a model and {name} can start.', { name }) : name ? t('Message {name}', { name }) : t('Message'),
        onSend: (text, files) => send(text, files, actions, sessionId),
        actions,
        useUi: hooks.useUi,
        useRoster: hooks.useRoster,
      })))
}
