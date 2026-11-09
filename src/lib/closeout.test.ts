// Run: npx tsx src/lib/closeout.test.ts
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  resolveWeek1Identity,
  Week1IdentityError,
  protectedNullEventLedgerIds,
  ledgerChecksum,
  seasonFinanceAdvisoryKey,
  revisionsMatch,
  requestCacheDecision,
  bumpRevision,
} from './closeout'

const SEASON_ID = '81298495-f87c-4d7c-a344-89b97e587d9b'
const WEEK1_EVENT_ID = '10000000-0000-4000-8000-000000000001'

// 1. Week1 exact match and error cases
{
  const events = [
    {
      id: WEEK1_EVENT_ID,
      season_id: SEASON_ID,
      date: '2026-11-05',
      name: 'Week 1',
    },
  ]
  const beforeJson = JSON.stringify(events)
  const resolved = resolveWeek1Identity(events)
  assert.deepEqual(resolved, { eventId: WEEK1_EVENT_ID, seasonId: SEASON_ID })
  assert.equal(JSON.stringify(events), beforeJson)

  assert.throws(
    () => resolveWeek1Identity([]),
    (err: unknown) => err instanceof Week1IdentityError && err.code === 'missing',
  )

  assert.throws(
    () =>
      resolveWeek1Identity([
        events[0],
        { ...events[0], id: '10000000-0000-4000-8000-000000000002' },
      ]),
    (err: unknown) => err instanceof Week1IdentityError && err.code === 'duplicate',
  )

  assert.throws(
    () => resolveWeek1Identity([{ ...events[0], name: 'Week 2' }]),
    (err: unknown) => err instanceof Week1IdentityError && err.code === 'missing',
  )

  assert.throws(
    () => resolveWeek1Identity([{ ...events[0], date: '2026-11-06' }]),
    (err: unknown) => err instanceof Week1IdentityError && err.code === 'missing',
  )

  assert.throws(
    () =>
      resolveWeek1Identity([
        { ...events[0], season_id: '99999999-9999-4999-8999-999999999999' },
      ]),
    (err: unknown) => err instanceof Week1IdentityError && err.code === 'missing',
  )
}

// 2. protectedNullEventLedgerIds
{
  const ledgerRows = [
    { id: 'row-c', season_id: SEASON_ID, event_id: null, amount: 25 },
    { id: 'row-a', season_id: SEASON_ID, event_id: null, amount: 50 },
    { id: 'row-b', season_id: SEASON_ID, event_id: WEEK1_EVENT_ID, amount: 15 },
    {
      id: 'row-d',
      season_id: '99999999-9999-4999-8999-999999999999',
      event_id: null,
      amount: 100,
    },
  ]
  const amountsBefore = ledgerRows.map((r) => r.amount)
  const ids = protectedNullEventLedgerIds(ledgerRows, SEASON_ID)
  assert.deepEqual(ids, ['row-a', 'row-c'])
  assert.deepEqual(
    ledgerRows.map((r) => r.amount),
    amountsBefore,
  )
}

// 3. ledgerChecksum
{
  const row1 = {
    id: 'ledger-1',
    season_id: SEASON_ID,
    event_id: WEEK1_EVENT_ID,
    player_id: 'player-1',
    division: 'A',
    fund: 'pot',
    kind: 'payout',
    amount: 20,
  }
  const row2 = {
    id: 'ledger-2',
    season_id: SEASON_ID,
    event_id: null,
    player_id: 'player-2',
    division: 'B',
    fund: 'ace',
    kind: 'carryover',
    amount: 35,
  }

  const baseSum = ledgerChecksum([row1, row2])
  assert.equal(ledgerChecksum([row2, row1]), baseSum)

  assert.notEqual(ledgerChecksum([{ ...row1, amount: 21 }, row2]), baseSum)
  assert.notEqual(ledgerChecksum([{ ...row1, id: 'ledger-9' }, row2]), baseSum)
  assert.notEqual(ledgerChecksum([{ ...row1, fund: ' skins' }, row2]), baseSum)
  assert.notEqual(ledgerChecksum([{ ...row1, kind: 'entry' }, row2]), baseSum)
  assert.notEqual(ledgerChecksum([{ ...row1, division: 'C' }, row2]), baseSum)
  assert.notEqual(ledgerChecksum([{ ...row1, event_id: null }, row2]), baseSum)
  assert.notEqual(ledgerChecksum([{ ...row1, player_id: 'player-9' }, row2]), baseSum)
  assert.notEqual(
    ledgerChecksum([{ ...row1, season_id: 'other-season' }, row2]),
    baseSum,
  )
  assert.notEqual(
    ledgerChecksum([row1, row2, { ...row1, id: 'ledger-3' }]),
    baseSum,
  )
}

