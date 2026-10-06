import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  entryFee: 10,
  perfectRoundShare: 2,
  barMatchPct: 50,
  perfectRoundCap: 250,
  tagPrice: 20,
  bonus: { perfect5: 10, perfect4: 10, highScore: 10 },
  points: [10, 8, 6, 4, 2],
  cutRounding: 'down',
  paidEvery: 5,
  ties: {
    placement: 'split',
    cut: 'include',
    countback: ['final9', 'r2', 'r1', 'f_b1', 'r2_b1', 'r1_b1'],
  },
  potsVisibility: {
    perfect_round: true,
    backup: true,
    perfect5: true,
    perfect4: true,
    high_score: true,
    tag_fund: true,
  },
}

/** Merge stored (possibly partial / older) settings over the defaults. */
export function resolveSettings(stored?: Partial<Settings> | null): Settings {
  const s = stored ?? {}
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    bonus: { ...DEFAULT_SETTINGS.bonus, ...s.bonus },
    ties: { ...DEFAULT_SETTINGS.ties, ...s.ties },
    potsVisibility: { ...DEFAULT_SETTINGS.potsVisibility, ...s.potsVisibility },
    points: s.points?.length ? s.points : DEFAULT_SETTINGS.points,
  }
}
