// Run: npx tsx src/lib/closeout-fixtures.test.ts
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS as S } from './settings'
import { PLACE_REMAINDER_NOTE } from './money'
import { planSplitClose } from './closeout'

function bal(over: Record<string, number> = {}) {
  return {
    perfect_round: 0,
    backup: 0,
    perfect5: 0,
    perfect4: 0,
    high_score: 0,
    tag_fund: 0,
    purse: 0,
    ...over,
  }
}

function men(n: number, award?: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`,
    player_id: `m${i + 1}`,
    division: 'M' as const,
    created_at: `2026-11-12T00:00:0${i + 1}`,
    awards: i === 0 && award ? [award] : [],
    place: i + 1,
  }))
}

type Leg = {
  division: string
  fund: string
  kind: string
  amount: number
  note: string
  player_id: string | null
}

function legsOf(plan: { firstLegs: Leg[]; secondLegs: Leg[] }, pred: (row: Leg) => boolean) {
  return [...plan.firstLegs, ...plan.secondLegs].filter(pred)
}

// Pool 83 pays the $80 place budget and routes the $3 remainder to Perfect Round.
{
  const plan = planSplitClose({
    settings: S,
    entries: men(10),
    balances: { M: bal(), W: bal() },
    bar: { M: 3, W: 0 },
    openingNight: false,
  })
  assert.equal(plan.ok, true)
  if (!plan.ok) throw new Error('refused')
  assert.equal(plan.placePool.M, 83)
  const pays = plan.firstLegs.filter((r) => r.kind === 'place_payout')
  assert.equal(pays.reduce((sum, r) => sum + r.amount, 0), -80)
  const remainder = plan.firstLegs.filter((r) => r.fund === 'purse' && r.note === PLACE_REMAINDER_NOTE)
  assert.equal(remainder.length, 1)
  assert.equal(remainder[0].amount, -3)
  const pot = plan.firstLegs.filter((r) => r.fund === 'perfect_round' && r.note === PLACE_REMAINDER_NOTE)
  assert.equal(pot[0].amount, 3)
}

// Pool 100 with a saved under-pool check list of 50 keeps the other 50 in the purse.
// No rounding remainder is created, because 100 is already a $5 budget.
{
  const plan = planSplitClose({
    settings: S,
    entries: men(10),
    balances: { M: bal(), W: bal() },
    bar: { M: 20, W: 0 },
    openingNight: false,
    payouts: { M: [30, 20], W: [] },
  })
  assert.equal(plan.ok, true)
  if (!plan.ok) throw new Error('refused')
  assert.equal(plan.placePool.M, 100)
  const pays = plan.firstLegs.filter((r) => r.kind === 'place_payout')
  assert.deepEqual(pays.map((r) => r.amount), [-30, -20])
  assert.equal(plan.firstLegs.some((r) => r.note === PLACE_REMAINDER_NOTE), false)
}

// Two men tied for the only paid place. The $15 of a $16 pool splits 10/5.
// The earlier check-in gets the extra $5. The $1 remainder goes to Perfect Round.
{
  const plan = planSplitClose({
    settings: S,
    entries: [
      { id: 'a', player_id: 'a', division: 'M' as const, created_at: '2026-11-12T00:00:01', awards: [], place: 1 },
      { id: 'b', player_id: 'b', division: 'M' as const, created_at: '2026-11-12T00:00:02', awards: [], place: 1 },
    ],
    balances: { M: bal(), W: bal() },
    bar: { M: 0, W: 0 },
    openingNight: false,
  })
  assert.equal(plan.ok, true)
  if (!plan.ok) throw new Error('refused')
  assert.equal(plan.placePool.M, 16)
  const pays = plan.firstLegs.filter((r) => r.kind === 'place_payout')
  assert.equal(pays.find((r) => r.player_id === 'a')?.amount, -10)
  assert.equal(pays.find((r) => r.player_id === 'b')?.amount, -5)
  const remainder = plan.firstLegs.filter((r) => r.fund === 'purse' && r.note === PLACE_REMAINDER_NOTE)
  assert.equal(remainder[0].amount, -1)
}

// Perfect Round already at 249.99. Ten entries add 20: 0.01 fits, 19.99 overflows.
// One winner is paid 250. Backup 0 rolls 19.99 back, not 250.01.
{
  const plan = planSplitClose({
    settings: S,
    entries: men(10, 'perfect_round'),
    balances: { M: bal({ perfect_round: 249.99 }), W: bal() },
    bar: { M: 50, W: 0 },
    openingNight: false,
  })
  assert.equal(plan.ok, true)
  if (!plan.ok) throw new Error('refused')
  const win = plan.firstLegs.find((r) => r.player_id === 'm1' && r.fund === 'perfect_round' && r.kind === 'bonus_payout')
  assert.equal(win?.amount, -250)
  const roll = plan.firstLegs.find((r) => r.fund === 'perfect_round' && r.kind === 'rollover')
  assert.equal(roll?.amount, 19.99)
  assert.equal(plan.firstLegs.some((r) => r.amount === 250.01 || r.amount === -250.01), false)
}

// No Perfect 4 or Perfect 5 winners means no shared rows.
{
  const plan = planSplitClose({
    settings: S,
    entries: men(1),
    balances: { M: bal({ perfect4: 40, perfect5: 30 }), W: bal() },
    bar: { M: 0, W: 0 },
    openingNight: true,
  })
  assert.equal(plan.ok, true)
  if (!plan.ok) throw new Error('refused')
  const all = [...plan.firstLegs, ...plan.secondLegs]
  assert.equal(all.some((r) => r.fund === 'perfect4' || r.fund === 'perfect5'), false)
}

// Women's shortfall stays funding-needed. Two women, purse 16 + bar 10, high score 10,
// and that woman also holds the only Perfect 4 and Perfect 5, so both flats charge 20.
{
  const plan = planSplitClose({
    settings: S,
    entries: [
      {
        id: 'w1',
        player_id: 'w1',
        division: 'W' as const,
        created_at: '2026-11-12T01:00:01',
        awards: ['high_score', 'perfect4', 'perfect5'],
        place: 1,
      },
      {
        id: 'w2',
        player_id: 'w2',
        division: 'W' as const,
        created_at: '2026-11-12T01:00:02',
        awards: [],
        place: 2,
      },
    ],
    balances: { M: bal(), W: bal() },
    bar: { M: 0, W: 10 },
    openingNight: false,
  })
  assert.equal(plan.ok, false)
  if (plan.ok) throw new Error('should refuse')
  assert.equal(plan.reason, 'funding_needed')
  assert.equal(plan.deficit, 4)
  assert.deepEqual(plan.legs, [])
}

console.log('closeout fixture tests defined')
