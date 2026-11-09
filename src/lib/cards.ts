import type { Division, Entry, PPEvent } from './types'
import { byEntryOrder, isSeason9Week1 } from './scoring'

export type CardSortMode = 'checkin' | 'standings' | 'random'

export interface PPCard {
  id: string
  division: Division
  cardNumber: number
  name: string
  playerIds: string[]
}

export interface PPEvtCards {
  eventId: string
  targetCardSize: number
  sortMode: CardSortMode
  cards: {
    M: PPCard[]
    W: PPCard[]
  }
  updatedAt: string
}

export const DEFAULT_CARD_SIZE = 4
export const PP_CARDS_STORAGE_PREFIX = 'pp_cards_'
export const PP_SCORE_VIEW_MODE_KEY = 'pp_score_view_mode'
export const PP_CHECKIN_VIEW_MODE_KEY = 'pp_checkin_view_mode'
export const WEEK1_EVENT_ID = 'e1ff57b8-9569-485d-aaa2-d538470bf9f4'

/**
 * Returns a human-friendly label for a card, e.g. "Men's Card 1" or "Women's Card 2".
 */
export function cardLabel(division: Division, cardNumber: number): string {
  return `${division === 'M' ? "Men's" : "Women's"} Card ${cardNumber}`
}

/**
 * Calculates card sizes such that:
 * 1. Sizes differ by at most 1 (e.g. 14 players at size 4 = [4, 4, 3, 3]).
 * 2. Sum of card sizes equals playerCount.
 * 3. Avoids a card of size 1 unless the division's total forces it (playerCount === 1).
 */
export function calculateCardSizes(playerCount: number, cardSize: number): number[] {
  if (playerCount <= 0) return []
  const target = Math.max(1, Math.floor(cardSize || DEFAULT_CARD_SIZE))
  if (target === 1) {
    return Array.from({ length: playerCount }, () => 1)
  }
  if (playerCount === 1) {
    return [1]
  }

  // Calculate number of cards K
  let numCards = Math.ceil(playerCount / target)
  if (numCards <= 1) {
    return [playerCount]
  }

  // If numCards would produce cards of size 1 and playerCount > 1, reduce numCards
  while (numCards > 1 && Math.floor(playerCount / numCards) < 2) {
    numCards -= 1
  }

  const baseSize = Math.floor(playerCount / numCards)
  const remainder = playerCount % numCards

  const sizes: number[] = []
  for (let i = 0; i < numCards; i++) {
    sizes.push(i < remainder ? baseSize + 1 : baseSize)
  }
  return sizes
}

/**
 * Calculates season standings points for a player across completed events in the active season.
 */
export function calculateSeasonStandingsPoints(
  playerId: string,
  division: Division,
  allEntries: readonly Entry[] = [],
  events: readonly PPEvent[] = [],
): { points: number; firstPlaces: number; winnings: number } {
  const completedIds = new Set(
    events.filter((e) => e.status === 'complete').map((e) => e.id),
  )

  let points = 0
  let firstPlaces = 0
  let winnings = 0

  for (const ent of allEntries) {
    if (ent.player_id !== playerId || ent.division !== division) continue
    if (!completedIds.has(ent.event_id)) continue

    points += Number(ent.points || 0)
    winnings += Number(ent.payout || 0)
    if (ent.place === 1) firstPlaces += 1
  }

  return { points, firstPlaces, winnings }
}

/**
 * Sorts entries according to the chosen card sort mode.
 */
export function sortEntriesForCards(params: {
  entries: readonly Entry[]
  division: Division
  sortMode: CardSortMode
  allEntries?: readonly Entry[]
  events?: readonly PPEvent[]
  randomFn?: () => number
}): Entry[] {
  const { entries, division, sortMode, allEntries = [], events = [], randomFn = Math.random } = params
  const list = [...entries].filter((e) => e.division === division)

  if (sortMode === 'checkin') {
    return list.sort(byEntryOrder)
  }

  if (sortMode === 'standings') {
    const statsMap = new Map<string, { points: number; firstPlaces: number; winnings: number }>()
    for (const ent of list) {
      if (!statsMap.has(ent.player_id)) {
        statsMap.set(
          ent.player_id,
          calculateSeasonStandingsPoints(ent.player_id, division, allEntries, events),
        )
      }
    }

    return list.sort((a, b) => {
      const sa = statsMap.get(a.player_id)!
      const sb = statsMap.get(b.player_id)!
      if (sb.points !== sa.points) return sb.points - sa.points
      if (sb.firstPlaces !== sa.firstPlaces) return sb.firstPlaces - sa.firstPlaces
      if (sb.winnings !== sa.winnings) return sb.winnings - sa.winnings
      return byEntryOrder(a, b)
    })
  }

  if (sortMode === 'random') {
    const shuffled = [...list]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(randomFn() * (i + 1))
      const temp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = temp
    }
    return shuffled
  }

  return list
}

