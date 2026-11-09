// Run: npx tsx src/lib/closeout-money.test.ts
import assert from 'node:assert/strict'
import { openPoolDeficit, minimumOpenBar, extraWholeDollars, combinedBarFits, debitSolvency, distributeTiedChecks } from './closeout'

assert.deepEqual(openPoolDeficit({ entryPurse: 8, bar: 0, highScoreLiability: 30, sharedCharges: 0 }), { pool: -22, deficit: 22 })
assert.deepEqual(openPoolDeficit({ entryPurse: 16, bar: 10, highScoreLiability: 10, sharedCharges: 20 }), { pool: -4, deficit: 4 })
assert.deepEqual(openPoolDeficit({ entryPurse: 80, bar: 50, highScoreLiability: 0, sharedCharges: 10 }), { pool: 120, deficit: 0 })
assert.equal(minimumOpenBar(16, 10, 20), 14)
assert.equal(extraWholeDollars(4), 4)
assert.equal(extraWholeDollars(0), 0)
assert.equal(combinedBarFits(100, 14, 150), true)
assert.equal(combinedBarFits(140, 14, 150), false)
assert.equal(combinedBarFits(140, 10, 150), true)

const empty = debitSolvency({ M: { backup: -5 }, W: {} }, [{ division: 'M', fund: 'backup', kind: 'overflow', amount: 2, note: '', player_id: null }])
assert.deepEqual(empty, [])
const short = debitSolvency({ M: { purse: 3 }, W: {} }, [{ division: 'M', fund: 'purse', kind: 'place_payout', amount: -10, note: '', player_id: 'p' }])
assert.deepEqual(short, [{ division: 'M', fund: 'purse' }])

const ranked = [
  { id: 'b', player_id: 'b', place: 1, created_at: '2026-11-12T00:00:02' },
  { id: 'a', player_id: 'a', place: 1, created_at: '2026-11-12T00:00:01' },
]
const before = JSON.stringify(ranked)
const pays = distributeTiedChecks([10, 5], ranked)
assert.equal(pays.get('a'), 10)
assert.equal(pays.get('b'), 5)
assert.equal(JSON.stringify(ranked), before)
console.log('closeout p2a tests defined')
