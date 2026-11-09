import { createHash } from 'node:crypto'
import type { Fund, LedgerKind, Settings } from './types'
import {
  PLACE_REMAINDER_BACKUP_NOTE,
  PLACE_REMAINDER_NOTE,
  paidPlaceCount,
  perfectRoundRoom,
  placeBudget,
  splitEvenly,
  suggestedPayouts,
} from './money'

const WEEK1_SEASON_ID = '81298495-f87c-4d7c-a344-89b97e587d9b'
const WEEK1_DATE = '2026-11-05'
const WEEK1_NAME = 'Week 1'

interface EventRow {
  id: string
  season_id: string
  date: string
  name: string
}

interface NullEventLedgerRow {
  id: string
  season_id: string
  event_id: string | null
}

interface LedgerChecksumRow {
  id: string
  season_id: string
  event_id: string | null
  player_id?: string | null
  division?: string | null
  fund?: string | null
  kind?: string | null
  amount: number
}

interface RevisionState {
  input: number
  result: number
  finance: number
  settings: number
  tag: number
  structure: number
  postingGeneration: number
  correctionGeneration: number
  engineVersion: string
  schemaVersion: string
  snapshotHash: string
}

interface StoredCacheEntry {
  completed: boolean
  hash: string
}

export class Week1IdentityError extends Error {
  readonly code: 'missing' | 'duplicate'

