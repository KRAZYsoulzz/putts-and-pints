import { cents, distribute, initialTagAssignment, rankFinal, redistributeTags, totals, type Ranked } from './scoring'
import { AWARD_LABEL, AWARDS } from './types'
import type { Award, Division, Entry, Fund, LedgerKind, LedgerRow, PPEvent, Settings } from './types'

// ---------------------------------------------------------------------------
// Pot balances
// ---------------------------------------------------------------------------
export type Balances = Record<Fund, number>
const EMPTY: Balances = { perfect_round: 0, backup: 0, perfect5: 0, perfect4: 0, high_score: 0, tag_fund: 0, purse: 0 }

/** Balances for one division (season-wide tag fund included). */
export function balances(ledger: LedgerRow[], division: Division): Balances {
  const b = { ...EMPTY }
  for (const r of ledger) {
    if (r.fund === 'tag_fund' || r.division === division) b[r.fund] = cents(b[r.fund] + Number(r.amount))
  }
  return b
}

/** Total balance across all ledger rows for a fund regardless of division. */
export function sharedPotBalance(ledger: readonly LedgerRow[], fund: Fund): number {
  return cents(ledger
    .filter(r => r.fund === fund)
    .reduce((sum, r) => sum + Number(r.amount), 0)
  )
}

// ---------------------------------------------------------------------------
// Event money
// ---------------------------------------------------------------------------
export interface EventMoney {
  totalPot: number
  barMatch: number
  barSplit: Record<Division, number>
}

/** Bar matches a % of the whole night's entry money, up to barMatchCap; split suggested by division size. */
export function eventMoney(counts: Record<Division, number>, s: Settings): EventMoney {
  const players = counts.M + counts.W
  const totalPot = players * s.entryFee
  const barMatch = Math.min(cents(totalPot * s.barMatchPct / 100), s.barMatchCap)
  // Nearest dollar for the men's share. Women get the rest, so a whole-dollar bar
  // stays whole for both divisions and the two shares still add up to the bar.
  let men = 0
  let women = 0
  if (players > 0 && barMatch > 0) {
    if (counts.M === 0) women = barMatch
    else if (counts.W === 0) men = barMatch
    else {
      men = Math.round((barMatch * counts.M) / players)
      women = cents(barMatch - men)
    }
  }
  return { totalPot, barMatch, barSplit: { M: men, W: women } }
}

/**
 * The bar match this division gets for an event. A typed override (or a finished night, whose
 * amount was saved at finalize) wins; otherwise it follows the check-in counts, so it moves as
 * players arrive: 50% of the entry money, capped, split by division size.
 */
