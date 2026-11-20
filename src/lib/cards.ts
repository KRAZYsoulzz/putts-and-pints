import type { Division, Entry, PPEvent, Settings } from './types'
import { byEntryOrder, isSeason9Week1, rank18 } from './scoring'

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
  targetCardSizes?: {
    M: number
    W: number
  }
  sortMode: CardSortMode
  cards: {
    M: PPCard[]
    W: PPCard[]
  }
  final9Cards?: {
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
 * Returns the configured target card size for a specific division,
 * falling back to the legacy shared targetCardSize when per-division sizes aren't set.
 */
export function cardSizeForDivision(
  cards: PPEvtCards | null | undefined,
  division: Division,
  fallback = DEFAULT_CARD_SIZE,
): number {
  const specific = cards?.targetCardSizes?.[division]
  if (typeof specific === 'number' && Number.isFinite(specific) && specific >= 1) {
    return Math.trunc(specific)
  }
  const shared = cards?.targetCardSize
  if (typeof shared === 'number' && Number.isFinite(shared) && shared >= 1) {
    return Math.trunc(shared)
  }
  return fallback
}

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
  cardSizes?: Partial<Record<Division, number>>
  sortMode: CardSortMode
  allEntries?: readonly Entry[]
  events?: readonly PPEvent[]
  randomFn?: () => number
}): PPEvtCards {
  const { eventId, entries, cardSize, cardSizes, sortMode, allEntries, events, randomFn } = params
  const eventEntries = entries.filter((e) => e.event_id === eventId)
  const sizeM =
    typeof cardSizes?.M === 'number' && Number.isFinite(cardSizes.M) && cardSizes.M >= 1
      ? Math.trunc(cardSizes.M)
      : cardSize
  const sizeW =
    typeof cardSizes?.W === 'number' && Number.isFinite(cardSizes.W) && cardSizes.W >= 1
      ? Math.trunc(cardSizes.W)
      : cardSize

  const cardsM = splitPlayersIntoCards({
    entries: eventEntries,
    division: 'M',
    cardSize: sizeM,
    sortMode,
    allEntries,
    events,
    randomFn,
  })

  const cardsW = splitPlayersIntoCards({
    entries: eventEntries,
    division: 'W',
    cardSize: sizeW,
    sortMode,
    allEntries,
    events,
    randomFn,
  })

  return {
    eventId,
    targetCardSize: sizeM,
    targetCardSizes: { M: sizeM, W: sizeW },
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
 * Validates and normalizes an unknown card payload into a well-formed PPEvtCards object.
 */
export function normalizeEventCards(raw: unknown): PPEvtCards | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.eventId !== 'string' || !r.eventId) return null
  if (!r.cards || typeof r.cards !== 'object') return null
  const cardMap = r.cards as Record<string, unknown>
  const normalizeList = (list: unknown, division: Division): PPCard[] =>
    Array.isArray(list)
      ? list
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item, idx) => ({
            id: typeof item.id === 'string' && item.id ? item.id : `${division}-${idx + 1}`,
            division,
            cardNumber:
              typeof item.cardNumber === 'number' && Number.isFinite(item.cardNumber)
                ? item.cardNumber
                : idx + 1,
            name:
              typeof item.name === 'string' && item.name
                ? item.name
                : cardLabel(division, idx + 1),
            playerIds: Array.isArray(item.playerIds)
              ? item.playerIds.filter((pid): pid is string => typeof pid === 'string')
              : [],
          }))
      : []

  const sizeNum = Number(r.targetCardSize)
  const fallbackSize = Number.isFinite(sizeNum) && sizeNum >= 1 ? Math.trunc(sizeNum) : DEFAULT_CARD_SIZE
  const rawSizes =
    r.targetCardSizes && typeof r.targetCardSizes === 'object'
      ? (r.targetCardSizes as Record<string, unknown>)
      : null
  const mSizeNum = rawSizes ? Number(rawSizes.M) : NaN
  const wSizeNum = rawSizes ? Number(rawSizes.W) : NaN
  const targetCardSizes = rawSizes
    ? {
        M: Number.isFinite(mSizeNum) && mSizeNum >= 1 ? Math.trunc(mSizeNum) : fallbackSize,
        W: Number.isFinite(wSizeNum) && wSizeNum >= 1 ? Math.trunc(wSizeNum) : fallbackSize,
      }
    : undefined

  const sortMode: CardSortMode =
    r.sortMode === 'standings' || r.sortMode === 'random' || r.sortMode === 'checkin'
      ? r.sortMode
      : 'checkin'

  const finalMap =
    r.final9Cards && typeof r.final9Cards === 'object'
      ? (r.final9Cards as Record<string, unknown>)
      : null

  return {
    eventId: r.eventId,
    targetCardSize: fallbackSize,
    ...(targetCardSizes ? { targetCardSizes } : {}),
    sortMode,
    cards: {
      M: normalizeList(cardMap.M, 'M'),
      W: normalizeList(cardMap.W, 'W'),
    },
    ...(finalMap
      ? {
          final9Cards: {
            M: normalizeList(finalMap.M, 'M'),
            W: normalizeList(finalMap.W, 'W'),
          },
        }
      : {}),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  }
}

