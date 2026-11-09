// Run: npx tsx src/lib/closeout-plan.test.ts
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS as S } from './settings'
import { planSplitClose } from './closeout'

function bal(over = {}) {
  return { perfect_round: 0, backup: 0, perfect5: 0, perfect4: 0, high_score: 0, tag_fund: 0, purse: 0, ...over }
}
function men(n, award) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`, player_id: `m${i + 1}`, division: 'M',
    created_at: `2026-11-12T00:00:0${i + 1}`,
    awards: i === 0 && award ? [award] : [],
    place: i + 1,
  }))
}
const legs = (rows, pred) => rows.filter(pred)
const sum = (rows) => rows.reduce((a, r) => a + r.amount, 0)

const plan = planSplitClose({
  settings: S,
  entries: [
    ...men(10, 'perfect4'),
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `w${i + 1}`, player_id: `w${i + 1}`, division: 'W',
      created_at: `2026-11-12T01:00:0${i + 1}`,
      awards: i === 0 ? ['perfect4'] : i === 1 ? ['perfect5'] : [],
      place: i + 1,
    })),
  ],
  balances: { M: bal({ perfect_round: 249.99, perfect4: 40 }), W: bal({ perfect5: 30 }) },
  bar: { M: 50, W: 25 },
  openingNight: false,
})
assert.equal(plan.ok, true)
if (!plan.ok) throw new Error('refused')
assert.equal(plan.gross.M, 130)
assert.equal(plan.gross.W, 65)
assert.equal(plan.heldReserve.M.perfect4, 10)
assert.equal(plan.heldReserve.M.perfect5, 0)
assert.equal(plan.placePool.M, 120)
assert.equal(plan.placePool.W, 50)
assert.equal(plan.released.M, 5)
const first = plan.firstLegs
const second = plan.secondLegs
assert.equal(sum(legs(first, r => r.division === 'M' && r.fund === 'purse' && r.kind === 'entry')), 80)
assert.equal(sum(legs(first, r => r.fund === 'perfect_round' && r.kind === 'entry')), 0.01)
assert.equal(legs(first, r => r.fund === 'backup' && r.kind === 'overflow')[0].note, 'Over the cap')
assert.equal(sum(legs(first, r => r.kind === 'place_payout')), -120)
assert.equal(legs(first, r => r.player_id === 'm1' && r.kind === 'place_payout')[0].amount, -80)
assert.equal(legs(first, r => r.player_id === 'm2' && r.kind === 'place_payout')[0].amount, -40)
assert.ok(!first.some(r => r.fund === 'perfect4' || r.fund === 'perfect5'))
assert.equal(sum(legs(second, r => r.division === 'W' && r.fund === 'purse' && r.kind === 'entry')), 40)
assert.equal(sum(legs(second, r => r.division === 'W' && r.kind === 'place_payout')), -50)
assert.equal(legs(second, r => r.fund === 'perfect4' && r.division === 'M' && r.amount === 5)[0].note, 'Funded from the payout pool')
assert.equal(legs(second, r => r.fund === 'perfect4' && r.division === 'M' && r.amount === -20)[0].note, 'Shared Perfect 4 pot')
assert.equal(legs(second, r => r.fund === 'perfect4' && r.division === 'W' && r.amount === 20)[0].note, 'Shared Perfect 4 pot')
assert.equal(legs(second, r => r.player_id === 'w2' && r.fund === 'perfect5' && r.kind === 'bonus_payout')[0].amount, -40)
assert.equal(sum(legs(second, r => r.division === 'M' && r.fund === 'purse' && r.kind === 'transfer' && r.amount === -5)), -10)
const all = [...first, ...second]
const net = (d, fund) => sum(all.filter(r => r.division === d && r.fund === fund))
assert.equal(Math.round((net('M', 'purse') + net('W', 'purse')) * 100), 0)
assert.equal(Math.round((249.99 + net('M', 'perfect_round')) * 100), 25000)
assert.equal(Math.round((30 + net('W', 'perfect5')) * 100), 0)
assert.equal(Math.round((net('M', 'backup')) * 100), 2499)
assert.ok(!all.some(r => r.amount === 0))

const refused = planSplitClose({
  settings: { ...S, bonus: { ...S.bonus, highScore: 30 } },
  entries: men(1, 'high_score'),
  balances: { M: bal(), W: bal() },
  bar: { M: 0, W: 0 },
  openingNight: false,
})
assert.equal(refused.ok, false)
if (refused.ok) throw new Error('should refuse')
assert.equal(refused.reason, 'funding_needed')
assert.equal(refused.deficit, 22)
assert.deepEqual(refused.legs, [])
assert.equal(S.bonus.highScore, 10)
console.log('closeout plan tests defined')
