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

function utf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function sha256Hex(message: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const bytes = utf8Bytes(message)
  const bitLen = bytes.length * 8
  const padLen = ((bytes.length + 9 + 63) & ~63)
  const buf = new Uint8Array(padLen)
  buf.set(bytes)
  buf[bytes.length] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false)
  view.setUint32(padLen - 4, bitLen >>> 0, false)

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

  for (let i = 0; i < padLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('')
}

function md5Hex(message: string): string {
  const bytes = utf8Bytes(message)
  const bitLen = bytes.length * 8
  const padLen = ((bytes.length + 9 + 63) & ~63)
  const buf = new Uint8Array(padLen)
  buf.set(bytes)
  buf[bytes.length] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(padLen - 8, bitLen >>> 0, true)
  view.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000), true)

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  for (let i = 0; i < padLen; i += 64) {
    let A = a0, B = b0, C = c0, D = d0
    for (let j = 0; j < 64; j++) {
      let F = 0, g = 0
      if (j < 16) { F = (B & C) | (~B & D); g = j }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16 }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * j) % 16 }
      const m = view.getUint32(i + g * 4, true)
      const sum = (A + F + K[j] + m) >>> 0
      const rot = ((sum << S[j]) | (sum >>> (32 - S[j]))) >>> 0
      A = D; D = C; C = B; B = (B + rot) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true); outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true); outView.setUint32(12, d0, true)
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const WEEK1_EVENT_ID = 'e1ff57b8-9569-485d-aaa2-d538470bf9f4'
const WEEK1_SEASON_ID = '81298495-f87c-4d7c-a344-89b97e587d9b'
const WEEK1_DATE = '2026-11-05'
const WEEK1_NAME = 'Week 1'

export function closeoutPayloadHash(payload: unknown): string {
  return sha256Hex(JSON.stringify(payload))
}

export function closeoutRequestUuid(seed: string): string {
  const hex = sha256Hex(seed)
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variantNibble}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

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

export function isWeek1Event(event: {
  id?: string | null
  season_id?: string | null
  date?: string | null
  event_date?: string | null
  name?: string | null
} | null | undefined): boolean {
  if (!event) return false
  if (event.id === WEEK1_EVENT_ID) return true
  const eventDate = event.date ?? event.event_date ?? ''
  const eventName = event.name == null || event.name.trim() === '' ? WEEK1_NAME : event.name.trim()
  return (
    event.season_id === WEEK1_SEASON_ID &&
    eventDate === WEEK1_DATE &&
    eventName === WEEK1_NAME
  )
}

export function refuseWeek1Finance(input: {
  event: { id?: string | null; season_id: string; date?: string; event_date?: string; name?: string | null }
  action: string
}): { ok: true } | { ok: false; reason: 'week1_frozen' } {
  if (isWeek1Event(input.event)) {
    return { ok: false, reason: 'week1_frozen' }
  }
  return { ok: true }
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
  return sha256Hex(JSON.stringify({ count: rows.length, rows: normalized }))
}

