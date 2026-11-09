// Run: npx tsx src/lib/standings.test.ts
import assert from 'node:assert/strict'
import {
  calculatePlayerBests,
  compareDefaultStandings,
  arePlayersTiedOnDefaultKeys,
  assignOfficialPlaces,
  nextSortState,
  sortStandingsRows,
  buildOfficialStandings,
  type StandingsPlayerStats,
} from './standings'
import type { Entry, PPEvent, Player } from './types'

let n = 0
const makeEntry = (patch: Partial<Entry>): Entry => {
  n++
  return {
    id: `ent-${n}`,
    event_id: 'ev-1',
    player_id: `p-${n}`,
    division: 'M',
    tag_in: null,
    tag_out: null,
    r1_b1: null,
    r1_b2: null,
    r2_b1: null,
    r2_b2: null,
    f_b1: null,
    f_b2: null,
    score_front: null,
    score_back: null,
    score_18: null,
    score_final: null,
    made_final: false,
    place: null,
    points: 0,
    payout: 0,
    paid: true,
    bonus_high: false,
    bonus_4: false,
    bonus_5: false,
    awards: [],
    created_at: new Date(1700000000000 + n * 1000).toISOString(),
    ...patch,
  }
}

// ---------------------------------------------------------------------------
// 1. calculatePlayerBests
// ---------------------------------------------------------------------------

// Player with only 18-hole scores (never made final)
const entriesNoFinal = [
  makeEntry({ score_front: 25, score_back: 26, made_final: false }), // 51
  makeEntry({ score_18: 48, made_final: false }), // 48
]
const bestsNoFinal = calculatePlayerBests(entriesNoFinal)
assert.equal(bestsNoFinal.best18, 51, 'Best 18 should be 51')
assert.equal(bestsNoFinal.best27, null, 'Best 27 must be null when player never made final')

// Player with 18 and Final 9
const entriesWithFinal = [
  makeEntry({ score_18: 50, made_final: false }), // 50
  makeEntry({ score_18: 52, score_final: 24, made_final: true }), // 18=52, 27=76
  makeEntry({ score_front: 27, score_back: 26, score_final: 21, made_final: true }), // 18=53, 27=74
]
const bestsWithFinal = calculatePlayerBests(entriesWithFinal)
assert.equal(bestsWithFinal.best18, 53, 'Best 18 should be 53')
assert.equal(bestsWithFinal.best27, 76, 'Best 27 should be 76 (52 + 24)')

// ---------------------------------------------------------------------------
// 2. compareDefaultStandings (Tiebreaker hierarchy)
// ---------------------------------------------------------------------------

const baseRow = (patch: Partial<StandingsPlayerStats>): StandingsPlayerStats => ({
  playerId: 'p1',
  playerName: 'Player A',
  points: 10,
  winnings: 50,
  eventsPlayed: 2,
  firstPlaces: 1,
  best18: 50,
  best27: 75,
  place: 1,
  ...patch,
})

// 1. Points desc
const p10 = baseRow({ playerId: 'a', points: 10 })
const p8 = baseRow({ playerId: 'b', points: 8 })
assert.ok(compareDefaultStandings(p10, p8) < 0, '10 pts ranks ahead of 8 pts')

// 2. 1st Wins desc (points tied)
const win2 = baseRow({ playerId: 'a', points: 10, firstPlaces: 2 })
const win1 = baseRow({ playerId: 'b', points: 10, firstPlaces: 1 })
assert.ok(compareDefaultStandings(win2, win1) < 0, '2 wins ranks ahead of 1 win on tied points')

// 3. Best 27 desc: Final 9 player ranks ahead of non-final-9 player
const has27 = baseRow({ playerId: 'a', points: 10, firstPlaces: 1, best27: 70 })
const no27 = baseRow({ playerId: 'b', points: 10, firstPlaces: 1, best27: null })
assert.ok(compareDefaultStandings(has27, no27) < 0, 'Player with Final 9 ranks ahead of player without Final 9')
assert.ok(compareDefaultStandings(no27, has27) > 0, 'Player without Final 9 ranks behind player with Final 9')

