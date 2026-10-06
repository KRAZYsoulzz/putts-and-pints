export type Division = 'M' | 'W'
export const DIVISIONS: Division[] = ['M', 'W']
export const DIVISION_LABEL: Record<Division, string> = { M: "Men's", W: "Women's" }

export type EventStatus = 'checkin' | 'scoring' | 'final9' | 'results' | 'complete'

/** Bonuses Les awards by hand (right-click a player). */
export type Award = 'perfect_round' | 'perfect5' | 'perfect4' | 'high_score'
export const AWARDS: Award[] = ['perfect_round', 'perfect5', 'perfect4', 'high_score']
export const AWARD_LABEL: Record<Award, string> = {
  perfect_round: 'Perfect Round',
  perfect5: 'Perfect 5',
  perfect4: 'Perfect 4',
  high_score: 'High Score',
}
export const AWARD_SHORT: Record<Award, string> = { perfect_round: 'PR', perfect5: 'P5', perfect4: 'P4', high_score: 'HS' }

export type Fund = 'perfect_round' | 'backup' | 'perfect5' | 'perfect4' | 'high_score' | 'tag_fund'
export type LedgerKind =
  | 'carryover' | 'entry' | 'overflow' | 'bonus_payout' | 'transfer'
  | 'adjustment' | 'expense' | 'tag_sale' | 'rollover'

export const FUND_LABEL: Record<Fund, string> = {
  perfect_round: 'Perfect Round',
  backup: 'Backup Pot',
  perfect5: 'Perfect 5',
  perfect4: 'Perfect 4',
  high_score: 'High Score',
  tag_fund: 'Tag Fund',
}

/** Ordered criteria used to break ties by countback. */
export type CountbackKey = 'final9' | 'r2' | 'r1' | 'f_b1' | 'r2_b1' | 'r1_b1'
export const COUNTBACK_LABEL: Record<CountbackKey, string> = {
  final9: 'Final 9 total',
  r2: 'Second 9 total',
  r1: 'First 9 total',
  f_b1: 'Final 9 · Basket 1',
  r2_b1: 'Second 9 · Basket 1',
  r1_b1: 'First 9 · Basket 1',
}

/** split = share place & average money/points; playoff = manual order; countback = criteria list */
export type TieMode = 'split' | 'playoff' | 'countback'
export type CutTieMode = 'include' | 'playoff' | 'countback'

export interface Settings {
  entryFee: number
  perfectRoundShare: number
  barMatchPct: number
  perfectRoundCap: number
  tagPrice: number
  bonus: { perfect5: number; perfect4: number; highScore: number }
  points: number[]
  cutRounding: 'down' | 'up'
  paidEvery: number
  ties: { placement: TieMode; cut: CutTieMode; countback: CountbackKey[] }
  potsVisibility: Record<Fund, boolean>
}

export interface Season {
  id: string
  name: string
  active: boolean
  settings: Partial<Settings>
  created_at: string
}

export interface Player {
  id: string
  name: string
  division: Division
  active: boolean
}

export interface Tag {
  id: string
  season_id: string
  player_id: string
  tag_number: number
}

export interface PPEvent {
  id: string
  season_id: string
  event_date: string
  status: EventStatus
  bar_match_men: number
  bar_match_women: number
  final_cut_men: number | null
  final_cut_women: number | null
  payouts_men: number[]
  payouts_women: number[]
  settings_snapshot: Settings | null
  notes: string | null
}

export interface Entry {
  id: string
  event_id: string
  player_id: string
  division: Division
  paid: boolean
  tag_in: number | null
  tag_out: number | null
  r1_b1: number | null
  r1_b2: number | null
  r2_b1: number | null
  r2_b2: number | null
  f_b1: number | null
  f_b2: number | null
  awards: Award[]
  made_final: boolean
  tiebreak: number | null
  place: number | null
  payout: number
  points: number
  created_at?: string
}

export interface LedgerRow {
  id: string
  season_id: string
  event_id: string | null
  player_id: string | null
  division: Division | null
  fund: Fund
  kind: LedgerKind
  amount: number
  note: string | null
  created_at: string
}