  constructor(code: 'missing' | 'duplicate', message?: string) {
    super(message ?? `Week 1 identity ${code}`)
    this.name = 'Week1IdentityError'
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function resolveWeek1Identity(
  events: readonly EventRow[],
): { eventId: string; seasonId: string } {
  const matches = events.filter(
    (e) =>
      e.season_id === WEEK1_SEASON_ID &&
      e.date === WEEK1_DATE &&
      e.name === WEEK1_NAME,
  )
  if (matches.length === 0) {
    throw new Week1IdentityError('missing')
  }
  if (matches.length > 1) {
    throw new Week1IdentityError('duplicate')
  }
  return { eventId: matches[0].id, seasonId: matches[0].season_id }
}

export function protectedNullEventLedgerIds(
  rows: readonly NullEventLedgerRow[],
  seasonId: string,
): string[] {
  return rows
    .filter((r) => r.event_id === null && r.season_id === seasonId)
    .map((r) => r.id)
    .sort()
}

export function ledgerChecksum(rows: readonly LedgerChecksumRow[]): string {
  const normalized = rows
    .map((r) =>
      JSON.stringify([
        r.id,
        r.season_id,
        r.event_id,
        r.player_id ?? null,
        r.division ?? null,
        r.fund ?? null,
        r.kind ?? null,
        r.amount,
      ]),
    )
    .sort()
  return createHash('sha256')
    .update(JSON.stringify({ count: rows.length, rows: normalized }))
    .digest('hex')
}

export function seasonFinanceAdvisoryKey(id: string): bigint {
  const hex = createHash('md5')
    .update(`season_finance:${id}`)
    .digest('hex')
    .slice(0, 16)
  const unsigned = BigInt(`0x${hex}`)
  return unsigned >= 2n ** 63n ? unsigned - 2n ** 64n : unsigned
}

export function revisionsMatch(a: RevisionState, b: RevisionState): boolean {
  return (
    a.input === b.input &&
    a.result === b.result &&
    a.finance === b.finance &&
    a.settings === b.settings &&
    a.tag === b.tag &&
    a.structure === b.structure &&
    a.postingGeneration === b.postingGeneration &&
    a.correctionGeneration === b.correctionGeneration &&
    a.engineVersion === b.engineVersion &&
    a.schemaVersion === b.schemaVersion &&
    a.snapshotHash === b.snapshotHash
  )
}

export function requestCacheDecision(params: {
  stored: StoredCacheEntry | null
  hash: string
  fresh: boolean
}): 'cached' | 'collision' | 'stale' | 'proceed' {
  const { stored, hash, fresh } = params
  if (stored !== null) {
    if (stored.hash !== hash) {
      return 'collision'
    }
    if (stored.completed) {
      return 'cached'
    }
  }
  return fresh ? 'proceed' : 'stale'
}

export function bumpRevision(n: number): number {
  return n + 1
}

export function openPoolDeficit(params: {
  entryPurse: number
  bar: number
  highScoreLiability: number
  sharedCharges: number
}): { pool: number; deficit: number } {
  const pool =
    params.entryPurse +
    params.bar -
    params.highScoreLiability -
    params.sharedCharges
  const deficit = Math.max(0, -pool)
  return { pool, deficit }
}

export function minimumOpenBar(
  entryPurse: number,
  highScoreLiability: number,
  sharedCharges: number,
): number {
  return Math.max(0, highScoreLiability + sharedCharges - entryPurse)
}

export function extraWholeDollars(deficit: number): number {
  return Math.ceil(Math.max(0, deficit))
}

export function combinedBarFits(
  frozenOther: number,
  typedBar: number,
  cap: number,
): boolean {
  return frozenOther + typedBar <= cap
}

export function debitSolvency(
  start: {
    M?: Record<string, number | undefined>
    W?: Record<string, number | undefined>
    [division: string]: Record<string, number | undefined> | undefined
  },
  legs: readonly {
    division: string
    fund: string
    amount: number
    kind?: string | null
    note?: string | null
    player_id?: string | null
  }[],
): { division: string; fund: string }[] {
  const groups = new Map<
    string,
    { division: string; fund: string; net: number; hasDebit: boolean }
  >()

  for (const leg of legs) {
    const key = `${leg.division}\0${leg.fund}`
    let entry = groups.get(key)
    if (!entry) {
      entry = {
        division: leg.division,
        fund: leg.fund,
        net: 0,
        hasDebit: false,
      }
      groups.set(key, entry)
    }
    entry.net += leg.amount
    if (leg.amount < 0) {
      entry.hasDebit = true
    }
  }

  const insolvent: { division: string; fund: string }[] = []
  for (const entry of groups.values()) {
    if (!entry.hasDebit) continue
    const startingBalance = start[entry.division]?.[entry.fund] ?? 0
    if (startingBalance + entry.net < -0.001) {
      insolvent.push({ division: entry.division, fund: entry.fund })
    }
  }

  return insolvent
}

export function distributeTiedChecks(
  payouts: readonly number[],
  ranked: readonly {
    id: string
    place: number
    created_at: string
    player_id?: string
  }[],
): Map<string, number> {
  const byPlace = new Map<
    number,
    { id: string; place: number; created_at: string }[]
  >()

  for (const row of ranked) {
    let group = byPlace.get(row.place)
    if (!group) {
      group = []
      byPlace.set(row.place, group)
    }
    group.push(row)
  }

  const result = new Map<string, number>()

  for (const [place, group] of byPlace.entries()) {
    if (place < 1 || group.length === 0) continue

    const sorted = [...group].sort((a, b) => {
      const ta = Date.parse(a.created_at)
      const tb = Date.parse(b.created_at)
      if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
        return ta - tb
      }
      if (a.created_at !== b.created_at) {
        return a.created_at < b.created_at ? -1 : 1
      }
      return 0
    })

    const startIdx = Math.max(0, place - 1)
    let totalCents = 0
    for (let i = 0; i < sorted.length; i++) {
      const p = payouts[startIdx + i] ?? 0
      totalCents += Math.round(p * 100)
    }
    const n = sorted.length

    if (totalCents % 500 === 0) {
      const totalUnits = totalCents / 500
      const baseUnits = Math.floor(totalUnits / n)
      const extraUnits = totalUnits % n
      for (let i = 0; i < n; i++) {
        const units = baseUnits + (i < extraUnits ? 1 : 0)
        result.set(sorted[i].id, units * 5)
      }
    } else {
      const baseCents = Math.floor(totalCents / n)
      const extraCents = totalCents % n
      for (let i = 0; i < n; i++) {
        const cents = baseCents + (i < extraCents ? 1 : 0)
        result.set(sorted[i].id, cents / 100)
      }
    }
  }

  return result
}

export interface Leg {
  division: 'M' | 'W'
  fund: Fund
  kind: LedgerKind
  amount: number
  note: string
  player_id: string | null
}

function cents(n: number): number {
  return Math.round(n * 100) / 100
}

function placeNote(place: number): string {
  const suffix = ['th', 'st', 'nd', 'rd']
  const v = place % 100
  return `${place}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]} place`
}

function byCheckIn(
  a: { created_at: string; id: string },
  b: { created_at: string; id: string },
): number {
  const ta = Date.parse(a.created_at)
  const tb = Date.parse(b.created_at)
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
    return ta - tb
  }
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1
  }
  return 0
}

