import type { Award, Entry } from './types'

export type StationMake = 0 | 1 | 2 | null
export type PuttCardRound = '18' | 'final'
export type AutoStationAward = 'perfect5' | 'perfect4' | 'perfect_round'

export interface StationScores {
  front?: StationMake[]
  back?: StationMake[]
  final?: StationMake[]
  autoAwards?: AutoStationAward[]
}

export interface StationMeta {
  index: number
  stationInRound: number
  basket: 1 | 2
  stopInBasket: number
  pointsPerPutt: number
  maxPoints: number
  label: string
}

export interface StationRoundSummary {
  enteredCount: number
  isComplete: boolean
  basket1Entered: number
  basket2Entered: number
  basket1Points: number | null
  basket2Points: number | null
  totalPoints: number | null
  isPerfect5: boolean
  isPerfect4: boolean
  isPerfectRound: boolean
}

export const PUTT_STATIONS_9: readonly StationMeta[] = [
  { index: 0, stationInRound: 1, basket: 1, stopInBasket: 1, pointsPerPutt: 1, maxPoints: 2, label: 'Basket 1 · Stop 1' },
  { index: 1, stationInRound: 2, basket: 1, stopInBasket: 2, pointsPerPutt: 2, maxPoints: 4, label: 'Basket 1 · Stop 2' },
  { index: 2, stationInRound: 3, basket: 1, stopInBasket: 3, pointsPerPutt: 3, maxPoints: 6, label: 'Basket 1 · Stop 3' },
  { index: 3, stationInRound: 4, basket: 1, stopInBasket: 4, pointsPerPutt: 4, maxPoints: 8, label: 'Basket 1 · Stop 4' },
  { index: 4, stationInRound: 5, basket: 1, stopInBasket: 5, pointsPerPutt: 5, maxPoints: 10, label: 'Basket 1 · Stop 5' },
  { index: 5, stationInRound: 6, basket: 2, stopInBasket: 1, pointsPerPutt: 1, maxPoints: 2, label: 'Basket 2 · Stop 1' },
  { index: 6, stationInRound: 7, basket: 2, stopInBasket: 2, pointsPerPutt: 2, maxPoints: 4, label: 'Basket 2 · Stop 2' },
  { index: 7, stationInRound: 8, basket: 2, stopInBasket: 3, pointsPerPutt: 3, maxPoints: 6, label: 'Basket 2 · Stop 3' },
  { index: 8, stationInRound: 9, basket: 2, stopInBasket: 4, pointsPerPutt: 4, maxPoints: 8, label: 'Basket 2 · Stop 4' },
]

const AUTO_AWARD_SET = new Set<AutoStationAward>(['perfect5', 'perfect4', 'perfect_round'])

export function clampStationMake(raw: unknown): StationMake {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const t = Math.trunc(n)
  if (t === 0 || t === 1 || t === 2) return t
  return null
}

export function emptyNineStations(): StationMake[] {
  return Array.from({ length: 9 }, () => null)
}

export function normalizeStationArray(raw: unknown): StationMake[] {
  const arr = Array.isArray(raw) ? raw : []
  return Array.from({ length: 9 }, (_, i) => clampStationMake(arr[i]))
}

export function normalizeStationScores(raw: unknown): StationScores | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: StationScores = {}

  if (Array.isArray(r.front)) {
    const clean = normalizeStationArray(r.front)
    if (clean.some(v => v != null)) out.front = clean
  }
  if (Array.isArray(r.back)) {
    const clean = normalizeStationArray(r.back)
    if (clean.some(v => v != null)) out.back = clean
  }
  if (Array.isArray(r.final)) {
    const clean = normalizeStationArray(r.final)
    if (clean.some(v => v != null)) out.final = clean
  }
  if (Array.isArray(r.autoAwards)) {
    const cleanAwards = r.autoAwards.filter(
      (a): a is AutoStationAward => typeof a === 'string' && AUTO_AWARD_SET.has(a as AutoStationAward),
    )
    if (cleanAwards.length > 0) out.autoAwards = Array.from(new Set(cleanAwards))
  }

  if (!out.front && !out.back && !out.final && !out.autoAwards) return null
  return out
}

