// Quick sanity checks for the rules engine. Run: npx tsx scripts/test-logic.ts
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS as S } from '../src/lib/settings'
import { bestTotal, byEntryOrder, cents, clampScore, effectiveCut, eighteenGridRows, initialTagAssignment, isOpeningTagNight, qualifiers, rank18, rankFinal, redistributeTags, suggestedCut, totals } from '../src/lib/scoring'
import { applyScoreEdit, draftAfterScoreSave, runScoreEdit } from '../src/lib/score-edit'
import { completeRefresh, requestRefresh } from '../src/lib/score-refresh'
import { balances, clampPaidPlaces, displayedPerfectRound, displayedSharedPot, divisionResult, effectiveBar, eventLedgerPosted, eventMoney, nightBonusCost, otherDivisionNights, paidPlaceCount, payoutPool, payoutsForPlaceCount, placeBudget, postedBonusCost, splitEvenly, suggestedPaidPlaces, suggestedPayouts, type DivisionNight } from '../src/lib/money'
import { duplicateName, friendlyError, parseMoney, parseTag, payoutIssue, payoutRejectMessage, tagTakenTonight } from '../src/lib/validation'
import { buyingTagAfter, checkinTagIn, freshBuyingTag, newPlayerInsert } from '../src/lib/newPlayer'
import type { Entry } from '../src/lib/types'

let n = 0
const e = (p: Partial<Entry>): Entry => ({
  id: `e${++n}`, event_id: 'ev', player_id: `p${n}`, division: 'M', paid: true,
  tag_in: null, tag_out: null, r1_b1: null, r1_b2: null, r2_b1: null, r2_b2: null,
  f_b1: null, f_b2: null, score_18: null, score_final: null, awards: [],
  made_final: false, tiebreak: null, place: null, payout: 0, points: 0, ...p,
})
const zero = { perfect_round: 0, backup: 0, perfect5: 0, perfect4: 0, high_score: 0, tag_fund: 0, purse: 0 }

// Totals
const perfect = e({ r1_b1: 30, r1_b2: 20, r2_b1: 30, r2_b2: 20, made_final: true, f_b1: 30, f_b2: 20 })
assert.deepEqual(totals(perfect), { r1: 50, r2: 50, f: 50, t18: 100, total: 150 })

// Totals-only entry: score_18 / score_final win; older nights fall back to the per-basket columns
assert.deepEqual(totals(e({ score_18: 77, made_final: true, score_final: 41 })), { r1: null, r2: null, f: 41, t18: 77, total: 118 })
assert.equal(totals(e({ score_18: 77, score_final: 41 })).f, null, 'final total ignored when not a finalist')
assert.equal(totals(e({ score_18: 0 })).total, 0, 'a finished 0 is a real score')
assert.equal(totals(e({ score_18: 90, r1_b1: 1, r1_b2: 1, r2_b1: 1, r2_b2: 1 })).t18, 90, 'new total beats old columns')
const totalsOnly = [e({ score_18: 80 }), e({ score_18: 80 }), e({ score_18: 60 })]
assert.deepEqual(rank18(totalsOnly, S).map(r => r.place), [1, 1, 3], 'ranks off the 18 total alone')

// Bar match cap
const bigNight = eventMoney({ M: 30, W: 10 }, S)
assert.equal(bigNight.totalPot, 400); assert.equal(bigNight.barMatch, 150, '50% of 400 is 200, capped at 150')
assert.equal(bigNight.barSplit.M + bigNight.barSplit.W, 150)
assert.equal(eventMoney({ M: 14, W: 6 }, S).barMatch, 100, 'under the cap is unchanged')

// Bar match follows the check-ins unless typed; finished nights keep their saved amount
const barEv = { status: 'checkin' as const, bar_match_men: 0, bar_match_women: 0, bar_match_men_manual: false, bar_match_women_manual: false }
assert.equal(effectiveBar(barEv, 'M', { M: 0, W: 0 }, S), 0, 'nobody checked in yet')
assert.equal(effectiveBar(barEv, 'M', { M: 14, W: 6 }, S), 70, 'auto: 50% of $200 split 14/6')
assert.equal(effectiveBar(barEv, 'W', { M: 14, W: 6 }, S), 30)
assert.equal(effectiveBar(barEv, 'M', { M: 30, W: 10 }, S) + effectiveBar(barEv, 'W', { M: 30, W: 10 }, S), 150, 'auto respects the cap')
assert.equal(effectiveBar({ ...barEv, bar_match_men: 25, bar_match_men_manual: true }, 'M', { M: 14, W: 6 }, S), 25, 'typed override wins')
assert.equal(effectiveBar({ ...barEv, bar_match_men: 25, bar_match_men_manual: true }, 'W', { M: 14, W: 6 }, S), 30, 'other division stays automatic')
assert.equal(effectiveBar({ ...barEv, status: 'complete' as const, bar_match_men: 40 }, 'M', { M: 14, W: 6 }, S), 40, 'finished night uses the saved amount')
assert.equal(payoutPool(14, effectiveBar(barEv, 'M', { M: 14, W: 6 }, S), S), 14 * 8 + 70, 'auto bar is part of the payout pool')

// Men's and Women's Perfect Round pots are separate: each division's entries fund its own pot and a win pays only from it
const prLedger = [
  { id: '1', season_id: 's', event_id: null, player_id: null, division: 'M' as const, fund: 'perfect_round' as const, kind: 'carryover' as const, amount: 100, note: null, created_at: '' },
  { id: '2', season_id: 's', event_id: null, player_id: null, division: 'W' as const, fund: 'perfect_round' as const, kind: 'carryover' as const, amount: 20, note: null, created_at: '' },
]
const womenWin = divisionResult({
  division: 'W', entries: [e({ division: 'W', awards: ['perfect_round'] })], payoutPlaces: [], settings: S,
  balances: balances(prLedger, 'W'), barMatch: 0, priorRecord: null,
})
assert.equal(womenWin.bonuses[0].each, 22, "women's $20 pot + her own $2, nothing from the men's $100")
assert.ok(womenWin.ledger.every(r => r.division === 'W'), "women's night writes only women's rows")

// Shared pots split to the cent
assert.deepEqual(splitEvenly(10, 3), [3.34, 3.33, 3.33])
assert.deepEqual(splitEvenly(10, 2), [5, 5])
assert.deepEqual(splitEvenly(10, 1), [10])
assert.equal(splitEvenly(250, 7).reduce((a, b) => a + b, 0).toFixed(2), '250.00')

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
  balances: { ...zero, perfect_round: 100, backup: 30 }, priorRecord: null, openingNight: false })
