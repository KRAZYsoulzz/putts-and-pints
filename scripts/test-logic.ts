// Quick sanity checks for the rules engine. Run: npx tsx scripts/test-logic.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_SETTINGS as S } from '../src/lib/settings'
import { bestTotal, byEntryOrder, cents, clampScore, effectiveCut, eighteenGridRows, final9EntryOrder, initialTagAssignment, isOpeningTagNight, qualifiers, rank18, rankFinal, redistributeTags, suggestedCut, totals, displayedFront, displayedBack, computeNineCommit, canConfirmCut, liveNightTotal, tonightBoard, isSeason9Week1, week1AllowsScorePatch, historicalEighteenWrite, week1AllowsEventPatch, week1AllowsCheckin, week1AllowsEntryDelete, week1AllowsFinalize, week1AllowsPlayerDelete, canDeletePlayer, historicalEntryUpdatePayload, canAdvanceToStatus, cutConfirmationReady, applyScoreDirty, applyNineToLatest, mergeNinePatch, seasonHighScoreRecord, entryScore27 } from '../src/lib/scoring'
import { calculatePlayerBests } from '../src/lib/standings'
import { applyScoreEdit, draftAfterScoreSave, runScoreEdit } from '../src/lib/score-edit'
import { completeRefresh, requestRefresh } from '../src/lib/score-refresh'
import { balances, sharedPotBalance, clampPaidPlaces, displayedPerfectRound, displayedSharedPot, divisionResult, effectiveBar, eventLedgerPosted, eventMoney, nightBonusCost, otherDivisionNights, paidPlaceCount, payoutPool, payoutsForPlaceCount, placeBudget, postedBonusCost, splitEvenly, suggestedPaidPlaces, suggestedPayouts, type DivisionNight } from '../src/lib/money'
import { duplicateName, friendlyError, parseMoney, parseTag, payoutIssue, payoutRejectMessage, tagTakenTonight } from '../src/lib/validation'
import { buyingTagAfter, checkinTagIn, freshBuyingTag, newPlayerInsert } from '../src/lib/newPlayer'
import type { Entry, LedgerRow, PPEvent, Player, Settings } from '../src/lib/types'

