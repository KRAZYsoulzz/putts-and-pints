// Quick sanity checks for the rules engine. Run: npx tsx scripts/test-logic.ts
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS as S } from '../src/lib/settings'
import { bestTotal, clampScore, effectiveCut, perfectHints, qualifiers, rank18, rankFinal, suggestedCut, totals } from '../src/lib/scoring'
import { balances, divisionResult, eventMoney, nightBonusCost, payoutPool, suggestedPaidPlaces, suggestedPayouts } from '../src/lib/money'
import { duplicateName, friendlyError, parseMoney, parseTag, payoutIssue, tagTakenTonight } from '../src/lib/validation'
import type { Entry } from '../src/lib/types'

let n = 0
const e = (p: Partial<Entry>): Entry => ({
  id: `e${++n}`, event_id: 'ev', player_id: `p${n}`, division: 'M', paid: true,
  tag_in: null, tag_out: null, r1_b1: null, r1_b2: null, r2_b1: null, r2_b2: null,
  f_b1: null, f_b2: null, awards: [],
  made_final: false, tiebreak: null, place: null, payout: 0, points: 0, ...p,
})
const zero = { perfect_round: 0, backup: 0, perfect5: 0, perfect4: 0, high_score: 0, tag_fund: 0, purse: 0 }

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
assert.equal(suggestedCut(2, S), 1, 'two players: top half is one, not zero')
assert.equal(suggestedCut(1, S), 1, 'the only player still makes the final')
assert.equal(effectiveCut(0, 2, S), 1, 'a stored 0 is unset once players exist')
assert.equal(effectiveCut(null, 2, S), 1)
assert.equal(effectiveCut(2, 4, S), 2)
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

// A finished 0 is a score. A blank row is not, and it does not share a place.
const zeros = e({ r1_b1: 0, r1_b2: 0, r2_b1: 0, r2_b2: 0, made_final: true, f_b1: 0, f_b2: 0 })
assert.equal(totals(zeros).total, 0)
assert.equal(bestTotal([zeros], 'total'), 0)
assert.equal(bestTotal([e({ r1_b1: 5 })], 'total'), null, 'unfinished round is not a best score')
const mixed = [
  e({ r1_b1: 10, r1_b2: 10, r2_b1: 10, r2_b2: 10 }),
  e({ r1_b1: 0, r1_b2: 0, r2_b1: 0, r2_b2: 0 }),
  e({ r1_b1: 3 }),
  e({}),
]
const placed = rank18(mixed, S)
assert.deepEqual(placed.map(r => r.place), [1, 2, 0, 0])
assert.equal(placed[1].totals.t18, 0)

// Scores clamp instead of reaching the database check.
assert.equal(clampScore('-3', 30), 0)
assert.equal(clampScore('40', 30), 30)
assert.equal(clampScore('15', 30), 15)
assert.equal(clampScore('', 30), null)
assert.equal(clampScore('nope', 20), null)

// Cut changes who qualifies.
const cutField = [
  e({ r1_b1: 20, r1_b2: 10, r2_b1: 20, r2_b2: 10 }),
  e({ r1_b1: 10, r1_b2: 10, r2_b1: 10, r2_b2: 10 }),
  e({ r1_b1: 5, r1_b2: 5, r2_b1: 5, r2_b2: 5 }),
]
assert.equal(qualifiers(cutField, 1, S).size, 1)
assert.equal(qualifiers(cutField, 2, S).size, 2)

// Payout pool subtracts an awarded $10 Perfect 5. Suggestions add up to that pool.
const bonusField = [e({ awards: ['perfect5'] }), e({}), e({}), e({})]
assert.equal(nightBonusCost(bonusField, S), 10)
assert.equal(payoutPool(4, 20, S, nightBonusCost(bonusField, S)), 42, '4×$8 + $20 bar − $10 bonus')
assert.equal(suggestedPaidPlaces(4, S), 1)
const suggested = suggestedPayouts(42, 1)
assert.deepEqual(suggested, [42])
assert.equal(payoutIssue([500], 42), 'over')
assert.equal(payoutIssue([-1], 42), 'negative')
assert.equal(payoutIssue([30, 12], 42), null)
const split = suggestedPayouts(52, 3)
assert.equal(split.reduce((a, b) => a + b, 0), 52)

// $55 across 1, 2, or 3 paid places is a declining split, not 55/0/0.
assert.deepEqual(suggestedPayouts(55, 1), [55])
const twoPlaces = suggestedPayouts(55, 2)
const threePlaces = suggestedPayouts(55, 3)
assert.deepEqual(twoPlaces, [36.67, 18.33])
assert.deepEqual(threePlaces, [27.5, 18.33, 9.17])
assert.ok(twoPlaces[0] > twoPlaces[1])
assert.ok(threePlaces[0] > threePlaces[1] && threePlaces[1] > threePlaces[2])
assert.equal(twoPlaces.reduce((a, b) => a + b, 0), 55)
assert.equal(threePlaces.reduce((a, b) => a + b, 0), 55)
assert.notDeepEqual(threePlaces, [55, 0, 0])

