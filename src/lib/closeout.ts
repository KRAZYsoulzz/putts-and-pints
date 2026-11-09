import { createHash } from 'node:crypto'

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
    const slice = payouts.slice(startIdx, startIdx + sorted.length)
    const totalCents = slice.reduce((sum, p) => sum + Math.round(p * 100), 0)
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
