// Quick sanity checks for the rules engine. Run: npx tsx scripts/test-logic.ts
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS as S } from '../src/lib/settings'
import { perfectHints, qualifiers, rankFinal, suggestedCut, totals } from '../src/lib/scoring'
import { divisionResult, eventMoney, payoutPool } from '../src/lib/money'
import type { Entry } from '../src/lib/types'

let n = 0
const e = (p: Partial<Entry>): Entry => ({
  id: `e${++n}`, event_id: 'ev', player_id: `p${n}`, division: 'M', paid: true,
  tag_in: null, tag_out: null, r1_b1: null, r1_b2: null, r2_b1: null, r2_b2: null,
  f_b1: null, f_b2: null, awards: [],
  made_final: false, tiebreak: null, place: null, payout: 0, points: 0, ...p,
})
const zero = { perfect_round: 0, backup: 0, perfect5: 0, perfect4: 0, high_score: 0, tag_fund: 0 }

// Totals
const perfect = e({ r1_b1: 30, r1_b2: 20, r2_b1: 30, r2_b2: 20, made_final: true, f_b1: 30, f_b2: 20 })
assert.deepEqual(totals(perfect), { r1: 50, r2: 50, f: 50, t18: 100, total: 150 })

// Hints only (bonuses are manual)
assert.deepEqual(perfectHints(e({ r1_b1: 30, r2_b2: 20 })), { p5: true, p4: true })
assert.deepEqual(perfectHints(e({ f_b1: 30 })), { p5: false, p4: false }, 'final 9 ignored when not a finalist')

// Money: 20 players, bar matches 50%
const m = eventMoney({ M: 14, W: 6 }, S)
assert.equal(m.totalPot, 200); assert.equal(m.barMatch, 100)
assert.equal(m.barSplit.M, 70); assert.equal(m.barSplit.W, 30)
assert.equal(payoutPool(20, 100, S), 260)

// Cut + ranking with ties (split mode)
const field = [
  e({ r1_b1: 20, r1_b2: 10, r2_b1: 20, r2_b2: 10, tag_in: 5 }),  // 60
  e({ r1_b1: 25, r1_b2: 15, r2_b1: 25, r2_b2: 15, tag_in: 2 }),  // 80
  e({ r1_b1: 20, r1_b2: 10, r2_b1: 20, r2_b2: 10 }),             // 60
  e({ r1_b1: 10, r1_b2: 10, r2_b1: 10, r2_b2: 10, tag_in: 9 }),  // 40
]
assert.equal(suggestedCut(field.length, S), 2)
const q = qualifiers(field, 2, S)
assert.equal(q.size, 3, 'tie at the cut line includes both')

field.forEach(x => { x.made_final = q.has(x.id) })
field[0].f_b1 = 10; field[0].f_b2 = 5   // 75
field[1].f_b1 = 10; field[1].f_b2 = 5   // 95
field[2].f_b1 = 10; field[2].f_b2 = 5   // 75
assert.deepEqual(rankFinal(field, S).map(r => r.place), [1, 2, 2, 4])

// Countback breaks the tie for 2nd
const cb = { ...S, ties: { ...S.ties, placement: 'countback' as const } }
field[2].r2_b1 = 21; field[2].r2_b2 = 9  // same 18, better second-9 Basket 1… r2 total equal → falls to r2_b1
assert.deepEqual(rankFinal(field, cb).map(r => r.place), [1, 2, 3, 4])
field[2].r2_b1 = 20; field[2].r2_b2 = 10

const res = divisionResult({
  division: 'M', entries: field, payoutPlaces: [30, 20, 10], settings: S,
  balances: { ...zero, perfect_round: 245, backup: 40 }, priorRecord: 90,
})
assert.equal(res.payouts.get(field[1].id), 30)
assert.equal(res.payouts.get(field[0].id), 15, 'tied 2nd splits 20+10')
assert.equal(res.points.get(field[2].id), 7, 'tied 2nd splits 8+6')
assert.equal(res.points.get(field[3].id), 4)
assert.equal(res.tagsOut.get(field[1].id), 2)
assert.equal(res.tagsOut.get(field[0].id), 5)
assert.equal(res.tagsOut.get(field[3].id), 9)
assert.equal(res.potAfterEntries, 250, 'pot caps at 250')
assert.ok(res.ledger.some(r => r.fund === 'backup' && r.amount === 3), '$3 overflow to backup')
assert.equal(res.bonuses.length, 0, 'nothing paid unless awarded')
assert.equal(res.newRecord, 95)

// Manual awards: two Perfect 5s split $10; Perfect Round pays the pot and backup rolls in
const a = e({ r1_b1: 30, r1_b2: 10, r2_b1: 10, r2_b2: 10, tag_in: 1, awards: ['perfect5'] })
const b = e({ r1_b1: 30, r1_b2: 10, r2_b1: 10, r2_b2: 10, tag_in: 3, awards: ['perfect5', 'high_score'] })
const c = e({ r1_b1: 30, r1_b2: 10, r2_b1: 10, r2_b2: 10, tag_in: 4, awards: ['perfect_round'] })
const aw = divisionResult({ division: 'M', entries: [a, b, c], payoutPlaces: [], settings: S,
  balances: { ...zero, perfect_round: 100, backup: 30 }, priorRecord: null })
assert.deepEqual(aw.bonuses, [
  { type: 'perfect_round', entryIds: [c.id], each: 106 },
  { type: 'perfect5', entryIds: [a.id, b.id], each: 5 },
  { type: 'high_score', entryIds: [b.id], each: 10 },
])
assert.ok(aw.ledger.some(r => r.fund === 'perfect_round' && r.kind === 'rollover' && r.amount === 30))

console.log('All rules checks passed ✔')
