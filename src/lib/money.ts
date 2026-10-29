import { cents, distribute, rankFinal, redistributeTags, totals, type Ranked } from './scoring'
import { AWARD_LABEL, AWARDS } from './types'
import type { Award, Division, Entry, Fund, LedgerKind, LedgerRow, PPEvent, Settings } from './types'

const NIGHT_BONUSES = ['perfect5', 'perfect4', 'high_score'] as const

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
  const men = players ? cents(barMatch * counts.M / players) : 0
  return { totalPot, barMatch, barSplit: { M: men, W: cents(barMatch - men) } }
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

/** What the awarded night bonuses cost the purse: the flat amount, once per award with any winner. */
export function nightBonusCost(entries: Entry[], s: Settings): number {
  const amounts: Record<(typeof NIGHT_BONUSES)[number], number> = {
    perfect5: s.bonus.perfect5,
    perfect4: s.bonus.perfect4,
    high_score: s.bonus.highScore,
  }
  let total = 0
  for (const type of NIGHT_BONUSES) {
    if (!entries.some(e => e.awards?.includes(type))) continue
    total += amounts[type]
  }
  return cents(total)
}

/**
 * Split a pool across `places` in a declining ratio (2 places → 2/3 + 1/3, and so on).
 * The first place absorbs rounding so the suggestions add up to the pool exactly.
 */
export function suggestedPayouts(pool: number, places: number): number[] {
  if (places <= 0 || pool <= 0) return []
  const weights = Array.from({ length: places }, (_, i) => places - i)
  const sumW = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map(w => cents((pool * w) / sumW))
  raw[0] = cents(raw[0] + (pool - raw.reduce((a, b) => a + b, 0)))
  return raw
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
  /** One share per winner, in entryIds order. Adds up to the whole pot. */
  amounts: number[]
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

  // Bonuses: awarded by hand (right-click). Perfect 5, Perfect 4 and Perfect Round are shared pots:
  // everyone who hits one splits the whole pot evenly. Perfect 5 / Perfect 4 pots are the
  // pot balance plus the flat night bonus, which is funded from the purse when someone wins.
  // High Score stays a flat bonus (split on ties).
  // Fund the pot first so the payout does not drive it negative.
  const bonuses: BonusWin[] = []
  const amounts: Record<Award, number> = {
    perfect_round: potAfterEntries,
    perfect5: s.bonus.perfect5,
    perfect4: s.bonus.perfect4,
    high_score: s.bonus.highScore,
  }
  for (const type of AWARDS) {
    const winners = entries.filter(e => e.awards?.includes(type))
    if (!winners.length) continue
    const flat = type === 'perfect_round' ? 0 : amounts[type]
    const pot = type === 'perfect5' || type === 'perfect4' ? cents(i.balances[type] + flat) : amounts[type]
    const shares = splitEvenly(pot, winners.length)
    bonuses.push({ type, entryIds: winners.map(w => w.id), each: shares[0], amounts: shares })
    if (type !== 'perfect_round') {
      row('purse', 'transfer', -flat, `${AWARD_LABEL[type]} funded from the payout pool`)
      row(type, 'transfer', flat, 'Funded from the payout pool')
    }
    winners.forEach((w, k) => row(type, 'bonus_payout', -shares[k], AWARD_LABEL[type], w.player_id))
    if (type === 'perfect_round') {
      const roll = Math.min(i.balances.backup + (contribution - toPot), s.perfectRoundCap)
      row('backup', 'rollover', -roll, 'Backup becomes the Perfect Round pot')
      row('perfect_round', 'rollover', roll, 'From backup pot')
    }
  }

  const payouts = distribute(ranked, i.payoutPlaces)
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
    tagsOut: redistributeTags(ranked),
    bonuses,
    newRecord,
    potAfterEntries,
    ledger,
  }
}