export function effectiveBar(
  ev: Pick<PPEvent, 'status' | 'bar_match_men' | 'bar_match_women' | 'bar_match_men_manual' | 'bar_match_women_manual'>,
  d: Division,
  counts: Record<Division, number>,
  s: Settings,
): number {
  const manual = d === 'M' ? ev.bar_match_men_manual : ev.bar_match_women_manual
  if (manual || ev.status === 'complete') {
    const n = Number(d === 'M' ? ev.bar_match_men : ev.bar_match_women)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return eventMoney(counts, s).barSplit[d]
}

/**
 * Night purse available for place checks.
 * $8 of each entry (the $2 perfect-round share is already removed) plus the bar match,
 * minus Perfect 5 / Perfect 4 / High Score bonuses that have actually been awarded.
 * The Perfect Round pot is not part of this pool.
 */
export function payoutPool(count: number, barMatch: number, s: Settings, bonuses = 0): number {
  return cents(count * (s.entryFee - s.perfectRoundShare) + barMatch - bonuses)
}

export const suggestedPaidPlaces = (count: number, s: Settings) =>
  count ? Math.max(1, Math.round(count / s.paidEvery)) : 0

/** Keep a chosen place count inside 1..field. An empty field stays at 0. */
export function clampPaidPlaces(field: number, places: number): number {
  if (field <= 0) return 0
  const n = Math.floor(places)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(field, n)
}

/**
 * Paid places for one division tonight. A saved payout list wins; otherwise the
 * season suggestion (1 per `paidEvery`). At least 1 when anyone played, never
 * more than the field.
 */
export function paidPlaceCount(field: number, stored: number, s: Settings): number {
  if (field <= 0) return 0
  return clampPaidPlaces(field, stored > 0 ? stored : suggestedPaidPlaces(field, s))
}

/**
 * Rebuild place checks for a new count. The declining split is `suggestedPayouts`.
 * A pool that cannot be split still keeps `places` entries so the count sticks.
 */
export function payoutsForPlaceCount(pool: number, places: number): number[] {
  if (places <= 0) return []
  const split = suggestedPayouts(pool, places)
  if (split.length === places) return split
  return Array.from({ length: places }, () => 0)
}

/** This night already has ledger rows. Reopen keeps them until the next finalize. */
export function eventLedgerPosted(rows: { event_id: string | null }[], eventId: string): boolean {
  return rows.some(r => r.event_id === eventId)
}

/**
 * Before the post, the card previews the pot plus tonight's $2s.
 * After the post those $2s are already in the ledger, so adding them again
 * shows $20 when the ledger says $10.
 */
export function displayedPerfectRound(ledgerBalance: number, projected: number, posted: boolean): number {
  return posted ? ledgerBalance : projected
}

/**
 * Split a pot evenly among n winners to the cent. Leftover cents go one at a time to
 * the first winners, so the shares always add back up to the pot.
 */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return []
  const totalCents = Math.round(total * 100)
  const base = Math.floor(totalCents / n)
  const extra = totalCents - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100)
}

/** One division's entries and the pot balances from before this event. */
export interface DivisionNight {
  division: Division
  entries: Entry[]
  balances: Balances
}

type SharedAward = 'perfect5' | 'perfect4'

function eventNights(division: Division, entries: Entry[], potBalances: Balances, cohort?: DivisionNight[]): DivisionNight[] {
  return [
    { division, entries, balances: potBalances },
    ...(cohort ?? []).filter(night => night.division !== division),
  ]
}

