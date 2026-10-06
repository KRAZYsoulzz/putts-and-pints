import type { CountbackKey, CutTieMode, Entry, Settings, TieMode } from './types'

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------
export const MAX_B1 = 30
export const MAX_B2 = 20

const nine = (b1: number | null, b2: number | null) => (b1 == null || b2 == null ? null : b1 + b2)

export interface Totals {
  r1: number | null
  r2: number | null
  f: number | null
  t18: number | null
  /** 18 + final 9 (if the player made the final) */
  total: number | null
}

export function totals(e: Entry): Totals {
  const r1 = nine(e.r1_b1, e.r1_b2)
  const r2 = nine(e.r2_b1, e.r2_b2)
  const f = e.made_final ? nine(e.f_b1, e.f_b2) : null
  const t18 = r1 != null && r2 != null ? r1 + r2 : null
  const total = t18 == null ? null : t18 + (f ?? 0)
  return { r1, r2, f, t18, total }
}

// ---------------------------------------------------------------------------
// Perfect hints — bonuses are awarded by hand; these just light up the grid
// ---------------------------------------------------------------------------
export function perfectHints(e: Entry): { p5: boolean; p4: boolean } {
  const b1s = [e.r1_b1, e.r2_b1, e.made_final ? e.f_b1 : null]
  const b2s = [e.r1_b2, e.r2_b2, e.made_final ? e.f_b2 : null]
  return { p5: b1s.includes(MAX_B1), p4: b2s.includes(MAX_B2) }
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

/** Standard competition ranking (1, 2, 2, 4) after applying the tie mode. */
function rank(entries: Entry[], o: RankOpts): Ranked[] {
  const group = o.group ?? (() => 0)
  const primary = (a: Entry, b: Entry) =>
    group(a) - group(b) || (o.score(b) ?? -1) - (o.score(a) ?? -1)

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

  const sorted = [...entries].sort((a, b) => primary(a, b) || breaker(a, b))
  const out: Ranked[] = []
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1]
    const tied = prev && primary(prev, e) === 0 && breaker(prev, e) === 0
    out.push({ entry: e, totals: totals(e), place: tied ? out[i - 1].place : i + 1 })
  })
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
  const half = fieldSize / 2
  return s.cutRounding === 'up' ? Math.ceil(half) : Math.floor(half)
}

/** Entry ids that make the final 9. Anyone tied at the line (unresolved) is included. */
export function qualifiers(entries: Entry[], cut: number, s: Settings): Set<string> {
  return new Set(
    rank18(entries.filter(e => totals(e).t18 != null), s)
      .filter(r => r.place <= cut)
      .map(r => r.entry.id),
  )
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
    const slice = values.slice(place - 1, place - 1 + group.length)
    const each = slice.reduce((a, b) => a + (b || 0), 0) / group.length
    group.forEach(r => out.set(r.entry.id, cents(each)))
  }
  return out
}

// ---------------------------------------------------------------------------
// Tags — highest finisher among tag holders gets the lowest tag
// ---------------------------------------------------------------------------
export function redistributeTags(ranked: Ranked[]): Map<string, number> {
  const holders = ranked.filter(r => r.entry.tag_in != null)
  const tags = holders.map(r => r.entry.tag_in as number).sort((a, b) => a - b)
  return new Map(holders.map((r, i) => [r.entry.id, tags[i]]))
}
