import { cents, distribute, rankFinal, redistributeTags, totals, type Ranked } from './scoring'
import { AWARD_LABEL, AWARDS } from './types'
import type { Award, Division, Entry, Fund, LedgerKind, LedgerRow, Settings } from './types'

// ---------------------------------------------------------------------------
// Pot balances
// ---------------------------------------------------------------------------
export type Balances = Record<Fund, number>
const EMPTY: Balances = { perfect_round: 0, backup: 0, perfect5: 0, perfect4: 0, high_score: 0, tag_fund: 0 }

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

/** Bar matches a % of the whole night's entry money; split suggested by division size. */
export function eventMoney(counts: Record<Division, number>, s: Settings): EventMoney {
  const players = counts.M + counts.W
  const totalPot = players * s.entryFee
  const barMatch = cents(totalPot * s.barMatchPct / 100)
  const men = players ? cents(barMatch * counts.M / players) : 0
  return { totalPot, barMatch, barSplit: { M: men, W: cents(barMatch - men) } }
}

export function payoutPool(count: number, barMatch: number, s: Settings): number {
  return cents(count * (s.entryFee - s.perfectRoundShare) + barMatch)
}

export const suggestedPaidPlaces = (count: number, s: Settings) =>
  count ? Math.max(1, Math.round(count / s.paidEvery)) : 0

// ---------------------------------------------------------------------------
// Results for one division
// ---------------------------------------------------------------------------
export interface BonusWin {
  type: Award
  entryIds: string[]
  each: number
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

  // Perfect Round pot: $X per entry, capped, overflow to backup
  const contribution = entries.length * s.perfectRoundShare
  const room = Math.max(0, s.perfectRoundCap - i.balances.perfect_round)
  const toPot = Math.min(room, contribution)
  row('perfect_round', 'entry', toPot, `${entries.length} entries × $${s.perfectRoundShare}`)
  row('backup', 'overflow', contribution - toPot, 'Over the cap')
  const potAfterEntries = cents(i.balances.perfect_round + toPot)

  // Bonuses: awarded by hand (right-click). Multiple winners of the same award split it.
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
    const each = cents(amounts[type] / winners.length)
    bonuses.push({ type, entryIds: winners.map(w => w.id), each })
    winners.forEach(w => row(type, 'bonus_payout', -each, AWARD_LABEL[type], w.player_id))
    if (type === 'perfect_round') {
      const roll = Math.min(i.balances.backup + (contribution - toPot), s.perfectRoundCap)
      row('backup', 'rollover', -roll, 'Backup becomes the Perfect Round pot')
      row('perfect_round', 'rollover', roll, 'From backup pot')
    }
  }

  // High score record (shown as a hint — must BEAT it; first event only sets it)
  const scores = entries.map(e => totals(e).total).filter((t): t is number => t != null)
  const nightHigh = scores.length ? Math.max(...scores) : null
  const newRecord = nightHigh == null ? i.priorRecord : Math.max(nightHigh, i.priorRecord ?? -1)

  return {
    ranked,
    payouts: distribute(ranked, i.payoutPlaces),
    points: distribute(ranked, s.points),
    tagsOut: redistributeTags(ranked),
    bonuses,
    newRecord,
    potAfterEntries,
    ledger,
  }
}
