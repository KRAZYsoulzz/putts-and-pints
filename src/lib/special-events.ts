import { cents } from './scoring'
import { clampPaidPlaces, splitEvenly, suggestedPayouts } from './money'

export type SpecialPool = 'A' | 'B'
export type SpecialStatus = 'checkin' | 'draw' | 'scoring' | 'results' | 'complete'

export interface CourseHole {
  hole: number
  par: number
  distanceFt: number | null
  note: string
}

/**
 * Gateway Park - Trinity Side (Fort Worth, TX) 18-hole baseline (UDisc Trinity 18: Par 56, ~4,996 ft).
 */
export const GATEWAY_TRINITY_18_HOLES: readonly CourseHole[] = [
  { hole: 1, par: 3, distanceFt: 223, note: '' },
  { hole: 2, par: 3, distanceFt: 247, note: '' },
  { hole: 3, par: 3, distanceFt: 202, note: '' },
  { hole: 4, par: 3, distanceFt: 234, note: '' },
  { hole: 5, par: 3, distanceFt: 302, note: '' },
  { hole: 6, par: 3, distanceFt: 236, note: '' },
  { hole: 7, par: 3, distanceFt: 369, note: '' },
  { hole: 8, par: 3, distanceFt: 171, note: '' },
  { hole: 9, par: 3, distanceFt: 176, note: '' },
  { hole: 10, par: 3, distanceFt: 167, note: '' },
  { hole: 11, par: 3, distanceFt: 402, note: '' },
  { hole: 12, par: 3, distanceFt: 276, note: '' },
  { hole: 13, par: 3, distanceFt: 331, note: '' },
  { hole: 14, par: 3, distanceFt: 262, note: '' },
  { hole: 15, par: 4, distanceFt: 341, note: '' },
  { hole: 16, par: 4, distanceFt: 513, note: '' },
  { hole: 17, par: 3, distanceFt: 368, note: '' },
  { hole: 18, par: 3, distanceFt: 176, note: '' },
]

export interface SpecialEventConfig {
  entryFee: number
  aceShare: number
  courseFundShare: number
  courseFundLabel: string
  front9Label: string
  back9Label: string
  teamsPerCard: number
}

export interface SpecialParticipant {
  id: string
  playerId: string | null
  name: string
  pool: SpecialPool
  paid: boolean
  createdAt: string
}

export interface SpecialTeam {
  id: string
  teamNumber: number
  participantIds: string[]
  isCali: boolean
  cardId: string | null
  holes: (number | null)[]
  manualTotal18: number | null
  playoffRank: number | null
}

export interface SpecialCard {
  id: string
  cardNumber: number
  startingHole: number
}

export interface AceResolution {
  mode: 'pending' | 'ace' | 'ctp'
  winnerParticipantIds: string[]
}