// Ledger: purse is funded by the $8 share and the bar, bonuses are funded before they are paid,
// and place checks leave a row. Perfect 5 nets to zero instead of −$10.
const paid = [
  e({ r1_b1: 30, r1_b2: 10, r2_b1: 10, r2_b2: 10, awards: ['perfect5'], player_id: 'p-a' }),
  e({ r1_b1: 20, r1_b2: 10, r2_b1: 10, r2_b2: 10, player_id: 'p-b' }),
  e({ r1_b1: 10, r1_b2: 10, r2_b1: 10, r2_b2: 10, player_id: 'p-c' }),
  e({ r1_b1: 5, r1_b2: 5, r2_b1: 5, r2_b2: 5, player_id: 'p-d' }),
]
const night = divisionResult({
  division: 'M', entries: paid, payoutPlaces: [42], settings: S,
  balances: { ...zero }, barMatch: 20, priorRecord: null,
})
const sumFund = (fund: string) => night.ledger.filter(r => r.fund === fund).reduce((a, r) => a + r.amount, 0)
assert.ok(night.ledger.some(r => r.fund === 'purse' && r.kind === 'entry' && r.amount === 32), '4 × $8 into the purse')
assert.ok(night.ledger.some(r => r.fund === 'purse' && r.kind === 'bar_match' && r.amount === 20))
assert.ok(night.ledger.some(r => r.fund === 'perfect_round' && r.kind === 'entry' && r.amount === 8))
assert.ok(night.ledger.some(r => r.fund === 'purse' && r.kind === 'transfer' && r.amount === -10), 'Perfect 5 leaves the purse')
assert.ok(night.ledger.some(r => r.fund === 'perfect5' && r.kind === 'transfer' && r.amount === 10), 'Perfect 5 pot is funded')
assert.ok(night.ledger.some(r => r.fund === 'perfect5' && r.kind === 'bonus_payout' && r.amount === -10))
assert.equal(sumFund('perfect5'), 0, 'Perfect 5 does not go negative')
assert.ok(night.ledger.some(r => r.fund === 'purse' && r.kind === 'place_payout' && r.amount === -42))
assert.equal(sumFund('purse'), 0, '32 + 20 − 10 − 42')
const after = balances([
  ...night.ledger.map((r, i) => ({ ...r, id: String(i), season_id: 's', event_id: 'ev', created_at: '', division: 'M' as const })),
], 'M')
assert.equal(after.perfect5, 0)
assert.equal(after.purse, 0)
assert.equal(after.perfect_round, 8)

// Perfect Round pays the pot (tonight's $2s included, cap applies), not a flat $10,
// and that payout does not come out of the place pool.
const prNight = divisionResult({
  division: 'W',
  entries: [e({ awards: ['perfect_round', 'perfect5'], player_id: 'pr' })],
  payoutPlaces: [],
  settings: S,
  balances: { ...zero },
  barMatch: 0,
  priorRecord: null,
})
assert.equal(prNight.potAfterEntries, 2, 'one entry adds $2 to an empty pot')
assert.equal(prNight.bonuses.find(b => b.type === 'perfect_round')?.each, 2)
assert.equal(prNight.bonuses.find(b => b.type === 'perfect5')?.each, 10)
assert.ok(!prNight.ledger.some(r => r.fund === 'purse' && r.note.includes('Perfect Round')))
assert.ok(prNight.ledger.some(r => r.fund === 'purse' && r.amount === -10 && r.note.includes('Perfect 5')))
const capped = divisionResult({
  division: 'M',
  entries: [e({ awards: ['perfect_round'] }), e({}), e({})],
  payoutPlaces: [],
  settings: S,
  balances: { ...zero, perfect_round: 248 },
  barMatch: 0,
  priorRecord: null,
})
assert.equal(capped.potAfterEntries, 250, 'three × $2 stops at the $250 cap')
assert.equal(capped.bonuses.find(b => b.type === 'perfect_round')?.each, 250)
assert.ok(capped.ledger.some(r => r.fund === 'backup' && r.kind === 'overflow' && r.amount === 4))

// Names, tags, and raw database errors.
assert.equal(duplicateName('  Ann   Lee ', [{ id: '1', name: 'ann lee' }]), true)
assert.equal(duplicateName('Ann', [{ id: '1', name: 'Ann' }], '1'), false)
assert.deepEqual(parseTag(''), { ok: true, value: null })
assert.deepEqual(parseTag('4'), { ok: true, value: 4 })
assert.equal(parseTag('-2').ok, false)
assert.equal(parseTag('1.5').ok, false)
assert.equal(tagTakenTonight(4, [{ id: 'a', division: 'M', tag_in: 4 }, { id: 'b', division: 'W', tag_in: 4 }], 'c', 'M'), true)
assert.equal(tagTakenTonight(4, [{ id: 'a', division: 'M', tag_in: 4 }], 'c', 'W'), false)
assert.match(friendlyError('duplicate key value violates unique constraint "pp_entries_event_id_player_id_key"'), /already checked in/)
assert.doesNotMatch(friendlyError('duplicate key value violates unique constraint "pp_entries_event_id_player_id_key"'), /pp_entries_event_id_player_id_key/)
assert.match(friendlyError('new row violates check constraint "pp_entries_r1_b1_check"'), /allowed range/)
assert.match(friendlyError('new row violates row-level security policy for table "pp_players"'), /not signed in/)
assert.match(friendlyError('JWT expired'), /not signed in/)
assert.match(friendlyError(undefined), /try again/)
assert.match(friendlyError('new row violates check constraint "pp_ledger_fund_check"'), /003_ledger_and_event_name/)
assert.deepEqual(parseMoney('-5'), { ok: false, error: 'Amount can’t be negative.' })
assert.deepEqual(parseMoney('abc'), { ok: false, error: 'Enter a dollar amount.' })
assert.deepEqual(parseMoney('-'), { ok: false, error: 'Amount can’t be negative.' })
assert.deepEqual(parseMoney(''), { ok: true, value: 0 })
assert.deepEqual(parseMoney('12.5'), { ok: true, value: 12.5 })
assert.equal(parseMoney('-3', true).ok, true)

console.log('All rules checks passed ✔')