// 3b. Best 27 desc: Both have Final 9 -> higher 27 score ranks first
const score27High = baseRow({ playerId: 'a', points: 10, firstPlaces: 1, best27: 78 })
const score27Low = baseRow({ playerId: 'b', points: 10, firstPlaces: 1, best27: 75 })
assert.ok(compareDefaultStandings(score27High, score27Low) < 0, '78 Best 27 ranks ahead of 75')

// 4. Best 18 desc (tied points, wins, best 27)
const score18High = baseRow({ playerId: 'a', points: 10, firstPlaces: 1, best27: 75, best18: 54 })
const score18Low = baseRow({ playerId: 'b', points: 10, firstPlaces: 1, best27: 75, best18: 50 })
assert.ok(compareDefaultStandings(score18High, score18Low) < 0, '54 Best 18 ranks ahead of 50 Best 18')

// 5. Winnings desc (tied points, wins, best27, best18)
const winHigh = baseRow({ playerId: 'a', points: 10, firstPlaces: 1, best27: 75, best18: 50, winnings: 100 })
const winLow = baseRow({ playerId: 'b', points: 10, firstPlaces: 1, best27: 75, best18: 50, winnings: 50 })
assert.ok(compareDefaultStandings(winHigh, winLow) < 0, '$100 winnings ranks ahead of $50')

// 6. Name asc (tied on all numerical stats)
const nameAlice = baseRow({ playerId: 'a', playerName: 'Alice', points: 0, firstPlaces: 0, best27: null, best18: 45, winnings: 0 })
const nameBob = baseRow({ playerId: 'b', playerName: 'Bob', points: 0, firstPlaces: 0, best27: null, best18: 45, winnings: 0 })
assert.ok(compareDefaultStandings(nameAlice, nameBob) < 0, 'Alice ranks ahead of Bob alphabetically when all stats tie')

// ---------------------------------------------------------------------------
// 3. arePlayersTiedOnDefaultKeys & assignOfficialPlaces (5th, 5th, 7th)
// ---------------------------------------------------------------------------

const r1 = baseRow({ playerId: 'p1', playerName: 'Leader', points: 20 })
const r2 = baseRow({ playerId: 'p2', playerName: 'Second', points: 16 })
const r3 = baseRow({ playerId: 'p3', playerName: 'Third', points: 12 })
const r4 = baseRow({ playerId: 'p4', playerName: 'Fourth', points: 10 })
// Two players tied on all default keys:
const r5a = baseRow({ playerId: 'p5a', playerName: 'Aaron', points: 6, firstPlaces: 0, best27: 70, best18: 48, winnings: 20 })
const r5b = baseRow({ playerId: 'p5b', playerName: 'Zach', points: 6, firstPlaces: 0, best27: 70, best18: 48, winnings: 20 })
// Next player after the tie:
const r7 = baseRow({ playerId: 'p7', playerName: 'Seventh', points: 4 })

assert.equal(arePlayersTiedOnDefaultKeys(r5a, r5b), true)
assert.equal(arePlayersTiedOnDefaultKeys(r4, r5a), false)

const ranked = assignOfficialPlaces([r1, r2, r3, r4, r5a, r5b, r7])
assert.equal(ranked[0].place, 1)
assert.equal(ranked[1].place, 2)
assert.equal(ranked[2].place, 3)
assert.equal(ranked[3].place, 4)
assert.equal(ranked[4].place, 5, 'First tied player gets 5th')
assert.equal(ranked[5].place, 5, 'Second tied player shares 5th')
assert.equal(ranked[6].place, 7, 'Next player gets 7th (not 6th)')

// ---------------------------------------------------------------------------
// 4. nextSortState (Tapping headers flips asc/desc; numbers high-to-low; player A-Z)
// ---------------------------------------------------------------------------

const defaultState = { column: 'default' as const, direction: 'desc' as const }