// 4. seasonFinanceAdvisoryKey
{
  const computeExpectedKey = (id: string): bigint => {
    const hex = createHash('md5')
      .update(`season_finance:${id}`)
      .digest('hex')
      .slice(0, 16)
    const unsigned = BigInt(`0x${hex}`)
    return unsigned >= 2n ** 63n ? unsigned - 2n ** 64n : unsigned
  }

  const id1 = '11111111-1111-4111-8111-111111111111'
  const id2 = '22222222-2222-4222-8222-222222222222'

  const key1 = seasonFinanceAdvisoryKey(id1)
  const key2 = seasonFinanceAdvisoryKey(id2)

  assert.equal(key1, computeExpectedKey(id1))
  assert.equal(key2, computeExpectedKey(id2))
  assert.notEqual(key1, key2)
}

// 5. revisionsMatch
{
  const baseRev = {
    input: 1,
    result: 2,
    finance: 3,
    settings: 4,
    tag: 5,
    structure: 6,
    postingGeneration: 7,
    correctionGeneration: 8,
    engineVersion: '1.0.0',
    schemaVersion: '2026-11',
    snapshotHash: 'abc123hash',
  }

  assert.equal(revisionsMatch(baseRev, { ...baseRev }), true)

  assert.equal(revisionsMatch(baseRev, { ...baseRev, input: 99 }), false)
  assert.equal(revisionsMatch(baseRev, { ...baseRev, result: 99 }), false)
  assert.equal(revisionsMatch(baseRev, { ...baseRev, finance: 99 }), false)
  assert.equal(revisionsMatch(baseRev, { ...baseRev, settings: 99 }), false)
  assert.equal(revisionsMatch(baseRev, { ...baseRev, tag: 99 }), false)
  assert.equal(revisionsMatch(baseRev, { ...baseRev, structure: 99 }), false)
  assert.equal(revisionsMatch(baseRev, { ...baseRev, postingGeneration: 99 }), false)
  assert.equal(
    revisionsMatch(baseRev, { ...baseRev, correctionGeneration: 99 }),
    false,
  )
  assert.equal(revisionsMatch(baseRev, { ...baseRev, engineVersion: '2.0.0' }), false)
  assert.equal(revisionsMatch(baseRev, { ...baseRev, schemaVersion: '2026-12' }), false)
  assert.equal(revisionsMatch(baseRev, { ...baseRev, snapshotHash: 'different' }), false)
}

// 6. requestCacheDecision
{
  assert.equal(
    requestCacheDecision({
      stored: { completed: true, hash: 'h1' },
      hash: 'h1',
      fresh: false,
    }),
    'cached',
  )
  assert.equal(
    requestCacheDecision({
      stored: { completed: true, hash: 'h1' },
      hash: 'h2',
      fresh: true,
    }),
    'collision',
  )
  assert.equal(
    requestCacheDecision({
      stored: null,
      hash: 'h1',
      fresh: false,
    }),
    'stale',
  )
  assert.equal(
    requestCacheDecision({
      stored: null,
      hash: 'h1',
      fresh: true,
    }),
    'proceed',
  )
  assert.equal(
    requestCacheDecision({
      stored: { completed: false, hash: 'h1' },
      hash: 'h1',
      fresh: true,
    }),
    'proceed',
  )
  assert.equal(
    requestCacheDecision({
      stored: { completed: false, hash: 'h1' },
      hash: 'h1',
      fresh: false,
    }),
    'stale',
  )
}

// 7. bumpRevision
{
  assert.equal(bumpRevision(0), 1)
  assert.equal(bumpRevision(5), 6)
}

console.log('closeout p1 tests defined')
