import type { CountbackKey, CutTieMode, Entry, EventStatus, Settings, TieMode } from './types'

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------
export const MAX_18 = 100
export const MAX_FINAL = 50
export const MAX_NINE = 50

const nine = (b1: number | null, b2: number | null) => (b1 == null || b2 == null ? null : b1 + b2)

/** Blank stays blank. Anything else is clamped into 0..max so a negative never reaches Postgres. */
export function clampScore(raw: string, max: number): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(0, Math.trunc(n)))
}

/** Check-in order. Scoring grids stay in this order so a keystroke cannot jump rows. */
export function byEntryOrder(a: Entry, b: Entry): number {
  return (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id)
}

/** Best completed total. Zero is a real score; null means nobody has a finished round. */
export function bestTotal(entries: Entry[], which: 't18' | 'total'): number | null {
  let best: number | null = null
  for (const e of entries) {
    const t = totals(e)[which]
    if (t != null && (best == null || t > best)) best = t
  }
  return best
}

export interface Totals {
  r1: number | null
  r2: number | null
  f: number | null
  t18: number | null
  /** 18 + final 9 (if the player made the final) */
  total: number | null
}

/**
 * New nights store two totals (score_18, score_final) or Front/Back 9 totals.
 * Nights scored before that only have the per-basket columns, so fall back to summing those.
 */
export function totals(e: Entry): Totals {
  const r1 = nine(e.r1_b1, e.r1_b2)
  const r2 = nine(e.r2_b1, e.r2_b2)
  const f = e.made_final ? (e.score_final ?? nine(e.f_b1, e.f_b2)) : null
  let t18: number | null
  if (e.score_front != null || e.score_back != null) {
    t18 = e.score_front != null && e.score_back != null ? e.score_front + e.score_back : null
  } else if (e.score_18 != null) {
    t18 = e.score_18
  } else {
    t18 = r1 != null && r2 != null ? r1 + r2 : null
  }
  const total = t18 == null ? null : t18 + (f ?? 0)
  return { r1, r2, f, t18, total }
}

export function displayedFront(e: Entry): number | null {
  if (e.score_front != null || e.score_back != null) {
    return e.score_front
  }
  if (e.score_18 != null) {
    return null
  }
  return nine(e.r1_b1, e.r1_b2)
}

export function displayedBack(e: Entry): number | null {
  if (e.score_front != null || e.score_back != null) {
    return e.score_back
  }
  if (e.score_18 != null) {
    return null
  }
  return nine(e.r2_b1, e.r2_b2)
}

export function computeNineCommit(current: Entry, which: 'front' | 'back', nextVal: number | null): Partial<Entry> {
  const patch: Partial<Entry> = {
    [which === 'front' ? 'score_front' : 'score_back']: nextVal,
  }
  const nextFront = which === 'front' ? nextVal : current.score_front
  const nextBack = which === 'back' ? nextVal : current.score_back

  if (nextFront != null && nextBack != null) {
    patch.score_18 = nextFront + nextBack
  } else if (
    current.score_front != null &&
    current.score_back != null &&
    current.score_18 === current.score_front + current.score_back
  ) {
    patch.score_18 = null
  }

  return patch
}

export function canConfirmCut(entries: Entry[]): boolean {
  return entries.every(e => totals(e).t18 != null)
}

export function liveNightTotal(e: Entry): number | null {
  const t = totals(e)
  if (t.t18 == null) return null
  if (e.made_final && e.score_final == null) return null
  return t.total
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------
function countbackValue(e: Entry, key: CountbackKey): number {
  const t = totals(e)
  const map: Record<CountbackKey, number | null> = {
    final9: t.f, r2: t.r2, r1: t.r1,
    f_b1: e.made_final ? e.f_b1 : null, r2_b1: e.r2_b1, r1_b1: e.r1_b1,
  }
  return map[key] ?? -1
}

export interface Ranked {
  entry: Entry
  totals: Totals
  place: number
}

interface RankOpts {
  score: (e: Entry) => number | null
  /** Optional higher-priority group (lower = ranked first), e.g. finalists before the rest */
  group?: (e: Entry) => number
  mode: TieMode
  countback: CountbackKey[]
}

/**
 * Competition ranking (1, 2, 2, 4).
 * A blank score is unplaced (place 0) — it must not share a number with other unfinished rows.
 * A finished 0 is a real score and gets a place.
 */
function rank(entries: Entry[], o: RankOpts): Ranked[] {
  const group = o.group ?? (() => 0)
  const scored: Entry[] = []
  const unscored: Entry[] = []
  for (const e of entries) (o.score(e) == null ? unscored : scored).push(e)

  const primary = (a: Entry, b: Entry) =>
    group(a) - group(b) || (o.score(b) as number) - (o.score(a) as number)

  const breaker = (a: Entry, b: Entry) => {
    if (o.mode === 'playoff') return (a.tiebreak ?? Infinity) - (b.tiebreak ?? Infinity) || 0
    if (o.mode === 'countback') {
      for (const k of o.countback) {
        const d = countbackValue(b, k) - countbackValue(a, k)
        if (d) return d
      }
    }
    return 0
  }

  const sorted = [...scored].sort((a, b) => primary(a, b) || breaker(a, b) || byEntryOrder(a, b))
  const out: Ranked[] = []
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1]
    const tied = prev && primary(prev, e) === 0 && breaker(prev, e) === 0
    out.push({ entry: e, totals: totals(e), place: tied ? out[i - 1].place : i + 1 })
  })
  for (const e of unscored) out.push({ entry: e, totals: totals(e), place: 0 })
  return out
}