// Clicking player starts asc (A to Z)
const toPlayer = nextSortState(defaultState, 'player')
assert.deepEqual(toPlayer, { column: 'player', direction: 'asc' })
// Tapping player again flips to desc (Z to A)
const toPlayerDesc = nextSortState(toPlayer, 'player')
assert.deepEqual(toPlayerDesc, { column: 'player', direction: 'desc' })

// Clicking numbers starts desc (high to low)
const toPoints = nextSortState(defaultState, 'points')
assert.deepEqual(toPoints, { column: 'points', direction: 'desc' })
const toPointsAsc = nextSortState(toPoints, 'points')
assert.deepEqual(toPointsAsc, { column: 'points', direction: 'asc' })

const to18 = nextSortState(defaultState, 'best18')
assert.deepEqual(to18, { column: 'best18', direction: 'desc' })

const to27 = nextSortState(defaultState, 'best27')
assert.deepEqual(to27, { column: 'best27', direction: 'desc' })

// Clicking 'default' resets
assert.deepEqual(nextSortState(toPointsAsc, 'default'), defaultState)

// ---------------------------------------------------------------------------
// 5. sortStandingsRows (Dashes sort last; PLC always preserves official rank)
// ---------------------------------------------------------------------------

const rowWith27_High = baseRow({ playerId: 'a', playerName: 'Alpha', best27: 80, place: 1 })
const rowWith27_Low = baseRow({ playerId: 'b', playerName: 'Beta', best27: 70, place: 2 })
const rowNo27_1 = baseRow({ playerId: 'c', playerName: 'Charlie', best27: null, place: 3 })
const rowNo27_2 = baseRow({ playerId: 'd', playerName: 'Delta', best27: null, place: 4 })

// Best 27 DESC: High (80), Low (70), then dashes (null, null)
const sorted27Desc = sortStandingsRows(
  [rowNo27_1, rowWith27_Low, rowNo27_2, rowWith27_High],
  { column: 'best27', direction: 'desc' },
)
assert.deepEqual(
  sorted27Desc.map((r) => r.playerId),
  ['a', 'b', 'c', 'd'],
  'Best 27 desc: non-nulls high to low, dashes last',
)
// Official places are preserved
assert.deepEqual(
  sorted27Desc.map((r) => r.place),
  [1, 2, 3, 4],
)

// Best 27 ASC: Low (70), High (80), then dashes (null, null) last
const sorted27Asc = sortStandingsRows(
  [rowNo27_1, rowWith27_Low, rowNo27_2, rowWith27_High],
  { column: 'best27', direction: 'asc' },
)
assert.deepEqual(
  sorted27Asc.map((r) => r.playerId),
  ['b', 'a', 'c', 'd'],
  'Best 27 asc: non-nulls low to high, dashes last',
)

// Winnings: $0 is dash, sorts last
const win100 = baseRow({ playerId: 'w1', playerName: 'Rich', winnings: 100, place: 1 })
const win25 = baseRow({ playerId: 'w2', playerName: 'Medium', winnings: 25, place: 2 })
const winZero = baseRow({ playerId: 'w3', playerName: 'None', winnings: 0, place: 3 })

const sortedWinAsc = sortStandingsRows([win100, winZero, win25], { column: 'winnings', direction: 'asc' })
assert.deepEqual(
  sortedWinAsc.map((r) => r.playerId),
  ['w2', 'w1', 'w3'],
  'Winnings asc: $25, $100, then $0 (dash) last',
)

// Sort by Player (alphabetical) maintains official rank
const sortedPlayer = sortStandingsRows([rowWith27_Low, rowWith27_High], { column: 'player', direction: 'asc' })
assert.equal(sortedPlayer[0].playerName, 'Alpha')
assert.equal(sortedPlayer[0].place, 1, 'Alpha retains official rank 1st')
assert.equal(sortedPlayer[1].playerName, 'Beta')
assert.equal(sortedPlayer[1].place, 2, 'Beta retains official rank 2nd')

// ---------------------------------------------------------------------------
// 6. buildOfficialStandings (End-to-end division aggregation)
// ---------------------------------------------------------------------------