export function seasonFinanceAdvisoryKey(id: string): bigint {
  const hex = md5Hex(`season_finance:${id}`).slice(0, 16)
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
      if (a.id !== b.id) {
        return a.id < b.id ? -1 : 1
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
  event?: { season_id: string; date?: string; event_date?: string; name?: string | null }
  firstDivision?: 'M' | 'W'
}):
  | {
      ok: false
      reason: 'funding_needed' | 'negative_shared_carry' | 'week1_frozen' | 'insolvent'
      deficit?: number
      insolvent?: { division: string; fund: string }[]
      legs: []
    }
  | {
      ok: true
      gross: { M: number; W: number }
      heldReserve: { M: { perfect4: number; perfect5: number }; W: { perfect4: number; perfect5: number } }
      placePool: { M: number; W: number }
      released: { M: number; W: number }
      firstLegs: Leg[]
      secondLegs: Leg[]
    } {
  if (input.event) {
    const refusal = refuseWeek1Finance({ event: input.event, action: 'close' })
    if (!refusal.ok) {
      return { ok: false, reason: 'week1_frozen', legs: [] }
    }
  }

  const first: 'M' | 'W' = input.firstDivision ?? 'M'
  const second: 'M' | 'W' = first === 'M' ? 'W' : 'M'

  const menEntries = input.entries.filter((e) => e.division === 'M')
  const womenEntries = input.entries.filter((e) => e.division === 'W')
  const entriesByDiv = { M: menEntries, W: womenEntries }

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

  const purseCharges = {
    M: { perfect4: purseChargeM_P4, perfect5: purseChargeM_P5 },
    W: { perfect4: purseChargeW_P4, perfect5: purseChargeW_P5 },
  }

  const firstReserve = {
    perfect4: entriesByDiv[first].some((e) => e.awards.includes('perfect4')) ? flatP4 : 0,
    perfect5: entriesByDiv[first].some((e) => e.awards.includes('perfect5')) ? flatP5 : 0,
  }

  const heldReserve = {
    M: first === 'M' ? firstReserve : { perfect4: 0, perfect5: 0 },
    W: first === 'W' ? firstReserve : { perfect4: 0, perfect5: 0 },
  }

  const totalPurseChargeSecond = cents(purseCharges[second].perfect4 + purseCharges[second].perfect5)
  const placePoolFirst = cents(gross[first] - H[first] - heldReserve[first].perfect4 - heldReserve[first].perfect5)
  const placePoolSecond = cents(gross[second] - H[second] - totalPurseChargeSecond)

  const placePool = {
    M: first === 'M' ? placePoolFirst : placePoolSecond,
    W: first === 'W' ? placePoolFirst : placePoolSecond,
  }

  if (placePool[first] < 0) {
    return { ok: false, reason: 'funding_needed', deficit: cents(-placePool[first]), legs: [] }
  }
  if (placePool[second] < 0) {
    return { ok: false, reason: 'funding_needed', deficit: cents(-placePool[second]), legs: [] }
  }

  if (p4Winners.length > 0 && cents(input.balances.M.perfect4 + input.balances.W.perfect4) < 0) {
    return { ok: false, reason: 'negative_shared_carry', legs: [] }
  }
  if (p5Winners.length > 0 && cents(input.balances.M.perfect5 + input.balances.W.perfect5) < 0) {
    return { ok: false, reason: 'negative_shared_carry', legs: [] }
  }

  const unusedFirst_P4 = Math.max(0, cents(heldReserve[first].perfect4 - purseCharges[first].perfect4))
  const unusedFirst_P5 = Math.max(0, cents(heldReserve[first].perfect5 - purseCharges[first].perfect5))

  const released = {
    M: first === 'M' ? cents(unusedFirst_P4 + unusedFirst_P5) : 0,
    W: first === 'W' ? cents(unusedFirst_P4 + unusedFirst_P5) : 0,
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

  function buildDivisionOwnLegs(div: 'M' | 'W', target: Leg[]): number {
    const divEntries = entriesByDiv[div]
    addLeg(
      target,
      div,
      'purse',
      'entry',
      divEntries.length * entryPurse,
      `${divEntries.length} entries × $${entryPurse} to the payout pool`,
    )
    addLeg(target, div, 'purse', 'bar_match', input.bar[div], 'Bar match')

    const prContribution = cents(divEntries.length * input.settings.perfectRoundShare)
    const prFit = Math.min(Math.max(0, cents(prCap - input.balances[div].perfect_round)), prContribution)
    const prOverflow = cents(prContribution - prFit)
    addLeg(
      target,
      div,
      'perfect_round',
      'entry',
      prFit,
      `${divEntries.length} entries × $${input.settings.perfectRoundShare}`,
    )
    addLeg(target, div, 'backup', 'overflow', prOverflow, 'Over the cap')
    const potAfter = cents(input.balances[div].perfect_round + prFit)
    let laterPR = potAfter

    const prWinners = divEntries
      .filter((e) => e.awards.includes('perfect_round'))
      .slice()
      .sort(byCheckIn)
    if (prWinners.length > 0) {
      const prShares = splitEvenly(potAfter, prWinners.length)
      for (let i = 0; i < prWinners.length; i++) {
        addLeg(target, div, 'perfect_round', 'bonus_payout', -prShares[i], 'Perfect Round', prWinners[i].player_id)
      }
      const roll = Math.min(cents(input.balances[div].backup + prOverflow), prCap)
      if (roll !== 0) {
        addLeg(target, div, 'backup', 'rollover', -roll, 'Backup becomes the Perfect Round pot')
        addLeg(target, div, 'perfect_round', 'rollover', roll, 'From backup pot')
      }
      laterPR = cents(roll)
    }

    if (H[div] !== 0) {
      addLeg(target, div, 'purse', 'transfer', -H[div], 'Funded from the payout pool')
      addLeg(target, div, 'high_score', 'transfer', H[div], 'Funded from the payout pool')
      const hsWinners = divEntries
        .filter((e) => e.awards.includes('high_score'))
        .slice()
        .sort(byCheckIn)
      const hsShares = splitEvenly(H[div], hsWinners.length)
      for (let i = 0; i < hsWinners.length; i++) {
        addLeg(target, div, 'high_score', 'bonus_payout', -hsShares[i], 'High Score', hsWinners[i].player_id)
      }
    }

    const checks =
      input.payouts?.[div] !== undefined
        ? input.payouts[div]!
        : suggestedPayouts(placePool[div], paidPlaceCount(divEntries.length, 0, input.settings))
    const payoutMap = distributeTiedChecks(checks, divEntries)
    const sortedEntries = [...divEntries].sort((a, b) => a.place - b.place || byCheckIn(a, b))
    for (const entry of sortedEntries) {
      const pay = payoutMap.get(entry.id) ?? 0
      if (pay > 0) {
        addLeg(target, div, 'purse', 'place_payout', -pay, placeNote(entry.place), entry.player_id)
      }
    }

    const allocated = cents(Array.from(payoutMap.values()).reduce((sum, v) => sum + (v > 0 ? v : 0), 0))
    const r = Math.max(0, Math.min(cents(placePool[div] - placeBudget(placePool[div])), cents(placePool[div] - allocated)))
    if (r !== 0) {
      addLeg(target, div, 'purse', 'transfer', -r, PLACE_REMAINDER_NOTE)
      const room = perfectRoundRoom(laterPR, prCap, r)
      if (room.pot !== 0) {
        addLeg(target, div, 'perfect_round', 'transfer', room.pot, PLACE_REMAINDER_NOTE)
        laterPR = cents(laterPR + room.pot)
      }
      if (room.backup !== 0) {
        addLeg(target, div, 'backup', 'overflow', room.backup, PLACE_REMAINDER_BACKUP_NOTE)
      }
    }

    return laterPR
  }

  let laterPRFirst = buildDivisionOwnLegs(first, firstLegs)
  buildDivisionOwnLegs(second, secondLegs)

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

  // --- Reserve release for first division on secondLegs ---
  const unusedList = [
    { pot: 'perfect4' as const, unused: unusedFirst_P4 },
    { pot: 'perfect5' as const, unused: unusedFirst_P5 },
  ]

  for (const item of unusedList) {
    if (item.unused !== 0) {
      addLeg(secondLegs, first, 'purse', 'transfer', -item.unused, 'Unused reserve to the Perfect Round pot')
      const room = perfectRoundRoom(laterPRFirst, prCap, item.unused)
      if (room.pot !== 0) {
        addLeg(secondLegs, first, 'perfect_round', 'transfer', room.pot, 'Unused reserve to the Perfect Round pot')
        laterPRFirst = cents(laterPRFirst + room.pot)
      }
      if (room.backup !== 0) {
        addLeg(secondLegs, first, 'backup', 'overflow', room.backup, 'Unused reserve over the Perfect Round cap')
      }
    }
  }

  const insolventFirst = debitSolvency(input.balances, firstLegs)
  const insolventAll = debitSolvency(input.balances, [...firstLegs, ...secondLegs])
  if (insolventFirst.length > 0 || insolventAll.length > 0) {
    return {
      ok: false,
      reason: 'insolvent',
      insolvent: insolventFirst.length > 0 ? insolventFirst : insolventAll,
      legs: [],
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

export interface DivisionCloseState {
  closed: { M: boolean; W: boolean }
  firstDivision: 'M' | 'W' | null
  sharedPosted: boolean
  heldReserve: { M: { perfect4: number; perfect5: number }; W: { perfect4: number; perfect5: number } }
  released: { M: number; W: number }
  paidPlaces: { M: Record<string, number>; W: Record<string, number> }
  frozenChecks: { M?: readonly number[]; W?: readonly number[] }
  requests: Record<string, { completed: boolean; hash: string; response: unknown }>
}

export function createEmptyDivisionCloseState(): DivisionCloseState {
  return {
    closed: { M: false, W: false },
    firstDivision: null,
    sharedPosted: false,
    heldReserve: { M: { perfect4: 0, perfect5: 0 }, W: { perfect4: 0, perfect5: 0 } },
    released: { M: 0, W: 0 },
    paidPlaces: { M: {}, W: {} },
    frozenChecks: {},
    requests: {},
  }
}

export function closeDivisionStep(input: {
  state?: DivisionCloseState
  event: { season_id: string; date?: string; event_date?: string; name?: string | null }
  division: 'M' | 'W'
  requestId: string
  payloadHash: string
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
  legacyPending?: boolean
  laterPosted?: boolean
}):
  | {
      ok: false
      reason: 'legacy_pending' | 'week1_frozen' | 'chronology' | 'collision' | 'funding_needed' | 'negative_shared_carry' | 'insolvent'
      deficit?: number
      postedLegs: []
      state: DivisionCloseState
    }
  | {
      ok: true
      cached: boolean
      closed: { M: boolean; W: boolean }
      sharedPosted: boolean
      heldReserve: { M: { perfect4: number; perfect5: number }; W: { perfect4: number; perfect5: number } }
      released: { M: number; W: number }
      paidPlaces: { M: Record<string, number>; W: Record<string, number> }
      postedLegs: Leg[]
      state: DivisionCloseState
    } {
  const baseState = input.state ?? createEmptyDivisionCloseState()
  const storedReq = baseState.requests[input.requestId] ?? null
  const cacheDecision = idempotentCloseResult({
    stored: storedReq,
    hash: input.payloadHash,
    fresh: true,
    result: null,
  })
  if (cacheDecision.action === 'collision') {
    return { ok: false, reason: 'collision', postedLegs: [], state: baseState }
  }
  if (cacheDecision.action === 'cached') {
    const prev = cacheDecision.result as {
      closed: { M: boolean; W: boolean }
      sharedPosted: boolean
      heldReserve: { M: { perfect4: number; perfect5: number }; W: { perfect4: number; perfect5: number } }
      released: { M: number; W: number }
      paidPlaces: { M: Record<string, number>; W: Record<string, number> }
      state: DivisionCloseState
    }
    return {
      ok: true,
      cached: true,
      closed: prev.closed,
      sharedPosted: prev.sharedPosted,
      heldReserve: prev.heldReserve,
      released: prev.released,
      paidPlaces: prev.paidPlaces,
      postedLegs: [],
      state: baseState,
    }
  }

  const admission = closeAdmission({
    legacyPending: Boolean(input.legacyPending),
    week1: !refuseWeek1Finance({ event: input.event, action: 'close' }).ok,
    laterPosted: Boolean(input.laterPosted),
  })
  if (!admission.ok) {
    return { ok: false, reason: admission.reason, postedLegs: [], state: baseState }
  }

  const firstDivision = baseState.firstDivision ?? input.division
  const mergedPayouts = {
    ...input.payouts,
    ...baseState.frozenChecks,
  }

  const plan = planSplitClose({
    settings: input.settings,
    entries: input.entries,
    balances: input.balances,
    bar: input.bar,
    openingNight: input.openingNight,
    payouts: mergedPayouts,
    event: input.event,
    firstDivision,
  })
  if (!plan.ok) {
    return {
      ok: false,
      reason: plan.reason,
      deficit: plan.deficit,
      postedLegs: [],
      state: baseState,
    }
  }

  const isFirstClose = baseState.firstDivision === null
  const postedLegs = isFirstClose ? plan.firstLegs : plan.secondLegs

  const divPaid: Record<string, number> = {}
  for (const leg of postedLegs) {
    if (leg.division === input.division && leg.kind === 'place_payout' && leg.player_id) {
      divPaid[leg.player_id] = cents((divPaid[leg.player_id] ?? 0) + Math.abs(leg.amount))
    }
  }

  const nextClosed = {
    ...baseState.closed,
    [input.division]: true,
  }
  const nextSharedPosted = nextClosed.M && nextClosed.W
  const nextPaidPlaces = {
    M: input.division === 'M' && !baseState.closed.M ? divPaid : { ...baseState.paidPlaces.M },
    W: input.division === 'W' && !baseState.closed.W ? divPaid : { ...baseState.paidPlaces.W },
  }
  const divEntries = input.entries.filter((e) => e.division === input.division)
  const divChecks =
    mergedPayouts[input.division] !== undefined
      ? mergedPayouts[input.division]!
      : suggestedPayouts(plan.placePool[input.division], paidPlaceCount(divEntries.length, 0, input.settings))

  const nextState: DivisionCloseState = {
    closed: nextClosed,
    firstDivision,
    sharedPosted: nextSharedPosted,
    heldReserve: plan.heldReserve,
    released: nextSharedPosted ? plan.released : { M: 0, W: 0 },
    paidPlaces: nextPaidPlaces,
    frozenChecks: {
      ...baseState.frozenChecks,
      [input.division]: divChecks,
    },
    requests: {
      ...baseState.requests,
    },
  }

  const responseSummary = {
    closed: nextClosed,
    sharedPosted: nextSharedPosted,
    heldReserve: nextState.heldReserve,
    released: nextState.released,
    paidPlaces: nextPaidPlaces,
  }
  nextState.requests[input.requestId] = {
    completed: true,
    hash: input.payloadHash,
    response: responseSummary,
  }

  return {
    ok: true,
    cached: false,
    ...responseSummary,
    postedLegs,
    state: nextState,
  }
}

export function activationDecision(input: {
  status: string
  entryCount: number
  ledgerCount: number
  event: { season_id: string; date: string; name: string }
}):
  | { ok: true; stages: { M: 'checkin'; W: 'checkin' } }
  | { ok: false; reason: 'week1_frozen' | 'not_scheduled' | 'not_clean' } {
  if (!refuseWeek1Finance({ event: input.event, action: 'activate' }).ok) {
    return { ok: false, reason: 'week1_frozen' }
  }
  if (input.status !== 'scheduled') {
    return { ok: false, reason: 'not_scheduled' }
  }
  if (input.entryCount > 0 || input.ledgerCount > 0) {
    return { ok: false, reason: 'not_clean' }
  }
  return { ok: true, stages: { M: 'checkin', W: 'checkin' } }
}

export function closeAdmission(input: {
  legacyPending: boolean
  week1: boolean
  laterPosted: boolean
}):
  | { ok: true }
  | { ok: false; reason: 'legacy_pending' | 'week1_frozen' | 'chronology' } {
  if (input.legacyPending) {
    return { ok: false, reason: 'legacy_pending' }
  }
  if (input.week1) {
    return { ok: false, reason: 'week1_frozen' }
  }
  if (input.laterPosted) {
    return { ok: false, reason: 'chronology' }
  }
  return { ok: true }
}

export function idempotentCloseResult<T, R>(input: {
  stored: { completed: boolean; hash: string; response?: R } | null
  hash: string
  fresh: boolean
  result: T
}):
  | { action: 'collision' }
  | { action: 'cached'; result: R | undefined }
  | { action: 'stale' }
  | { action: 'proceed'; result: T } {
  const { stored, hash, fresh, result } = input
  if (stored !== null) {
    if (stored.hash !== hash) {
      return { action: 'collision' }
    }
    if (stored.completed) {
      return { action: 'cached', result: stored.response }
    }
  }
  if (!fresh) {
    return { action: 'stale' }
  }
  return { action: 'proceed', result }
}

export const CONFIRMATION_SENTENCE = 'All cash differences shown have been physically settled.'

/**
 * Plans a correction leg for the latest financially posted night.
 * `bookedCash` and `targetCash` represent cash paid out from the division purse, so a positive
 * `cashDelta` (additional cash paid out to players) debits the division purse by `-cashDelta`.
 */
export function planCorrection(input: {
  event: { season_id: string; date?: string; event_date?: string; name?: string | null }
  division?: 'M' | 'W'
  fund?: Fund
  bookedCash: number
  targetCash: number
  externalPerfect4?: number
  balances?: {
    M?: Record<string, number | undefined>
    W?: Record<string, number | undefined>
    [division: string]: Record<string, number | undefined> | undefined
  }
  laterPosted?: boolean
  legacyPending?: boolean
}):
  | {
      ok: false
      reason: 'week1_frozen' | 'chronology' | 'legacy_pending' | 'insolvent'
      insolvent?: { division: string; fund: string }[]
      legs: Leg[]
    }
  | {
      ok: true
      cashDelta: number
      passThroughPerfect4: number
      legs: Leg[]
    } {
  const admission = closeAdmission({
    legacyPending: Boolean(input.legacyPending),
    week1: !refuseWeek1Finance({ event: input.event, action: 'correct' }).ok,
    laterPosted: Boolean(input.laterPosted),
  })
  if (!admission.ok) {
    return { ok: false, reason: admission.reason, legs: [] }
  }

  const division: 'M' | 'W' = input.division ?? 'M'
  const fund: Fund = input.fund ?? 'purse'
  const cashDelta = cents(input.targetCash - input.bookedCash)
  const passThroughPerfect4 = input.externalPerfect4 ?? 0
  if (cashDelta === 0) {
    return {
      ok: true,
      cashDelta: 0,
      passThroughPerfect4,
      legs: [],
    }
  }
  const leg: Leg = {
    division,
    fund,
    kind: 'adjustment',
    amount: cents(-cashDelta),
    note: 'Correction',
    player_id: null,
  }
  const legs: Leg[] = [leg]
  const effectiveBalances = input.balances ?? {
    [division]: { [fund]: Math.max(0, cashDelta) },
  }
  const insolvent = debitSolvency(effectiveBalances, legs)
  if (insolvent.length > 0) {
    return {
      ok: false,
      reason: 'insolvent',
      insolvent,
      legs: [],
    }
  }
  return {
    ok: true,
    cashDelta,
    passThroughPerfect4,
    legs,
  }
}

export function isLatestPostedNight(input: {
  event: { id?: string; season_id: string; date?: string; event_date?: string; created_at?: string; pp_closed_men?: boolean; pp_closed_women?: boolean }
  events: ReadonlyArray<{ id: string; season_id: string; date?: string; event_date?: string; created_at?: string; pp_closed_men?: boolean; pp_closed_women?: boolean }>
  ledger: ReadonlyArray<{ event_id: string | null }>
}): { posted: boolean; latest: boolean; laterPosted: boolean } {
  const eventId = input.event.id
  const postedIds = new Set<string>()
  for (const row of input.ledger) {
    if (row.event_id) postedIds.add(row.event_id)
  }
  for (const ev of input.events) {
    if (ev.pp_closed_men || ev.pp_closed_women) postedIds.add(ev.id)
  }
  const posted = eventId ? postedIds.has(eventId) : Boolean(input.event.pp_closed_men || input.event.pp_closed_women)
  const seasonPosted = input.events
    .filter((ev) => ev.season_id === input.event.season_id && postedIds.has(ev.id))
    .slice()
    .sort((a, b) => {
      const da = a.date ?? a.event_date ?? ''
      const db = b.date ?? b.event_date ?? ''
      if (da !== db) return da < db ? -1 : 1
      const ca = a.created_at ?? ''
      const cb = b.created_at ?? ''
      if (ca !== cb) return ca < cb ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  if (seasonPosted.length === 0) {
    return { posted, latest: false, laterPosted: false }
  }
  const latestEvent = seasonPosted[seasonPosted.length - 1]
  if (!eventId) {
    return { posted, latest: posted, laterPosted: false }
  }
  const latest = posted && latestEvent.id === eventId
  const targetDate = input.event.date ?? input.event.event_date ?? ''
  const laterPosted = seasonPosted.some((ev) => {
    if (ev.id === eventId) return false
    const evDate = ev.date ?? ev.event_date ?? ''
    if (evDate !== targetDate) return evDate > targetDate
    const targetCreated = input.event.created_at ?? ''
    const evCreated = ev.created_at ?? ''
    if (evCreated !== targetCreated) return evCreated > targetCreated
    return ev.id > eventId
  })
  return { posted, latest, laterPosted }
}

export function canEditDivisionPayouts(input: {
  event: { season_id: string; date?: string; event_date?: string; name?: string | null }
  divisionClosed: boolean
  reopenViaCorrection?: boolean
}): boolean {
  if (!refuseWeek1Finance({ event: input.event, action: 'payout' }).ok) {
    return false
  }
  if (input.divisionClosed && !input.reopenViaCorrection) {
    return false
  }
  return true
}

export interface OriginalPayoutRecord {
  id: string
  player_id: string
  place: number | null
  payout: number
}

export interface CorrectionDraft {
  id: string
  eventId: string
  division: 'M' | 'W'
  bookedCash: number
  targetCash: number
  cashDelta: number
  cashDue: number
  handled: number
  acknowledged: boolean
  confirmation: string
  reopenDivision: boolean
  originalPayouts: ReadonlyArray<OriginalPayoutRecord>
  adjustmentLegs: Leg[]
  status: 'awaiting' | 'cash confirmed, posting pending' | 'applied'
}

export function createCorrectionDraft(input: {
  id?: string
  event: { id?: string; season_id: string; date?: string; event_date?: string; name?: string | null; created_at?: string; pp_closed_men?: boolean; pp_closed_women?: boolean }
  division: 'M' | 'W'
  events?: ReadonlyArray<{ id: string; season_id: string; date?: string; event_date?: string; created_at?: string; pp_closed_men?: boolean; pp_closed_women?: boolean }>
  ledger?: ReadonlyArray<{ event_id: string | null }>
  bookedCash: number
  targetCash: number
  balances?: {
    M?: Record<string, number | undefined>
    W?: Record<string, number | undefined>
    [division: string]: Record<string, number | undefined> | undefined
  }
  originalPayouts: ReadonlyArray<OriginalPayoutRecord>
  reopenDivision?: boolean
}):
  | {
      ok: false
      reason: 'week1_frozen' | 'not_posted' | 'chronology' | 'legacy_pending' | 'insolvent'
      insolvent?: { division: string; fund: string }[]
    }
  | {
      ok: true
      draft: CorrectionDraft
    } {
  if (!refuseWeek1Finance({ event: input.event, action: 'correct' }).ok) {
    return { ok: false, reason: 'week1_frozen' }
  }
  if (input.events && input.ledger) {
    const check = isLatestPostedNight({
      event: input.event,
      events: input.events,
      ledger: input.ledger,
    })
    if (check.laterPosted) {
      return { ok: false, reason: 'chronology' }
    }
    if (!check.posted) {
      return { ok: false, reason: 'not_posted' }
    }
  }
  const plan = planCorrection({
    event: input.event,
    division: input.division,
    bookedCash: input.bookedCash,
    targetCash: input.targetCash,
    balances: input.balances,
  })
  if (!plan.ok) {
    return {
      ok: false,
      reason: plan.reason,
      insolvent: plan.insolvent,
    }
  }
  const cashDue = Math.abs(plan.cashDelta)
  return {
    ok: true,
    draft: {
      id: input.id ?? `corr-${input.event.id ?? 'ev'}-${input.division}`,
      eventId: input.event.id ?? '',
      division: input.division,
      bookedCash: input.bookedCash,
      targetCash: input.targetCash,
      cashDelta: plan.cashDelta,
      cashDue,
      handled: 0,
      acknowledged: false,
      confirmation: '',
      reopenDivision: Boolean(input.reopenDivision),
      originalPayouts: input.originalPayouts.map((r) => ({ ...r })),
      adjustmentLegs: plan.legs,
      status: 'awaiting',
    },
  }
}

export function applyCorrectionDraft(input: {
  draft: CorrectionDraft
  handled: number
  acknowledged: boolean
  confirmation?: string
  applyFailed?: boolean
}):
  | {
      ok: false
      state: 'awaiting' | 'cash confirmed, posting pending'
      actionable: number
      confirmationOk: boolean
      draft: CorrectionDraft
    }
  | {
      ok: true
      state: 'applied'
      actionable: 0
      confirmationOk: true
      reopened: boolean
      originalPayouts: ReadonlyArray<OriginalPayoutRecord>
      adjustmentLegs: Leg[]
      draft: CorrectionDraft
    } {
  const windowState = cashWindow({
    cashDue: input.draft.cashDue,
    handled: input.handled,
    acknowledged: input.acknowledged,
    confirmation: input.confirmation,
    applyFailed: input.applyFailed,
  })
  if (windowState.state !== 'applied') {
    return {
      ok: false,
      state: windowState.state,
      actionable: windowState.actionable,
      confirmationOk: windowState.confirmationOk,
      draft: {
        ...input.draft,
        handled: input.handled,
        acknowledged: input.acknowledged,
        confirmation: input.confirmation ?? '',
        status: windowState.state,
      },
    }
  }
  const nextDraft: CorrectionDraft = {
    ...input.draft,
    handled: input.handled,
    acknowledged: input.acknowledged,
    confirmation: input.confirmation ?? '',
    status: 'applied',
  }
  return {
    ok: true,
    state: 'applied',
    actionable: 0,
    confirmationOk: true,
    reopened: nextDraft.reopenDivision,
    originalPayouts: nextDraft.originalPayouts.map((r) => ({ ...r })),
    adjustmentLegs: nextDraft.adjustmentLegs,
    draft: nextDraft,
  }
}

export function cashWindow(input: {
  cashDue: number
  acknowledged: boolean
  confirmation?: string
  handled: number
  applyFailed?: boolean
}): {
  state: 'applied' | 'cash confirmed, posting pending' | 'awaiting'
  actionable: number
  confirmationOk: boolean
} {
  const confirmationOk =
    Boolean(input.acknowledged) &&
    input.confirmation === CONFIRMATION_SENTENCE

  if (confirmationOk && input.handled === input.cashDue) {
    if (input.applyFailed) {
      return {
        state: 'cash confirmed, posting pending',
        actionable: 0,
        confirmationOk,
      }
    }
    return {
      state: 'applied',
      actionable: 0,
      confirmationOk,
    }
  }

  return {
    state: 'awaiting',
    actionable: cents(input.cashDue - input.handled),
    confirmationOk,
  }
}

export function closeoutReader(input: {
  closed: boolean
  sharedPosted: boolean
  correctionPending: boolean
  deficit: number
}): {
  closed: boolean
  sharedPosted: boolean
  correctionPending: boolean
  fundingNeeded: string | null
} {
  return {
    closed: input.closed,
    sharedPosted: input.sharedPosted,
    correctionPending: input.correctionPending,
    fundingNeeded:
      input.deficit > 0
        ? `funding needed: $${input.deficit.toFixed(2)}; no payout posted`
        : null,
  }
}

export interface PreviewCloseRpcResponse {
  event_id: string
  season_id: string
  close_mode?: 'legacy' | 'split' | null
  closed_men?: boolean | null
  closed_women?: boolean | null
  shared_pots_posted?: boolean | null
  reserve_p4_men?: number | string | null
  reserve_p5_men?: number | string | null
  reserve_p4_women?: number | string | null
  reserve_p5_women?: number | string | null
  week1_frozen?: boolean | null
  later_posted?: boolean | null
  can_close?: boolean | null
}

export interface ExecuteDivisionCloseRpcResponse {
  ok: boolean
  cached?: boolean
  event_id: string
  posting_id?: string
  division: 'M' | 'W'
  closed_men: boolean
  closed_women: boolean
  shared_pots_posted: boolean
}

export interface ApplyCorrectionRpcResponse {
  ok: boolean
  event_id: string
  correction_id: string
  division: 'M' | 'W'
  reopened: boolean
}

export type CloseoutRpcCaller = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>

export interface DivisionClosePreviewSummary {
  division: 'M' | 'W'
  divisionLabel: string
  isSecondClose: boolean
  entryPurse: number
  barMatch: number
  perfectRoundContribution: number
  perfectRoundOverflow: number
  placePayoutTotal: number
  placePayouts: ReadonlyArray<{ note: string; amount: number; player_id: string | null }>
  placeRemainderToPot: number
  placeRemainderToBackup: number
  highScorePayoutTotal: number
  perfectRoundPayoutTotal: number
  heldReserve: { perfect4: number; perfect5: number }
  sharedP4PayoutTotal: number
  sharedP5PayoutTotal: number
  releasedReserve: number
  legs: ReadonlyArray<Leg>
  text: string
}

export function hydrateDivisionCloseState(params: {
  event: {
    pp_closed_men?: boolean | null
    pp_closed_women?: boolean | null
    pp_shared_pots_posted?: boolean | null
    pp_reserve_p4_men?: number | null
    pp_reserve_p5_men?: number | null
    pp_reserve_p4_women?: number | null
    pp_reserve_p5_women?: number | null
    payouts_men?: readonly number[] | null
    payouts_women?: readonly number[] | null
  }
  preview?: PreviewCloseRpcResponse | null
  previous?: DivisionCloseState | null
}): DivisionCloseState {
  const base = params.previous ?? createEmptyDivisionCloseState()
  const closedM = Boolean(params.preview?.closed_men ?? params.event.pp_closed_men ?? base.closed.M)
  const closedW = Boolean(params.preview?.closed_women ?? params.event.pp_closed_women ?? base.closed.W)
  const sharedPosted = Boolean(
    params.preview?.shared_pots_posted ?? params.event.pp_shared_pots_posted ?? (closedM && closedW),
  )
  const num = (v: unknown, fallback = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? cents(n) : fallback
  }
  const reserveM = {
    perfect4: num(params.preview?.reserve_p4_men ?? params.event.pp_reserve_p4_men, base.heldReserve.M.perfect4),
    perfect5: num(params.preview?.reserve_p5_men ?? params.event.pp_reserve_p5_men, base.heldReserve.M.perfect5),
  }
  const reserveW = {
    perfect4: num(params.preview?.reserve_p4_women ?? params.event.pp_reserve_p4_women, base.heldReserve.W.perfect4),
    perfect5: num(params.preview?.reserve_p5_women ?? params.event.pp_reserve_p5_women, base.heldReserve.W.perfect5),
  }

  let firstDivision: 'M' | 'W' | null = base.firstDivision
  if (closedM && !closedW) {
    firstDivision = 'M'
  } else if (closedW && !closedM) {
    firstDivision = 'W'
  } else if (!closedM && !closedW) {
    firstDivision = null
  } else if (!firstDivision) {
    firstDivision = 'M'
  }

  const frozenChecks: { M?: readonly number[]; W?: readonly number[] } = {
    ...base.frozenChecks,
  }
  if (closedM && (params.event.payouts_men?.length ?? 0) > 0 && !frozenChecks.M) {
    frozenChecks.M = params.event.payouts_men!.map((n) => Number(n))
  }
  if (closedW && (params.event.payouts_women?.length ?? 0) > 0 && !frozenChecks.W) {
    frozenChecks.W = params.event.payouts_women!.map((n) => Number(n))
  }

  return {
    ...base,
    closed: { M: closedM, W: closedW },
    firstDivision,
    sharedPosted,
    heldReserve: { M: reserveM, W: reserveW },
    frozenChecks,
  }
}

export function buildDivisionClosePreview(params: {
  division: 'M' | 'W'
  isSecondClose: boolean
  legs: ReadonlyArray<Leg>
  heldReserve: { perfect4: number; perfect5: number }
  releasedReserve: number
}): DivisionClosePreviewSummary {
  const { division, isSecondClose, legs, heldReserve, releasedReserve } = params
  const divisionLabel = division === 'M' ? "Men's" : "Women's"
  const sumAbs = (pred: (leg: Leg) => boolean) =>
    cents(legs.filter(pred).reduce((acc, leg) => acc + Math.abs(leg.amount), 0))

  const entryPurse = sumAbs((l) => l.division === division && l.fund === 'purse' && l.kind === 'entry' && l.amount > 0)
  const barMatch = sumAbs((l) => l.division === division && l.fund === 'purse' && l.kind === 'bar_match' && l.amount > 0)
  const perfectRoundContribution = sumAbs(
    (l) => l.division === division && l.fund === 'perfect_round' && l.kind === 'entry' && l.amount > 0,
  )
  const perfectRoundOverflow = sumAbs(
    (l) =>
      l.division === division &&
      l.fund === 'backup' &&
      l.kind === 'overflow' &&
      l.note === 'Over the cap' &&
      l.amount > 0,
  )
  const placePayoutLegs = legs.filter(
    (l) => l.division === division && l.fund === 'purse' && l.kind === 'place_payout' && l.amount < 0,
  )
  const placePayoutTotal = cents(placePayoutLegs.reduce((acc, l) => acc + Math.abs(l.amount), 0))
  const placeRemainderToPot = sumAbs(
    (l) =>
      l.division === division &&
      l.fund === 'perfect_round' &&
      l.kind === 'transfer' &&
      l.note === PLACE_REMAINDER_NOTE &&
      l.amount > 0,
  )
  const placeRemainderToBackup = sumAbs(
    (l) =>
      l.division === division &&
      l.fund === 'backup' &&
      l.kind === 'overflow' &&
      l.note === PLACE_REMAINDER_BACKUP_NOTE &&
      l.amount > 0,
  )
  const highScorePayoutTotal = sumAbs(
    (l) => l.division === division && l.fund === 'high_score' && l.kind === 'bonus_payout' && l.amount < 0,
  )
  const perfectRoundPayoutTotal = sumAbs(
    (l) => l.division === division && l.fund === 'perfect_round' && l.kind === 'bonus_payout' && l.amount < 0,
  )
  const sharedP4PayoutTotal = sumAbs((l) => l.fund === 'perfect4' && l.kind === 'bonus_payout' && l.amount < 0)
  const sharedP5PayoutTotal = sumAbs((l) => l.fund === 'perfect5' && l.kind === 'bonus_payout' && l.amount < 0)

  const fmt = (n: number) => `$${cents(n).toFixed(2).replace(/\.00$/, '')}`
  const lines: string[] = [`${divisionLabel} division close preview:`]
  if (legs.length === 0) {
    lines.push('• Re-closing division after correction (existing division ledger legs stay intact).')
  } else {
    lines.push(`• Purse funding: ${fmt(entryPurse)} entry share + ${fmt(barMatch)} bar match`)
    lines.push(`• Place payouts (${placePayoutLegs.length}): ${fmt(placePayoutTotal)}`)
    const remTotal = cents(placeRemainderToPot + placeRemainderToBackup)
    lines.push(
      `• Perfect Round pot: +${fmt(perfectRoundContribution)} entry ($2/player)` +
        (remTotal > 0 ? ` + ${fmt(remTotal)} place remainder` : '') +
        (perfectRoundOverflow > 0 ? ` (${fmt(perfectRoundOverflow)} overflow to Backup)` : ''),
    )
    if (highScorePayoutTotal > 0) {
      lines.push(`• High Score bonus payout: ${fmt(highScorePayoutTotal)}`)
    }
    if (perfectRoundPayoutTotal > 0) {
      lines.push(`• Perfect Round bonus payout: ${fmt(perfectRoundPayoutTotal)}`)
    }
  }

  const heldTotal = cents(heldReserve.perfect4 + heldReserve.perfect5)
  if (!isSecondClose) {
    if (heldTotal > 0) {
      lines.push(
        `• Shared P4/P5 reserve held until other division closes: ${fmt(heldTotal)} (P4 ${fmt(heldReserve.perfect4)}, P5 ${fmt(heldReserve.perfect5)})`,
      )
    } else {
      lines.push('• Shared P4/P5 pots stay held until both divisions close.')
    }
  } else {
    lines.push(
      `• Both divisions closing — settling shared P4/P5 pots now (P4 payout ${fmt(sharedP4PayoutTotal)}, P5 payout ${fmt(sharedP5PayoutTotal)}).`,
    )
    if (releasedReserve > 0) {
      lines.push(`• Released unused shared reserve to Perfect Round pot: +${fmt(releasedReserve)}`)
    }
  }

  return {
    division,
    divisionLabel,
    isSecondClose,
    entryPurse,
    barMatch,
    perfectRoundContribution,
    perfectRoundOverflow,
    placePayoutTotal,
    placePayouts: placePayoutLegs.map((l) => ({
      note: l.note,
      amount: Math.abs(l.amount),
      player_id: l.player_id,
    })),
    placeRemainderToPot,
    placeRemainderToBackup,
    highScorePayoutTotal,
    perfectRoundPayoutTotal,
    heldReserve,
    sharedP4PayoutTotal,
    sharedP5PayoutTotal,
    releasedReserve,
    legs,
    text: lines.join('\n'),
  }
}

export async function executeDivisionCloseFlow(params: {
  rpc: CloseoutRpcCaller
  event: {
    id: string
    season_id: string
    date?: string
    event_date?: string
    name?: string | null
    pp_closed_men?: boolean | null
    pp_closed_women?: boolean | null
    pp_shared_pots_posted?: boolean | null
    pp_reserve_p4_men?: number | null
    pp_reserve_p5_men?: number | null
    pp_reserve_p4_women?: number | null
    pp_reserve_p5_women?: number | null
    payouts_men?: readonly number[] | null
    payouts_women?: readonly number[] | null
  }
  division: 'M' | 'W'
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
  payouts: { M: readonly number[]; W: readonly number[] }
  state?: DivisionCloseState
  divisionAlreadyPosted?: boolean
  requestNonce?: string | number
  onPreview?: (summary: DivisionClosePreviewSummary) => void
  confirmPreview?: (summary: DivisionClosePreviewSummary) => Promise<boolean> | boolean
}): Promise<
  | {
      ok: false
      reason:
        | 'week1_frozen'
        | 'chronology'
        | 'legacy_pending'
        | 'collision'
        | 'funding_needed'
        | 'negative_shared_carry'
        | 'insolvent'
        | 'already_closed'
        | 'cancelled'
        | 'rpc_error'
      message: string
      deficit?: number
      preview?: DivisionClosePreviewSummary
    }
  | {
      ok: true
      cached: boolean
      preview: DivisionClosePreviewSummary
      rpcResult: ExecuteDivisionCloseRpcResponse
      closed: { M: boolean; W: boolean }
      sharedPosted: boolean
      heldReserve: { M: { perfect4: number; perfect5: number }; W: { perfect4: number; perfect5: number } }
      released: { M: number; W: number }
      postedLegs: Leg[]
      state: DivisionCloseState
    }
> {
  if (isWeek1Event(params.event)) {
    return {
      ok: false,
      reason: 'week1_frozen',
      message: 'Week 1 is locked and cannot be modified.',
    }
  }

  const previewRes = await params.rpc('pp_preview_close', { p_event_id: params.event.id })
  if (previewRes.error) {
    return {
      ok: false,
      reason: 'rpc_error',
      message: previewRes.error.message,
    }
  }
  const serverPreview = (previewRes.data ?? {}) as PreviewCloseRpcResponse
  if (serverPreview.week1_frozen) {
    return {
      ok: false,
      reason: 'week1_frozen',
      message: 'Week 1 is locked and cannot be modified.',
    }
  }
  if (serverPreview.later_posted || serverPreview.can_close === false) {
    return {
      ok: false,
      reason: 'chronology',
      message: 'Cannot close division because a later night has already been financially posted.',
    }
  }

  const hydratedState = hydrateDivisionCloseState({
    event: params.event,
    preview: serverPreview,
    previous: params.state ?? null,
  })
  if (hydratedState.closed[params.division]) {
    return {
      ok: false,
      reason: 'already_closed',
      message: `${params.division === 'M' ? "Men's" : "Women's"} division is already closed.`,
    }
  }

  const payloadObj = {
    eventId: params.event.id,
    division: params.division,
    payouts: params.payouts[params.division],
    bar: params.bar,
    reclose: Boolean(params.divisionAlreadyPosted),
    nonce: params.requestNonce ?? 0,
  }
  const payloadHash = closeoutPayloadHash(payloadObj)
  const requestId = closeoutRequestUuid(
    `${params.event.id}:${params.division}:close:${payloadHash}`,
  )

  const step = closeDivisionStep({
    state: hydratedState,
    event: params.event,
    division: params.division,
    requestId,
    payloadHash,
    settings: params.settings,
    entries: params.entries,
    balances: params.balances,
    bar: params.bar,
    openingNight: params.openingNight,
    payouts: params.payouts,
    laterPosted: Boolean(serverPreview.later_posted),
  })

  if (!step.ok) {
    return {
      ok: false,
      reason: step.reason,
      deficit: step.deficit,
      message: `Cannot close division: ${step.reason}`,
    }
  }

  const legsToPost = params.divisionAlreadyPosted ? [] : step.postedLegs
  const isSecondClose = step.sharedPosted
  const releasedTotal = cents(step.released.M + step.released.W)
  const previewSummary = buildDivisionClosePreview({
    division: params.division,
    isSecondClose,
    legs: legsToPost,
    heldReserve: step.heldReserve[params.division],
    releasedReserve: releasedTotal,
  })

  params.onPreview?.(previewSummary)

  if (params.confirmPreview) {
    const confirmed = await params.confirmPreview(previewSummary)
    if (!confirmed) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'Division close cancelled.',
        preview: previewSummary,
      }
    }
  }

  const execRes = await params.rpc('pp_execute_division_close', {
    p_event_id: params.event.id,
    p_division: params.division,
    p_request_id: requestId,
    p_payload_hash: payloadHash,
    p_legs: legsToPost,
    p_reserve_p4: step.heldReserve[params.division].perfect4,
    p_reserve_p5: step.heldReserve[params.division].perfect5,
  })
  if (execRes.error) {
    return {
      ok: false,
      reason: 'rpc_error',
      message: execRes.error.message,
      preview: previewSummary,
    }
  }

  const rpcData = (execRes.data ?? {}) as Partial<ExecuteDivisionCloseRpcResponse>
  const finalClosed = {
    M: typeof rpcData.closed_men === 'boolean' ? rpcData.closed_men : step.closed.M,
    W: typeof rpcData.closed_women === 'boolean' ? rpcData.closed_women : step.closed.W,
  }
  const finalSharedPosted =
    typeof rpcData.shared_pots_posted === 'boolean' ? rpcData.shared_pots_posted : step.sharedPosted

  const finalState: DivisionCloseState = {
    ...step.state,
    closed: finalClosed,
    sharedPosted: finalSharedPosted,
  }

  return {
    ok: true,
    cached: Boolean(rpcData.cached ?? step.cached),
    preview: previewSummary,
    rpcResult: {
      ok: true,
      cached: Boolean(rpcData.cached ?? step.cached),
      event_id: rpcData.event_id ?? params.event.id,
      posting_id: rpcData.posting_id,
      division: params.division,
      closed_men: finalClosed.M,
      closed_women: finalClosed.W,
      shared_pots_posted: finalSharedPosted,
    },
    closed: finalClosed,
    sharedPosted: finalSharedPosted,
    heldReserve: step.heldReserve,
    released: step.released,
    postedLegs: legsToPost,
    state: finalState,
  }
}

export async function executeCorrectionFlow(params: {
  rpc: CloseoutRpcCaller
  event: {
    id: string
    season_id: string
    date?: string
    event_date?: string
    name?: string | null
  }
  draft: CorrectionDraft
  requestNonce?: string | number
}): Promise<
  | {
      ok: false
      reason: 'week1_frozen' | 'confirmation_required' | 'rpc_error'
      message: string
    }
  | {
      ok: true
      reopened: boolean
      adjustmentLegs: Leg[]
      rpcResult: ApplyCorrectionRpcResponse
      draft: CorrectionDraft
    }
> {
  if (isWeek1Event(params.event)) {
    return {
      ok: false,
      reason: 'week1_frozen',
      message: 'Week 1 is locked and cannot be corrected.',
    }
  }

  const applied = applyCorrectionDraft({
    draft: params.draft,
    handled: params.draft.handled,
    acknowledged: params.draft.acknowledged,
    confirmation: params.draft.confirmation,
  })
  if (!applied.ok) {
    return {
      ok: false,
      reason: 'confirmation_required',
      message: 'Confirm physical cash settlement before posting this correction.',
    }
  }

  const payloadObj = {
    eventId: params.event.id,
    division: params.draft.division,
    bookedCash: params.draft.bookedCash,
    targetCash: params.draft.targetCash,
    cashDue: params.draft.cashDue,
    handled: params.draft.handled,
    reopen: applied.reopened,
    legs: applied.adjustmentLegs,
    nonce: params.requestNonce ?? params.draft.id,
  }
  const payloadHash = closeoutPayloadHash(payloadObj)
  const requestId = closeoutRequestUuid(
    `${params.event.id}:${params.draft.division}:correction:${payloadHash}`,
  )

  const rpcRes = await params.rpc('pp_apply_correction', {
    p_event_id: params.event.id,
    p_division: params.draft.division,
    p_request_id: requestId,
    p_payload_hash: payloadHash,
    p_confirmation: params.draft.confirmation,
    p_cash_due: params.draft.cashDue,
    p_handled: params.draft.handled,
    p_legs: applied.adjustmentLegs,
    p_reopen: applied.reopened,
  })
  if (rpcRes.error) {
    return {
      ok: false,
      reason: 'rpc_error',
      message: rpcRes.error.message,
    }
  }

  const rpcData = (rpcRes.data ?? {}) as Partial<ApplyCorrectionRpcResponse>
  const reopened = typeof rpcData.reopened === 'boolean' ? rpcData.reopened : applied.reopened

  return {
    ok: true,
    reopened,
    adjustmentLegs: applied.adjustmentLegs,
    rpcResult: {
      ok: true,
      event_id: rpcData.event_id ?? params.event.id,
      correction_id: rpcData.correction_id ?? '',
      division: params.draft.division,
      reopened,
    },
    draft: applied.draft,
  }
}