let n = 0
const e = (p: Partial<Entry>): Entry => ({
  id: `e${++n}`, event_id: 'ev', player_id: `p${n}`, division: 'M', paid: true,
  tag_in: null, tag_out: null, r1_b1: null, r1_b2: null, r2_b1: null, r2_b2: null,
  f_b1: null, f_b2: null, score_18: null, score_final: null, awards: [],
  made_final: false, tiebreak: null, place: null, payout: 0, points: 0,
  score_front: null, score_back: null, ...p,
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

// Director Final 9 scoring list order:
// Finalists by initial-18 rank place ascending, ties in check-in order,
// place 0 finalists after those, then non-finalists in check-in order.
const blankFin = e({ id: 'blank-fin', created_at: '2026-11-08T00:00:00.000Z', score_18: null, made_final: true, score_final: null })
const earlyCut = e({ id: 'early-cut', created_at: '2026-11-08T00:30:00.000Z', score_18: 80, made_final: false, score_final: null })
const tieEarly = e({ id: 'tie-early', created_at: '2026-11-08T01:00:00.000Z', score_18: 40, made_final: true, score_final: null })
const tieLate = e({ id: 'tie-late', created_at: '2026-11-08T02:00:00.000Z', score_18: 40, made_final: true, score_final: 30 })
const leader = e({ id: 'leader', created_at: '2026-11-08T03:00:00.000Z', score_18: 55, made_final: true, score_final: null })
const lateCut = e({ id: 'late-cut', created_at: '2026-11-08T04:00:00.000Z', score_18: 10, made_final: false, score_final: null })
const zero18 = e({ id: 'zero-18', created_at: '2026-11-08T05:00:00.000Z', score_18: 0, made_final: true, score_final: null })
const f9Field = [blankFin, earlyCut, tieEarly, tieLate, leader, lateCut, zero18]

const f9R18 = new Map(rank18(f9Field, S).map(r => [r.entry.id, r.place]))
assert.equal(f9R18.get('early-cut'), 1)
assert.equal(f9R18.get('leader'), 2)
assert.equal(f9R18.get('tie-early'), 3)
assert.equal(f9R18.get('tie-late'), 3)
assert.equal(f9R18.get('late-cut'), 5)
assert.equal(f9R18.get('zero-18'), 6)
assert.equal(f9R18.get('blank-fin'), 0)

assert.deepEqual(
  eighteenGridRows(f9Field, S).map(row => row.id),
  ['blank-fin', 'early-cut', 'tie-early', 'tie-late', 'leader', 'late-cut', 'zero-18'],
  'eighteenGridRows on the same field is still check-in order',
)

const f9FieldCopy = [...f9Field]
const f9Ordered = final9EntryOrder(f9FieldCopy, S)
assert.deepEqual(f9FieldCopy.map(x => x.id), f9Field.map(x => x.id), 'original array order is unchanged after calling final9EntryOrder')
assert.deepEqual(
  f9Ordered.map(x => x.id),
  ['leader', 'tie-early', 'tie-late', 'zero-18', 'blank-fin', 'early-cut', 'late-cut'],
  'finalists by initial-18 place, blank finalists next, non-finalists in check-in order',
)

leader.score_final = 0
tieLate.score_final = 50
const f9RfPlaces = new Map(rankFinal(f9Field, S).map(r => [r.entry.id, r.place]))
assert.notEqual(f9RfPlaces.get('leader'), f9RfPlaces.get('tie-late'), 'rankFinal places differ after score_final changes')
assert.ok((f9RfPlaces.get('leader') ?? 0) > 0, 'a typed Final 9 of 0 is real for rankFinal')
assert.deepEqual(
  final9EntryOrder(f9Field, S).map(x => x.id),
  ['leader', 'tie-early', 'tie-late', 'zero-18', 'blank-fin', 'early-cut', 'late-cut'],
  'score_final changes do not move final9EntryOrder',
)

const mb = e({ id: 'm-b', created_at: '2026-11-08T06:00:00.000Z', score_18: 36, made_final: true })
const ma = e({ id: 'm-a', created_at: '2026-11-08T06:00:00.000Z', score_18: 36, made_final: true })
assert.deepEqual(
  final9EntryOrder([mb, ma], S).map(x => x.id),
  ['m-a', 'm-b'],
  'equal created_at finalist tie broken by id localeCompare',
)

const backLowFin = e({ id: 'back-low', score_18: 36, r2_b1: 10, r2_b2: 0, r1_b1: 10, r1_b2: 16, created_at: '2026-11-08T07:00:00.000Z', made_final: true })
const backHighFin = e({ id: 'back-high', score_18: 36, r2_b1: 20, r2_b2: 0, r1_b1: 10, r1_b2: 6, created_at: '2026-11-08T08:00:00.000Z', made_final: true })
assert.deepEqual(
  final9EntryOrder([backHighFin, backLowFin], S).map(x => x.id),
  ['back-low', 'back-high'],
  'default cut include keeps earlier check-in first despite worse back 9',
)
const cutCbSettings = { ...S, ties: { ...S.ties, cut: 'countback' as const } }
const cbPlaces = new Map(rank18([backLowFin, backHighFin], cutCbSettings).map(r => [r.entry.id, r.place]))
assert.notEqual(cbPlaces.get('back-high'), cbPlaces.get('back-low'), 'countback cut assigns different rank18 places')
assert.deepEqual(
  final9EntryOrder([backLowFin, backHighFin], cutCbSettings).map(x => x.id),
  ['back-high', 'back-low'],
  'countback cut ranks better back 9 first in final9EntryOrder even if checked in later',
)

const blankCut = e({ id: 'blank-cut', created_at: '2026-11-07T23:50:00.000Z', score_18: null, made_final: false })
assert.deepEqual(
  final9EntryOrder([blankCut, blankFin, leader, lateCut], S).map(x => x.id),
  ['leader', 'blank-fin', 'blank-cut', 'late-cut'],
  'non-finalist with null score_18 stays in non-finalist check-in group, not with blank finalist',
)

const cutPlayoffSettings = { ...S, ties: { ...S.ties, cut: 'playoff' as const } }
const playEarly = e({ id: 'play-early', score_18: 36, tiebreak: 2, created_at: '2026-11-08T09:00:00.000Z', made_final: true })
const playLate = e({ id: 'play-late', score_18: 36, tiebreak: 1, created_at: '2026-11-08T10:00:00.000Z', made_final: true })
assert.deepEqual(
  final9EntryOrder([playEarly, playLate], cutPlayoffSettings).map(x => x.id),
  ['play-late', 'play-early'],
  'playoff cut lists later check-in with lower tiebreak first',
)

const playSameB = e({ id: 'play-same-b', score_18: 36, tiebreak: 1, created_at: '2026-11-08T11:00:00.000Z', made_final: true })
const playSameA = e({ id: 'play-same-a', score_18: 36, tiebreak: 1, created_at: '2026-11-08T11:00:00.000Z', made_final: true })
assert.deepEqual(
  final9EntryOrder([playSameB, playSameA], cutPlayoffSettings).map(x => x.id),
  ['play-same-a', 'play-same-b'],
  'equal tiebreak numbers keep id localeCompare order',
)

const playNullEarly = e({ id: 'play-null-early', score_18: 36, tiebreak: null, created_at: '2026-11-08T12:00:00.000Z', made_final: true })
const playNullLate = e({ id: 'play-null-late', score_18: 36, tiebreak: null, created_at: '2026-11-08T13:00:00.000Z', made_final: true })
assert.deepEqual(
  final9EntryOrder([playNullLate, playNullEarly], cutPlayoffSettings).map(x => x.id),
  ['play-null-early', 'play-null-late'],
  'null tiebreaks keep check-in order even when cut is playoff',
)

// Front 9 / Back 9. Completed 18 is both new nines, or a legacy score_18
// with both new columns empty. A partial nine must not become a basket 18.
const partialBaskets = e({
  score_front: 40,
  score_back: null,
  score_18: null,
  r1_b1: 20,
  r1_b2: 10,
  r2_b1: 20,
  r2_b2: 10,
})
assert.equal(totals(partialBaskets).t18, null, 'partial front must not fall back to basket sum')
assert.equal(totals(partialBaskets).r1, 30)
assert.equal(totals(partialBaskets).r2, 30)

const bothNines = e({ score_front: 40, score_back: 30, score_18: null })
assert.equal(totals(bothNines).t18, 70, 'both nines complete the 18')
assert.equal(totals(bothNines).total, 70)

const frontOnly = e({ score_front: 50, score_back: null, score_18: null })
assert.equal(totals(frontOnly).t18, null, 'front only is not a completed 18')

const legacy77 = e({ score_18: 77, score_front: null, score_back: null })
assert.equal(totals(legacy77).t18, 77, 'legacy score_18 stays the completed 18')
assert.equal(totals(e({ score_18: 90, score_front: null, score_back: null, r1_b1: 1, r1_b2: 1, r2_b1: 1, r2_b2: 1 })).t18, 90)

const tied36a = e({ id: 'n36-a', created_at: '2026-11-08T14:00:00.000Z', score_front: 20, score_back: 16, score_18: 36 })
const tied36b = e({ id: 'n36-b', created_at: '2026-11-08T15:00:00.000Z', score_front: 10, score_back: 26, score_18: 36 })
const tied36c = e({ id: 'n36-c', created_at: '2026-11-08T16:00:00.000Z', score_18: 36, score_front: null, score_back: null })
const front50 = e({ id: 'front-50', created_at: '2026-11-08T13:00:00.000Z', score_front: 50, score_back: null, score_18: null })
const nineField = [front50, tied36c, tied36a, tied36b]
const ninePlaces = new Map(rank18(nineField, S).map(r => [r.entry.id, r.place]))
assert.equal(ninePlaces.get('front-50'), 0, 'front-only is unplaced')
assert.equal(ninePlaces.get('n36-a'), 1)
assert.equal(ninePlaces.get('n36-b'), 1)
assert.equal(ninePlaces.get('n36-c'), 1)
assert.equal(qualifiers([tied36a, tied36b], 1, S).size, 2, 'cut include keeps both players tied at the line')

const week1 = e({
  id: 'week1-row',
  event_id: '81298495-f87c-4d7c-a344-89b97e587d9b',
  score_18: 77,
  score_front: null,
  score_back: null,
})
const migrated = { ...week1 }
assert.equal(migrated.score_front, null, 'migrate step must not invent a front')
assert.equal(migrated.score_back, null, 'migrate step must not invent a back')
assert.equal(totals(migrated).t18, 77)

assert.equal(displayedFront(legacy77), null, 'legacy score_18 does not invent a front')
assert.equal(displayedBack(legacy77), null, 'legacy score_18 does not invent a back')
assert.equal(displayedFront(partialBaskets), 40)
assert.equal(displayedBack(partialBaskets), null, 'partial back stays blank instead of a basket nine')
const basketsOnly = e({ r1_b1: 20, r1_b2: 10, r2_b1: 15, r2_b2: 10, score_18: null, score_front: null, score_back: null })
assert.equal(displayedFront(basketsOnly), 30)
assert.equal(displayedBack(basketsOnly), 25)
assert.equal(displayedFront(e({ score_18: 90, score_front: null, score_back: null, r1_b1: 1, r1_b2: 1, r2_b1: 1, r2_b2: 1 })), null)

assert.deepEqual(
  computeNineCommit(e({ score_front: 40, score_back: 30, score_18: 70 }), 'back', null),
  { score_back: null, score_18: null },
)
assert.deepEqual(
  computeNineCommit(e({ score_front: 40, score_back: null, score_18: 77 }), 'front', null),
  { score_front: null, score_18: null },
)
assert.deepEqual(
  computeNineCommit(e({ score_front: null, score_back: null, score_18: 77 }), 'front', 40),
  { score_front: 40, score_18: null },
)
assert.deepEqual(
  computeNineCommit(e({ score_front: 40, score_back: null, score_18: 77 }), 'back', 30),
  { score_back: 30, score_18: 70 },
)
const cleared = {
  ...e({ score_front: 40, score_back: 30, score_18: 70 }),
  ...computeNineCommit(e({ score_front: 40, score_back: 30, score_18: 70 }), 'back', null),
}
assert.equal(totals(cleared).t18, null, 'clearing a derived nine drops the stale 18')

assert.equal(liveNightTotal(e({ score_18: 36, made_final: true, score_final: null, score_front: null, score_back: null })), null)
assert.equal(liveNightTotal(e({ score_18: 36, made_final: true, score_final: 0, score_front: null, score_back: null })), 36)
assert.equal(liveNightTotal(e({ score_18: 36, made_final: true, score_final: 12, score_front: null, score_back: null })), 48)
assert.equal(canConfirmCut([]), true)
assert.equal(canConfirmCut([frontOnly]), false)
assert.equal(canConfirmCut([bothNines]), true)

const boardScoring = tonightBoard(nineField, S, 'scoring')
assert.equal(boardScoring.provisional, true)
assert.deepEqual(boardScoring.completed.map(row => row.id), ['n36-a', 'n36-b', 'n36-c'])
assert.deepEqual(boardScoring.partial.map(row => row.id), ['front-50'])
assert.equal(boardScoring.partial[0].place, null)
assert.equal(boardScoring.partial[0].front, 50)
assert.equal(boardScoring.partial[0].back, null)
assert.equal(boardScoring.partial[0].t18, null)
assert.equal(boardScoring.completed[0].id === 'front-50', false)
assert.equal(boardScoring.cutAfterId, 'n36-c')

const finA = e({ id: 'fin-a', created_at: '2026-11-08T21:00:00.000Z', score_18: 36, score_front: null, score_back: null, made_final: true, score_final: null })
const finB = e({ id: 'fin-b', created_at: '2026-11-08T22:00:00.000Z', score_18: 40, score_front: null, score_back: null, made_final: true, score_final: null })
assert.deepEqual(tonightBoard([finA, finB], S, 'final9').completed.map(row => row.id), ['fin-b', 'fin-a'])
assert.equal(tonightBoard([finA, finB], S, 'final9').completed.find(row => row.id === 'fin-a')?.night, null)
finA.score_final = 12
assert.deepEqual(tonightBoard([finA, finB], S, 'final9').completed.map(row => row.id), ['fin-a', 'fin-b'])
assert.equal(tonightBoard([finA, finB], S, 'final9').completed.find(row => row.id === 'fin-a')?.night, 48)
finB.score_final = 0
const afterZero = tonightBoard([finA, finB], S, 'final9')
assert.equal(afterZero.provisional, false)
assert.equal(afterZero.completed.find(row => row.id === 'fin-b')?.finalNine, 0)
assert.equal(afterZero.completed.find(row => row.id === 'fin-b')?.night, 40)
assert.deepEqual(afterZero.completed.map(row => row.id), ['fin-a', 'fin-b'])

// 27-player Men's division (13 finalists, 14 non-finalists) + 7-player Women's division (3 finalists, 4 non-finalists)
// Reproduces bug where J Ferguson (Night Total 58) and Dirk Tailford (Night Total 57) had lower 18 totals
// and appeared below finalists with lower Night Totals after Final 9.
const men27: Entry[] = [
  // Two finalists tied at 65
  e({ id: 'm-top-a', division: 'M', created_at: '2026-11-08T18:01:00.000Z', score_front: 22, score_back: 21, score_18: 43, made_final: true, score_final: 22 }), // 65
  e({ id: 'm-top-b', division: 'M', created_at: '2026-11-08T18:02:00.000Z', score_front: 21, score_back: 21, score_18: 42, made_final: true, score_final: 23 }), // 65
  // Other finalists with higher 18-hole scores (35..41) but lower Final 9 scores -> Night Totals 48..60
  e({ id: 'm-fin-60', division: 'M', created_at: '2026-11-08T18:03:00.000Z', score_front: 21, score_back: 20, score_18: 41, made_final: true, score_final: 19 }), // 60
  e({ id: 'm-fin-56', division: 'M', created_at: '2026-11-08T18:04:00.000Z', score_front: 20, score_back: 20, score_18: 40, made_final: true, score_final: 16 }), // 56
  e({ id: 'm-fin-55', division: 'M', created_at: '2026-11-08T18:05:00.000Z', score_front: 20, score_back: 19, score_18: 39, made_final: true, score_final: 16 }), // 55
  e({ id: 'm-fin-54', division: 'M', created_at: '2026-11-08T18:06:00.000Z', score_front: 19, score_back: 19, score_18: 38, made_final: true, score_final: 16 }), // 54
  e({ id: 'm-fin-53', division: 'M', created_at: '2026-11-08T18:07:00.000Z', score_front: 19, score_back: 18, score_18: 37, made_final: true, score_final: 16 }), // 53
  e({ id: 'm-fin-52', division: 'M', created_at: '2026-11-08T18:08:00.000Z', score_front: 18, score_back: 18, score_18: 36, made_final: true, score_final: 16 }), // 52
  e({ id: 'm-fin-51', division: 'M', created_at: '2026-11-08T18:09:00.000Z', score_front: 18, score_back: 18, score_18: 36, made_final: true, score_final: 15 }), // 51
  e({ id: 'm-fin-50', division: 'M', created_at: '2026-11-08T18:10:00.000Z', score_front: 18, score_back: 17, score_18: 35, made_final: true, score_final: 15 }), // 50
  e({ id: 'm-fin-48', division: 'M', created_at: '2026-11-08T18:11:00.000Z', score_front: 18, score_back: 17, score_18: 35, made_final: true, score_final: 13 }), // 48
  // J Ferguson (18 total 34, Final 9 24 -> Night Total 58) and Dirk Tailford (18 total 33, Final 9 24 -> Night Total 57)
  e({ id: 'j-ferguson', division: 'M', created_at: '2026-11-08T18:12:00.000Z', score_front: 17, score_back: 17, score_18: 34, made_final: true, score_final: 24 }), // 58
  e({ id: 'dirk-tailford', division: 'M', created_at: '2026-11-08T18:13:00.000Z', score_front: 17, score_back: 16, score_18: 33, made_final: true, score_final: 24 }), // 57
  // 14 non-finalists (18 totals 19..32, given in non-sorted order)
  e({ id: 'm-cut-25', division: 'M', created_at: '2026-11-08T18:14:00.000Z', score_front: 13, score_back: 12, score_18: 25, made_final: false }),
  e({ id: 'm-cut-32', division: 'M', created_at: '2026-11-08T18:15:00.000Z', score_front: 16, score_back: 16, score_18: 32, made_final: false }),
  e({ id: 'm-cut-19', division: 'M', created_at: '2026-11-08T18:16:00.000Z', score_front: 10, score_back: 9, score_18: 19, made_final: false }),
  e({ id: 'm-cut-31', division: 'M', created_at: '2026-11-08T18:17:00.000Z', score_front: 16, score_back: 15, score_18: 31, made_final: false }),
  e({ id: 'm-cut-28', division: 'M', created_at: '2026-11-08T18:18:00.000Z', score_front: 14, score_back: 14, score_18: 28, made_final: false }),
  e({ id: 'm-cut-30', division: 'M', created_at: '2026-11-08T18:19:00.000Z', score_front: 15, score_back: 15, score_18: 30, made_final: false }),
  e({ id: 'm-cut-22', division: 'M', created_at: '2026-11-08T18:20:00.000Z', score_front: 11, score_back: 11, score_18: 22, made_final: false }),
  e({ id: 'm-cut-29', division: 'M', created_at: '2026-11-08T18:21:00.000Z', score_front: 15, score_back: 14, score_18: 29, made_final: false }),
  e({ id: 'm-cut-27', division: 'M', created_at: '2026-11-08T18:22:00.000Z', score_front: 14, score_back: 13, score_18: 27, made_final: false }),
  e({ id: 'm-cut-24', division: 'M', created_at: '2026-11-08T18:23:00.000Z', score_front: 12, score_back: 12, score_18: 24, made_final: false }),
  e({ id: 'm-cut-26', division: 'M', created_at: '2026-11-08T18:24:00.000Z', score_front: 13, score_back: 13, score_18: 26, made_final: false }),
  e({ id: 'm-cut-21', division: 'M', created_at: '2026-11-08T18:25:00.000Z', score_front: 11, score_back: 10, score_18: 21, made_final: false }),
  e({ id: 'm-cut-23', division: 'M', created_at: '2026-11-08T18:26:00.000Z', score_front: 12, score_back: 11, score_18: 23, made_final: false }),
  e({ id: 'm-cut-20', division: 'M', created_at: '2026-11-08T18:27:00.000Z', score_front: 10, score_back: 10, score_18: 20, made_final: false }),
]
for (const statusAfterF9 of ['final9', 'results'] as const) {
  const menBoard = tonightBoard(men27, S, statusAfterF9, 13)
  assert.equal(menBoard.completed.length, 27)
  assert.equal(menBoard.provisional, false)
  const menFinalRows = menBoard.completed.slice(0, 13)
  const menNonFinalRows = menBoard.completed.slice(13)
  assert.deepEqual(
    menFinalRows.map(r => r.id),
    [
      'm-top-a',
      'm-top-b',
      'm-fin-60',
      'j-ferguson',
      'dirk-tailford',
      'm-fin-56',
      'm-fin-55',
      'm-fin-54',
      'm-fin-53',
      'm-fin-52',
      'm-fin-51',
      'm-fin-50',
      'm-fin-48',
    ],
    `27-player Men's finalists sorted by Night Total desc in ${statusAfterF9}`,
  )
  assert.deepEqual(
    menFinalRows.map(r => r.place),
    [1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    'two finalists tied at 65 share 1st, followed by 3rd..13th by Night Total',
  )
  // Verify countback tiebreak mode shows 1st/2nd for the two tied at 65
  const menBoardCb = tonightBoard(men27, { ...S, ties: { ...S.ties, placement: 'countback' } }, statusAfterF9, 13)
  assert.deepEqual(menBoardCb.completed.slice(0, 2).map(r => r.id), ['m-top-b', 'm-top-a'])
  assert.deepEqual(menBoardCb.completed.slice(0, 2).map(r => r.place), [1, 2])
  assert.equal(menBoard.cutAfterId, 'm-fin-48', 'cut line placed immediately after the 13th finalist')
  assert.deepEqual(
    menNonFinalRows.map(r => r.id),
    [
      'm-cut-32',
      'm-cut-31',
      'm-cut-30',
      'm-cut-29',
      'm-cut-28',
      'm-cut-27',
      'm-cut-26',
      'm-cut-25',
      'm-cut-24',
      'm-cut-23',
      'm-cut-22',
      'm-cut-21',
      'm-cut-20',
      'm-cut-19',
    ],
    `non-finalists sorted by 18 total desc after the cut line in ${statusAfterF9}`,
  )
  assert.deepEqual(
    menNonFinalRows.map(r => r.place),
    [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
  )
}

const women7: Entry[] = [
  e({ id: 'w-fin-3', division: 'W', created_at: '2026-11-08T18:30:00.000Z', score_front: 16, score_back: 16, score_18: 32, made_final: true, score_final: 20 }), // 52
  e({ id: 'w-fin-1', division: 'W', created_at: '2026-11-08T18:31:00.000Z', score_front: 18, score_back: 18, score_18: 36, made_final: true, score_final: 19 }), // 55
  e({ id: 'w-fin-2', division: 'W', created_at: '2026-11-08T18:32:00.000Z', score_front: 17, score_back: 17, score_18: 34, made_final: true, score_final: 20 }), // 54
  e({ id: 'w-cut-4', division: 'W', created_at: '2026-11-08T18:33:00.000Z', score_front: 12, score_back: 12, score_18: 24, made_final: false }),
  e({ id: 'w-cut-1', division: 'W', created_at: '2026-11-08T18:34:00.000Z', score_front: 15, score_back: 15, score_18: 30, made_final: false }),
  e({ id: 'w-cut-3', division: 'W', created_at: '2026-11-08T18:35:00.000Z', score_front: 13, score_back: 13, score_18: 26, made_final: false }),
  e({ id: 'w-cut-2', division: 'W', created_at: '2026-11-08T18:36:00.000Z', score_front: 14, score_back: 14, score_18: 28, made_final: false }),
]
const womenBoard = tonightBoard(women7, S, 'final9', 3)
assert.deepEqual(
  womenBoard.completed.map(r => r.id),
  ['w-fin-1', 'w-fin-2', 'w-fin-3', 'w-cut-1', 'w-cut-2', 'w-cut-3', 'w-cut-4'],
)
assert.equal(womenBoard.cutAfterId, 'w-fin-3')

const cutHi = e({ id: 'cut-hi', created_at: '2026-11-08T17:00:00.000Z', score_18: 50, score_front: null, score_back: null })
const cutMid = e({ id: 'cut-mid', created_at: '2026-11-08T18:00:00.000Z', score_18: 40, score_front: null, score_back: null })
const cutLow = e({ id: 'cut-low', created_at: '2026-11-08T19:00:00.000Z', score_18: 30, score_front: null, score_back: null })
const cutTail = e({ id: 'cut-tail', created_at: '2026-11-08T20:00:00.000Z', score_18: 20, score_front: null, score_back: null })
const savedCutField = [cutTail, cutHi, cutLow, cutMid]
assert.equal(tonightBoard(savedCutField, S, 'scoring', 1).cutAfterId, 'cut-hi', 'saved cut 1 keeps only the lead, not the half-field line')
assert.equal(tonightBoard(savedCutField, S, 'scoring', 1).provisional, true)
assert.equal(tonightBoard(savedCutField, S, 'scoring').cutAfterId, 'cut-mid', 'missing saved cut still uses the half-field default')
assert.equal(tonightBoard(savedCutField, S, 'scoring', 0).cutAfterId, 'cut-mid', 'stored 0 is unset and uses the half-field default')
assert.equal(tonightBoard(savedCutField, S, 'scoring', 3).cutAfterId, 'cut-low')
const cutUp = { ...S, cutRounding: 'up' as const }
assert.equal(tonightBoard([cutHi, cutMid, cutLow], S, 'scoring').cutAfterId, 'cut-hi', 'round-down half of 3 is 1')
assert.equal(tonightBoard([cutHi, cutMid, cutLow], cutUp, 'scoring').cutAfterId, 'cut-mid', 'round-up half of 3 is 2')
const lineTieA = e({ id: 'line-a', created_at: '2026-11-08T18:10:00.000Z', score_18: 40, score_front: null, score_back: null })
const lineTieB = e({ id: 'line-b', created_at: '2026-11-08T18:20:00.000Z', score_18: 40, score_front: null, score_back: null })
const tieLead = e({ id: 'line-lead', created_at: '2026-11-08T18:00:00.000Z', score_18: 55, score_front: null, score_back: null })
assert.equal(tonightBoard([lineTieB, tieLead, lineTieA], S, 'scoring', 2).cutAfterId, 'line-b', 'cut 2 includes both players tied on place 2')
const cutPartial = e({ id: 'cut-partial', created_at: '2026-11-08T16:30:00.000Z', score_front: 50, score_back: null, score_18: null })
const incompleteCut = tonightBoard([cutPartial, cutHi, cutMid], S, 'scoring', 1)
assert.deepEqual(incompleteCut.partial.map(row => row.id), ['cut-partial'])
assert.equal(incompleteCut.cutAfterId, 'cut-hi', 'a front-only row is outside the cut')
assert.equal(incompleteCut.provisional, true)
cutHi.made_final = true
const confirmedCustom = tonightBoard([cutHi, cutMid, cutLow, cutTail], S, 'final9', 4)
assert.equal(confirmedCustom.provisional, false)
assert.equal(confirmedCustom.cutAfterId, 'cut-hi', 'a confirmed cut follows made_final, not the numeric cut')

const season9 = '81298495-f87c-4d7c-a344-89b97e587d9b'
const week1Event = { season_id: season9, event_date: '2026-11-05', name: 'Week 1' }
assert.equal(isSeason9Week1(week1Event), true)
assert.equal(isSeason9Week1({ season_id: season9, event_date: '2026-11-19', name: 'Week 2' }), false)
assert.equal(isSeason9Week1({ season_id: season9, event_date: '2026-11-05', name: 'Black Friday Dubs' }), false)
assert.equal(isSeason9Week1({ season_id: 'other-season', event_date: '2026-11-05', name: 'Week 1' }), false)
assert.equal(week1AllowsScorePatch(week1Event, { score_front: 40 }), false)
assert.equal(week1AllowsScorePatch(week1Event, { score_back: null }), false)
assert.equal(week1AllowsScorePatch(week1Event, { score_18: 70 }), false)
assert.equal(week1AllowsScorePatch(week1Event, { score_final: 0 }), false)
assert.equal(week1AllowsScorePatch(week1Event, { made_final: true }), false)

const cbNine = { ...S, ties: { ...S.ties, cut: 'countback' as const } }
const nineA = e({ id: 'nine-a', created_at: '2026-11-08T01:00:00.000Z', score_front: 40, score_back: 30, score_18: 70 })
const nineB = e({ id: 'nine-b', created_at: '2026-11-08T02:00:00.000Z', score_front: 30, score_back: 40, score_18: 70 })
const countbackNinePlaces = new Map(rank18([nineA, nineB], cbNine).map(r => [r.entry.id, r.place]))
assert.equal(countbackNinePlaces.get('nine-b'), 1, 'countback second nine uses the new back nine')
assert.equal(countbackNinePlaces.get('nine-a'), 2)
const basketA = e({ id: 'bask-a', created_at: '2026-11-08T03:00:00.000Z', score_18: 36, score_front: null, score_back: null, r2_b1: 10, r2_b2: 0, r1_b1: 10, r1_b2: 16 })
const basketB = e({ id: 'bask-b', created_at: '2026-11-08T04:00:00.000Z', score_18: 36, score_front: null, score_back: null, r2_b1: 20, r2_b2: 0, r1_b1: 10, r1_b2: 6 })
const baskPlaces = new Map(rank18([basketA, basketB], cbNine).map(r => [r.entry.id, r.place]))
assert.equal(baskPlaces.get('bask-b'), 1, 'basket second nine still breaks a totals tie')
assert.equal(baskPlaces.get('bask-a'), 2)

const leaderCut = e({ id: 'leader-cut', created_at: '2026-11-08T05:00:00.000Z', score_18: 50, score_front: null, score_back: null, made_final: false })
const lowerFin = e({ id: 'lower-fin', created_at: '2026-11-08T06:00:00.000Z', score_18: 40, score_front: null, score_back: null, made_final: true })
const mixedCut = tonightBoard([leaderCut, lowerFin], S, 'final9', 1)
assert.deepEqual(mixedCut.completed.map(r => r.id), ['lower-fin', 'leader-cut'], 'confirmed finalists stay together even if a higher score was cut')
assert.equal(mixedCut.cutAfterId, 'lower-fin')
const tieFinEarly = e({ id: 'tie-fin-a', created_at: '2026-11-08T07:00:00.000Z', score_18: 36, score_front: null, score_back: null, made_final: true })
const tieOut = e({ id: 'tie-out', created_at: '2026-11-08T08:00:00.000Z', score_18: 36, score_front: null, score_back: null, made_final: false })
const tieFinLate = e({ id: 'tie-fin-b', created_at: '2026-11-08T09:00:00.000Z', score_18: 36, score_front: null, score_back: null, made_final: true })
const tiedFlags = tonightBoard([tieOut, tieFinLate, tieFinEarly], S, 'final9', 2)
assert.deepEqual(tiedFlags.completed.map(r => r.id), ['tie-fin-a', 'tie-fin-b', 'tie-out'])
assert.equal(tiedFlags.cutAfterId, 'tie-fin-b')

const conflicted = e({ id: 'conflicted', score_front: 41, score_back: 32, score_18: 72 })
const clearConflictFront = computeNineCommit(conflicted, 'front', null)
assert.equal(clearConflictFront.score_18, null, 'a mismatched derived 18 is cleared when a nine is removed')
const afterConflictFront = { ...conflicted, ...clearConflictFront }
const clearConflictBack = computeNineCommit(afterConflictFront, 'back', null)
assert.equal(totals({ ...afterConflictFront, ...clearConflictBack }).t18, null, 'clearing both nines must not revive a stale 18')

assert.equal(week1AllowsScorePatch(week1Event, { paid: false }), false)
assert.equal(week1AllowsScorePatch(week1Event, { payout: 10, points: 8, place: 1 }), false)
assert.equal(week1AllowsScorePatch({ season_id: season9, event_date: '2026-11-19', name: 'Week 2' }, { score_front: 40 }), true)
assert.equal(week1AllowsScorePatch(week1Event, { awards: [] }), false)
assert.equal(week1AllowsScorePatch(week1Event, { tag_in: 4 }), false)
assert.equal(week1AllowsScorePatch(week1Event, { tag_out: 4 }), false)
assert.equal(week1AllowsScorePatch(week1Event, { points: 2 }), false)
assert.equal(week1AllowsScorePatch({ season_id: season9, event_date: '2026-11-19', name: 'Week 2' }, { paid: false, payout: 10, place: 1, points: 2, awards: [], tag_in: 4 }), true)

const derivedEighteen = e({ score_front: 40, score_back: 30, score_18: 70 })
assert.deepEqual(historicalEighteenWrite(derivedEighteen, 99), { omit: true })
const legacyEighteen = e({ score_18: 77, score_front: null, score_back: null })
assert.deepEqual(historicalEighteenWrite(legacyEighteen, 80), { omit: false, score_18: 80 })
const oneNine = e({ score_front: 40, score_back: null, score_18: null })
assert.deepEqual(historicalEighteenWrite(oneNine, 40), { omit: true })

assert.equal(week1AllowsEventPatch(week1Event, { status: 'results' }), false)
assert.equal(week1AllowsCheckin(week1Event), false)
assert.equal(week1AllowsEntryDelete(week1Event), false)
assert.equal(week1AllowsFinalize(week1Event), false)
assert.equal(week1AllowsEventPatch({ season_id: season9, event_date: '2026-11-19', name: 'Week 2' }, { status: 'scoring' }), true)
assert.equal(isSeason9Week1({ season_id: season9, event_date: '2026-11-05' }), true, 'Week 1 identified by season and date even when name is omitted')
assert.equal(isSeason9Week1({ season_id: season9, event_date: '2026-11-05', name: null }), true)
assert.equal(historicalEntryUpdatePayload(week1Event, legacyEighteen, {
  made_final: true,
  place: 1,
  payout: 20,
  points: 10,
  awards: ['high_score'],
  tag_in: 1,
  tag_out: 1,
  score_18: 80,
  score_final: 25,
}), null, 'Players historical save must not write to Week 1')
const week2Historical = historicalEntryUpdatePayload(
  { season_id: season9, event_date: '2026-11-19', name: 'Week 2' },
  derivedEighteen,
  {
    made_final: true,
    place: 2,
    payout: 15,
    points: 6,
    awards: ['perfect4'],
    tag_in: 3,
    tag_out: 2,
    score_18: 99,
    score_final: 22,
  },
)
assert.equal(week2Historical != null && !('score_18' in week2Historical), true, 'derived 18 is omitted on historical save')

// Item 2: Delete Player must not bulk-delete a player's historical entries. Block when player has posted/recorded nights.
assert.equal(week1AllowsPlayerDelete([{ event_id: 'w1' }], [{ id: 'w1', season_id: season9, event_date: '2026-11-05', name: 'Week 1' }]), false)
assert.equal(canDeletePlayer([], [{ id: 'w2', season_id: season9, event_date: '2026-11-19', name: 'Week 2', status: 'complete' }]), true)
assert.equal(canDeletePlayer([{ event_id: 'w2', place: 1 }], [{ id: 'w2', season_id: season9, event_date: '2026-11-19', name: 'Week 2', status: 'complete' }]), false, 'cannot delete player with posted night')
assert.equal(canDeletePlayer([{ event_id: 'w1', place: null }], [{ id: 'w1', season_id: season9, event_date: '2026-11-05', name: 'Week 1', status: 'complete' }]), false, 'cannot delete player in Week 1')
assert.equal(canDeletePlayer([{ event_id: 'w3', place: null }], [{ id: 'w3', season_id: season9, event_date: '2026-11-26', name: 'Week 3', status: 'scoring' }]), false, 'cannot bulk-delete player historical entries')

// Item 3: Step navigation (setStatus to final9/results) must not skip completion gate, and must wait for dirty or in-flight saves.
const ready = { dirty: 0, saves: 0, refreshing: false }
assert.equal(cutConfirmationReady([bothNines], ready), true)
assert.equal(cutConfirmationReady([bothNines], { dirty: 1, saves: 0, refreshing: false }), false)
assert.equal(cutConfirmationReady([bothNines], { dirty: 0, saves: 1, refreshing: false }), false)
assert.equal(cutConfirmationReady([bothNines], { dirty: 0, saves: 0, refreshing: true }), false)
assert.equal(cutConfirmationReady([frontOnly], ready), false)
assert.equal(canAdvanceToStatus('scoring', 'final9', [frontOnly], ready, null), false, 'setStatus to final9 blocked when 18 incomplete')
assert.equal(canAdvanceToStatus('scoring', 'results', [frontOnly], ready, null), false, 'setStatus to results blocked when 18 incomplete')
assert.equal(canAdvanceToStatus('scoring', 'final9', [bothNines], { dirty: 1, saves: 0, refreshing: false }, null), false, 'setStatus to final9 waits for dirty input')
assert.equal(canAdvanceToStatus('final9', 'results', [bothNines], { dirty: 0, saves: 1, refreshing: false }, null), false, 'setStatus to results waits for in-flight save')
assert.equal(canAdvanceToStatus('scoring', 'final9', [bothNines], ready, week1Event), false, 'setStatus blocked on Week 1')
assert.equal(canAdvanceToStatus('scoring', 'final9', [bothNines], ready, { season_id: season9, event_date: '2026-11-19', name: 'Week 2' }), true)
assert.equal(canAdvanceToStatus('scoring', 'checkin', [frontOnly], { dirty: 1, saves: 1, refreshing: false }, { season_id: season9, event_date: '2026-11-19', name: 'Week 2' }), true, 'stepping back to checkin is not gated on 18 completion')

// Item 4: Separate dirty-save keys for front, back, final
let dirtyKeys = new Set<string>()
dirtyKeys = applyScoreDirty(dirtyKeys, 'p1', 'front', true)
dirtyKeys = applyScoreDirty(dirtyKeys, 'p1', 'back', true)
dirtyKeys = applyScoreDirty(dirtyKeys, 'p1', 'final', true)
dirtyKeys = applyScoreDirty(dirtyKeys, 'p1', 'back', false)
assert.equal(dirtyKeys.has('p1:front'), true)
assert.equal(dirtyKeys.has('p1:back'), false)
assert.equal(dirtyKeys.has('p1:final'), true)
dirtyKeys = applyScoreDirty(dirtyKeys, 'p1', 'front', false)
dirtyKeys = applyScoreDirty(dirtyKeys, 'p1', 'final', false)
assert.equal(dirtyKeys.size, 0)

// Item 5: Countback tiebreaks r1/r2 must use new Front/Back nines, not old basket fields
const cbFrontTieA = e({ id: 'cbf-a', created_at: '2026-11-08T01:00:00.000Z', score_front: 35, score_back: 35, score_18: 70, r1_b1: 25, r1_b2: 20, r2_b1: 25, r2_b2: 20 })
const cbFrontTieB = e({ id: 'cbf-b', created_at: '2026-11-08T02:00:00.000Z', score_front: 35, score_back: 35, score_18: 70, r1_b1: 5, r1_b2: 5, r2_b1: 5, r2_b2: 5 })
const cbFrontPlaces = new Map(rank18([cbFrontTieA, cbFrontTieB], cbNine).map(r => [r.entry.id, r.place]))
assert.equal(cbFrontPlaces.get('cbf-a'), 1, 'old basket fields must not break a tie when new Front/Back nines are tied')
assert.equal(cbFrontPlaces.get('cbf-b'), 1, 'both players share place 1 when new Front and Back are identical despite old basket values')
const r1OnlySettings = { ...S, ties: { ...S.ties, cut: 'countback' as const, countback: ['r1'] as ('r1')[] } }
const r1Low = e({ id: 'r1-low', created_at: '2026-11-08T01:00:00.000Z', score_front: 30, score_back: 40, score_18: 70, r1_b1: 25, r1_b2: 25 })
const r1High = e({ id: 'r1-high', created_at: '2026-11-08T02:00:00.000Z', score_front: 40, score_back: 30, score_18: 70, r1_b1: 5, r1_b2: 5 })
const r1Places = new Map(rank18([r1Low, r1High], r1OnlySettings).map(r => [r.entry.id, r.place]))
assert.equal(r1Places.get('r1-high'), 1, 'countback r1 uses score_front and ignores higher old r1_b1+r1_b2')
assert.equal(r1Places.get('r1-low'), 2)

// Item 6: Confirmed cut divider when no finalists or non-top finalists
const noFinalistsBoard = tonightBoard([leaderCut, tieOut], S, 'final9', 2)
assert.equal(noFinalistsBoard.provisional, false)
assert.equal(noFinalistsBoard.cutAfterId, null, 'confirmed cut divider is null when no one has made_final')

// Item 7: Stale concurrent score_18 save must not bring back a score that was cleared; legacy summed values must not resurrect either.
let synced = e({ score_front: 40, score_back: 30, score_18: 70 })
synced = applyNineToLatest(synced, 'front', 41)
synced = applyNineToLatest(synced, 'back', 32)
assert.equal(synced.score_18, 73)
const stalePatch = computeNineCommit(e({ score_front: 40, score_back: 30, score_18: 70 }), 'back', 32)
const merged = mergeNinePatch(e({ score_front: 41, score_back: 30, score_18: 71 }), stalePatch)
assert.equal(merged.score_front, 41)
assert.equal(merged.score_back, 32)
assert.equal(merged.score_18, 73)

const afterFrontCleared = e({ score_front: null, score_back: 30, score_18: null })
const staleSaveWith18 = computeNineCommit(e({ score_front: 40, score_back: 30, score_18: 70 }), 'back', 32)
const mergedAfterClear = mergeNinePatch(afterFrontCleared, staleSaveWith18)
assert.equal(mergedAfterClear.score_front, null)
assert.equal(mergedAfterClear.score_back, 32)
assert.equal(mergedAfterClear.score_18, null, 'stale concurrent score_18 save must not bring back 18 when front was cleared')
assert.equal(totals(mergedAfterClear).t18, null)

const mergedDirectStale18 = mergeNinePatch(e({ score_front: 40, score_back: null, score_18: null }), { score_18: 70 })
assert.equal(mergedDirectStale18.score_18, null, 'direct stale score_18 patch must not resurrect when only one nine is present')

const staleRemaining = e({ score_front: 40, score_back: null, score_18: 70 })
const clearLastNine = computeNineCommit(staleRemaining, 'front', null)
const afterLastNineCleared = mergeNinePatch(staleRemaining, clearLastNine)
assert.equal(afterLastNineCleared.score_18, null, 'clearing last nine must clear legacy/stale score_18')
assert.equal(totals(afterLastNineCleared).t18, null, 'legacy summed score_18 must not resurrect after clearing last nine')

const withLegacyBaskets = e({ score_front: 40, score_back: 30, score_18: 70, r1_b1: 20, r1_b2: 15, r2_b1: 20, r2_b2: 15 })
const step1Clear = { ...withLegacyBaskets, ...computeNineCommit(withLegacyBaskets, 'front', null) }
const step2Clear = { ...step1Clear, ...computeNineCommit(step1Clear, 'back', null) }
assert.equal(totals(step2Clear).t18, null, 'legacy summed basket values must not resurrect when both nines are cleared')
assert.equal(displayedFront(step2Clear), null)
assert.equal(displayedBack(step2Clear), null)

// Item: Shared Pot totals across divisions (including division: null)
const sharedPotLedger: LedgerRow[] = [
  { id: 'l1', season_id: 's', event_id: null, player_id: null, division: 'M', fund: 'perfect5', kind: 'carryover', amount: 30, note: null, created_at: '2026-11-01' },
  { id: 'l2', season_id: 's', event_id: null, player_id: null, division: 'W', fund: 'perfect5', kind: 'carryover', amount: 15, note: null, created_at: '2026-11-01' },
  { id: 'l3', season_id: 's', event_id: null, player_id: null, division: null, fund: 'perfect5', kind: 'carryover', amount: 25, note: null, created_at: '2026-11-02' },
  { id: 'l4', season_id: 's', event_id: null, player_id: null, division: null, fund: 'perfect4', kind: 'carryover', amount: 50, note: null, created_at: '2026-11-02' },
  { id: 'l5', season_id: 's', event_id: null, player_id: null, division: 'M', fund: 'perfect_round', kind: 'carryover', amount: 120, note: null, created_at: '2026-11-01' },
  { id: 'l6', season_id: 's', event_id: null, player_id: null, division: 'W', fund: 'perfect_round', kind: 'carryover', amount: 40, note: null, created_at: '2026-11-01' },
]

assert.equal(sharedPotBalance(sharedPotLedger, 'perfect5'), 70, 'shared perfect 5 sums M (30), W (15), and null (25)')
assert.equal(sharedPotBalance(sharedPotLedger, 'perfect4'), 50, 'shared perfect 4 sums null division rows')
assert.equal(balances(sharedPotLedger, 'M').perfect_round, 120, 'perfect round stays per-division for M')
assert.equal(balances(sharedPotLedger, 'W').perfect_round, 40, 'perfect round stays per-division for W')

// Item: Pot visibility helpers & defaults
const testVisSettings: Settings = {
  ...S,
  potsVisibility: {
    perfect_round: true,
    backup: true,
    perfect5: true,
    perfect4: true,
    high_score: true,
    tag_fund: true,
    purse: true,
  },
  pp_pot_visibility: {
    perfect_round_W: false,
    perfect4: false,
  },
}
assert.equal(testVisSettings.pp_pot_visibility?.perfect_round_W, false)
assert.equal(testVisSettings.pp_pot_visibility?.perfect4, false)
assert.equal(testVisSettings.potsVisibility.perfect5, true)

// Item: Season High Score Record computation
const mockEvents: PPEvent[] = [
  { id: 'ev-w1', season_id: 's9', event_date: '2026-11-05', name: 'Week 1', status: 'complete', created_at: '2026-11-05' },
  { id: 'ev-w2', season_id: 's9', event_date: '2026-11-12', name: 'Week 2', status: 'scoring', pp_closed_men: true, pp_closed_women: false, created_at: '2026-11-12' },
  { id: 'ev-w3', season_id: 's9', event_date: '2026-11-19', name: 'Week 3', status: 'active', pp_closed_men: false, pp_closed_women: false, created_at: '2026-11-19' },
]
const mockPlayers: Player[] = [
  { id: 'p-dirk', name: 'Dirk Tailford', division: 'M', active: true, in_tags: true, created_at: '' },
  { id: 'p-ferg', name: 'J Ferguson', division: 'M', active: true, in_tags: true, created_at: '' },
  { id: 'p-alice', name: 'Alice Walker', division: 'W', active: true, in_tags: true, created_at: '' },
  { id: 'p-unfin', name: 'Unfinished Man', division: 'M', active: true, in_tags: true, created_at: '' },
]
const mockPlayerById = new Map(mockPlayers.map(p => [p.id, p]))

const mockEntries: Entry[] = [
  // Week 1 (complete) - Dirk 74, Alice 68
  e({ id: 'en-1', event_id: 'ev-w1', player_id: 'p-dirk', division: 'M', score_18: 48, score_final: 26, made_final: true }),
  e({ id: 'en-2', event_id: 'ev-w1', player_id: 'p-alice', division: 'W', score_18: 46, score_final: 22, made_final: true }),
  // Week 2 (Men closed, Women open) - Ferg ties Dirk at 74
  e({ id: 'en-3', event_id: 'ev-w2', player_id: 'p-ferg', division: 'M', score_front: 25, score_back: 23, score_18: 48, score_final: 26, made_final: true }),
  e({ id: 'en-4', event_id: 'ev-w2', player_id: 'p-alice', division: 'W', score_front: 26, score_back: 25, score_18: 51, score_final: 25, made_final: true }),
  // Week 3 (Active, neither closed) - 80 points should be ignored
  e({ id: 'en-5', event_id: 'ev-w3', player_id: 'p-unfin', division: 'M', score_18: 50, score_final: 30, made_final: true }),
  // Non-finalist with high 18 score (55)
  e({ id: 'en-6', event_id: 'ev-w1', player_id: 'p-nonfin', division: 'M', score_18: 55, score_final: null, made_final: false }),
]

const menHighScore = seasonHighScoreRecord({ entries: mockEntries, events: mockEvents, division: 'M', playerById: mockPlayerById })
assert.equal(menHighScore.score, 74, 'Men high score is 74 (Dirk and Ferg tied)')
assert.deepEqual(menHighScore.holders, ['Dirk Tailford', 'J Ferguson'], 'both tied players are listed as record holders')

const womenHighScore = seasonHighScoreRecord({ entries: mockEntries, events: mockEvents, division: 'W', playerById: mockPlayerById })
assert.equal(womenHighScore.score, 68, 'Women high score ignores unclosed Week 2 and active Week 3')
assert.deepEqual(womenHighScore.holders, ['Alice Walker'])

// Item: Legacy Week 1 entry fallback (only score_18 and score_final, all basket columns null)
const legacyWeek1Finalist = e({
  score_18: 49,
  score_final: 23,
  made_final: true,
  r1_b1: null,
  r1_b2: null,
  r2_b1: null,
  r2_b2: null,
  f_b1: null,
  f_b2: null,
  score_front: null,
  score_back: null,
})
assert.equal(totals(legacyWeek1Finalist).t18, 49, 'legacy entry falls back to score_18 for t18')
assert.equal(totals(legacyWeek1Finalist).total, 72, 'legacy finalist falls back to score_18 + score_final for 27 total')
assert.equal(entryScore27(legacyWeek1Finalist), 72, 'entryScore27 gives 72 for legacy finalist')

const legacyWeek1NonFinalist = e({
  score_18: 52,
  score_final: null,
  made_final: false,
  r1_b1: null,
  r1_b2: null,
  r2_b1: null,
  r2_b2: null,
  f_b1: null,
  f_b2: null,
  score_front: null,
  score_back: null,
})
assert.equal(totals(legacyWeek1NonFinalist).t18, 52, 'legacy non-finalist falls back to score_18')
assert.equal(entryScore27(legacyWeek1NonFinalist), null, 'entryScore27 is null for non-finalist')
const legacyBests = calculatePlayerBests([legacyWeek1Finalist, legacyWeek1NonFinalist])
assert.equal(legacyBests.best18, 52, 'best18 is max across legacy entries')
assert.equal(legacyBests.best27, 72, 'best27 only considers made_final entry')

// Item 8: Changed files must be clean UTF-8 without BOM or mojibake
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const changedFiles = [
  'src/lib/scoring.ts',
  'src/lib/store.tsx',
  'src/lib/types.ts',
  'src/pages/Players.tsx',
  'src/pages/Season.tsx',
  'src/pages/Tonight.tsx',
  'src/components/ui.tsx',
  'scripts/test-logic.ts',
  'scripts/smoke-scoring.tsx',
  'src/lib/money.ts',
  'src/lib/settings.ts',
  'src/pages/Pots.tsx',
  'src/pages/Standings.tsx',
  'supabase/pp_009_score_front_back.sql',
  'supabase/pp_finance_010_division_closeout.sql',
]
for (const relPath of changedFiles) {
  const bytes = fs.readFileSync(new URL(`../${relPath}`, import.meta.url))
  assert.equal(
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    false,
    `${relPath} must not have a UTF-8 BOM`,
  )
  const decoded = utf8Decoder.decode(bytes)
  assert.equal(
    /[\u0080-\u009f\ufffd\u00c2\u00c3]|\u00e2\u20ac/.test(decoded),
    false,
    `${relPath} must not contain mojibake`,
  )
}

await import('../src/lib/closeout.test')
await import('../src/lib/closeout-money.test')
await import('../src/lib/closeout-plan.test')
await import('../src/lib/closeout-fixtures.test')
await import('../src/lib/closeout-protocol.test')
await import('../src/lib/closeout-week1.test')
await import('../src/lib/closeout-gaps.test')
await import('../src/lib/standings.test')
await import('../src/lib/cards.test')

console.log('All rules checks passed ✔')