export function clearStationRound(
  current: StationScores | null | undefined,
  which: 'front' | 'back' | 'final',
): StationScores | null {
  if (!current) return null
  const next: StationScores = { ...current }
  delete next[which]
  if (!next.front && !next.back && !next.final) return null
  return next
}

export function summarizeStationRound(makes?: readonly StationMake[] | null): StationRoundSummary {
  if (!makes || makes.length === 0) {
    return {
      enteredCount: 0,
      isComplete: false,
      basket1Entered: 0,
      basket2Entered: 0,
      basket1Points: null,
      basket2Points: null,
      totalPoints: null,
      isPerfect5: false,
      isPerfect4: false,
      isPerfectRound: false,
    }
  }

  let basket1Entered = 0
  let basket2Entered = 0
  let basket1Sum = 0
  let basket2Sum = 0

  for (let i = 0; i < 9; i++) {
    const m = clampStationMake(makes[i])
    if (m == null) continue
    const pts = m * PUTT_STATIONS_9[i].pointsPerPutt
    if (i < 5) {
      basket1Entered += 1
      basket1Sum += pts
    } else {
      basket2Entered += 1
      basket2Sum += pts
    }
  }

  const enteredCount = basket1Entered + basket2Entered
  const basket1Points = basket1Entered > 0 ? basket1Sum : null
  const basket2Points = basket2Entered > 0 ? basket2Sum : null
  const totalPoints = enteredCount > 0 ? basket1Sum + basket2Sum : null
  const isPerfect5 = basket1Entered === 5 && basket1Sum === 30
  const isPerfect4 = basket2Entered === 4 && basket2Sum === 20
  const isPerfectRound = isPerfect5 && isPerfect4

  return {
    enteredCount,
    isComplete: enteredCount === 9,
    basket1Entered,
    basket2Entered,
    basket1Points,
    basket2Points,
    totalPoints,
    isPerfect5,
    isPerfect4,
    isPerfectRound,
  }
}

export function hasPartialStation18(stationScores?: StationScores | null): boolean {
  if (!stationScores) return false
  if (stationScores.front) {
    const fCount = summarizeStationRound(stationScores.front).enteredCount
    if (fCount > 0 && fCount < 9) return true
  }
  if (stationScores.back) {
    const bCount = summarizeStationRound(stationScores.back).enteredCount
    if (bCount > 0 && bCount < 9) return true
  }
  return false
}

export function stationProgressLabel(
  stationScores: StationScores | null | undefined,
  status: string,
  madeFinal: boolean,
): string | null {
  if (!stationScores) return null
  if (status === 'scoring') {
    const f = stationScores.front ? summarizeStationRound(stationScores.front).enteredCount : 0
    const b = stationScores.back ? summarizeStationRound(stationScores.back).enteredCount : 0
    const total = f + b
    if (total > 0 && total < 18) return `${total}/18`
    return null
  }
  if (status === 'final9' && madeFinal && stationScores.final) {
    const fin = summarizeStationRound(stationScores.final).enteredCount
    if (fin > 0 && fin < 9) return `${fin}/9`
  }
  return null
}

export function mergeStationAwards(
  currentAwards: readonly Award[] | null | undefined,
  prevAuto: readonly AutoStationAward[] | null | undefined,
  nextStationScores: StationScores,
): { awards: Award[]; autoAwards: AutoStationAward[] } {
  const summaries = [
    nextStationScores.front ? summarizeStationRound(nextStationScores.front) : null,
    nextStationScores.back ? summarizeStationRound(nextStationScores.back) : null,
    nextStationScores.final ? summarizeStationRound(nextStationScores.final) : null,
  ].filter((s): s is StationRoundSummary => s !== null)

  const nextAuto: AutoStationAward[] = []
  if (summaries.some(s => s.isPerfect5)) nextAuto.push('perfect5')
  if (summaries.some(s => s.isPerfect4)) nextAuto.push('perfect4')
  if (summaries.some(s => s.isPerfectRound)) nextAuto.push('perfect_round')

  const prevAutoSet = new Set<Award>(prevAuto ?? [])
  const nextAutoSet = new Set<Award>(nextAuto)
  const out: Award[] = []

  for (const a of currentAwards ?? []) {
    if (prevAutoSet.has(a) && !nextAutoSet.has(a)) continue
    if (!out.includes(a)) out.push(a)
  }
  for (const a of nextAuto) {
    if (!out.includes(a)) out.push(a)
  }

  return { awards: out, autoAwards: nextAuto }
}

