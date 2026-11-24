import { t } from './i18n.js'

const TEAM = 'team'

// The places memory is kept: the team's is read and written through any Bot's panel.
export function bankPlaces(roster) {
  const bots = roster.bots ?? []
  return [
    ...(bots.length > 0 ? [{ key: TEAM, id: bots[0].id, scope: 'team', name: t('Team') }] : []),
    ...bots.map(bot => ({ key: bot.id, id: bot.id, scope: 'own', name: bot.name })),
    ...(roster.rooms ?? []).map(room => ({ key: room.id, id: room.id, scope: 'group', name: room.name })),
  ]
}

export function bankEntries(places, views, { selected, query }) {
  const wanted = query.trim().toLowerCase()
  return places.filter(place => wanted !== '' || place.key === selected).flatMap(place =>
    (views[place.id]?.entries ?? [])
      .filter(entry => entry.scope === place.scope && (wanted === '' || `${entry.text} ${entry.topic ?? ''} ${place.name}`.toLowerCase().includes(wanted)))
      .map(entry => ({ place, entry })))
}

export function bankMarkdown(places, views) {
  return places.map(place => [`## ${place.name}`, ...(views[place.id]?.entries ?? []).filter(entry => entry.scope === place.scope)
    .map(entry => `- ${entry.topic ? `[${entry.topic}] ` : ''}${entry.text}`)].join('\n')).join('\n\n') + '\n'
}