function byCheckIn(a: Entry, b: Entry): number {
  const ta = a.created_at ?? ''
  const tb = b.created_at ?? ''
  if (ta !== tb) return ta < tb ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

interface SharedShare {
  entry: Entry
  /** Division whose list this entry came from. That purse pays this winner's flat cents. */
  division: Division
  amount: number
}

interface SharedAwardPlan {
  winners: SharedShare[]
  shares: SharedShare[]
  purseCharge: Record<Division, number>
}

/**
 * One Perfect 4 or Perfect 5 pot for the event.
 * Available money is both divisions' carryover plus the flat bonus once.
 * Player shares are one even split of that total, so they add up to it.
 * Purse charges are a separate even split of only the flat bonus: carryover
 * is already in the pot, and a division with no winner pays none of the $10.
 * Check-in order (then id) decides who receives a leftover cent when both
 * divisions are in the event. A single division keeps its list order.
 */
function sharedAwardPlan(nights: DivisionNight[], type: SharedAward, s: Settings): SharedAwardPlan {
  const groups = nights.map(night => night.entries
    .filter(entry => entry.awards?.includes(type))
    .map(entry => ({ entry, division: night.division, amount: 0 })))
  const tagged = nights.length < 2 ? (groups[0] ?? []) : groups.flat().sort((a, b) => byCheckIn(a.entry, b.entry))
  const seen = new Set<string>()
  const winners: SharedShare[] = []
  for (const item of tagged) {
    if (seen.has(item.entry.id)) continue
    seen.add(item.entry.id)
    winners.push(item)
  }
  const carry = cents(nights.reduce((sum, night) => sum + (night.balances[type] || 0), 0))
  const flat = winners.length ? (type === 'perfect5' ? s.bonus.perfect5 : s.bonus.perfect4) : 0
  const amounts = splitEvenly(winners.length ? cents(carry + flat) : 0, winners.length)
  const flatParts = splitEvenly(flat, winners.length)
  const purseCharge: Record<Division, number> = { M: 0, W: 0 }
  winners.forEach((winner, index) => {
    winner.amount = amounts[index]
    purseCharge[winner.division] = cents(purseCharge[winner.division] + flatParts[index])
  })
  return { winners, shares: winners, purseCharge }
}

/** Combined carryover plus the one flat bonus. This is the pot a winner splits, before anyone is marked. */
export function displayedSharedPot(
  type: SharedAward,
  nights: DivisionNight[],
  s: Settings,
  priorLedger?: readonly LedgerRow[],
): number {
  const carry = priorLedger
    ? sharedPotBalance(priorLedger, type)
    : cents(nights.reduce((sum, night) => sum + (night.balances[type] || 0), 0))
  const flat = type === 'perfect5' ? s.bonus.perfect5 : s.bonus.perfect4
  return cents(carry + flat)
}

/** The other division's entries and its pot balances from before this event. */
export function otherDivisionNights(division: Division, eventId: string, entries: Entry[], ledger: LedgerRow[]): DivisionNight[] {
  return (['M', 'W'] as Division[])
    .filter(d => d !== division)
    .map(d => ({
      division: d,
      entries: entries.filter(entry => entry.event_id === eventId && entry.division === d),
      balances: balances(ledger.filter(row => row.event_id !== eventId), d),
    }))
}

/**
 * What the awarded night bonuses cost this division's purse.
 * Perfect 5 and Perfect 4 are one flat bonus each for the whole event. Pass `cohort`
 * (the other division) so that $10 is split across every winner and this purse pays
 * only its players' cents. Without a cohort, this list is the whole event.
 * High Score stays on this division, and is free on the season's first event
 * (`payHighScore: false`); it only sets the record.
 */
export function nightBonusCost(entries: Entry[], s: Settings, opts?: {
  payHighScore?: boolean
  division?: Division
  cohort?: DivisionNight[]
}): number {
  const payHighScore = opts?.payHighScore !== false
  let total = 0
  if (opts?.cohort && opts.division) {
    const nights = eventNights(opts.division, entries, EMPTY, opts.cohort)
    total += sharedAwardPlan(nights, 'perfect5', s).purseCharge[opts.division]
    total += sharedAwardPlan(nights, 'perfect4', s).purseCharge[opts.division]
  } else {
    if (entries.some(e => e.awards?.includes('perfect5'))) total += s.bonus.perfect5
    if (entries.some(e => e.awards?.includes('perfect4'))) total += s.bonus.perfect4
  }
  if (payHighScore && entries.some(e => e.awards?.includes('high_score'))) total += s.bonus.highScore
  return cents(total)
}

/**
 * Bonus cost already posted for one division. A finished night shows this so the
 * pool stays on the ledger instead of a rule that changed after finalize.
 */
export function postedBonusCost(
  rows: { event_id: string | null; division: Division | null; fund: string; kind: string; amount: number; note?: string | null }[],
  eventId: string,
  division: Division,
): number {
  const spent = rows
    .filter(r => r.event_id === eventId && r.division === division && r.fund === 'purse' && r.kind === 'transfer' && r.note !== PLACE_REMAINDER_NOTE)
    .reduce((sum, r) => sum + Number(r.amount), 0)
  return cents(0 - spent)
}

/** Perfect Round deposit already posted for one division. A finished night shows this instead of a new calculation. */
export function postedPlaceRemainder(
  rows: { event_id: string | null; division: Division | null; fund: string; kind: string; amount: number; note?: string | null }[],
  eventId: string,
  division: Division,
): number {
  return cents(rows
    .filter(r => r.event_id === eventId && r.division === division && r.fund === 'perfect_round' && r.kind === 'transfer' && r.note === PLACE_REMAINDER_NOTE)
    .reduce((sum, r) => sum + Number(r.amount), 0))
}

/** Remainder that overflowed from a full Perfect Round pot on an already posted night. */
export function postedRemainderBackup(
  rows: { event_id: string | null; division: Division | null; fund: string; kind: string; amount: number; note?: string | null }[],
  eventId: string,
  division: Division,
): number {
  return cents(rows
    .filter(r => r.event_id === eventId && r.division === division && r.fund === 'backup' && r.kind === 'overflow' && r.note === PLACE_REMAINDER_BACKUP_NOTE)
    .reduce((sum, r) => sum + Number(r.amount), 0))
}

/** Largest multiple of $5 that place checks can use without going over the pool. */
export function placeBudget(pool: number): number {
  if (!(pool > 0)) return 0
  return Math.floor(Math.round(pool * 100) / 500) * 5
}

/** Pool money that is not a $5 step. It is deposited to that division's Perfect Round pot. */
export function placeRemainder(pool: number): number {
  if (!(pool > 0)) return 0
  return cents(pool - placeBudget(pool))
}

export const PLACE_REMAINDER_NOTE = 'Place payout remainder to the Perfect Round pot'
export const PLACE_REMAINDER_BACKUP_NOTE = 'Place payout remainder over the Perfect Round cap'

/** How much of `amount` fits in the Perfect Round pot, and how much overflows to Backup. */
export function perfectRoundRoom(balance: number, cap: number, amount: number): { pot: number; backup: number } {
  if (!(amount > 0)) return { pot: 0, backup: 0 }
  const room = Math.max(0, cents(cap - balance))
  const pot = Math.min(room, amount)
  return { pot: cents(pot), backup: cents(amount - pot) }
}

/**
 * Split a pool across `places` in a declining ratio (2 places → 2/3 + 1/3, and so on).
 * Every check is a multiple of $5 and the checks stay within the pool. Extra $5 bills
 * go to the places with the largest leftover fraction, earlier places first on a tie.
 * The part of the pool under $5 is not included; `placeRemainder` sends it to Perfect Round.
 */
export function suggestedPayouts(pool: number, places: number): number[] {
  if (places <= 0 || pool <= 0) return []
  const budget = placeBudget(pool)
  if (budget <= 0) return Array.from({ length: places }, () => 0)
  const units = budget / 5
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
  return base.map(u => u * 5)
}

/**
 * Tied players share place money in $5 steps when the places add up to a $5 total.
 * The earlier player in the existing rank order gets each extra $5.
 * A total that is not a $5 step is split to the cent instead of being rewritten.
 */
function distributePlaceChecks(ranked: Ranked[], values: number[]): Map<string, number> {
  const out = new Map<string, number>()
  const byPlace = new Map<number, Ranked[]>()
  ranked.forEach(r => byPlace.set(r.place, [...(byPlace.get(r.place) ?? []), r]))
  for (const [place, group] of byPlace) {
    if (place < 1 || group.length === 0) continue
    const total = cents(values.slice(place - 1, place - 1 + group.length).reduce((a, b) => a + (Number(b) || 0), 0))
    const totalCents = Math.round(total * 100)
    if (totalCents % 500 === 0) {
      const units = totalCents / 500
      const base = Math.floor(units / group.length)
      let extra = units - base * group.length
      group.forEach(r => {
        const pay = (base + (extra > 0 ? 1 : 0)) * 5
        if (extra > 0) extra -= 1
        out.set(r.entry.id, pay)
      })
      continue
    }
    const shares = splitEvenly(total, group.length)
    group.forEach((r, i) => out.set(r.entry.id, shares[i]))
  }
  return out
}

function placeNote(place: number): string {
  const suffix = ['th', 'st', 'nd', 'rd']
  const v = place % 100
  return `${place}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]} place`
}

// ---------------------------------------------------------------------------
// Results for one division
// ---------------------------------------------------------------------------
export interface BonusWin {
  type: Award
  entryIds: string[]
  /** The biggest share (shares differ by a cent when the pot does not divide evenly). */
  each: number
  /** One share per winner, in entryIds order. Adds up to this division's part of the pot. */
  amounts: number[]
  /** Winners in both divisions, when this list is only one division's share of a shared pot. */
  splitAmong?: number
}

export interface DivisionResult {
  ranked: Ranked[]
  payouts: Map<string, number>
  points: Map<string, number>
  tagsOut: Map<string, number>
  bonuses: BonusWin[]
  newRecord: number | null
  /** pot balance after tonight's $2s, before any win */
  potAfterEntries: number
  /** Place-pool remainder that fits in this division's Perfect Round pot. */
  placeRemainderToPot: number
  /** Place-pool remainder that overflows into Backup because the pot is full. */
  placeRemainderToBackup: number
  ledger: Omit<LedgerRow, 'id' | 'created_at' | 'season_id' | 'event_id'>[]
}

interface ResultInput {
  division: Division
  entries: Entry[]
  payoutPlaces: number[]
  settings: Settings
  balances: Balances
  /** This division's bar-match dollars for the night. */
  barMatch?: number
  /** best 27-hole total from earlier completed events this season (null = first event) */
  priorRecord: number | null
  /**
   * The other division tonight. Perfect 4 and Perfect 5 then use one combined pot.
   * Omit when this division is the whole event.
   */
  cohort?: DivisionNight[]
  /**
   * Season's first event: an awarded High Score sets the record and pays nothing.
   * Later nights pay the flat bonus when it is awarded.
   * When omitted, a null prior record is treated as that first night.
   */
  openingNight?: boolean
  /**
   * opening = the season's first event deals tag 1..N to opted-in players.
   * redistribute (default) = later nights reshuffle the numbers people carried in.
   */
  tagPlan?: 'opening' | 'redistribute'
  /** Bought a tag this season. When omitted, every carried tag stays eligible. */
  inTags?: (playerId: string) => boolean
}

export function divisionResult(i: ResultInput): DivisionResult {
  const { division, entries, settings: s } = i
  const ranked = rankFinal(entries, s)
  const ledger: DivisionResult['ledger'] = []
  const row = (fund: Fund, kind: LedgerKind, amount: number, note: string, player_id: string | null = null) => {
    if (amount) ledger.push({ division, fund, kind, amount: cents(amount), note, player_id })
  }

  // Night purse: the $8 payout share of each entry, plus whatever the bar matched.
  const entryShare = s.entryFee - s.perfectRoundShare
  row('purse', 'entry', entries.length * entryShare, `${entries.length} entries × $${entryShare} to the payout pool`)
  row('purse', 'bar_match', i.barMatch ?? 0, 'Bar match')

  // Perfect Round pot: $X per entry, capped, overflow to backup
  const contribution = entries.length * s.perfectRoundShare
  const room = Math.max(0, s.perfectRoundCap - i.balances.perfect_round)
  const toPot = Math.min(room, contribution)
  row('perfect_round', 'entry', toPot, `${entries.length} entries × $${s.perfectRoundShare}`)
  row('backup', 'overflow', contribution - toPot, 'Over the cap')
  const potAfterEntries = cents(i.balances.perfect_round + toPot)
  let perfectRoundBalance = potAfterEntries

  // Bonuses: awarded by hand (right-click). Perfect Round is this division's pot.
  // Perfect 5 and Perfect 4 are one pot each for the event: both divisions' carryover
  // plus one flat bonus, split across everyone who hit it. High Score stays a flat
  // per-division bonus, except the season's first event, which only sets the record.
  // Fund the pot first so the payout does not drive it negative.
  const bonuses: BonusWin[] = []
  const openingNight = i.openingNight ?? i.priorRecord == null
  const nights = eventNights(division, entries, i.balances, i.cohort)
  const amounts: Record<Award, number> = {
    perfect_round: potAfterEntries,
    perfect5: s.bonus.perfect5,
    perfect4: s.bonus.perfect4,
    high_score: openingNight ? 0 : s.bonus.highScore,
  }
  for (const type of AWARDS) {
    if (type === 'perfect5' || type === 'perfect4') {
      const plan = sharedAwardPlan(nights, type, s)
      if (!plan.winners.length) continue
      const mine = plan.shares.filter(share => share.division === division)
      if (mine.length) {
        const shares = mine.map(share => share.amount)
        bonuses.push({
          type,
          entryIds: mine.map(share => share.entry.id),
          each: shares[0],
          amounts: shares,
          ...(plan.winners.length !== mine.length ? { splitAmong: plan.winners.length } : {}),
        })
      }
      // The purse pays only this division's cents of the flat bonus. Carryover is already
      // in the pot funds. The pot transfer makes this division's balance end at zero
      // once anyone in the event has won, including when its carryover is paid to the
      // other division.
      const flatCharge = plan.purseCharge[division]
      const payoutSum = cents(mine.reduce((sum, share) => sum + share.amount, 0))
      const potTransfer = cents(payoutSum - i.balances[type])
      if (flatCharge) row('purse', 'transfer', -flatCharge, `${AWARD_LABEL[type]} funded from the payout pool`)
      if (potTransfer) {
        const sameAsPurse = cents(potTransfer - flatCharge) === 0
        row(type, 'transfer', potTransfer, sameAsPurse ? 'Funded from the payout pool' : `Shared ${AWARD_LABEL[type]} pot`)
      }
      for (const share of mine) row(type, 'bonus_payout', -share.amount, AWARD_LABEL[type], share.entry.player_id)
      continue
    }
    const winners = entries.filter(e => e.awards?.includes(type))
    if (!winners.length) continue
    const flat = type === 'perfect_round' ? 0 : amounts[type]
    const pot = amounts[type]
    const shares = splitEvenly(pot, winners.length)
    bonuses.push({ type, entryIds: winners.map(w => w.id), each: shares[0], amounts: shares })
    if (type !== 'perfect_round') {
      row('purse', 'transfer', -flat, `${AWARD_LABEL[type]} funded from the payout pool`)
      row(type, 'transfer', flat, 'Funded from the payout pool')
    }
    winners.forEach((w, k) => row(type, 'bonus_payout', -shares[k], AWARD_LABEL[type], w.player_id))
    if (type === 'perfect_round') {
      const roll = Math.min(i.balances.backup + (contribution - toPot), s.perfectRoundCap)
      perfectRoundBalance = cents(roll)
      row('backup', 'rollover', -roll, 'Backup becomes the Perfect Round pot')
      row('perfect_round', 'rollover', roll, 'From backup pot')
    }
  }

  const payouts = distributePlaceChecks(ranked, i.payoutPlaces)
  const allocated = cents([...payouts.values()].reduce((sum, pay) => sum + (pay || 0), 0))
  const bonusOut = cents(ledger
    .filter(r => r.fund === 'purse' && r.kind === 'transfer')
    .reduce((sum, r) => sum - r.amount, 0))
  const pool = cents(entries.length * entryShare + (i.barMatch ?? 0) - bonusOut)
  const remainder = Math.max(0, Math.min(placeRemainder(pool), cents(pool - allocated)))
  const remainderSplit = perfectRoundRoom(perfectRoundBalance, s.perfectRoundCap, remainder)
  row('purse', 'transfer', -remainder, PLACE_REMAINDER_NOTE)
  row('perfect_round', 'transfer', remainderSplit.pot, PLACE_REMAINDER_NOTE)
  row('backup', 'overflow', remainderSplit.backup, PLACE_REMAINDER_BACKUP_NOTE)
  for (const r of ranked) {
    const pay = payouts.get(r.entry.id) ?? 0
    if (pay) row('purse', 'place_payout', -pay, placeNote(r.place), r.entry.player_id)
  }

  // High score record (shown as a hint — must BEAT it; first event only sets it)
  const scores = entries.map(e => totals(e).total).filter((t): t is number => t != null)
  const nightHigh = scores.length ? Math.max(...scores) : null
  const newRecord = nightHigh == null ? i.priorRecord : Math.max(nightHigh, i.priorRecord ?? -1)

  return {
    ranked,
    payouts,
    points: distribute(ranked, s.points),
    tagsOut: i.tagPlan === 'opening'
      ? initialTagAssignment(ranked, i.inTags ?? (() => true))
      : redistributeTags(ranked, i.inTags),
    bonuses,
    newRecord,
    potAfterEntries,
    placeRemainderToPot: remainderSplit.pot,
    placeRemainderToBackup: remainderSplit.backup,
    ledger,
  }
}