assert.deepEqual(aw.bonuses, [
  { type: 'perfect_round', entryIds: [c.id], each: 106, amounts: [106] },
  { type: 'perfect5', entryIds: [a.id, b.id], each: 5, amounts: [5, 5] },
  { type: 'high_score', entryIds: [b.id], each: 10, amounts: [10] },
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
assert.deepEqual(suggested, [40], '$42 pays a $40 check; $2 is not a $5 step')
assert.equal(payoutIssue([500], 42), 'over')
assert.equal(payoutIssue([-1], 42), 'negative')
assert.equal(payoutIssue([30, 12], 42), 'increment', 'a place check that is not a $5 step is refused')
assert.match(payoutRejectMessage([22.5], 45) ?? '', /multiples of \$5/)
assert.equal(payoutIssue([40, 25], 75), null, 'multiples of $5 inside the budget are allowed')
assert.match(payoutRejectMessage([100], 45) ?? '', /\$100/)
assert.match(payoutRejectMessage([100], 45) ?? '', /more than the \$45 pool/)
assert.equal(payoutRejectMessage([-1], 45), 'Payouts can’t be negative.')
const split = suggestedPayouts(52, 3)
assert.deepEqual(split, [25, 15, 10], '$5 steps of the $50 that fits; $2 is not a place check')
assert.equal(split.reduce((a, b) => a + b, 0), 50)

// Suggested checks are $5 steps in the same declining ratio, and they stay inside the pool.
assert.deepEqual(suggestedPayouts(55, 1), [55])
const twoPlaces = suggestedPayouts(55, 2)
const threePlaces = suggestedPayouts(55, 3)
assert.deepEqual(twoPlaces, [35, 20])
assert.deepEqual(threePlaces, [25, 20, 10])
assert.ok(twoPlaces.every(n => n % 5 === 0) && threePlaces.every(n => n % 5 === 0))
assert.ok(twoPlaces[0] > twoPlaces[1])
assert.ok(threePlaces[0] > threePlaces[1] && threePlaces[1] > threePlaces[2])
assert.equal(twoPlaces.reduce((a, b) => a + b, 0), 55)
assert.equal(threePlaces.reduce((a, b) => a + b, 0), 55)
assert.notDeepEqual(threePlaces, [55, 0, 0])
assert.deepEqual(suggestedPayouts(10.4, 2), [5, 5])
assert.equal(suggestedPayouts(10.4, 2).reduce((a, b) => a + b, 0), 10)

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

// A posted night already includes tonight's $2s. The card must not add them again.
assert.equal(eventLedgerPosted([{ event_id: 'night' }, { event_id: null }], 'night'), true)
assert.equal(eventLedgerPosted([{ event_id: 'other' }], 'night'), false)
assert.equal(displayedPerfectRound(10, 20, true), 10, 'ledger says $10; do not preview another $10')
assert.equal(displayedPerfectRound(0, 10, false), 10, 'before the post, preview tonight’s $2s')

// Five men's entries post $10. Opening that night again must not show $20.
const fiveMen = Array.from({ length: 5 }, () => e({}))
const fiveNight = divisionResult({
  division: 'M', entries: fiveMen, payoutPlaces: [], settings: S,
  balances: { ...zero }, barMatch: 0, priorRecord: null,
})
const fiveRows = fiveNight.ledger.map((r, i) => ({
  ...r, id: `l${i}`, season_id: 's', event_id: 'night', created_at: '', division: 'M' as const,
}))
const fiveBal = balances(fiveRows, 'M')
assert.equal(fiveBal.perfect_round, 10, '5 × $2 posted to the pot')
const reopened = divisionResult({
  division: 'M', entries: fiveMen, payoutPlaces: [], settings: S,
  balances: fiveBal, barMatch: 0, priorRecord: null,
})
assert.equal(reopened.potAfterEntries, 20, 'the projection still adds tonight on top of the posted balance')
assert.equal(
  displayedPerfectRound(fiveBal.perfect_round, reopened.potAfterEntries, eventLedgerPosted(fiveRows, 'night')),
  10,
  'a finalized or reopened card matches the ledger',
)

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

// Shared pots: P5/P4 winners split the pot balance plus tonight's flat $10; odd cents add back up.
const sharedP5 = divisionResult({
  division: 'M',
  entries: [e({ awards: ['perfect5', 'perfect4'], player_id: 's1' }), e({ awards: ['perfect5'], player_id: 's2' })],
  payoutPlaces: [], settings: S,
  balances: { ...zero, perfect5: 40, perfect4: 5 }, barMatch: 0, priorRecord: null,
})
assert.deepEqual(sharedP5.bonuses.find(b => b.type === 'perfect5')?.amounts, [25, 25], '$40 pot + $10 split two ways')
assert.deepEqual(sharedP5.bonuses.find(b => b.type === 'perfect4')?.amounts, [15], 'sole winner takes the pot')
const p5Sum = (fund: string) => sharedP5.ledger.filter(r => r.fund === fund).reduce((a, r) => a + r.amount, 0)
assert.equal(p5Sum('perfect5'), -40, 'pot goes from $40 to 0 (the $10 transfer in, $50 paid out)')
assert.equal(p5Sum('perfect4'), -5)
assert.equal(nightBonusCost(sharedP5.ledger.length ? [e({ awards: ['perfect5', 'perfect4'] }), e({ awards: ['perfect5'] })] : [], S), 20, 'purse only funds the flat amounts')
const threeWay = divisionResult({
  division: 'M',
  entries: [1, 2, 3].map(i => e({ awards: ['perfect_round'], player_id: `t${i}` })),
  payoutPlaces: [], settings: S,
  balances: { ...zero, perfect_round: 100 }, barMatch: 0, priorRecord: null,
})
const prAmounts = threeWay.bonuses[0].amounts
assert.equal(prAmounts.reduce((a, b) => a + b, 0).toFixed(2), '106.00', 'pot of 100 + 3x$2 splits with no cent lost')
assert.deepEqual(prAmounts, [35.34, 35.33, 35.33])

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

// Tags: only opted-in players move, and the first finalized night deals 1..N.
const tagIn = (id: string) => id.startsWith('in')
const optedOut = e({ player_id: 'out', score_18: 99, tag_in: 3, created_at: '1' })
const holderLow = e({ player_id: 'in-low', score_18: 70, tag_in: 5, created_at: '2' })
const holderHigh = e({ player_id: 'in-high', score_18: 80, tag_in: 2, created_at: '3' })
const tagged = rankFinal([optedOut, holderLow, holderHigh], S)
const reshuffled = redistributeTags(tagged, tagIn)
assert.equal(reshuffled.has(optedOut.id), false, 'a typed tag on someone not in tags is ignored')
assert.equal(reshuffled.get(holderHigh.id), 2, 'best opted-in finish takes the lowest carried number')
assert.equal(reshuffled.get(holderLow.id), 5)
assert.deepEqual([...reshuffled.values()].sort((a, b) => a - b), [2, 5], 'holders keep the same set of numbers')

const bareLeader = e({ player_id: 'out-first', score_18: 100, tag_in: null, created_at: '1' })
const stillTagged = redistributeTags(rankFinal([bareLeader, holderHigh, holderLow], S), tagIn)
assert.equal(stillTagged.has(bareLeader.id), false, 'a non-tag leader does not take a tag')
assert.equal(stillTagged.get(holderHigh.id), 2)
assert.equal(stillTagged.get(holderLow.id), 5)

const openBest = e({ player_id: 'in-best', score_18: 88, created_at: '2' })
const openTiedLater = e({ player_id: 'in-tie', score_18: 88, created_at: '3' })
const openThird = e({ player_id: 'in-third', score_18: 40, created_at: '1' })
const openBlank = e({ player_id: 'in-blank', created_at: '4' })
const openOut = e({ player_id: 'out-best', score_18: 150, tag_in: 7, created_at: '0' })
const dealt = initialTagAssignment(rankFinal([openOut, openThird, openBest, openTiedLater, openBlank], S), tagIn)
assert.equal(dealt.has(openOut.id), false, 'opening night skips anyone not in tags')
assert.equal(dealt.get(openBest.id), 1, 'best finish, check-in order on a tie, gets tag 1')
assert.equal(dealt.get(openTiedLater.id), 2, 'same score later in check-in gets the next tag')
assert.equal(dealt.get(openThird.id), 3)
assert.equal(dealt.get(openBlank.id), 4, 'unfinished opted-in players sort last')
assert.deepEqual([...dealt.values()].sort((a, b) => a - b), [1, 2, 3, 4])

const tagCb = { ...S, ties: { ...S.ties, placement: 'countback' as const } }
const lowBasket = e({ player_id: 'in-a', score_18: 80, r2_b1: 10, r2_b2: 10, created_at: '1' })
const highBasket = e({ player_id: 'in-b', score_18: 80, r2_b1: 20, r2_b2: 0, created_at: '9' })
const byCountback = initialTagAssignment(rankFinal([lowBasket, highBasket], tagCb), tagIn)
assert.equal(byCountback.get(highBasket.id), 1, 'countback, not check-in order, picks tag 1')
assert.equal(byCountback.get(lowBasket.id), 2)

const opened = divisionResult({
  division: 'M',
  entries: [openOut, openBest, openThird],
  payoutPlaces: [],
  settings: S,
  balances: { ...zero },
  priorRecord: null,
  tagPlan: 'opening',
  inTags: tagIn,
})
assert.equal(opened.tagsOut.get(openBest.id), 1)
assert.equal(opened.tagsOut.get(openThird.id), 2)
assert.equal(opened.tagsOut.has(openOut.id), false)
assert.equal(opened.bonuses.length, 0)

const later = divisionResult({
  division: 'M',
  entries: [openOut, holderHigh, holderLow],
  payoutPlaces: [],
  settings: S,
  balances: { ...zero },
  priorRecord: 50,
  tagPlan: 'redistribute',
  inTags: tagIn,
})
assert.equal(later.tagsOut.has(openOut.id), false)
assert.equal(later.tagsOut.get(holderHigh.id), 2)
assert.equal(later.tagsOut.get(holderLow.id), 5)

const noTagWinner = e({ player_id: 'out-bonus', tag_in: null, awards: ['perfect5', 'perfect4', 'high_score', 'perfect_round'], score_18: 100 })
const stillPaid = divisionResult({
  division: 'M',
  entries: [noTagWinner],
  payoutPlaces: [],
  settings: S,
  balances: { ...zero, perfect_round: 10 },
  priorRecord: null,
  openingNight: false,
  tagPlan: 'redistribute',
  inTags: tagIn,
})
assert.deepEqual(stillPaid.bonuses.map(b => b.type), ['perfect_round', 'perfect5', 'perfect4', 'high_score'])
assert.equal(stillPaid.tagsOut.size, 0, 'bonuses do not hand out a tag')

assert.equal(isOpeningTagNight([
  { id: 'a', event_date: '2026-11-05' },
  { id: 'b', event_date: '2026-11-19' },
], 'a'), true)
assert.equal(isOpeningTagNight([
  { id: 'a', event_date: '2026-11-05' },
], 'a'), true, 're-finalizing the first night still deals tags')
assert.equal(isOpeningTagNight([
  { id: 'week2', event_date: '2026-11-19' },
  { id: 'week1', event_date: '2026-11-05' },
], 'week2'), false, 'a later night reshuffles instead of dealing 1..N')
assert.equal(isOpeningTagNight([
  { id: 'late', event_date: '2026-11-05', created_at: '2026-10-02' },
  { id: 'early', event_date: '2026-11-05', created_at: '2026-10-01' },
], 'early'), true, 'same date: the earlier-created event is first')

// Season default stays 1 paid place per 5 players. The director can pick another count for tonight.
assert.equal(suggestedPaidPlaces(0, S), 0)
assert.equal(suggestedPaidPlaces(1, S), 1)
assert.equal(suggestedPaidPlaces(5, S), 1, '5 players → 1 place')
assert.equal(suggestedPaidPlaces(7, S), 1, 'round(7/5) is still 1')
assert.equal(suggestedPaidPlaces(8, S), 2, 'round(8/5) is 2')
assert.equal(suggestedPaidPlaces(14, S), 3)
assert.equal(paidPlaceCount(0, 4, S), 0, 'no players, no paid places')
assert.equal(paidPlaceCount(9, 0, S), suggestedPaidPlaces(9, S), 'empty payout list uses the season suggestion')
assert.equal(paidPlaceCount(9, 4, S), 4, 'a saved count is tonight’s choice')
assert.equal(paidPlaceCount(4, 8, S), 4, 'cannot pay more places than the field')
assert.equal(paidPlaceCount(6, 1, S), 1, 'at least one place when anyone played')
assert.equal(clampPaidPlaces(8, 0), 1, 'stepping down from one place stays at one')
assert.equal(clampPaidPlaces(8, 9), 8, 'stepping up stops at the field')
assert.equal(clampPaidPlaces(0, 2), 0)
const rebuilt = payoutsForPlaceCount(55, 3)
assert.deepEqual(rebuilt, suggestedPayouts(55, 3), 'changing the count re-splits the pool')
assert.equal(rebuilt.length, 3)
assert.equal(rebuilt.reduce((a, b) => a + b, 0), 55)
assert.deepEqual(payoutsForPlaceCount(0, 2), [0, 0], 'a zero pool still keeps the place count')

// First night of the season: High Score sets the record and does not come out of the purse.
// Perfect 5 still pays. A later night pays the flat high-score bonus when it is awarded.
const hsPlayer = e({ awards: ['high_score', 'perfect5'], score_18: 88, player_id: 'hs-open' })
const openingHs = divisionResult({
  division: 'M', entries: [hsPlayer], payoutPlaces: [], settings: S,
  balances: { ...zero }, barMatch: 0, priorRecord: null,
})
assert.equal(openingHs.newRecord, 88, 'the opening score becomes the record')
assert.equal(openingHs.bonuses.find(b => b.type === 'high_score')?.each, 0)
assert.equal(openingHs.bonuses.find(b => b.type === 'perfect5')?.each, 10, 'Perfect 5 is unchanged on night 1')
assert.ok(!openingHs.ledger.some(r => r.fund === 'high_score'), 'no high-score ledger hit')
assert.ok(!openingHs.ledger.some(r => r.fund === 'purse' && r.note.includes('High Score')))
assert.ok(openingHs.ledger.some(r => r.fund === 'purse' && r.amount === -10 && r.note.includes('Perfect 5')))
assert.equal(nightBonusCost([hsPlayer], S, { payHighScore: false }), 10, 'purse preview drops Perfect 5 only')

const openingDespiteLater = divisionResult({
  division: 'M',
  entries: [e({ awards: ['high_score'], score_18: 100, player_id: 'hs-first' })],
  payoutPlaces: [], settings: S, balances: { ...zero }, priorRecord: 90, openingNight: true,
})
assert.equal(openingDespiteLater.bonuses.find(b => b.type === 'high_score')?.each, 0, 'the first event does not pay even if another night already has a score')
assert.equal(openingDespiteLater.newRecord, 100)
assert.ok(!openingDespiteLater.ledger.some(r => r.kind === 'bonus_payout' && r.fund === 'high_score'))

const laterHs = divisionResult({
  division: 'M',
  entries: [e({ awards: ['high_score'], score_18: 96, player_id: 'hs-later' })],
  payoutPlaces: [], settings: S, balances: { ...zero }, priorRecord: 88, openingNight: false,
})
assert.equal(laterHs.bonuses.find(b => b.type === 'high_score')?.each, 10)
assert.equal(laterHs.newRecord, 96)
assert.ok(laterHs.ledger.some(r => r.fund === 'purse' && r.kind === 'transfer' && r.amount === -10 && r.note.includes('High Score')))
assert.ok(laterHs.ledger.some(r => r.fund === 'high_score' && r.kind === 'bonus_payout' && r.amount === -10))
assert.equal(nightBonusCost([e({ awards: ['high_score'] })], S, { payHighScore: true }), 10)

const laterNoRecordYet = divisionResult({
  division: 'W',
  entries: [e({ division: 'W', awards: ['high_score'], score_18: 70, player_id: 'hs-w' })],
  payoutPlaces: [], settings: S, balances: { ...zero }, priorRecord: null, openingNight: false,
})
assert.equal(laterNoRecordYet.bonuses.find(b => b.type === 'high_score')?.each, 10, 'a later night still pays when high score is awarded')
assert.ok(laterNoRecordYet.ledger.some(r => r.fund === 'high_score' && r.kind === 'bonus_payout'))

// Tonight → add a new player: Buying a tag is off until the director turns it on,
// and that choice is the player's in_tags flag on the same insert.
assert.equal(freshBuyingTag(), false, 'a new player is not buying a tag')
assert.deepEqual(newPlayerInsert('Ada Lovelace', 'W', false), {
  name: 'Ada Lovelace', division: 'W', active: true, in_tags: false,
})
assert.deepEqual(newPlayerInsert('Alan Turing', 'M', true), {
  name: 'Alan Turing', division: 'M', active: true, in_tags: true,
})
assert.deepEqual(Object.keys(newPlayerInsert('Ada Lovelace', 'M', true)), ['name', 'division', 'active', 'in_tags'])
assert.equal(checkinTagIn(false, 4), null, 'opted out: a held number is not eligible tonight')
assert.equal(checkinTagIn(true, 4), 4, 'opted in: the held tag comes in with them')
assert.equal(checkinTagIn(true, null), null, 'opted in with no number yet can still be in tags')
assert.equal(checkinTagIn(false, null), null)

let buying = freshBuyingTag()
buying = true
assert.equal(buyingTagAfter(buying, 'save-failure'), true, 'a failed save keeps Buying a tag on')
assert.equal(buyingTagAfter(false, 'save-failure'), false, 'a failed save keeps Buying a tag off')
assert.equal(buyingTagAfter(true, 'cancel'), false)
assert.equal(buyingTagAfter(true, 'success'), false)
assert.equal(buyingTagAfter(true, 'open'), false, 'the next player starts off')
assert.equal(buyingTagAfter(true, 'next-player'), false, 'clearing the name starts the next player off')

// Perfect 4 and Perfect 5 are one event pot each, shared by both divisions.
// The flat $10 is funded once. Shares across M and W add up to that pot exactly.
const sumMoney = (xs: number[]) => cents(xs.reduce((a, b) => a + b, 0))
const awardAmounts = (res: { bonuses: { type: string; amounts: number[] }[] }, type: string) =>
  res.bonuses.find(b => b.type === type)?.amounts ?? []
const purseHit = (res: { ledger: { fund: string; kind: string; amount: number; note: string }[] }, label: string) =>
  cents(res.ledger.filter(r => r.fund === 'purse' && r.kind === 'transfer' && r.note.includes(label)).reduce((a, r) => a + r.amount, 0))
const fundNet = (res: { ledger: { fund: string; amount: number }[] }, fund: string) =>
  cents(res.ledger.filter(r => r.fund === fund).reduce((a, r) => a + r.amount, 0))

function bothDivisions(
  men: Entry[],
  women: Entry[],
  menBalances: DivisionNight['balances'] = { ...zero },
  womenBalances: DivisionNight['balances'] = { ...zero },
  extra: { barMatch?: number; payoutPlaces?: number[]; openingNight?: boolean; priorRecord?: number | null; tagPlan?: 'opening' | 'redistribute'; inTags?: (id: string) => boolean } = {},
) {
  const menNight: DivisionNight = { division: 'M', entries: men, balances: menBalances }
  const womenNight: DivisionNight = { division: 'W', entries: women, balances: womenBalances }
  const base = { payoutPlaces: [] as number[], settings: S, barMatch: 0, priorRecord: null as number | null, ...extra }
  return {
    men: divisionResult({ ...base, division: 'M', entries: men, balances: menBalances, cohort: [womenNight] }),
    women: divisionResult({ ...base, division: 'W', entries: women, balances: womenBalances, cohort: [menNight] }),
  }
}

const manOnlyA = e({ awards: ['perfect5'], player_id: 'm-only-a', created_at: '1' })
const manOnlyB = e({ awards: ['perfect5'], player_id: 'm-only-b', created_at: '2' })
const womanIdle = e({ division: 'W', player_id: 'w-idle', created_at: '3' })
const menOnly = bothDivisions([manOnlyA, manOnlyB], [womanIdle])
assert.deepEqual(awardAmounts(menOnly.men, 'perfect5'), [5, 5], 'two men split the one $10')
assert.deepEqual(awardAmounts(menOnly.women, 'perfect5'), [], 'a division with no winner has no Perfect 5 share')
assert.equal(sumMoney([...awardAmounts(menOnly.men, 'perfect5'), ...awardAmounts(menOnly.women, 'perfect5')]), 10)
assert.equal(purseHit(menOnly.men, 'Perfect 5'), -10, 'the division that has every winner funds the whole $10')
assert.equal(purseHit(menOnly.women, 'Perfect 5'), 0)
assert.equal(nightBonusCost([manOnlyA, manOnlyB], S, { division: 'M', cohort: [{ division: 'W', entries: [womanIdle], balances: { ...zero } }] }), 10)
assert.equal(nightBonusCost([womanIdle], S, { division: 'W', cohort: [{ division: 'M', entries: [manOnlyA, manOnlyB], balances: { ...zero } }] }), 0)

const manP5 = e({ awards: ['perfect5'], player_id: 'm-p5', division: 'M', created_at: '1' })
const womanP5 = e({ awards: ['perfect5'], player_id: 'w-p5', division: 'W', created_at: '2' })
const mixedP5 = bothDivisions([manP5], [womanP5])
assert.deepEqual(awardAmounts(mixedP5.men, 'perfect5'), [5])
assert.deepEqual(awardAmounts(mixedP5.women, 'perfect5'), [5])
assert.equal(sumMoney([...awardAmounts(mixedP5.men, 'perfect5'), ...awardAmounts(mixedP5.women, 'perfect5')]), 10, 'mixed winners still share $10, not $20')
assert.equal(purseHit(mixedP5.men, 'Perfect 5') + purseHit(mixedP5.women, 'Perfect 5'), -10)
assert.equal(nightBonusCost([manP5], S, { division: 'M', cohort: [{ division: 'W', entries: [womanP5], balances: { ...zero } }] }), 5)
assert.equal(nightBonusCost([womanP5], S, { division: 'W', cohort: [{ division: 'M', entries: [manP5], balances: { ...zero } }] }), 5)
assert.equal(mixedP5.men.bonuses.find(b => b.type === 'perfect5')?.splitAmong, 2)
assert.deepEqual(manP5.awards, ['perfect5'], 'computing the pot does not change a director award')
assert.deepEqual(womanP5.awards, ['perfect5'])

// Separate award types. Each is $10 once, even when the winners sit in different divisions.
const manP4 = e({ awards: ['perfect4'], player_id: 'm-p4', created_at: '1' })
const womanP4only = e({ division: 'W', awards: ['perfect5'], player_id: 'w-p5b', created_at: '2' })
const splitTypes = bothDivisions([manP4], [womanP4only])
assert.equal(sumMoney(awardAmounts(splitTypes.men, 'perfect4').concat(awardAmounts(splitTypes.women, 'perfect4'))), 10)
assert.equal(sumMoney(awardAmounts(splitTypes.men, 'perfect5').concat(awardAmounts(splitTypes.women, 'perfect5'))), 10)
assert.equal(purseHit(splitTypes.men, 'Perfect 4'), -10)
assert.equal(purseHit(splitTypes.men, 'Perfect 5'), 0)
assert.equal(purseHit(splitTypes.women, 'Perfect 5'), -10)
assert.equal(purseHit(splitTypes.women, 'Perfect 4'), 0)

// Uneven field: leftover cents stay inside the $10, and each purse pays only its players' flat share.
const manCent = e({ awards: ['perfect5', 'perfect4'], player_id: 'm-cent', created_at: '1' })
const womanCentA = e({ division: 'W', awards: ['perfect5', 'perfect4'], player_id: 'w-cent-a', created_at: '2' })
const womanCentB = e({ division: 'W', awards: ['perfect4'], player_id: 'w-cent-b', created_at: '3' })
const uneven = bothDivisions([manCent], [womanCentA, womanCentB])
const p5Shares = [...awardAmounts(uneven.men, 'perfect5'), ...awardAmounts(uneven.women, 'perfect5')]
const p4Shares = [...awardAmounts(uneven.men, 'perfect4'), ...awardAmounts(uneven.women, 'perfect4')]
assert.deepEqual(p5Shares, [5, 5])
assert.deepEqual(p4Shares, [3.34, 3.33, 3.33])
assert.equal(sumMoney(p5Shares), 10)
assert.equal(sumMoney(p4Shares), 10)
assert.equal(cents(purseHit(uneven.men, 'Perfect 5') + purseHit(uneven.women, 'Perfect 5')), -10)
assert.equal(cents(purseHit(uneven.men, 'Perfect 4') + purseHit(uneven.women, 'Perfect 4')), -10)
assert.equal(purseHit(uneven.men, 'Perfect 4'), -3.34, 'first check-in gets the extra cent, and that purse pays it')
assert.equal(purseHit(uneven.women, 'Perfect 4'), -6.66)
assert.equal(
  nightBonusCost([manCent], S, { division: 'M', cohort: [{ division: 'W', entries: [womanCentA, womanCentB], balances: { ...zero } }] }),
  cents(3.34 + 5),
)
assert.equal(
  nightBonusCost([womanCentA, womanCentB], S, { division: 'W', cohort: [{ division: 'M', entries: [manCent], balances: { ...zero } }] }),
  cents(6.66 + 5),
)

// Nobody hit it: carryover stays put and neither purse pays.
const noHitMen = e({ player_id: 'm-none' })
const noHitWomen = e({ division: 'W', player_id: 'w-none' })
const quietBalances = { ...zero, perfect5: 15, perfect4: 4 }
const quiet = bothDivisions([noHitMen], [noHitWomen], quietBalances, { ...zero, perfect5: 7 })
assert.equal(quiet.men.bonuses.length, 0)
assert.equal(quiet.women.bonuses.length, 0)
assert.equal(purseHit(quiet.men, 'Perfect 5') + purseHit(quiet.women, 'Perfect 5') + purseHit(quiet.men, 'Perfect 4') + purseHit(quiet.women, 'Perfect 4'), 0)
assert.ok(!quiet.men.ledger.some(r => r.fund === 'perfect5' || r.fund === 'perfect4'))
assert.ok(!quiet.women.ledger.some(r => r.fund === 'perfect5' || r.fund === 'perfect4'))
assert.equal(nightBonusCost([noHitMen], S, { division: 'M', cohort: [{ division: 'W', entries: [noHitWomen], balances: { ...zero, perfect5: 7 } }] }), 0)
assert.equal(displayedSharedPot('perfect5', [
  { division: 'M', entries: [noHitMen], balances: quietBalances },
  { division: 'W', entries: [noHitWomen], balances: { ...zero, perfect5: 7 } },
], S), 32, 'the card shows both carryovers plus the one $10, before anyone is awarded')
assert.equal(displayedSharedPot('perfect4', [
  { division: 'M', entries: [noHitMen], balances: quietBalances },
  { division: 'W', entries: [noHitWomen], balances: { ...zero } },
], S), 14)

// Carryover from both divisions is one pot, plus the flat $10 once. Purses still pay only the $10.
const carryMan = e({ awards: ['perfect5'], player_id: 'm-carry', created_at: '1' })
const carryWoman = e({ division: 'W', awards: ['perfect5'], player_id: 'w-carry', created_at: '2' })
const carried = bothDivisions(
  [carryMan],
  [carryWoman],
  { ...zero, perfect5: 40 },
  { ...zero, perfect5: 5 },
)
assert.deepEqual([...awardAmounts(carried.men, 'perfect5'), ...awardAmounts(carried.women, 'perfect5')], [27.5, 27.5])
assert.equal(sumMoney([...awardAmounts(carried.men, 'perfect5'), ...awardAmounts(carried.women, 'perfect5')]), 55)
assert.equal(purseHit(carried.men, 'Perfect 5') + purseHit(carried.women, 'Perfect 5'), -10, 'carryover is already in the pot; purses add $10 once')
assert.equal(fundNet(carried.men, 'perfect5'), -40, 'men’s pot is paid down to zero')
assert.equal(fundNet(carried.women, 'perfect5'), -5, 'women’s pot is paid down to zero')

// Finalizing, reopening, and finalizing again replaces the night. It does not stack another $10.
const postedRows = [...carried.men.ledger, ...carried.women.ledger].map((r, i) => ({
  ...r, id: `post${i}`, season_id: 's', event_id: 'night', created_at: '',
}))
const priorMen = balances(postedRows.filter(r => r.event_id !== 'night'), 'M')
const priorWomen = balances(postedRows.filter(r => r.event_id !== 'night'), 'W')
assert.equal(priorMen.perfect5, 0)
assert.equal(priorWomen.perfect5, 0)
const refinal = bothDivisions([carryMan], [carryWoman], priorMen, priorWomen)
const repostedP5 = cents(
  [...awardAmounts(refinal.men, 'perfect5'), ...awardAmounts(refinal.women, 'perfect5')].reduce((a, b) => a + b, 0),
)
assert.equal(repostedP5, 10, 'after the pots were paid out, a second finalize shares only the new $10')
assert.equal(purseHit(refinal.men, 'Perfect 5') + purseHit(refinal.women, 'Perfect 5'), -10)
const replaced = [...refinal.men.ledger, ...refinal.women.ledger]
const combinedLedger = [...postedRows, ...replaced.map((r, i) => ({ ...r, id: `new${i}`, season_id: 's', event_id: 'night', created_at: '' }))]
assert.equal(
  cents(combinedLedger.filter(r => r.fund === 'perfect5' && r.kind === 'bonus_payout').reduce((a, r) => a + r.amount, 0)),
  -65,
  'stacking the new rows on the old ones double-pays; finalize must delete this event first',
)
assert.equal(
  cents(replaced.filter(r => r.fund === 'perfect5' && r.kind === 'bonus_payout').reduce((a, r) => a + r.amount, 0)),
  -10,
)
assert.equal(postedBonusCost(postedRows, 'night', 'M'), 5)
assert.equal(postedBonusCost(postedRows, 'night', 'W'), 5)
assert.equal(postedBonusCost(postedRows, 'other-night', 'M'), 0)

// Women's Perfect Round stays her own pot. High score stays per division, and the first night pays $0.
const prMan = e({ player_id: 'm-pr' })
const prWoman = e({ division: 'W', awards: ['perfect_round', 'perfect5'], player_id: 'w-pr', created_at: '2' })
const prShared = bothDivisions(
  [prMan],
  [prWoman],
  { ...zero, perfect_round: 100 },
  { ...zero, perfect_round: 20 },
)
assert.equal(prShared.women.bonuses.find(b => b.type === 'perfect_round')?.each, 22, 'her $20 plus her $2, not the men’s $100')
assert.equal(awardAmounts(prShared.women, 'perfect5').concat(awardAmounts(prShared.men, 'perfect5')).reduce((a, b) => a + b, 0), 10)
assert.ok(prShared.men.ledger.every(r => r.division === 'M'))
assert.ok(prShared.women.ledger.every(r => r.division === 'W'))

const hsMan = e({ awards: ['high_score', 'perfect5'], score_18: 90, player_id: 'm-hs', created_at: '1' })
const hsWoman = e({ division: 'W', awards: ['perfect5'], score_18: 70, player_id: 'w-hs', created_at: '2' })
const openingShared = bothDivisions([hsMan], [hsWoman], { ...zero }, { ...zero }, { openingNight: true, tagPlan: 'opening', inTags: id => id.startsWith('m-hs') || id.startsWith('w-hs') })
assert.equal(openingShared.men.bonuses.find(b => b.type === 'high_score')?.each, 0, 'first night high score still sets the bar for $0')
assert.ok(!openingShared.men.ledger.some(r => r.kind === 'bonus_payout' && r.fund === 'high_score'), 'opening night does not pay the high-score bonus')
assert.ok(!openingShared.men.ledger.some(r => r.note === 'High Score funded from the payout pool'))
assert.equal(sumMoney(awardAmounts(openingShared.men, 'perfect5').concat(awardAmounts(openingShared.women, 'perfect5'))), 10)
assert.equal(openingShared.men.tagsOut.get(hsMan.id), 1, 'shared pots do not change opening tag assignment')
assert.equal(nightBonusCost([hsMan], S, {
  payHighScore: false,
  division: 'M',
  cohort: [{ division: 'W', entries: [hsWoman], balances: { ...zero } }],
}), 5, 'opening-night purse preview drops high score and only this division’s Perfect 5 share')

const laterShared = bothDivisions(
  [e({ awards: ['high_score'], score_18: 99, player_id: 'm-hs2' })],
  [e({ division: 'W', awards: ['high_score'], score_18: 80, player_id: 'w-hs2' })],
  { ...zero },
  { ...zero },
  { openingNight: false, priorRecord: 70 },
)
assert.equal(laterShared.men.bonuses.find(b => b.type === 'high_score')?.each, 10)
assert.equal(laterShared.women.bonuses.find(b => b.type === 'high_score')?.each, 10, 'each division still pays its own high score')
assert.equal(purseHit(laterShared.men, 'High Score'), -10)
assert.equal(purseHit(laterShared.women, 'High Score'), -10)

// Place checks stay whole dollars out of the purse that remains after this division’s share of the bonus.
const placeMen = [
  e({ awards: ['perfect5'], player_id: 'm-place', created_at: '1', score_18: 80 }),
  e({ player_id: 'm-place-2', score_18: 70 }),
  e({ player_id: 'm-place-3', score_18: 60 }),
  e({ player_id: 'm-place-4', score_18: 50 }),
]
const placeWoman = e({ division: 'W', awards: ['perfect5'], player_id: 'w-place', created_at: '2' })
const menBonus = nightBonusCost(placeMen, S, { division: 'M', cohort: [{ division: 'W', entries: [placeWoman], balances: { ...zero } }] })
assert.equal(menBonus, 5)
const placePool = payoutPool(4, 20, S, menBonus)
assert.equal(placePool, 47, '4×$8 + $20 bar − $5 shared Perfect 5')
assert.deepEqual(suggestedPayouts(placePool, 1), [45])
assert.ok(suggestedPayouts(placePool, 2).every(n => n % 5 === 0))
assert.equal(suggestedPayouts(placePool, 2).reduce((a, b) => a + b, 0), 45)
const placedNight = bothDivisions(placeMen, [placeWoman], { ...zero }, { ...zero }, { barMatch: 20, payoutPlaces: [47] })
assert.equal(fundNet(placedNight.men, 'purse'), 0, 'men’s purse: 32 + 20 − 5 − 47')

// The pots page adds both divisions’ Perfect 5 balances into the one pot it shows.
const potLedger = [
  { id: 'p1', season_id: 's', event_id: null, player_id: null, division: 'M' as const, fund: 'perfect5' as const, kind: 'carryover' as const, amount: 40, note: null, created_at: '' },
  { id: 'p2', season_id: 's', event_id: null, player_id: null, division: 'W' as const, fund: 'perfect5' as const, kind: 'carryover' as const, amount: 5, note: null, created_at: '' },
  { id: 'p3', season_id: 's', event_id: null, player_id: null, division: 'M' as const, fund: 'perfect_round' as const, kind: 'carryover' as const, amount: 100, note: null, created_at: '' },
  { id: 'p4', season_id: 's', event_id: null, player_id: null, division: 'W' as const, fund: 'perfect_round' as const, kind: 'carryover' as const, amount: 20, note: null, created_at: '' },
]
assert.equal(cents(balances(potLedger, 'M').perfect5 + balances(potLedger, 'W').perfect5), 45)
assert.equal(balances(potLedger, 'W').perfect_round, 20, 'Perfect Round stays a women’s pot')
const previewCohort = otherDivisionNights('M', 'night', [
  e({ event_id: 'night', division: 'M', awards: ['perfect5'], player_id: 'preview-m' }),
  e({ event_id: 'night', division: 'W', awards: ['perfect5'], player_id: 'preview-w' }),
  e({ event_id: 'other', division: 'W', awards: ['perfect5'], player_id: 'old-w' }),
], [
  ...potLedger,
  { id: 'tonight', season_id: 's', event_id: 'night', player_id: null, division: 'W', fund: 'perfect5', kind: 'bonus_payout', amount: -10, note: null, created_at: '' },
])
assert.equal(previewCohort.length, 1)
assert.equal(previewCohort[0].division, 'W')
assert.deepEqual(previewCohort[0].entries.map(entry => entry.player_id), ['preview-w'])
assert.equal(previewCohort[0].balances.perfect5, 5, 'tonight’s posted Perfect 5 is not carryover for the preview or the next finalize')

// Initial 18 score entry ranks the completed 18, including after the cut.
// Check-in order stays put. A blank is unplaced. A typed 0 is a real score.
// Different Final 9 totals change the night result and do not change this grid.
const gridZero = e({ id: 'zero', score_18: 0, made_final: false, created_at: '0' })
const gridHi = e({ id: 'hi', score_18: 50, made_final: true, score_final: 20, created_at: '1' })
const gridB = e({ id: 'b36', score_18: 36, made_final: true, score_final: 10, created_at: '2' })
const gridA = e({ id: 'a36', score_18: 36, made_final: true, score_final: 12, created_at: '3' })
const gridCut = e({ id: 'cut', score_18: 40, made_final: false, created_at: '4' })
const gridBlank = e({ id: 'blank', score_18: null, created_at: '5' })
const gridField = [gridCut, gridA, gridB, gridHi, gridBlank, gridZero]
const grid = eighteenGridRows(gridField, S)
const gridPlace = new Map(grid.map(row => [row.id, row.place]))
assert.deepEqual(grid.map(row => row.id), ['zero', 'hi', 'b36', 'a36', 'cut', 'blank'], '18 grid stays in check-in order')
assert.deepEqual([...gridField].sort(byEntryOrder).map(row => row.id), grid.map(row => row.id), 'row order is check-in order, not score order')
assert.equal(gridPlace.get('a36'), gridPlace.get('b36'), 'tied 36s share a place on the 18 grid after finalists are set')
assert.equal(gridPlace.get('blank'), 0, 'a blank 18 is unplaced')
assert.ok((gridPlace.get('zero') ?? 0) > 0, 'a finished 0 is a real 18')
const nightPlace = new Map(rankFinal(gridField, S).map(row => [row.entry.id, row.place]))
assert.notEqual(nightPlace.get('a36'), nightPlace.get('b36'), 'final ranking still separates 36+12 from 36+10')
assert.equal(gridPlace.get('a36'), gridPlace.get('b36'), 'that Final 9 gap does not change the 18-grid place')
const published = divisionResult({
  division: 'M',
  entries: [gridHi, gridA, gridB],
  payoutPlaces: [],
  settings: S,
  balances: { ...zero },
  barMatch: 0,
  priorRecord: null,
})
const publishedPlace = new Map(published.ranked.map(row => [row.entry.id, row.place]))
assert.notEqual(publishedPlace.get('a36'), publishedPlace.get('b36'), 'public results still follow the Final 9 total')
const same18 = [
  e({ id: 'lead', score_18: 80, made_final: true, score_final: 10, created_at: '1' }),
  e({ id: 'fin', score_18: 36, made_final: true, score_final: null, created_at: '2' }),
  e({ id: 'out', score_18: 36, made_final: false, created_at: '3' }),
]
const same18Grid = new Map(eighteenGridRows(same18, S).map(row => [row.id, row.place]))
const same18Night = new Map(rankFinal(same18, S).map(row => [row.entry.id, row.place]))
assert.equal(same18Grid.get('fin'), same18Grid.get('out'), 'a finalist and a cut player with the same 18 share the 18-grid place')
assert.notEqual(same18Night.get('fin'), same18Night.get('out'), 'night ranking still puts the finalist ahead of the same 18')
const backLow = e({ id: 'back-low', score_18: 36, r2_b1: 10, r2_b2: 0, r1_b1: 10, r1_b2: 16, created_at: '1' })
const backHigh = e({ id: 'back-high', score_18: 36, r2_b1: 20, r2_b2: 0, r1_b1: 10, r1_b2: 6, created_at: '2' })
const sharedCut = eighteenGridRows([backLow, backHigh], S)
assert.equal(sharedCut[0].place, sharedCut[1].place, 'default cut rule still shares an equal 18')
const brokenCut = eighteenGridRows([backLow, backHigh], { ...S, ties: { ...S.ties, cut: 'countback' } })
const brokenPlace = new Map(brokenCut.map(row => [row.id, row.place]))
assert.notEqual(brokenPlace.get('back-high'), brokenPlace.get('back-low'), '18 grid still honors the cut tie setting')
assert.ok((brokenPlace.get('back-high') ?? 99) < (brokenPlace.get('back-low') ?? 0), 'countback still prefers the better back 9')

// Enter saves the way blur does, once. The blur that follows Enter must not save again.
assert.deepEqual(runScoreEdit(null, 100, [{ type: 'focus' }, { type: 'change', raw: '36' }, { type: 'blur' }]), [36], 'blur saves a new score')
assert.deepEqual(runScoreEdit(null, 100, [{ type: 'focus' }, { type: 'change', raw: '36' }, { type: 'enter' }]), [36], 'Enter saves a new score')
assert.deepEqual(runScoreEdit(null, 100, [{ type: 'focus' }, { type: 'change', raw: '36' }, { type: 'enter' }, { type: 'blur' }]), [36], 'Enter then blur saves once')
assert.deepEqual(runScoreEdit(36, 100, [{ type: 'focus' }, { type: 'change', raw: '' }, { type: 'blur' }]), [null], 'blur still clears a score')
assert.deepEqual(runScoreEdit(36, 100, [{ type: 'focus' }, { type: 'change', raw: '' }, { type: 'enter' }, { type: 'blur' }]), [null], 'Enter clears a score once')
assert.deepEqual(runScoreEdit(null, 100, [{ type: 'focus' }, { type: 'change', raw: '' }, { type: 'blur' }]), [], 'a blank that was already blank does not save')
assert.deepEqual(runScoreEdit(null, 100, [{ type: 'focus' }, { type: 'change', raw: '0' }, { type: 'blur' }]), [0], '0 is saved')
assert.deepEqual(runScoreEdit(36, 100, [{ type: 'focus' }, { type: 'change', raw: '36' }, { type: 'enter' }, { type: 'blur' }]), [], 'an unchanged score does not save')
assert.deepEqual(runScoreEdit(10, 100, [{ type: 'focus' }, { type: 'change', raw: 'nope' }, { type: 'blur' }]), [], 'text that is not a score does not save')
assert.deepEqual(runScoreEdit(10, 100, [{ type: 'focus' }, { type: 'change', raw: '150' }, { type: 'blur' }]), [100], 'a score above the max is clamped on save')
assert.deepEqual(runScoreEdit(10, 100, [{ type: 'focus' }, { type: 'change', raw: '-3' }, { type: 'enter' }, { type: 'blur' }]), [0], 'a negative is clamped once')
assert.throws(
  () => applyScoreEdit({ draft: '36', enterAlreadySaved: false }, null, 100, 'blur', () => { throw new Error('save failed') }),
  /save failed/,
  'a save error is not swallowed',
)
const rejectedSave = applyScoreEdit(
  { draft: '36', enterAlreadySaved: false },
  null,
  100,
  'blur',
  () => Promise.reject(new Error('save failed')),
)
await assert.rejects(rejectedSave.pending, /save failed/, 'a failed save promise is not swallowed')
assert.equal(draftAfterScoreSave('36', true), null, 'a saved score leaves the box showing the stored value')
assert.equal(draftAfterScoreSave('36', false), '36', 'a failed save keeps what was typed')
assert.equal(draftAfterScoreSave('', false), '', 'a failed clear keeps the box blank')

// Refresh reads the server again. It does not save, and it does not replace a score
// that is still being typed or still on its way to the server.
const scoreBoard = { server: { ada: null, grace: 10 }, local: { ada: null, grace: 10 } }
const typing = requestRefresh({ ...scoreBoard, draft: { id: 'ada', raw: '36' }, savesInFlight: 0, refreshing: false })
assert.equal(typing.fetch, false, 'a pending score blocks refresh')
assert.equal(typing.board.draft?.raw, '36', 'refresh does not discard the typed score')
assert.deepEqual(typing.board.local, scoreBoard.local, 'refresh does not replace local scores while typing')
assert.match(typing.board.status ?? '', /typing/)
const saving = requestRefresh({ ...scoreBoard, local: { ada: 36, grace: 10 }, draft: null, savesInFlight: 1, refreshing: false })
assert.equal(saving.fetch, false, 'an in-flight save blocks refresh')
assert.equal(saving.board.local.ada, 36, 'a blocked refresh keeps the optimistic score')
assert.match(saving.board.status ?? '', /Saving/)
const started = requestRefresh({ ...scoreBoard, draft: null, savesInFlight: 0, refreshing: false })
assert.equal(started.fetch, true)
assert.match(started.board.status ?? '', /Refreshing/)
const again = requestRefresh(started.board)
assert.equal(again.fetch, false, 'a second refresh waits for the first')
const refreshed = completeRefresh(started.board, { ada: 36, grace: 12 })
assert.deepEqual(refreshed.local, { ada: 36, grace: 12 })
assert.deepEqual(refreshed.server, { ada: 36, grace: 12 })
assert.equal(refreshed.status, 'Scores refreshed.')
assert.doesNotMatch(refreshed.status ?? '', /saved/i, 'refresh does not claim it saved a score')
const failed = completeRefresh(started.board, { error: "Couldn't refresh scores." })
assert.deepEqual(failed.local, scoreBoard.local, 'a failed refresh leaves local scores alone')
assert.equal(failed.draft, null)
assert.equal(failed.status, "Couldn't refresh scores.")
const raced = completeRefresh({ ...started.board, local: { ada: 36, grace: 10 }, savesInFlight: 1 }, { ada: null, grace: 10 })
assert.equal(raced.local.ada, 36, 'a stale reload does not cover an in-flight score')
assert.notEqual(raced.status, 'Scores refreshed.')

// Bar split is whole dollars and still adds up to the capped bar. 30/40 of $150 is $112.50 today.
const cappedSplit = eventMoney({ M: 30, W: 10 }, S)
assert.equal(cappedSplit.barMatch, 150)
assert.equal(cappedSplit.barSplit.M, 113)
assert.equal(cappedSplit.barSplit.W, 37)
assert.equal(cappedSplit.barSplit.M + cappedSplit.barSplit.W, 150)
assert.ok(Number.isInteger(cappedSplit.barSplit.M) && Number.isInteger(cappedSplit.barSplit.W))
const oddCap = eventMoney({ M: 31, W: 9 }, S)
assert.equal(oddCap.barSplit.M, 116)
assert.equal(oddCap.barSplit.W, 34)
assert.equal(oddCap.barSplit.M + oddCap.barSplit.W, oddCap.barMatch)
const noWomen = eventMoney({ M: 8, W: 0 }, S)
assert.equal(noWomen.barSplit.W, 0)
assert.equal(noWomen.barSplit.M, noWomen.barMatch)
assert.ok(Number.isInteger(noWomen.barSplit.M))
const noMen = eventMoney({ M: 0, W: 4 }, S)
assert.equal(noMen.barSplit.M, 0)
assert.equal(noMen.barSplit.W, noMen.barMatch)

// Suggested place checks are $5 steps. What is not divisible by $5 is not forced onto first place.
assert.deepEqual(suggestedPayouts(65, 3), [35, 20, 10], '5-player women’s pool, custom 3 places')
assert.equal(suggestedPayouts(65, 3).reduce((a, b) => a + b, 0), 65)
assert.deepEqual(payoutsForPlaceCount(65, 3), suggestedPayouts(65, 3), 'custom count and Use suggested share one split')
assert.deepEqual(suggestedPayouts(104, 2), [65, 35])
assert.deepEqual(suggestedPayouts(104, 3), [50, 35, 15])
assert.equal(suggestedPayouts(104, 2).reduce((a, b) => a + b, 0), 100)
assert.equal(104 - suggestedPayouts(104, 2).reduce((a, b) => a + b, 0), 4)
assert.deepEqual(suggestedPayouts(78, 3), [40, 25, 10])
assert.deepEqual(suggestedPayouts(117, 2), [75, 40])
assert.deepEqual(suggestedPayouts(4, 1), [0], 'a pool under $5 pays no place check')
assert.deepEqual(suggestedPayouts(4, 2), [0, 0])
assert.ok(suggestedPayouts(117.5, 3).every(n => n % 5 === 0))
assert.ok(suggestedPayouts(117.5, 3).reduce((a, b) => a + b, 0) <= 117.5)

// A $35 tie pays $20 and $15. The earlier player gets the extra $5. Three players share $15, $10, and $10.
const tieA = e({ division: 'W', score_18: 80, created_at: '1', player_id: 'tie-a' })
const tieB = e({ division: 'W', score_18: 80, created_at: '2', player_id: 'tie-b' })
const tieTwo = divisionResult({
  division: 'W', entries: [tieA, tieB], payoutPlaces: [35], settings: S,
  balances: { ...zero }, barMatch: 0, priorRecord: 50, openingNight: false,
})
assert.equal(tieTwo.payouts.get(tieA.id), 20)
assert.equal(tieTwo.payouts.get(tieB.id), 15)
assert.equal([...(tieTwo.payouts.values())].reduce((a, b) => a + b, 0), 35)
assert.equal(tieTwo.points.get(tieA.id), tieTwo.points.get(tieB.id), 'place money steps by $5; points are unchanged')
const tieC = e({ division: 'W', score_18: 80, created_at: '3', player_id: 'tie-c' })
const tieThree = divisionResult({
  division: 'W', entries: [tieA, tieB, tieC], payoutPlaces: [35], settings: S,
  balances: { ...zero }, barMatch: 0, priorRecord: 50, openingNight: false,
})
assert.deepEqual([tieA, tieB, tieC].map(ent => tieThree.payouts.get(ent.id)), [15, 10, 10])
assert.ok([tieA, tieB, tieC].every(ent => (tieThree.payouts.get(ent.id) ?? 0) % 5 === 0))

// The non-$5 remainder goes to that division's Perfect Round pot, not High Score.
const sixWomen = [90, 80, 70, 60, 50, 40].map((score, i) => e({
  division: 'W', score_18: score, created_at: String(i), player_id: `w-rem-${i}`,
}))
const womenSuggested = suggestedPayouts(78, 3)
const womenNight = divisionResult({
  division: 'W', entries: sixWomen, payoutPlaces: womenSuggested, settings: S,
  balances: { ...zero }, barMatch: 30, priorRecord: 40, openingNight: false,
})
const prDeposits = (rows: { fund: string; kind: string; amount: number; note: string | null }[]) =>
  rows.filter(r => r.fund === 'perfect_round' && r.kind === 'transfer' && r.amount > 0 && (r.note ?? '').includes('remainder'))
assert.equal(womenNight.payouts.get(sixWomen[0].id), womenSuggested[0], 'a saved $5 place amount is what is paid')
assert.deepEqual(prDeposits(womenNight.ledger).map(r => r.amount), [3])
assert.ok(womenNight.ledger.some(r => r.fund === 'purse' && r.kind === 'transfer' && r.amount === -3 && (r.note ?? '').includes('remainder')))
assert.ok(!womenNight.ledger.some(r => r.fund === 'high_score' && (r.note ?? '').includes('remainder')))
assert.ok(womenNight.ledger.every(r => r.division === 'W'), 'women’s remainder stays in the women’s pot')
const womenAgain = divisionResult({
  division: 'W', entries: sixWomen, payoutPlaces: womenSuggested, settings: S,
  balances: { ...zero, perfect_round: 20 }, barMatch: 30, priorRecord: 40, openingNight: false,
})
assert.deepEqual(prDeposits(womenAgain.ledger).map(r => r.amount), [3], 'finalizing again with the same prior pot posts one $3, not another')
const replacedPr = balances([
  ...womenAgain.ledger.map((r, i) => ({ ...r, id: `n${i}`, season_id: 's', event_id: 'night', created_at: '', note: r.note })),
  { id: 'prior', season_id: 's', event_id: null, player_id: null, division: 'W' as const, fund: 'perfect_round' as const, kind: 'carryover' as const, amount: 20, note: null, created_at: '' },
], 'W')
assert.equal(replacedPr.perfect_round, 35, 'prior $20 plus 6×$2 entry plus one $3 remainder')

// $104 pool: $100 in checks, $4 into an empty Perfect Round pot.
const thirteen = Array.from({ length: 13 }, (_, i) => e({
  division: 'M', score_18: 100 - i, created_at: String(i), player_id: `m104-${i}`,
}))
const pool104 = divisionResult({
  division: 'M', entries: thirteen, payoutPlaces: suggestedPayouts(104, 2), settings: S,
  balances: { ...zero }, barMatch: 0, priorRecord: 40, openingNight: false,
})
assert.deepEqual(suggestedPayouts(104, 2), [65, 35])
assert.equal([...pool104.payouts.values()].reduce((a, b) => a + b, 0), 100)
assert.deepEqual(prDeposits(pool104.ledger).map(r => r.amount), [4])
assert.ok(!pool104.ledger.some(r => r.fund === 'high_score'))

// Near the cap, the remainder fills Perfect Round and the rest overflows to Backup.
const cappedPlayer = e({ division: 'W', score_18: 90, player_id: 'cap-w', created_at: '1' })
const nearCap = divisionResult({
  division: 'W', entries: [cappedPlayer], payoutPlaces: [10], settings: S,
  balances: { ...zero, perfect_round: 246 }, barMatch: 6, priorRecord: 40, openingNight: false,
})
assert.equal(nearCap.potAfterEntries, 248, '$2 entry fills 246 to 248')
assert.deepEqual(prDeposits(nearCap.ledger).map(r => r.amount), [2], '$2 of the $4 remainder fits under the $250 cap')
assert.ok(nearCap.ledger.some(r => r.fund === 'backup' && r.kind === 'overflow' && r.amount === 2 && (r.note ?? '').includes('remainder')))
const againCap = divisionResult({
  division: 'W', entries: [cappedPlayer], payoutPlaces: [10], settings: S,
  balances: { ...zero, perfect_round: 246 }, barMatch: 6, priorRecord: 40, openingNight: false,
})
assert.deepEqual(prDeposits(againCap.ledger).map(r => r.amount), prDeposits(nearCap.ledger).map(r => r.amount))
assert.equal(
  againCap.ledger.filter(r => r.fund === 'backup' && (r.note ?? '').includes('remainder')).reduce((a, r) => a + r.amount, 0),
  2,
  'replacing the night from the same prior pot does not overflow a second $2',
)
const fullPot = divisionResult({
  division: 'W', entries: [cappedPlayer], payoutPlaces: [10], settings: S,
  balances: { ...zero, perfect_round: 250 }, barMatch: 6, priorRecord: 40, openingNight: false,
})
assert.deepEqual(prDeposits(fullPot.ledger), [])
assert.equal(fullPot.ledger.filter(r => r.fund === 'backup' && (r.note ?? '').includes('remainder')).reduce((a, r) => a + r.amount, 0), 4)
assert.ok(fullPot.ledger.some(r => r.fund === 'backup' && r.kind === 'overflow' && r.amount === 2 && r.note === 'Over the cap'), 'the $2 entry still overflows on its own')

// A tiny pool deposits the whole remainder. Nobody checked in posts nothing.
const tiny = divisionResult({
  division: 'M', entries: [e({ score_18: 40, player_id: 'tiny', created_at: '1' })], payoutPlaces: [5], settings: S,
  balances: { ...zero }, barMatch: 1, priorRecord: 10, openingNight: false,
})
assert.deepEqual([...tiny.payouts.values()], [5])
assert.deepEqual(prDeposits(tiny.ledger).map(r => r.amount), [4], '$8 entry + $1 bar = $9')
const nobody = divisionResult({
  division: 'W', entries: [], payoutPlaces: [], settings: S,
  balances: { ...zero }, barMatch: 0, priorRecord: null, openingNight: true,
})
assert.deepEqual(prDeposits(nobody.ledger), [])
assert.equal(nobody.ledger.filter(r => (r.note ?? '').includes('remainder')).length, 0)

// Opening night still does not pay the High Score bonus. The place remainder goes to Perfect Round.
const opener = e({ division: 'W', awards: ['high_score'], score_18: 88, player_id: 'open-hs', created_at: '1' })
const openingRemainder = divisionResult({
  division: 'W', entries: [opener], payoutPlaces: [5], settings: S,
  balances: { ...zero }, barMatch: 0, priorRecord: null, openingNight: true,
})
assert.equal(openingRemainder.newRecord, 88)
assert.equal(openingRemainder.bonuses.find(b => b.type === 'high_score')?.each, 0)
assert.ok(!openingRemainder.ledger.some(r => r.kind === 'bonus_payout' && r.fund === 'high_score'))
assert.deepEqual(prDeposits(openingRemainder.ledger).map(r => r.amount), [3])
assert.ok(!openingRemainder.ledger.some(r => r.fund === 'high_score'))

// A later High Score win still pays $10. The place remainder does not join that bonus.
const laterField = [99, 80, 70, 60].map((score, i) => e({
  division: 'M', awards: i === 0 ? ['high_score'] : [], score_18: score, player_id: `later-hs-${i}`, created_at: String(i),
}))
const laterRemainder = divisionResult({
  division: 'M', entries: laterField, payoutPlaces: [20], settings: S,
  balances: { ...zero }, barMatch: 0, priorRecord: 80, openingNight: false,
})
assert.equal(laterRemainder.bonuses.find(b => b.type === 'high_score')?.each, 10)
assert.equal(laterRemainder.payouts.get(laterField[0].id), 20)
assert.deepEqual(prDeposits(laterRemainder.ledger).map(r => r.amount), [2])
assert.equal(laterRemainder.ledger.filter(r => r.fund === 'high_score').reduce((a, r) => a + r.amount, 0), 0)

// A hand-typed $5 list is paid as typed. It is not snapped to the suggestion. A non-$5 amount is refused.
const handed = divisionResult({
  division: 'W', entries: sixWomen, payoutPlaces: [40, 25], settings: S,
  balances: { ...zero }, barMatch: 30, priorRecord: 40, openingNight: false,
})
assert.equal(handed.payouts.get(sixWomen[0].id), 40)
assert.equal(handed.payouts.get(sixWomen[1].id), 25)
assert.notDeepEqual([40, 25], suggestedPayouts(78, 2))
assert.deepEqual(prDeposits(handed.ledger).map(r => r.amount), [3])
assert.equal(payoutIssue([32, 20], placeBudget(78)), 'increment')

// Perfect Round and Perfect 5 payouts stay exact. The remainder does not change a Perfect Round win.
const prWinner = e({ division: 'W', awards: ['perfect_round'], score_18: 70, player_id: 'pr-win', created_at: '1' })
const prPaid = divisionResult({
  division: 'W', entries: [prWinner], payoutPlaces: [5], settings: S,
  balances: { ...zero, perfect_round: 100 }, barMatch: 0, priorRecord: 40, openingNight: false,
})
assert.equal(prPaid.bonuses.find(b => b.type === 'perfect_round')?.each, 102, '$100 pot plus her $2, not the $3 place remainder')
assert.deepEqual(prDeposits(prPaid.ledger).map(r => r.amount), [3])

// The Perfect Round deposit is not a night bonus, so a finished night does not subtract it twice.
assert.equal(postedBonusCost([
  { event_id: 'night', division: 'W', fund: 'purse', kind: 'transfer', amount: -5, note: 'Perfect 5 funded from the payout pool' },
  { event_id: 'night', division: 'W', fund: 'purse', kind: 'transfer', amount: -3, note: 'Place payout remainder to the Perfect Round pot' },
], 'night', 'W'), 5)

await import('../src/lib/closeout.test')
await import('../src/lib/closeout-money.test')
await import('../src/lib/closeout-plan.test')
await import('../src/lib/closeout-fixtures.test')
await import('../src/lib/closeout-protocol.test')
await import('../src/lib/closeout-week1.test')
await import('../src/lib/closeout-gaps.test')

console.log('All rules checks passed ✔')