/** Final night order: finalists by 27-hole total, then everyone else by their 18. */
export function rankFinal(entries: Entry[], s: Settings): Ranked[] {
  const anyFinal = entries.some(e => e.made_final)
  return rank(entries, {
    score: e => totals(e).total,
    group: e => (anyFinal && !e.made_final ? 1 : 0),
    mode: s.ties.placement,
    countback: s.ties.countback,
  })
}

/**
 * Places on the initial 18 score-entry grid, in check-in order.
 * Uses the completed 18 only, including after the cut. Final 9 does not move these places.
 */
export function eighteenGridRows(entries: Entry[], s: Settings): { id: string; place: number }[] {
  const places = new Map(rank18(entries, s).map(row => [row.entry.id, row.place]))
  return [...entries].sort(byEntryOrder).map(ent => ({ id: ent.id, place: places.get(ent.id) ?? 0 }))
}

export function final9EntryOrder(entries: Entry[], settings: Settings): Entry[] {
  const places = new Map(rank18(entries, settings).map(r => [r.entry.id, r.place]))
  return [...entries].sort((a, b) => {
    if (a.made_final !== b.made_final) return a.made_final ? -1 : 1
    if (a.made_final) {
      const pa = places.get(a.id) ?? 0
      const pb = places.get(b.id) ?? 0
      if (pa !== pb) {
        if (pa === 0) return 1
        if (pb === 0) return -1
        return pa - pb
      }
    }
    return byEntryOrder(a, b)
  })
}

/** Ranking after the 18 (used for the cut). */
export function rank18(entries: Entry[], s: Settings): Ranked[] {
  const cutMode: Record<CutTieMode, TieMode> = { include: 'split', playoff: 'playoff', countback: 'countback' }
  return rank(entries, {
    score: e => totals(e).t18,
    mode: cutMode[s.ties.cut],
    countback: s.ties.countback.filter(k => k !== 'final9' && k !== 'f_b1'),
  })
}

export function suggestedCut(fieldSize: number, s: Settings): number {
  if (fieldSize <= 0) return 0
  const half = fieldSize / 2
  const rounded = s.cutRounding === 'up' ? Math.ceil(half) : Math.floor(half)
  // A stored 0 used to cut a two-player division out entirely. One player still plays the final.
  return Math.max(1, Math.min(fieldSize, rounded))
}

/** A missing or 0 cut is unset. Use the half-field default once anyone is checked in. */
export function effectiveCut(stored: number | null | undefined, fieldSize: number, s: Settings): number {
  if (fieldSize <= 0) return 0
  if (stored == null || stored < 1) return suggestedCut(fieldSize, s)
  return Math.min(stored, fieldSize)
}

/** Entry ids that make the final 9. Anyone tied at the line (unresolved) is included. */
export function qualifiers(entries: Entry[], cut: number, s: Settings): Set<string> {
  return new Set(
    rank18(entries.filter(e => totals(e).t18 != null), s)
      .filter(r => r.place <= cut)
      .map(r => r.entry.id),
  )
}

export interface TonightBoardRow {
  id: string
  place: number | null
  front: number | null
  back: number | null
  t18: number | null
  finalNine: number | null
  night: number | null
}

export interface TonightBoard {
  completed: TonightBoardRow[]
  partial: TonightBoardRow[]
  unscored: TonightBoardRow[]
  provisional: boolean
  cutAfterId: string | null
}