export interface SpecialEvent {
  id: string
  name: string
  eventDate: string
  location: string
  status: SpecialStatus
  config: SpecialEventConfig
  courseHoles: CourseHole[]
  participants: SpecialParticipant[]
  teams: SpecialTeam[]
  cards: SpecialCard[]
  payoutPlaces: number[]
  aceResolution: AceResolution
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface SpecialEventMoney {
  participantCount: number
  paidCount: number
  unpaidCount: number
  unpaidAmount: number
  payoutShare: number
  totalEntryPot: number
  acePot: number
  courseFund: number
  payoutPurse: number
}

export interface TeamScoreSummary {
  thru: number
  strokes: number | null
  parPlayed: number
  toPar: number | null
  frontStrokes: number | null
  backStrokes: number | null
  frontComplete: boolean
  backComplete: boolean
  isFinished: boolean
  officialTotal18: number | null
}

export interface RankedSpecialTeam {
  team: SpecialTeam
  summary: TeamScoreSummary
  place: number
  tied: boolean
  payout: number
}

export interface SpecialRankings {
  leaderboard: RankedSpecialTeam[]
  notStarted: RankedSpecialTeam[]
  payoutByTeamId: Map<string, number>
  unfinishedCount: number
}

export interface SpecialEventPodiumEntry {
  place: number
  tied: boolean
  teamId: string
  teamName: string
  toPar: number | null
  strokes: number | null
  thru: number
  isFinished: boolean
  payout: number
}

export interface SpecialEventSnapshot {
  eventId: string
  name: string
  eventDate: string
  location: string
  participantCount: number
  teamCount: number
  totalPar: number
  payoutPurse: number
  courseFund: number
  courseFundLabel: string
  acePot: number
  winners: SpecialEventPodiumEntry[]
  podium: SpecialEventPodiumEntry[]
  aceOutcome: {
    mode: 'pending' | 'ace' | 'ctp'
    winners: { participantId: string; name: string; amount: number }[]
  }
}

export function makeSpecialId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-8${hex().slice(1)}-${hex()}${hex()}${hex()}`
}

export function emptyHoles(): (number | null)[] {
  return Array.from({ length: 18 }, () => null)
}

export function cloneGatewayTrinityHoles(): CourseHole[] {
  return GATEWAY_TRINITY_18_HOLES.map(h => ({ ...h }))
}

export function defaultPar3Holes(): CourseHole[] {
  return Array.from({ length: 18 }, (_, i) => ({
    hole: i + 1,
    par: 3,
    distanceFt: null,
    note: '',
  }))
}

export function normalizeCourseHoles(holes?: readonly Partial<CourseHole>[] | null): CourseHole[] {
  return Array.from({ length: 18 }, (_, idx) => {
    const fallback = GATEWAY_TRINITY_18_HOLES[idx]
    const raw = holes?.[idx]
    const parRaw = Number(raw?.par)
    const par = Number.isFinite(parRaw) ? Math.min(6, Math.max(2, Math.trunc(parRaw))) : fallback.par
    const distRaw = raw?.distanceFt == null ? null : Number(raw.distanceFt)
    const distanceFt = distRaw != null && Number.isFinite(distRaw) && distRaw > 0 ? Math.trunc(distRaw) : null
    return {
      hole: idx + 1,
      par,
      distanceFt,
      note: typeof raw?.note === 'string' ? raw.note : '',
    }
  })
}

export function createBlackFridayDubsPreset(eventDate?: string): SpecialEvent {
  const now = new Date().toISOString()
  return {
    id: makeSpecialId(),
    name: 'Black Friday Draw Dubs',
    eventDate: eventDate || now.slice(0, 10),
    location: 'Gateway Park - Trinity Side',
    status: 'checkin',
    config: {
      entryFee: 20,
      aceShare: 5,
      courseFundShare: 5,
      courseFundLabel: 'Gatekeepers Course Fund',
      front9Label: 'Alternating Shot',
      back9Label: 'Best Shot',
      teamsPerCard: 2,
    },
    courseHoles: cloneGatewayTrinityHoles(),
    participants: [],
    teams: [],
    cards: [],
    payoutPlaces: [],
    aceResolution: { mode: 'pending', winnerParticipantIds: [] },
    notes: '9:00 AM sign-up, 9:45 AM draw. Holes 1-9 Alternating Shot, Holes 10-18 Best Shot.',
    createdAt: now,
    updatedAt: now,
  }
}

export function createBlankSpecialEvent(params: {
  name: string
  eventDate?: string
  location?: string
  config?: Partial<SpecialEventConfig>
  useGatewayTrinity?: boolean
  notes?: string | null
}): SpecialEvent {
  const now = new Date().toISOString()
  return {
    id: makeSpecialId(),
    name: params.name.trim() || 'Special Event',
    eventDate: params.eventDate || now.slice(0, 10),
    location: (params.location ?? '').trim(),
    status: 'checkin',
    config: {
      entryFee: params.config?.entryFee ?? 20,
      aceShare: params.config?.aceShare ?? 5,
      courseFundShare: params.config?.courseFundShare ?? 0,
      courseFundLabel: params.config?.courseFundLabel?.trim() || 'Course Fund',
      front9Label: params.config?.front9Label?.trim() || 'Front 9',
      back9Label: params.config?.back9Label?.trim() || 'Back 9',
      teamsPerCard: Math.max(1, Math.trunc(params.config?.teamsPerCard ?? 2)),
    },
    courseHoles: params.useGatewayTrinity !== false ? cloneGatewayTrinityHoles() : defaultPar3Holes(),
    participants: [],
    teams: [],
    cards: [],
    payoutPlaces: [],
    aceResolution: { mode: 'pending', winnerParticipantIds: [] },
    notes: params.notes ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

export function courseParTotals(courseHoles: readonly CourseHole[]): { frontPar: number; backPar: number; totalPar: number; totalDistanceFt: number } {
  const holes = normalizeCourseHoles(courseHoles)
  let frontPar = 0
  let backPar = 0
  let totalDistanceFt = 0
  for (let i = 0; i < 18; i++) {
    if (i < 9) frontPar += holes[i].par
    else backPar += holes[i].par
    totalDistanceFt += holes[i].distanceFt ?? 0
  }
  return { frontPar, backPar, totalPar: frontPar + backPar, totalDistanceFt }
}

export function formatToPar(toPar: number | null): string {
  if (toPar == null) return '--'
  if (toPar === 0) return 'E'
  return toPar > 0 ? `+${toPar}` : String(toPar)
}

export function specialEventMoney(
  participants: readonly SpecialParticipant[],
  config: SpecialEventConfig,
): SpecialEventMoney {
  const participantCount = participants.length
  const paidCount = participants.filter(p => p.paid).length
  const unpaidCount = participantCount - paidCount
  const entryFee = Math.max(0, Number(config.entryFee) || 0)
  const aceShare = Math.max(0, Number(config.aceShare) || 0)
  const courseFundShare = Math.max(0, Number(config.courseFundShare) || 0)
  const payoutShare = Math.max(0, cents(entryFee - aceShare - courseFundShare))
  return {
    participantCount,
    paidCount,
    unpaidCount,
    unpaidAmount: cents(unpaidCount * entryFee),
    payoutShare,
    totalEntryPot: cents(participantCount * entryFee),
    acePot: cents(participantCount * aceShare),
    courseFund: cents(participantCount * courseFundShare),
    payoutPurse: cents(participantCount * payoutShare),
  }
}

export function suggestedTeamPaidPlaces(teamCount: number): number {
  if (teamCount <= 0) return 0
  return clampPaidPlaces(teamCount, Math.max(1, Math.round(teamCount / 4)))
}

/**
 * Declining team payouts. When the purse is a whole multiple of $2 and covers at
 * least $2 per paid place, splits in $2 increments so 2-player partner splits are
 * crisp whole dollars (e.g. $50 / $50 instead of $27.50).
 */
export function suggestedTeamPayouts(payoutPurse: number, places: number): number[] {
  if (places <= 0 || payoutPurse <= 0) {
    return Array.from({ length: Math.max(0, places) }, () => 0)
  }
  const purseCents = Math.round(payoutPurse * 100)
  if (purseCents >= places * 200 && purseCents % 200 === 0) {
    const units = purseCents / 200
    const weights = Array.from({ length: places }, (_, i) => places - i)
    const sumW = weights.reduce((a, b) => a + b, 0)
    const base = weights.map(w => Math.floor((units * w) / sumW))
    let leftover = units - base.reduce((a, b) => a + b, 0)
    const order = weights
      .map((w, i) => ({ i, frac: (units * w) % sumW }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i)
    for (const slot of order) {
      if (leftover <= 0) break
      base[slot.i] += 1
      leftover -= 1
    }
    return base.map(u => u * 2)
  }
  const split = suggestedPayouts(payoutPurse, places)
  if (split.length === places) return split
  return Array.from({ length: places }, () => 0)
}

export function resolveAcePayouts(
  acePot: number,
  resolution: AceResolution,
): { participantId: string; amount: number }[] {
  if (acePot <= 0 || resolution.mode === 'pending') return []
  const uniqueIds: string[] = []
  for (const id of resolution.winnerParticipantIds) {
    if (id && !uniqueIds.includes(id)) uniqueIds.push(id)
  }
  if (uniqueIds.length === 0) return []
  if (resolution.mode === 'ctp') {
    return [{ participantId: uniqueIds[0], amount: cents(acePot) }]
  }
  const shares = splitEvenly(acePot, uniqueIds.length)
  return uniqueIds.map((participantId, idx) => ({
    participantId,
    amount: shares[idx],
  }))
}

function shuffled<T>(items: readonly T[], randomFn: () => number): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

export function assignTeamsToCards(
  teams: readonly SpecialTeam[],
  teamsPerCard = 2,
): { teams: SpecialTeam[]; cards: SpecialCard[] } {
  const size = Math.max(1, Math.trunc(teamsPerCard || 2))
  const cards: SpecialCard[] = []
  const nextTeams: SpecialTeam[] = teams.map((t, idx) => ({
    ...t,
    teamNumber: idx + 1,
    holes: t.holes.length === 18 ? [...t.holes] : emptyHoles(),
  }))

  for (let i = 0; i < nextTeams.length; i += size) {
    const cardNumber = cards.length + 1
    const card: SpecialCard = {
      id: `card-${cardNumber}`,
      cardNumber,
      startingHole: ((cards.length * 2) % 18) + 1,
    }
    cards.push(card)
    for (let j = i; j < Math.min(i + size, nextTeams.length); j++) {
      nextTeams[j] = { ...nextTeams[j], cardId: card.id }
    }
  }
  return { teams: nextTeams, cards }
}

const PREFERRED_STARTING_HOLE_ORDER = [
  1, 3, 5, 7, 9, 11, 13, 15, 17,
  2, 4, 6, 8, 10, 12, 14, 16, 18,
]

export function addCardToEvent(cards: readonly SpecialCard[]): SpecialCard[] {
  const nextCardNumber = cards.reduce((max, c) => Math.max(max, c.cardNumber), 0) + 1
  const existingIds = new Set(cards.map(c => c.id))
  let idNum = nextCardNumber
  while (existingIds.has(`card-${idNum}`)) {
    idNum += 1
  }
  const usedHoles = new Set(cards.map(c => c.startingHole))
  const startingHole =
    PREFERRED_STARTING_HOLE_ORDER.find(h => !usedHoles.has(h)) ??
    (((nextCardNumber - 1) * 2) % 18) + 1
  return [
    ...cards,
    {
      id: `card-${idNum}`,
      cardNumber: nextCardNumber,
      startingHole,
    },
  ]
}

export function removeEmptyCardFromEvent(
  cards: readonly SpecialCard[],
  teams: readonly SpecialTeam[],
  cardId: string,
): SpecialCard[] {
  if (cards.length <= 1 || teams.some(t => t.cardId === cardId)) {
    return [...cards]
  }
  return cards
    .filter(c => c.id !== cardId)
    .map((c, idx) => ({
      ...c,
      cardNumber: idx + 1,
    }))
}

function pairPoolsIntoGroups(
  participants: readonly SpecialParticipant[],
  randomFn: () => number,
): { participantIds: string[]; isCali: boolean }[] {
  const poolA = shuffled(participants.filter(p => p.pool === 'A'), randomFn)
  const poolB = shuffled(participants.filter(p => p.pool === 'B'), randomFn)
  const pairCount = Math.min(poolA.length, poolB.length)
  const groups: { participantIds: string[]; isCali: boolean }[] = []

  for (let i = 0; i < pairCount; i++) {
    groups.push({ participantIds: [poolA[i].id, poolB[i].id], isCali: false })
  }

  const leftovers = [...poolA.slice(pairCount), ...poolB.slice(pairCount)]
  for (let i = 0; i + 1 < leftovers.length; i += 2) {
    groups.push({ participantIds: [leftovers[i].id, leftovers[i + 1].id], isCali: false })
  }
  if (leftovers.length % 2 === 1) {
    groups.push({ participantIds: [leftovers[leftovers.length - 1].id], isCali: true })
  }
  return groups
}

function makeEmptyTeam(teamNumber: number, participantIds: string[], isCali: boolean, cardId: string | null = null): SpecialTeam {
  return {
    id: makeSpecialId(),
    teamNumber,
    participantIds,
    isCali,
    cardId,
    holes: emptyHoles(),
    manualTotal18: null,
    playoffRank: null,
  }
}

/**
 * Randomly draws Pool A + Pool B doubles teams.
 * Pairs min(A, B) teams with 1 Pool A + 1 Pool B player, pairs any remaining
 * players from the larger pool together 2-by-2, and creates 1 solo Cali team
 * if the total player count is odd.
 */
export function drawDoublesTeams(
  participants: readonly SpecialParticipant[],
  teamsPerCard = 2,
  randomFn: () => number = Math.random,
): { teams: SpecialTeam[]; cards: SpecialCard[] } {
  const rawTeams = pairPoolsIntoGroups(participants, randomFn).map((grp, idx) =>
    makeEmptyTeam(idx + 1, grp.participantIds, grp.isCali),
  )
  return assignTeamsToCards(rawTeams, teamsPerCard)
}

/**
 * Assigns any late check-in participants who are not yet on a team without
 * reshuffling already-drawn partnerships. Pairs into any open Cali team first,
 * then creates new teams placed onto open cards (or adds new cards as needed).
 */
export function assignUnassignedParticipants(
  participants: readonly SpecialParticipant[],
  existingTeams: readonly SpecialTeam[],
  existingCards: readonly SpecialCard[],
  teamsPerCard = 2,
  randomFn: () => number = Math.random,
): { teams: SpecialTeam[]; cards: SpecialCard[] } {
  const assignedIds = new Set(existingTeams.flatMap(t => t.participantIds))
  const poolRemaining = participants.filter(p => !assignedIds.has(p.id))
  if (poolRemaining.length === 0) {
    return { teams: [...existingTeams], cards: [...existingCards] }
  }

  const nextTeams: SpecialTeam[] = existingTeams.map(t => ({
    ...t,
    participantIds: [...t.participantIds],
  }))
  let nextCards = [...existingCards]
  const size = Math.max(1, Math.trunc(teamsPerCard || 2))
  const partById = new Map(participants.map(p => [p.id, p]))

  for (const team of nextTeams) {
    if (team.participantIds.length !== 1 || poolRemaining.length === 0) continue
    const caliPool = partById.get(team.participantIds[0])?.pool
    const pickIdx =
      caliPool != null
        ? Math.max(0, poolRemaining.findIndex(p => p.pool !== caliPool))
        : 0
    const [picked] = poolRemaining.splice(pickIdx, 1)
    team.participantIds.push(picked.id)
    team.isCali = false
    team.playoffRank = null
  }

  if (poolRemaining.length > 0) {
    for (const grp of pairPoolsIntoGroups(poolRemaining, randomFn)) {
      const openCard = nextCards.find(
        c => nextTeams.filter(t => t.cardId === c.id).length < size,
      )
      let cardId = openCard?.id ?? null
      if (!cardId) {
        nextCards = addCardToEvent(nextCards)
        cardId = nextCards[nextCards.length - 1].id
      }
      nextTeams.push(makeEmptyTeam(nextTeams.length + 1, grp.participantIds, grp.isCali, cardId))
    }
  }

  return {
    teams: nextTeams.map((t, idx) => ({ ...t, teamNumber: idx + 1 })),
    cards: nextCards,
  }
}

export function moveParticipantBetweenTeams(
  teams: readonly SpecialTeam[],
  participantId: string,
  targetTeamId: string | 'new_cali',
  swapWithId?: string,
): SpecialTeam[] {
  const sourceTeam = teams.find(t => t.participantIds.includes(participantId))
  if (!sourceTeam) return [...teams]

  const renumber = (list: SpecialTeam[]) =>
    list
      .filter(t => t.participantIds.length > 0)
      .map((t, idx) => ({
        ...t,
        teamNumber: idx + 1,
        isCali: t.participantIds.length === 1,
      }))

  if (targetTeamId === 'new_cali') {
    if (sourceTeam.participantIds.length <= 1) {
      return teams.map(t => (t.id === sourceTeam.id ? { ...t, isCali: true } : t))
    }
    const next = teams.map(t => {
      if (t.id !== sourceTeam.id) return t
      const remaining = t.participantIds.filter(id => id !== participantId)
      return {
        ...t,
        participantIds: remaining,
        isCali: remaining.length === 1,
        playoffRank: null,
      }
    })
    next.push({
      id: makeSpecialId(),
      teamNumber: next.length + 1,
      participantIds: [participantId],
      isCali: true,
      cardId: sourceTeam.cardId,
      holes: emptyHoles(),
      manualTotal18: null,
      playoffRank: null,
    })
    return renumber(next)
  }

  if (sourceTeam.id === targetTeamId) return [...teams]
  const targetTeam = teams.find(t => t.id === targetTeamId)
  if (!targetTeam) return [...teams]

  if (targetTeam.participantIds.length >= 2) {
    const partnerToSwap =
      swapWithId && targetTeam.participantIds.includes(swapWithId)
        ? swapWithId
        : targetTeam.participantIds[targetTeam.participantIds.length - 1]
    return renumber(
      teams.map(t => {
        if (t.id === sourceTeam.id) {
          return {
            ...t,
            participantIds: t.participantIds.map(id => (id === participantId ? partnerToSwap : id)),
            playoffRank: null,
          }
        }
        if (t.id === targetTeam.id) {
          return {
            ...t,
            participantIds: t.participantIds.map(id => (id === partnerToSwap ? participantId : id)),
            playoffRank: null,
          }
        }
        return t
      }),
    )
  }

  // Target has 1 player (Cali): move participant onto target team.
  return renumber(
    teams.map(t => {
      if (t.id === sourceTeam.id) {
        return {
          ...t,
          participantIds: t.participantIds.filter(id => id !== participantId),
          playoffRank: null,
        }
      }
      if (t.id === targetTeam.id) {
        return {
          ...t,
          participantIds: [...t.participantIds, participantId],
          isCali: false,
          playoffRank: null,
        }
      }
      return t
    }),
  )
}

export function generateCardPins(
  cards: readonly SpecialCard[],
  existingPins: Readonly<Record<string, string>> = {},
  randomFn: () => number = Math.random,
): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()

  for (const card of cards) {
    const prev = existingPins[card.id]?.trim()
    if (prev && /^\d{4}$/.test(prev) && !used.has(prev)) {
      out[card.id] = prev
      used.add(prev)
    }
  }

  for (const card of cards) {
    if (out[card.id]) continue
    let pin = ''
    for (let attempt = 0; attempt < 500; attempt++) {
      const n = Math.floor(1000 + randomFn() * 9000)
      const candidate = String(Math.min(9999, Math.max(1000, n)))
      if (!used.has(candidate)) {
        pin = candidate
        break
      }
    }
    if (!pin) {
      for (let n = 1000; n <= 9999; n++) {
        const candidate = String(n)
        if (!used.has(candidate)) {
          pin = candidate
          break
        }
      }
    }
    used.add(pin)
    out[card.id] = pin
  }

  return out
}

export function nextHoleOrderForCard(
  startingHole: number,
  holes: readonly (number | null)[],
): number {
  const start = Math.min(18, Math.max(1, Math.trunc(startingHole || 1)))
  for (let offset = 0; offset < 18; offset++) {
    const hole = ((start - 1 + offset) % 18) + 1
    if (holes[hole - 1] == null) return hole
  }
  return start
}

export function clampHoleStroke(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null
  return Math.min(20, Math.max(1, Math.trunc(raw)))
}

export function teamScoreSummary(
  team: SpecialTeam,
  courseHoles: readonly CourseHole[],
): TeamScoreSummary {
  const holes = normalizeCourseHoles(courseHoles)
  const { totalPar } = courseParTotals(holes)

  let frontStrokesVal = 0
  let backStrokesVal = 0
  let frontCount = 0
  let backCount = 0
  let holesEntered = 0
  let holesSum = 0
  let parPlayed = 0

  for (let i = 0; i < 18; i++) {
    const v = clampHoleStroke(team.holes?.[i])
    if (v == null) continue
    holesEntered += 1
    holesSum += v
    parPlayed += holes[i].par
    if (i < 9) {
      frontCount += 1
      frontStrokesVal += v
    } else {
      backCount += 1
      backStrokesVal += v
    }
  }

  const frontComplete = frontCount === 9
  const backComplete = backCount === 9
  const frontStrokes = frontComplete ? frontStrokesVal : null
  const backStrokes = backComplete ? backStrokesVal : null

  if (team.manualTotal18 != null && Number.isFinite(team.manualTotal18)) {
    const total18 = Math.trunc(team.manualTotal18)
    return {
      thru: 18,
      strokes: total18,
      parPlayed: totalPar,
      toPar: total18 - totalPar,
      frontStrokes,
      backStrokes,
      frontComplete,
      backComplete,
      isFinished: true,
      officialTotal18: total18,
    }
  }

  if (holesEntered === 0) {
    return {
      thru: 0,
      strokes: null,
      parPlayed: 0,
      toPar: null,
      frontStrokes: null,
      backStrokes: null,
      frontComplete: false,
      backComplete: false,
      isFinished: false,
      officialTotal18: null,
    }
  }

  const isFinished = holesEntered === 18
  return {
    thru: holesEntered,
    strokes: holesSum,
    parPlayed,
    toPar: holesSum - parPlayed,
    frontStrokes,
    backStrokes,
    frontComplete,
    backComplete,
    isFinished,
    officialTotal18: isFinished ? holesSum : null,
  }
}

function sameStandingSlot(
  a: { team: SpecialTeam; summary: TeamScoreSummary },
  b: { team: SpecialTeam; summary: TeamScoreSummary },
): boolean {
  if (a.summary.toPar !== b.summary.toPar) return false
  if (a.summary.isFinished && b.summary.isFinished) {
    const pa = a.team.playoffRank ?? null
    const pb = b.team.playoffRank ?? null
    if ((pa != null || pb != null) && pa !== pb) return false
  }
  return true
}

export function rankSpecialTeams(
  teams: readonly SpecialTeam[],
  courseHoles: readonly CourseHole[],
  payoutPlaces: readonly number[] = [],
): SpecialRankings {
  const summaries = teams.map(team => ({
    team,
    summary: teamScoreSummary(team, courseHoles),
  }))

  const startedRaw = summaries
    .filter(item => item.summary.thru > 0 && item.summary.toPar != null)
    .sort((a, b) => {
      const parDiff = a.summary.toPar! - b.summary.toPar!
      if (parDiff !== 0) return parDiff
      if (a.summary.isFinished && b.summary.isFinished) {
        const pa = a.team.playoffRank ?? Number.MAX_SAFE_INTEGER
        const pb = b.team.playoffRank ?? Number.MAX_SAFE_INTEGER
        if (pa !== pb) return pa - pb
      }
      if (b.summary.thru !== a.summary.thru) return b.summary.thru - a.summary.thru
      return a.team.teamNumber - b.team.teamNumber
    })

  const notStartedRaw = summaries
    .filter(item => item.summary.thru === 0)
    .sort((a, b) => a.team.teamNumber - b.team.teamNumber)

  // Compute official cash payouts across finished teams only.
  const finishedOnly = startedRaw.filter(item => item.summary.isFinished)
  const payoutByTeamId = new Map<string, number>()
  let fIdx = 0
  while (fIdx < finishedOnly.length) {
    let fEnd = fIdx + 1
    while (fEnd < finishedOnly.length && sameStandingSlot(finishedOnly[fIdx], finishedOnly[fEnd])) {
      fEnd += 1
    }
    const groupSize = fEnd - fIdx
    const spanSum = cents(
      payoutPlaces.slice(fIdx, fEnd).reduce((acc, v) => acc + (Number(v) || 0), 0),
    )
    if (spanSum > 0) {
      const shares = splitEvenly(spanSum, groupSize)
      for (let k = 0; k < groupSize; k++) {
        payoutByTeamId.set(finishedOnly[fIdx + k].team.id, shares[k])
      }
    }
    fIdx = fEnd
  }

  // Assign live leaderboard places across started teams.
  const places: number[] = []
  for (let i = 0; i < startedRaw.length; i++) {
    if (i === 0) {
      places.push(1)
    } else if (sameStandingSlot(startedRaw[i - 1], startedRaw[i])) {
      places.push(places[i - 1])
    } else {
      places.push(i + 1)
    }
  }

  const placeCounts = new Map<number, number>()
  for (const p of places) placeCounts.set(p, (placeCounts.get(p) ?? 0) + 1)

  const leaderboard: RankedSpecialTeam[] = startedRaw.map((item, idx) => ({
    team: item.team,
    summary: item.summary,
    place: places[idx],
    tied: (placeCounts.get(places[idx]) ?? 0) > 1,
    payout: payoutByTeamId.get(item.team.id) ?? 0,
  }))

  const notStarted: RankedSpecialTeam[] = notStartedRaw.map(item => ({
    team: item.team,
    summary: item.summary,
    place: 0,
    tied: false,
    payout: 0,
  }))

  return {
    leaderboard,
    notStarted,
    payoutByTeamId,
    unfinishedCount: summaries.filter(item => !item.summary.isFinished).length,
  }
}

export function formatSpecialTeamName(
  team: Pick<SpecialTeam, 'participantIds' | 'isCali'>,
  participantById: ReadonlyMap<string, Pick<SpecialParticipant, 'name'>>,
): string {
  const names = team.participantIds.map(id => participantById.get(id)?.name ?? 'Unknown')
  return team.isCali && names.length === 1 ? `${names[0]} (Cali)` : names.join(' & ')
}

export function filterHistorySpecialEvents(events: readonly SpecialEvent[]): SpecialEvent[] {
  return events
    .filter(e => e.status === 'complete')
    .sort((a, b) => {
      const dateDiff = (b.eventDate ?? '').localeCompare(a.eventDate ?? '')
      if (dateDiff !== 0) return dateDiff
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    })
}

export function buildSpecialEventSnapshot(event: SpecialEvent): SpecialEventSnapshot {
  const participantMap = new Map(event.participants.map(p => [p.id, p]))
  const fin = specialEventMoney(event.participants, event.config)
  const parTotals = courseParTotals(event.courseHoles)
  const ranked = rankSpecialTeams(event.teams, event.courseHoles, event.payoutPlaces)
  const acePayouts = resolveAcePayouts(fin.acePot, event.aceResolution)

  const entries: SpecialEventPodiumEntry[] = ranked.leaderboard.map(row => ({
    place: row.place,
    tied: row.tied,
    teamId: row.team.id,
    teamName: formatSpecialTeamName(row.team, participantMap),
    toPar: row.summary.toPar,
    strokes: row.summary.isFinished ? row.summary.officialTotal18 : row.summary.strokes,
    thru: row.summary.thru,
    isFinished: row.summary.isFinished,
    payout: row.payout,
  }))

  return {
    eventId: event.id,
    name: event.name,
    eventDate: event.eventDate,
    location: event.location,
    participantCount: fin.participantCount,
    teamCount: event.teams.length,
    totalPar: parTotals.totalPar,
    payoutPurse: fin.payoutPurse,
    courseFund: fin.courseFund,
    courseFundLabel: event.config.courseFundLabel,
    acePot: fin.acePot,
    winners: entries.filter(e => e.place === 1),
    podium: entries.slice(0, 3),
    aceOutcome: {
      mode: event.aceResolution.mode,
      winners: acePayouts.map(ap => ({
        participantId: ap.participantId,
        name: participantMap.get(ap.participantId)?.name ?? 'Unknown',
        amount: ap.amount,
      })),
    },
  }
}

export function normalizeSpecialEvent(raw: SpecialEvent): SpecialEvent {
  return {
    ...raw,
    courseHoles: normalizeCourseHoles(raw.courseHoles),
    participants: Array.isArray(raw.participants) ? raw.participants : [],
    teams: Array.isArray(raw.teams)
      ? raw.teams.map(t => ({
          ...t,
          holes: Array.from({ length: 18 }, (_, i) => clampHoleStroke(t.holes?.[i])),
          manualTotal18: t.manualTotal18 == null ? null : Math.trunc(Number(t.manualTotal18)),
          playoffRank: t.playoffRank == null ? null : Math.trunc(Number(t.playoffRank)),
        }))
      : [],
    cards: Array.isArray(raw.cards) ? raw.cards : [],
    payoutPlaces: Array.isArray(raw.payoutPlaces)
      ? raw.payoutPlaces.map(n => Number(n)).filter(n => Number.isFinite(n))
      : [],
    aceResolution: raw.aceResolution ?? { mode: 'pending', winnerParticipantIds: [] },
  }
}

export function sortSpecialEvents(list: readonly SpecialEvent[]): SpecialEvent[] {
  return [...list].sort((a, b) => {
    const aLive = a.status !== 'complete' ? 1 : 0
    const bLive = b.status !== 'complete' ? 1 : 0
    if (aLive !== bLive) return bLive - aLive
    const dateDiff = (b.eventDate ?? '').localeCompare(a.eventDate ?? '')
    if (dateDiff !== 0) return dateDiff
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })
}

export function applyCardHoleScores(
  event: SpecialEvent,
  cardId: string,
  teamHoles: Readonly<Record<string, readonly (number | null)[]>>,
  nowIso = new Date().toISOString(),
): SpecialEvent {
  const sanitized: Record<string, (number | null)[]> = {}
  for (const [teamId, holes] of Object.entries(teamHoles)) {
    sanitized[teamId] = Array.from({ length: 18 }, (_, i) => clampHoleStroke(holes[i]))
  }
  return {
    ...event,
    updatedAt: nowIso,
    teams: event.teams.map(t => {
      if (t.cardId !== cardId || !sanitized[t.id]) return t
      return { ...t, holes: sanitized[t.id] }
    }),
  }
}

export function removeParticipantFromEvent(
  event: SpecialEvent,
  participantId: string,
): SpecialEvent {
  const nextParticipants = event.participants.filter(item => item.id !== participantId)
  const nextTeams = event.teams
    .map(t => {
      const remaining = t.participantIds.filter(pid => pid !== participantId)
      return {
        ...t,
        participantIds: remaining,
        isCali: remaining.length === 1,
      }
    })
    .filter(t => t.participantIds.length > 0)
    .map((t, idx) => ({ ...t, teamNumber: idx + 1 }))

  const nextAceWinnerIds = (event.aceResolution.winnerParticipantIds ?? []).filter(
    id => id !== participantId,
  )

  const nextMoney = specialEventMoney(nextParticipants, event.config)
  let nextPayoutPlaces = event.payoutPlaces
  if (event.payoutPlaces.length > 0) {
    const curSum = cents(event.payoutPlaces.reduce((s, v) => s + (Number(v) || 0), 0))
    if (nextTeams.length === 0) {
      nextPayoutPlaces = []
    } else if (
      event.payoutPlaces.length > nextTeams.length ||
      curSum > nextMoney.payoutPurse + 0.001
    ) {
      const clampedCount = clampPaidPlaces(nextTeams.length, event.payoutPlaces.length)
      nextPayoutPlaces = suggestedTeamPayouts(nextMoney.payoutPurse, clampedCount)
    }
  }

  return {
    ...event,
    participants: nextParticipants,
    teams: nextTeams,
    payoutPlaces: nextPayoutPlaces,
    aceResolution: {
      ...event.aceResolution,
      winnerParticipantIds: nextAceWinnerIds,
    },
  }
}