/**
 * Splits a list of entries from one division into PPCards based on the target card size and sort mode.
 */
export function splitPlayersIntoCards(params: {
  entries: readonly Entry[]
  division: Division
  cardSize: number
  sortMode: CardSortMode
  allEntries?: readonly Entry[]
  events?: readonly PPEvent[]
  randomFn?: () => number
}): PPCard[] {
  const { entries, division, cardSize, sortMode, allEntries, events, randomFn } = params
  const divEntries = entries.filter((e) => e.division === division)
  if (divEntries.length === 0) return []

  const sizes = calculateCardSizes(divEntries.length, cardSize)
  const sorted = sortEntriesForCards({
    entries: divEntries,
    division,
    sortMode,
    allEntries,
    events,
    randomFn,
  })

  const cards: PPCard[] = []
  let cursor = 0
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]
    const cardEntries = sorted.slice(cursor, cursor + size)
    cursor += size
    const cardNumber = i + 1
    cards.push({
      id: `${division}-${cardNumber}`,
      division,
      cardNumber,
      name: cardLabel(division, cardNumber),
      playerIds: cardEntries.map((e) => e.player_id),
    })
  }

  return cards
}

/**
 * Generates cards for both Men's and Women's divisions without mixing players.
 */
export function generateEventCards(params: {
  eventId: string
  entries: readonly Entry[]
  cardSize: number
  sortMode: CardSortMode
  allEntries?: readonly Entry[]
  events?: readonly PPEvent[]
  randomFn?: () => number
}): PPEvtCards {
  const { eventId, entries, cardSize, sortMode, allEntries, events, randomFn } = params
  const eventEntries = entries.filter((e) => e.event_id === eventId)

  const cardsM = splitPlayersIntoCards({
    entries: eventEntries,
    division: 'M',
    cardSize,
    sortMode,
    allEntries,
    events,
    randomFn,
  })

  const cardsW = splitPlayersIntoCards({
    entries: eventEntries,
    division: 'W',
    cardSize,
    sortMode,
    allEntries,
    events,
    randomFn,
  })

  return {
    eventId,
    targetCardSize: cardSize,
    sortMode,
    cards: {
      M: cardsM,
      W: cardsW,
    },
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Reshuffles players in random mode within a single division across existing cards.
 */
export function shuffleDivisionCards(params: {
  cards: readonly PPCard[]
  division: Division
  targetCardSize: number
  entries: readonly Entry[]
  randomFn?: () => number
}): PPCard[] {
  const { cards, division, targetCardSize, entries, randomFn = Math.random } = params
  if (cards.length === 0) return []

  const allPlayerIds = new Set(cards.flatMap((c) => c.playerIds))
  const relevantEntries = entries.filter(
    (e) => e.division === division && allPlayerIds.has(e.player_id),
  )

  return splitPlayersIntoCards({
    entries: relevantEntries,
    division,
    cardSize: targetCardSize,
    sortMode: 'random',
    randomFn,
  })
}

/**
 * Places a newly checked-in player into the smallest card in their division.
 * If cards are equal in size, places the player into the earliest card.
 * If no cards exist for that division, returns the cards unchanged.
 */
export function assignPlayerToSmallestCard(
  cards: readonly PPCard[],
  playerId: string,
): PPCard[] {
  if (cards.length === 0) return []
  // If player is already assigned, don't duplicate
  if (cards.some((c) => c.playerIds.includes(playerId))) {
    return [...cards]
  }

  let minIdx = 0
  let minSize = cards[0].playerIds.length
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].playerIds.length < minSize) {
      minSize = cards[i].playerIds.length
      minIdx = i
    }
  }

  return cards.map((c, i) => {
    if (i === minIdx) {
      return {
        ...c,
        playerIds: [...c.playerIds, playerId],
      }
    }
    return c
  })
}

/**
 * Moves a player to another card within the same division, or creates a new card if targetCardId === 'new'.
 */