export function applyStationScoresToEntry(
  entry: Entry,
  round: PuttCardRound,
  nextRoundStations: { front?: StationMake[]; back?: StationMake[]; final?: StationMake[] },
): Entry {
  const prev = normalizeStationScores(entry.station_scores)
  const prevAuto = prev?.autoAwards ?? []
  const draft: StationScores = {
    ...(prev ?? {}),
  }

  if (round === '18') {
    if (nextRoundStations.front !== undefined) {
      const clean = normalizeStationArray(nextRoundStations.front)
      if (clean.some(v => v != null)) draft.front = clean
      else delete draft.front
    }
    if (nextRoundStations.back !== undefined) {
      const clean = normalizeStationArray(nextRoundStations.back)
      if (clean.some(v => v != null)) draft.back = clean
      else delete draft.back
    }
  } else {
    if (nextRoundStations.final !== undefined) {
      const clean = normalizeStationArray(nextRoundStations.final)
      if (clean.some(v => v != null)) draft.final = clean
      else delete draft.final
    }
  }

  const { awards, autoAwards } = mergeStationAwards(entry.awards, prevAuto, draft)
  if (autoAwards.length > 0) draft.autoAwards = autoAwards
  else delete draft.autoAwards

  const finalStations =
    draft.front || draft.back || draft.final || draft.autoAwards ? draft : null

  if (round === '18') {
    const frontCleared = nextRoundStations.front !== undefined && !draft.front
    const backCleared = nextRoundStations.back !== undefined && !draft.back

    const fSum = draft.front ? summarizeStationRound(draft.front) : null
    const bSum = draft.back ? summarizeStationRound(draft.back) : null

    const score_front = fSum ? fSum.totalPoints : frontCleared ? null : entry.score_front
    const score_back = bSum ? bSum.totalPoints : backCleared ? null : entry.score_back
    const score_18 = score_front != null && score_back != null ? score_front + score_back : null

    return {
      ...entry,
      r1_b1: fSum ? fSum.basket1Points : frontCleared ? null : entry.r1_b1,
      r1_b2: fSum ? fSum.basket2Points : frontCleared ? null : entry.r1_b2,
      r2_b1: bSum ? bSum.basket1Points : backCleared ? null : entry.r2_b1,
      r2_b2: bSum ? bSum.basket2Points : backCleared ? null : entry.r2_b2,
      score_front,
      score_back,
      score_18,
      awards,
      station_scores: finalStations,
    }
  }

  const finalCleared = nextRoundStations.final !== undefined && !draft.final
  const finSum = draft.final ? summarizeStationRound(draft.final) : null
  const score_final = finSum ? finSum.totalPoints : finalCleared ? null : entry.score_final

  return {
    ...entry,
    f_b1: finSum ? finSum.basket1Points : finalCleared ? null : entry.f_b1,
    f_b2: finSum ? finSum.basket2Points : finalCleared ? null : entry.f_b2,
    score_final,
    awards,
    station_scores: finalStations,
  }
}

export function nextStationIndexForCard(
  round: PuttCardRound,
  entries: readonly Entry[],
): number {
  if (entries.length === 0) return 0
  if (round === 'final') {
    for (let idx = 0; idx < 9; idx++) {
      if (entries.some(e => clampStationMake(e.station_scores?.final?.[idx]) == null)) {
        return idx
      }
    }
    return 0
  }

  for (let idx = 0; idx < 18; idx++) {
    const arrKey = idx < 9 ? 'front' : 'back'
    const inner = idx < 9 ? idx : idx - 9
    if (entries.some(e => clampStationMake(e.station_scores?.[arrKey]?.[inner]) == null)) {
      return idx
    }
  }
  return 0
}
