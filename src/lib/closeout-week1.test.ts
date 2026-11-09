// Run: npx tsx src/lib/closeout-week1.test.ts
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS as S } from './settings'
import { planSplitClose, refuseWeek1Finance } from './closeout'

const SEASON = '81298495-f87c-4d7c-a344-89b97e587d9b'
const week1 = { season_id: SEASON, date: '2026-11-05', name: 'Week 1' }

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

const actions = ['close', 'correction', 'ledger', 'payout', 'bar', 'manual_pot', 'points', 'tags'] as const
for (const action of actions) {
  const decision = refuseWeek1Finance({ event: week1, action })
  assert.equal(decision.ok, false, action)
  if (decision.ok) throw new Error(action)
  assert.equal(decision.reason, 'week1_frozen')
}

assert.equal(
  refuseWeek1Finance({
    event: { season_id: SEASON, date: '2026-11-12', name: 'Week 2' },
    action: 'close',
  }).ok,
  true,
)

assert.equal(
  refuseWeek1Finance({
    event: { season_id: SEASON, date: '2026-11-05', name: 'Week 2' },
    action: 'ledger',
  }).ok,
  true,
)

const plan = planSplitClose({
  settings: S,
  entries: [
    {
      id: 'm1',
      player_id: 'm1',
      division: 'M',
      created_at: '2026-11-05T00:00:01',
      awards: [],
      place: 1,
    },
  ],
  balances: { M: bal(), W: bal() },
  bar: { M: 0, W: 0 },
  openingNight: true,
  event: week1,
})
assert.equal(plan.ok, false)
if (plan.ok) throw new Error('week1 planned')
assert.equal(plan.reason, 'week1_frozen')
assert.deepEqual(plan.legs, [])

console.log('closeout week1 finance tests defined')