const events: PPEvent[] = [
  { id: 'ev-c1', season_id: 's-1', status: 'complete', event_date: '2026-11-01', name: 'Week 1' },
  { id: 'ev-c2', season_id: 's-1', status: 'complete', event_date: '2026-11-08', name: 'Week 2' },
  { id: 'ev-open', season_id: 's-1', status: 'scoring', event_date: '2026-11-15', name: 'Week 3' },
]

const players: Player[] = [
  { id: 'p-m1', name: 'Dave Pro', division: 'M', active: true, created_at: '' },
  { id: 'p-m2', name: 'Bob Mid', division: 'M', active: true, created_at: '' },
  { id: 'p-m3', name: 'Carl Zero', division: 'M', active: true, created_at: '' },
  { id: 'p-w1', name: 'Alice Ace', division: 'W', active: true, created_at: '' },
]
const playerById = new Map(players.map((p) => [p.id, p]))

const entries: Entry[] = [
  // Dave Pro (Men)
  makeEntry({ event_id: 'ev-c1', player_id: 'p-m1', division: 'M', points: 10, place: 1, payout: 50, score_18: 50, score_final: 24, made_final: true }),
  makeEntry({ event_id: 'ev-c2', player_id: 'p-m1', division: 'M', points: 10, place: 1, payout: 50, score_18: 52, score_final: 25, made_final: true }),
  // Bob Mid (Men)
  makeEntry({ event_id: 'ev-c1', player_id: 'p-m2', division: 'M', points: 8, place: 2, payout: 30, score_18: 49, score_final: 22, made_final: true }),
  makeEntry({ event_id: 'ev-c2', player_id: 'p-m2', division: 'M', points: 0, place: 6, payout: 0, score_18: 48, made_final: false }),
  // Carl Zero (Men) - 0 points, never made final
  makeEntry({ event_id: 'ev-c1', player_id: 'p-m3', division: 'M', points: 0, place: 7, payout: 0, score_18: 46, made_final: false }),
  // Alice Ace (Women) - separate division
  makeEntry({ event_id: 'ev-c1', player_id: 'p-w1', division: 'W', points: 10, place: 1, payout: 40, score_18: 48, score_final: 23, made_final: true }),
  // Open event (should be ignored since status !== complete)
  makeEntry({ event_id: 'ev-open', player_id: 'p-m3', division: 'M', points: 10, place: 1, payout: 100 }),
]

const menStandings = buildOfficialStandings({
  entries,
  events,
  division: 'M',
  playerById,
})

assert.equal(menStandings.length, 3, '3 Men played completed events')
assert.equal(menStandings[0].playerName, 'Dave Pro')
assert.equal(menStandings[0].points, 20)
assert.equal(menStandings[0].firstPlaces, 2)
assert.equal(menStandings[0].best18, 52)
assert.equal(menStandings[0].best27, 77) // 52 + 25
assert.equal(menStandings[0].winnings, 100)
assert.equal(menStandings[0].place, 1)

assert.equal(menStandings[1].playerName, 'Bob Mid')
assert.equal(menStandings[1].points, 8)
assert.equal(menStandings[1].firstPlaces, 0)
assert.equal(menStandings[1].best18, 49)
assert.equal(menStandings[1].best27, 71) // 49 + 22
assert.equal(menStandings[1].winnings, 30)
assert.equal(menStandings[1].place, 2)

assert.equal(menStandings[2].playerName, 'Carl Zero')
assert.equal(menStandings[2].points, 0)
assert.equal(menStandings[2].firstPlaces, 0)
assert.equal(menStandings[2].best18, 46)
assert.equal(menStandings[2].best27, null, 'Carl has no Final 9, best27 is null')
assert.equal(menStandings[2].place, 3)

const womenStandings = buildOfficialStandings({
  entries,
  events,
  division: 'W',
  playerById,
})
assert.equal(womenStandings.length, 1)
assert.equal(womenStandings[0].playerName, 'Alice Ace')
assert.equal(womenStandings[0].place, 1)

console.log('standings tests defined ✔')