export function movePlayerBetweenCards(params: {
  cards: readonly PPCard[]
  division: Division
  playerId: string
  targetCardId: string
}): PPCard[] {
  const { cards, division, playerId, targetCardId } = params

  let nextCards = cards.map((c) => ({
    ...c,
    playerIds: c.playerIds.filter((id) => id !== playerId),
  }))

  if (targetCardId === 'new') {
    const nextNumber = nextCards.length + 1
    const newCard: PPCard = {
      id: `${division}-${nextNumber}-${Date.now()}`,
      division,
      cardNumber: nextNumber,
      name: cardLabel(division, nextNumber),
      playerIds: [playerId],
    }
    nextCards.push(newCard)
  } else {
    nextCards = nextCards.map((c) => {
      if (c.id === targetCardId) {
        return {
          ...c,
          playerIds: [...c.playerIds, playerId],
        }
      }
      return c
    })
  }

  return nextCards
}

/**
 * Removes a player from all cards in a division (e.g. when unchecking in).
 */
export function removePlayerFromCards(cards: readonly PPCard[], playerId: string): PPCard[] {
  return cards.map((c) => ({
    ...c,
    playerIds: c.playerIds.filter((id) => id !== playerId),
  }))
}

/**
 * Returns true if an event represents Week 1 (which must remain locked and untouched).
 */
export function isWeek1LockedEvent(
  event:
    | { id?: string | null; season_id?: string | null; event_date?: string | null; name?: string | null }
    | string
    | null
    | undefined,
): boolean {
  if (!event) return false
  if (typeof event === 'string') {
    return event === WEEK1_EVENT_ID
  }
  return isSeason9Week1(event)
}

export function getCardStorageKey(eventId: string): string {
  return `${PP_CARDS_STORAGE_PREFIX}${eventId}`
}

/**
 * Loads card assignments from local storage for an event.
 */
export function loadEventCards(eventId: string): PPEvtCards | null {
  if (!eventId) return null
  try {
    const raw = localStorage.getItem(getCardStorageKey(eventId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PPEvtCards
    if (!parsed || !parsed.cards || typeof parsed.cards !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Saves card assignments to local storage for an event.
 * Refuses writes for Week 1 to keep historical data untouched.
 */
export function saveEventCards(
  eventId: string,
  data: PPEvtCards,
  event?: { id?: string | null; season_id?: string | null; event_date?: string | null; name?: string | null } | null,
): boolean {
  if (!eventId) return false
  if (isWeek1LockedEvent(event ?? eventId)) {
    return false
  }
  try {
    localStorage.setItem(getCardStorageKey(eventId), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

/**
 * Clears card assignments from local storage for an event.
 * Refuses deletion for Week 1.
 */
export function clearEventCards(
  eventId: string,
  event?: { id?: string | null; season_id?: string | null; event_date?: string | null; name?: string | null } | null,
): boolean {
  if (!eventId) return false
  if (isWeek1LockedEvent(event ?? eventId)) {
    return false
  }
  try {
    localStorage.removeItem(getCardStorageKey(eventId))
    return true
  } catch {
    return false
  }
}

/**
 * Loads the score entry view mode ('list' | 'card') from local storage.
 */
export function loadScoreViewMode(): 'list' | 'card' {
  try {
    const mode = localStorage.getItem(PP_SCORE_VIEW_MODE_KEY)
    return mode === 'card' ? 'card' : 'list'
  } catch {
    return 'list'
  }
}

/**
 * Saves the score entry view mode ('list' | 'card') to local storage.
 */
export function saveScoreViewMode(mode: 'list' | 'card'): void {
  try {
    localStorage.setItem(PP_SCORE_VIEW_MODE_KEY, mode)
  } catch {
    // Ignore storage errors in private browsing/sandboxes
  }
}

/**
 * Loads the check-in view mode ('list' | 'card') from local storage.
 */
export function loadCheckinViewMode(): 'list' | 'card' {
  try {
    const mode = localStorage.getItem(PP_CHECKIN_VIEW_MODE_KEY)
    return mode === 'card' ? 'card' : 'list'
  } catch {
    return 'list'
  }
}

/**
 * Saves the check-in view mode ('list' | 'card') to local storage.
 */
export function saveCheckinViewMode(mode: 'list' | 'card'): void {
  try {
    localStorage.setItem(PP_CHECKIN_VIEW_MODE_KEY, mode)
  } catch {}
}
