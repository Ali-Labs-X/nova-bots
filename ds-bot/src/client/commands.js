// The "/" commands of a Bot's chat or a group chat, the same in DSH's composer and in the
// desktop window's own. Each one acts on the window or the host; none is sent to the Bot.
import { t } from './i18n.js'
import { sideSurface } from './side-model.js'

export const COMMAND_SOURCE = 'nova-bots-commands'

const COMMANDS = [
  { name: 'clear', groups: true, hint: () => t('Start this chat over. Earlier messages and memory stay saved.'), run: (id, actions) => actions.clearChat(id) },
  { name: 'stop', groups: true, hint: () => t('Stop the work running in this chat'), run: (id, actions, group) => (group ? actions.stopRoomWork(id) : actions.stopChat(id)) },
  { name: 'folder', groups: true, hint: () => t('Choose the folder to work in'), run: (id, actions) => actions.openFolder(id) },
  { name: 'memory', groups: true, hint: () => t('Open the Memory Bank'), run: (id, actions) => actions.openMemoryBank(id) },
]

// The Bot or group a Session belongs to.
export function commandOwner(roster, sessionId) {
  const surface = sideSurface(roster, sessionId)
  if (surface === 'group') return { id: roster.roomsById[sessionId].id, group: true }
  if (surface === 'bot') return { id: roster.byId[sessionId].id, group: false }
  return undefined
}

const usable = (command, owner, roster) => owner !== undefined && (command.groups || !owner.group) && (command.name !== 'memory' || roster.memory !== false)

export function commandsFor(roster, sessionId, query = '') {
  const owner = commandOwner(roster, sessionId)
  const head = String(query).trim().replace(/^\//, '').toLowerCase()
  return COMMANDS.filter(command => usable(command, owner, roster) && command.name.startsWith(head))
}

// The command a whole line is, or undefined: "/clear the cache" stays an ordinary message.
export function commandOf(roster, sessionId, line) {
  const name = /^\/([a-z]+)$/.exec(String(line ?? '').trim())?.[1]
  return name === undefined ? undefined : commandsFor(roster, sessionId).find(command => command.name === name)
}

export async function runCommand(command, { roster, sessionId, actions }) {
  const owner = commandOwner(roster, sessionId)
  if (owner === undefined) throw new Error(t('Nova Bots is still loading this chat.'))
  await command.run(owner.id, actions, owner.group)
}

// The commands in DSH's "/" menu.
export function commandSource({ roster, actions }) {
  const claimFor = (command, sessionId) => ({
    name: command.name,
    token: `/${command.name} `,
    hint: command.hint(),
    async submit(args, _context, attachments) {
      if (String(args ?? '').trim() !== '' || attachments?.length > 0) throw new Error(t('/{name} takes no text or attachments.', { name: command.name }))
      await runCommand(command, { roster: roster.getSnapshot(), sessionId, actions })
      return { kind: 'success' }
    },
  })
  const find = (sessionId, token) => commandOf(roster.getSnapshot(), sessionId, token)
  return {
    trigger: '/',
    name: COMMAND_SOURCE,
    order: -60,
    showGroupTitle: false,
    async candidates(session, req) {
      if (req?.position === 'inline') return []
      return commandsFor(roster.getSnapshot(), session.sessionId, req?.query)
        .map(command => ({ name: command.name, description: command.hint(), value: command.name }))
    },
    onPick(pick) {
      if (pick?.action === 'drill') return undefined
      const command = find(pick.session.sessionId, `/${pick?.candidate?.value ?? ''}`)
      return command && { claim: claimFor(command, pick.session.sessionId) }
    },
    matchSpace() { return undefined },
    async matchEnter(session, line) {
      const command = find(session.sessionId, line)
      return command && { claim: claimFor(command, session.sessionId) }
    },
    async matchClaim(session, token) {
      const command = find(session.sessionId, token)
      return command && claimFor(command, session.sessionId)
    },
  }
}