export function planSplitClose(input: {
  settings: Settings
  entries: ReadonlyArray<{
    id: string
    player_id: string
    division: 'M' | 'W'
    created_at: string
    awards: readonly string[]
    place: number
  }>
  balances: { M: Record<Fund, number>; W: Record<Fund, number> }
  bar: { M: number; W: number }
  openingNight: boolean
  payouts?: { M?: readonly number[]; W?: readonly number[] }
}):
  | { ok: false; reason: 'funding_needed' | 'negative_shared_carry'; deficit?: number; legs: [] }
  | {
      ok: true
      gross: { M: number; W: number }
      heldReserve: { M: { perfect4: number; perfect5: number }; W: { perfect4: number; perfect5: number } }
      placePool: { M: number; W: number }
      released: { M: number; W: number }
      firstLegs: Leg[]
      secondLegs: Leg[]
    } {
  const menEntries = input.entries.filter((e) => e.division === 'M')
  const womenEntries = input.entries.filter((e) => e.division === 'W')

  const entryPurse = cents(input.settings.entryFee - input.settings.perfectRoundShare)

  const gross = {
    M: cents(menEntries.length * entryPurse + input.bar.M),
    W: cents(womenEntries.length * entryPurse + input.bar.W),
  }

  const H = {
    M:
      !input.openingNight && menEntries.some((e) => e.awards.includes('high_score'))
        ? input.settings.bonus.highScore
        : 0,
    W:
      !input.openingNight && womenEntries.some((e) => e.awards.includes('high_score'))
        ? input.settings.bonus.highScore
        : 0,
  }

  const p4Winners = input.entries
    .filter((e) => e.awards.includes('perfect4'))
    .slice()
    .sort(byCheckIn)
  const p5Winners = input.entries
    .filter((e) => e.awards.includes('perfect5'))
    .slice()
    .sort(byCheckIn)

  const flatP4 = input.settings.bonus.perfect4
  const flatP5 = input.settings.bonus.perfect5

  const fPartsP4 = p4Winners.length > 0 ? splitEvenly(flatP4, p4Winners.length) : []
  const fPartsP5 = p5Winners.length > 0 ? splitEvenly(flatP5, p5Winners.length) : []

  let purseChargeM_P4 = 0
  let purseChargeW_P4 = 0
  for (let i = 0; i < p4Winners.length; i++) {
    if (p4Winners[i].division === 'M') {
      purseChargeM_P4 = cents(purseChargeM_P4 + fPartsP4[i])
    } else {
      purseChargeW_P4 = cents(purseChargeW_P4 + fPartsP4[i])
    }
  }

  let purseChargeM_P5 = 0
  let purseChargeW_P5 = 0
  for (let i = 0; i < p5Winners.length; i++) {
    if (p5Winners[i].division === 'M') {
      purseChargeM_P5 = cents(purseChargeM_P5 + fPartsP5[i])
    } else {
      purseChargeW_P5 = cents(purseChargeW_P5 + fPartsP5[i])
    }
  }

  const heldReserve = {
    M: {
      perfect4: menEntries.some((e) => e.awards.includes('perfect4')) ? flatP4 : 0,
      perfect5: menEntries.some((e) => e.awards.includes('perfect5')) ? flatP5 : 0,
    },
    W: {
      perfect4: 0,
      perfect5: 0,
    },
  }

  const totalPurseChargeW = cents(purseChargeW_P4 + purseChargeW_P5)
  const placePoolM = cents(gross.M - H.M - heldReserve.M.perfect4 - heldReserve.M.perfect5)
  const placePoolW = cents(gross.W - H.W - totalPurseChargeW)

  if (placePoolM < 0) {
    return { ok: false, reason: 'funding_needed', deficit: cents(-placePoolM), legs: [] }
  }
  if (placePoolW < 0) {
    return { ok: false, reason: 'funding_needed', deficit: cents(-placePoolW), legs: [] }
  }

  if (p4Winners.length > 0 && cents(input.balances.M.perfect4 + input.balances.W.perfect4) < 0) {
    return { ok: false, reason: 'negative_shared_carry', legs: [] }
  }
  if (p5Winners.length > 0 && cents(input.balances.M.perfect5 + input.balances.W.perfect5) < 0) {
    return { ok: false, reason: 'negative_shared_carry', legs: [] }
  }

  const unusedM_P4 = Math.max(0, cents(heldReserve.M.perfect4 - purseChargeM_P4))
  const unusedM_P5 = Math.max(0, cents(heldReserve.M.perfect5 - purseChargeM_P5))

  const placePool = {
    M: placePoolM,
    W: placePoolW,
  }

  const released = {
    M: cents(unusedM_P4 + unusedM_P5),
    W: 0,
  }

  const firstLegs: Leg[] = []
  const secondLegs: Leg[] = []

  function addLeg(
    target: Leg[],
    division: 'M' | 'W',
    fund: Fund,
    kind: LedgerKind,
    amount: number,
    note: string,
    player_id: string | null = null,
  ) {
    const rounded = cents(amount)
    if (rounded !== 0) {
      target.push({
        division,
        fund,
        kind,
        amount: rounded,
        note,
        player_id,
      })
    }
  }

  const prCap = input.settings.perfectRoundCap

  // --- Men's firstLegs ---
  addLeg(
    firstLegs,
    'M',
    'purse',
    'entry',
    menEntries.length * entryPurse,
    `${menEntries.length} entries × $${entryPurse} to the payout pool`,
  )
  addLeg(firstLegs, 'M', 'purse', 'bar_match', input.bar.M, 'Bar match')

  const prContributionM = cents(menEntries.length * input.settings.perfectRoundShare)
  const prFitM = Math.min(Math.max(0, cents(prCap - input.balances.M.perfect_round)), prContributionM)
  const prOverflowM = cents(prContributionM - prFitM)
  addLeg(
    firstLegs,
    'M',
    'perfect_round',
    'entry',
    prFitM,
    `${menEntries.length} entries × $${input.settings.perfectRoundShare}`,
  )
  addLeg(firstLegs, 'M', 'backup', 'overflow', prOverflowM, 'Over the cap')
  const potAfterM = cents(input.balances.M.perfect_round + prFitM)
  let laterPR_M = potAfterM

  const prWinnersM = menEntries
    .filter((e) => e.awards.includes('perfect_round'))
    .slice()
    .sort(byCheckIn)
  if (prWinnersM.length > 0) {
    const prSharesM = splitEvenly(potAfterM, prWinnersM.length)
    for (let i = 0; i < prWinnersM.length; i++) {
      addLeg(firstLegs, 'M', 'perfect_round', 'bonus_payout', -prSharesM[i], 'Perfect Round', prWinnersM[i].player_id)
    }
    const rollM = Math.min(cents(input.balances.M.backup + prOverflowM), prCap)
    if (rollM !== 0) {
      addLeg(firstLegs, 'M', 'backup', 'rollover', -rollM, 'Backup becomes the Perfect Round pot')
      addLeg(firstLegs, 'M', 'perfect_round', 'rollover', rollM, 'From backup pot')
    }
    laterPR_M = cents(rollM)
  }

  if (H.M !== 0) {
    addLeg(firstLegs, 'M', 'purse', 'transfer', -H.M, 'Funded from the payout pool')
    addLeg(firstLegs, 'M', 'high_score', 'transfer', H.M, 'Funded from the payout pool')
    const hsWinnersM = menEntries
      .filter((e) => e.awards.includes('high_score'))
      .slice()
      .sort(byCheckIn)
    const hsSharesM = splitEvenly(H.M, hsWinnersM.length)
    for (let i = 0; i < hsWinnersM.length; i++) {
      addLeg(firstLegs, 'M', 'high_score', 'bonus_payout', -hsSharesM[i], 'High Score', hsWinnersM[i].player_id)
    }
  }

  const checksM =
    input.payouts?.M !== undefined
      ? input.payouts.M
      : suggestedPayouts(placePool.M, paidPlaceCount(menEntries.length, 0, input.settings))
  const payoutMapM = distributeTiedChecks(checksM, menEntries)
  const sortedMenEntries = [...menEntries].sort((a, b) => a.place - b.place || byCheckIn(a, b))
  for (const entry of sortedMenEntries) {
    const pay = payoutMapM.get(entry.id) ?? 0
    if (pay > 0) {
      addLeg(firstLegs, 'M', 'purse', 'place_payout', -pay, placeNote(entry.place), entry.player_id)
    }
  }

  const allocatedM = cents(Array.from(payoutMapM.values()).reduce((sum, v) => sum + (v > 0 ? v : 0), 0))
  const rM = Math.max(0, Math.min(cents(placePool.M - placeBudget(placePool.M)), cents(placePool.M - allocatedM)))
  if (rM !== 0) {
    addLeg(firstLegs, 'M', 'purse', 'transfer', -rM, PLACE_REMAINDER_NOTE)
    const roomM = perfectRoundRoom(laterPR_M, prCap, rM)
    if (roomM.pot !== 0) {
      addLeg(firstLegs, 'M', 'perfect_round', 'transfer', roomM.pot, PLACE_REMAINDER_NOTE)
      laterPR_M = cents(laterPR_M + roomM.pot)
    }
    if (roomM.backup !== 0) {
      addLeg(firstLegs, 'M', 'backup', 'overflow', roomM.backup, PLACE_REMAINDER_BACKUP_NOTE)
    }
  }

  // --- Women's own legs on secondLegs ---
  addLeg(
    secondLegs,
    'W',
    'purse',
    'entry',
    womenEntries.length * entryPurse,
    `${womenEntries.length} entries × $${entryPurse} to the payout pool`,
  )
  addLeg(secondLegs, 'W', 'purse', 'bar_match', input.bar.W, 'Bar match')

  const prContributionW = cents(womenEntries.length * input.settings.perfectRoundShare)
  const prFitW = Math.min(Math.max(0, cents(prCap - input.balances.W.perfect_round)), prContributionW)
  const prOverflowW = cents(prContributionW - prFitW)
  addLeg(
    secondLegs,
    'W',
    'perfect_round',
    'entry',
    prFitW,
    `${womenEntries.length} entries × $${input.settings.perfectRoundShare}`,
  )
  addLeg(secondLegs, 'W', 'backup', 'overflow', prOverflowW, 'Over the cap')
  const potAfterW = cents(input.balances.W.perfect_round + prFitW)
  let laterPR_W = potAfterW

  const prWinnersW = womenEntries
    .filter((e) => e.awards.includes('perfect_round'))
    .slice()
    .sort(byCheckIn)
  if (prWinnersW.length > 0) {
    const prSharesW = splitEvenly(potAfterW, prWinnersW.length)
    for (let i = 0; i < prWinnersW.length; i++) {
      addLeg(secondLegs, 'W', 'perfect_round', 'bonus_payout', -prSharesW[i], 'Perfect Round', prWinnersW[i].player_id)
    }
    const rollW = Math.min(cents(input.balances.W.backup + prOverflowW), prCap)
    if (rollW !== 0) {
      addLeg(secondLegs, 'W', 'backup', 'rollover', -rollW, 'Backup becomes the Perfect Round pot')
      addLeg(secondLegs, 'W', 'perfect_round', 'rollover', rollW, 'From backup pot')
    }
    laterPR_W = cents(rollW)
  }

  if (H.W !== 0) {
    addLeg(secondLegs, 'W', 'purse', 'transfer', -H.W, 'Funded from the payout pool')
    addLeg(secondLegs, 'W', 'high_score', 'transfer', H.W, 'Funded from the payout pool')
    const hsWinnersW = womenEntries
      .filter((e) => e.awards.includes('high_score'))
      .slice()
      .sort(byCheckIn)
    const hsSharesW = splitEvenly(H.W, hsWinnersW.length)
    for (let i = 0; i < hsWinnersW.length; i++) {
      addLeg(secondLegs, 'W', 'high_score', 'bonus_payout', -hsSharesW[i], 'High Score', hsWinnersW[i].player_id)
    }
  }

  const checksW =
    input.payouts?.W !== undefined
      ? input.payouts.W
      : suggestedPayouts(placePool.W, paidPlaceCount(womenEntries.length, 0, input.settings))
  const payoutMapW = distributeTiedChecks(checksW, womenEntries)
  const sortedWomenEntries = [...womenEntries].sort((a, b) => a.place - b.place || byCheckIn(a, b))
  for (const entry of sortedWomenEntries) {
    const pay = payoutMapW.get(entry.id) ?? 0
    if (pay > 0) {
      addLeg(secondLegs, 'W', 'purse', 'place_payout', -pay, placeNote(entry.place), entry.player_id)
    }
  }

  const allocatedW = cents(Array.from(payoutMapW.values()).reduce((sum, v) => sum + (v > 0 ? v : 0), 0))
  const rW = Math.max(0, Math.min(cents(placePool.W - placeBudget(placePool.W)), cents(placePool.W - allocatedW)))
  if (rW !== 0) {
    addLeg(secondLegs, 'W', 'purse', 'transfer', -rW, PLACE_REMAINDER_NOTE)
    const roomW = perfectRoundRoom(laterPR_W, prCap, rW)
    if (roomW.pot !== 0) {
      addLeg(secondLegs, 'W', 'perfect_round', 'transfer', roomW.pot, PLACE_REMAINDER_NOTE)
      laterPR_W = cents(laterPR_W + roomW.pot)
    }
    if (roomW.backup !== 0) {
      addLeg(secondLegs, 'W', 'backup', 'overflow', roomW.backup, PLACE_REMAINDER_BACKUP_NOTE)
    }
  }

  // --- Shared P4 then P5 on secondLegs ---
  const sharedPots = [
    {
      fund: 'perfect4' as const,
      winners: p4Winners,
      flat: flatP4,
      fParts: fPartsP4,
      chargeM: purseChargeM_P4,
      chargeW: purseChargeW_P4,
      label: 'Perfect 4',
    },
    {
      fund: 'perfect5' as const,
      winners: p5Winners,
      flat: flatP5,
      fParts: fPartsP5,
      chargeM: purseChargeM_P5,
      chargeW: purseChargeW_P5,
      label: 'Perfect 5',
    },
  ]

  for (const pot of sharedPots) {
    if (pot.winners.length === 0) continue
    const cM = input.balances.M[pot.fund]
    const cW = input.balances.W[pot.fund]
    const totalPot = cents(cM + cW + pot.flat)
    const aParts = splitEvenly(totalPot, pot.winners.length)

    if (pot.chargeM !== 0) {
      addLeg(secondLegs, 'M', 'purse', 'transfer', -pot.chargeM, 'Funded from the payout pool')
      addLeg(secondLegs, 'M', pot.fund, 'transfer', pot.chargeM, 'Funded from the payout pool')
    }
    if (pot.chargeW !== 0) {
      addLeg(secondLegs, 'W', 'purse', 'transfer', -pot.chargeW, 'Funded from the payout pool')
      addLeg(secondLegs, 'W', pot.fund, 'transfer', pot.chargeW, 'Funded from the payout pool')
    }

    let dM = 0
    let dW = 0
    for (let i = 0; i < pot.winners.length; i++) {
      const diff = cents(aParts[i] - pot.fParts[i])
      if (pot.winners[i].division === 'M') {
        dM = cents(dM + diff)
      } else {
        dW = cents(dW + diff)
      }
    }

    const carryM = cents(dM - cM)
    const carryW = cents(dW - cW)
    if (carryM !== 0) {
      addLeg(secondLegs, 'M', pot.fund, 'transfer', carryM, `Shared ${pot.label} pot`)
    }
    if (carryW !== 0) {
      addLeg(secondLegs, 'W', pot.fund, 'transfer', carryW, `Shared ${pot.label} pot`)
    }

    for (let i = 0; i < pot.winners.length; i++) {
      addLeg(
        secondLegs,
        pot.winners[i].division,
        pot.fund,
        'bonus_payout',
        -aParts[i],
        pot.label,
        pot.winners[i].player_id,
      )
    }
  }

  // --- Reserve release for Men on secondLegs ---
  const unusedList = [
    { pot: 'perfect4' as const, unused: unusedM_P4 },
    { pot: 'perfect5' as const, unused: unusedM_P5 },
  ]

  for (const item of unusedList) {
    if (item.unused !== 0) {
      addLeg(secondLegs, 'M', 'purse', 'transfer', -item.unused, 'Unused reserve to the Perfect Round pot')
      const room = perfectRoundRoom(laterPR_M, prCap, item.unused)
      if (room.pot !== 0) {
        addLeg(secondLegs, 'M', 'perfect_round', 'transfer', room.pot, 'Unused reserve to the Perfect Round pot')
        laterPR_M = cents(laterPR_M + room.pot)
      }
      if (room.backup !== 0) {
        addLeg(secondLegs, 'M', 'backup', 'overflow', room.backup, 'Unused reserve over the Perfect Round cap')
      }
    }
  }

  return {
    ok: true,
    gross,
    heldReserve,
    placePool,
    released,
    firstLegs,
    secondLegs,
  }
}