export function tonightBoard(
  entries: Entry[],
  settings: Settings,
  status: 'scheduled' | 'checkin' | 'scoring' | 'final9' | 'results' | 'complete' | EventStatus,
  storedCut?: number | null,
): TonightBoard {
  const provisional = status === 'scheduled' || status === 'checkin' || status === 'scoring'

  const r18 = rank18(entries, settings)
  const completed: TonightBoardRow[] = r18
    .filter(r => r.totals.t18 != null)
    .map(r => ({
      id: r.entry.id,
      place: r.place,
      front: displayedFront(r.entry),
      back: displayedBack(r.entry),
      t18: r.totals.t18,
      finalNine: r.entry.made_final && typeof r.entry.score_final === 'number' ? r.entry.score_final : null,
      night: liveNightTotal(r.entry),
    }))

  const partialEntries: Entry[] = []
  const unscoredEntries: Entry[] = []

  for (const e of entries) {
    if (totals(e).t18 != null) continue
    if (e.score_front != null || e.score_back != null) {
      partialEntries.push(e)
    } else {
      unscoredEntries.push(e)
    }
  }

  partialEntries.sort(byEntryOrder)
  unscoredEntries.sort(byEntryOrder)

  const toRow = (e: Entry): TonightBoardRow => ({
    id: e.id,
    place: null,
    front: displayedFront(e),
    back: displayedBack(e),
    t18: null,
    finalNine: e.made_final && typeof e.score_final === 'number' ? e.score_final : null,
    night: liveNightTotal(e),
  })

  const partial = partialEntries.map(toRow)
  const unscored = unscoredEntries.map(toRow)

  let cutAfterId: string | null = null
  if (provisional) {
    const qualIds = qualifiers(entries, effectiveCut(storedCut ?? null, entries.length, settings), settings)
    for (let i = completed.length - 1; i >= 0; i--) {
      if (qualIds.has(completed[i].id)) {
        cutAfterId = completed[i].id
        break
      }
    }
  } else {
    const entryMap = new Map(entries.map(e => [e.id, e]))
    for (let i = completed.length - 1; i >= 0; i--) {
      const e = entryMap.get(completed[i].id)
      if (e?.made_final) {
        cutAfterId = completed[i].id
        break
      }
    }
  }

  return { completed, partial, unscored, provisional, cutAfterId }
}

// ---------------------------------------------------------------------------
// Distribute place-based values (payouts, points) — tied places share evenly
// ---------------------------------------------------------------------------
export const cents = (n: number) => Math.round(n * 100) / 100

export function distribute(ranked: Ranked[], values: number[]): Map<string, number> {
  const out = new Map<string, number>()
  const byPlace = new Map<number, Ranked[]>()
  ranked.forEach(r => byPlace.set(r.place, [...(byPlace.get(r.place) ?? []), r]))
  for (const [place, group] of byPlace) {
    if (place < 1) continue
    const slice = values.slice(place - 1, place - 1 + group.length)
    const each = slice.reduce((a, b) => a + (b || 0), 0) / group.length
    group.forEach(r => out.set(r.entry.id, cents(each)))
  }
  return out
}

// ---------------------------------------------------------------------------
// Tags — highest finisher among tag holders gets the lowest tag.
// Only players who bought in (inTags) are in the pool. Omit inTags to keep
// every carried number, which is how nights worked before the opt-in.
// ---------------------------------------------------------------------------
export function redistributeTags(ranked: Ranked[], inTags?: (playerId: string) => boolean): Map<string, number> {
  const opted = inTags ?? (() => true)
  const holders = ranked.filter(r => r.entry.tag_in != null && opted(r.entry.player_id))
  const tags = holders.map(r => r.entry.tag_in as number).sort((a, b) => a - b)
  return new Map(holders.map((r, i) => [r.entry.id, tags[i]]))
}

/**
 * First event of a season: opted-in players who played get tag 1, 2, 3…
 * in the same order rankFinal already produced (score, then the tiebreak,
 * then check-in order). Unfinished rows sit at the end and take the last numbers.
 */
export function initialTagAssignment(ranked: Ranked[], inTags: (playerId: string) => boolean): Map<string, number> {
  const buyers = ranked.filter(r => inTags(r.entry.player_id))
  return new Map(buyers.map((r, i) => [r.entry.id, i + 1]))
}

/** The earliest event in the season is the one that deals tags. */
export function isOpeningTagNight(
  events: { id: string; event_date: string; created_at?: string | null }[],
  eventId: string,
): boolean {
  if (events.length === 0) return false
  const first = [...events].sort((a, b) =>
    a.event_date.localeCompare(b.event_date)
    || (a.created_at ?? '').localeCompare(b.created_at ?? '')
    || a.id.localeCompare(b.id),
  )[0]
  return first.id === eventId
}

export function isSeason9Week1(
  event: { season_id?: string | null; event_date?: string | null; name?: string | null } | null | undefined,
): boolean {
  if (!event) return false
  return (
    event.season_id === '81298495-f87c-4d7c-a344-89b97e587d9b' &&
    event.event_date === '2026-11-05' &&
    event.name === 'Week 1'
  )
}

export function week1AllowsScorePatch(
  event: { season_id?: string | null; event_date?: string | null; name?: string | null } | null | undefined,
  patch: Partial<Entry>,
): boolean {
  if (!isSeason9Week1(event)) return true
  const scoreKeys: (keyof Entry)[] = [
    'score_front',
    'score_back',
    'score_18',
    'score_final',
    'made_final',
  ]
  return !scoreKeys.some(k => Object.prototype.hasOwnProperty.call(patch, k))
}

export function historicalEighteenWrite(
  entry: Entry,
  next: number | null,
): { omit: true } | { omit: false; score_18: number | null } {
  if (entry.score_front != null || entry.score_back != null) {
    return { omit: true }
  }
  return { omit: false, score_18: next }
}