/**
 * Generates Final 9 cards for one division from `made_final === true` players,
 * seeded by their 18-hole finish so top qualifiers play together.
 */
export function generateFinal9CardsForDivision(params: {
  entries: readonly Entry[]
  division: Division
  cardSize?: number
  settings: Settings
}): PPCard[] {
  const { entries, division, cardSize, settings } = params
  const finalists = entries.filter(e => e.division === division && e.made_final)
  if (finalists.length === 0) return []

  const ranked = rank18(finalists, settings)
  const ordered = ranked.map(r => r.entry)
  const target =
    cardSize != null && cardSize >= 1
      ? Math.trunc(cardSize)
      : ordered.length <= 6
        ? ordered.length
        : DEFAULT_CARD_SIZE

  const sizes = calculateCardSizes(ordered.length, target)
  const out: PPCard[] = []
  let cursor = 0
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]
    const slice = ordered.slice(cursor, cursor + size)
    cursor += size
    const cardNumber = i + 1
    out.push({
      id: `F9-${division}-${cardNumber}`,
      division,
      cardNumber,
      name: `${division === 'M' ? "Men's" : "Women's"} Final 9 Card ${cardNumber}`,
      playerIds: slice.map(e => e.player_id),
    })
  }
  return out
}

/**
 * Generates Final 9 cards for both divisions while preserving existing 18-hole cards.
 */
export function generateFinal9Cards(params: {
  eventId: string
  entries: readonly Entry[]
  existingCards: PPEvtCards | null
  cardSize?: number
  cardSizes?: Partial<Record<Division, number>>
  settings: Settings
}): PPEvtCards {
  const { eventId, entries, existingCards, cardSize, cardSizes, settings } = params
  const eventEntries = entries.filter(e => e.event_id === eventId)
  const sizeM =
    cardSizes?.M ??
    (existingCards ? cardSizeForDivision(existingCards, 'M', cardSize ?? DEFAULT_CARD_SIZE) : cardSize)
  const sizeW =
    cardSizes?.W ??
    (existingCards ? cardSizeForDivision(existingCards, 'W', cardSize ?? DEFAULT_CARD_SIZE) : cardSize)
  return {
    eventId,
    targetCardSize: existingCards?.targetCardSize ?? sizeM ?? DEFAULT_CARD_SIZE,
    ...(existingCards?.targetCardSizes
      ? { targetCardSizes: existingCards.targetCardSizes }
      : sizeM != null && sizeW != null
        ? { targetCardSizes: { M: sizeM, W: sizeW } }
        : {}),
    sortMode: existingCards?.sortMode ?? 'checkin',
    cards: existingCards?.cards ?? { M: [], W: [] },
    final9Cards: {
      M: generateFinal9CardsForDivision({ entries: eventEntries, division: 'M', cardSize: sizeM, settings }),
      W: generateFinal9CardsForDivision({ entries: eventEntries, division: 'W', cardSize: sizeW, settings }),
    },
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Returns every card ID (both 18-hole and Final 9) defined on an event's card bundle.
 */
export function allCardIdsFromEventCards(cards: PPEvtCards | null | undefined): string[] {
  if (!cards) return []
  const ids: string[] = []
  for (const list of [cards.cards?.M, cards.cards?.W, cards.final9Cards?.M, cards.final9Cards?.W]) {
    for (const c of list ?? []) {
      if (c.id && !ids.includes(c.id)) ids.push(c.id)
    }
  }
  return ids
}

/**
 * Resolves the authoritative card set for an event, preferring non-null remote cards.
 */
export function resolveEventCards(
  eventId: string,
  remoteCards: unknown,
  fallbackLocal: PPEvtCards | null = loadEventCards(eventId),
): PPEvtCards | null {
  if (remoteCards !== undefined && remoteCards !== null) {
    return normalizeEventCards(remoteCards)
  }
  return fallbackLocal
}

/**
 * Maps each playerId in a division's cards to its assigned cardNumber.
 */
export function playerCardLabelMap(
  cards: PPEvtCards | null | undefined,
  division: Division,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const card of cards?.cards?.[division] ?? []) {
    for (const pid of card.playerIds) {
      map.set(pid, card.cardNumber)
    }
  }
  return map
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
