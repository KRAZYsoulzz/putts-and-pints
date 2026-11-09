// Run: npx tsx src/lib/cards.test.ts
import assert from 'node:assert/strict'
import {
  calculateCardSizes,
  cardLabel,
  splitPlayersIntoCards,
  generateEventCards,
  shuffleDivisionCards,
  assignPlayerToSmallestCard,
  movePlayerBetweenCards,
  removePlayerFromCards,
  calculateSeasonStandingsPoints,
  sortEntriesForCards,
  loadEventCards,
  saveEventCards,
  clearEventCards,
  loadScoreViewMode,
  saveScoreViewMode,
  WEEK1_EVENT_ID,
  type PPCard,
  type CardSortMode,
} from './cards'
import type { Entry, PPEvent } from './types'

let n = 0
function makeEntry(p: Partial<Entry>): Entry {
  return {
    id: `e${++n}`,
    event_id: 'ev-test',
    player_id: `p${n}`,
    division: 'M',
    paid: true,
    tag_in: null,
    tag_out: null,
    r1_b1: null,
    r1_b2: null,
    r2_b1: null,
    r2_b2: null,
    f_b1: null,
    f_b2: null,
    score_18: null,
    score_final: null,
    awards: [],
    made_final: false,
    tiebreak: null,
    place: null,
    payout: 0,
    points: 0,
    score_front: null,
    score_back: null,
    created_at: `2026-11-12T00:00:${String(n).padStart(2, '0')}`,
    ...p,
  }
}

// ---------------------------------------------------------------------------
// 1. Card Splitting Math
// ---------------------------------------------------------------------------

// 14 players at size 4 = 4/4/3/3 (from prompt)
assert.deepEqual(
  calculateCardSizes(14, 4),
  [4, 4, 3, 3],
  '14 players at size 4 should split into 4/4/3/3',
)

// Differ by at most 1, sum equals N, avoids card of 1 unless total is 1
for (let N = 1; N <= 40; N++) {
  for (const S of [2, 3, 4, 5, 6]) {
    const sizes = calculateCardSizes(N, S)
    const sum = sizes.reduce((a, b) => a + b, 0)
    assert.equal(sum, N, `Sum of sizes for N=${N}, S=${S} must equal ${N}`)

    const max = Math.max(...sizes)
    const min = Math.min(...sizes)
    assert.ok(
      max - min <= 1,
      `Sizes for N=${N}, S=${S} must differ by at most 1, got [${sizes.join(', ')}]`,
    )

    if (N > 1 && S >= 2) {
      assert.ok(
        min >= 2,
        `Sizes for N=${N}, S=${S} must avoid card of 1, got [${sizes.join(', ')}]`,
      )
    }
  }
}

// Edge cases for N <= 1
assert.deepEqual(calculateCardSizes(0, 4), [])
assert.deepEqual(calculateCardSizes(1, 4), [1], '1 player total forces card of 1')
assert.deepEqual(calculateCardSizes(5, 4), [3, 2], '5 players at size 4 must avoid 4/1')
assert.deepEqual(calculateCardSizes(6, 4), [3, 3], '6 players at size 4 splits 3/3')
assert.deepEqual(calculateCardSizes(7, 4), [4, 3], '7 players at size 4 splits 4/3')
assert.deepEqual(calculateCardSizes(8, 4), [4, 4], '8 players at size 4 splits 4/4')
assert.deepEqual(calculateCardSizes(9, 4), [3, 3, 3], '9 players at size 4 splits 3/3/3')

// ---------------------------------------------------------------------------
// 2. Division Separation & Labeling
// ---------------------------------------------------------------------------

assert.equal(cardLabel('M', 1), "Men's Card 1")
assert.equal(cardLabel('W', 2), "Women's Card 2")

const mixedEntries: Entry[] = [
  ...Array.from({ length: 14 }, (_, i) =>
    makeEntry({ player_id: `m-${i + 1}`, division: 'M', event_id: 'ev-1' }),
  ),
  ...Array.from({ length: 7 }, (_, i) =>
    makeEntry({ player_id: `w-${i + 1}`, division: 'W', event_id: 'ev-1' }),
  ),
]

const eventCards = generateEventCards({
  eventId: 'ev-1',
  entries: mixedEntries,
  cardSize: 4,
  sortMode: 'checkin',
})

assert.equal(eventCards.cards.M.length, 4, 'Men with 14 players should have 4 cards')
assert.deepEqual(
  eventCards.cards.M.map((c) => c.playerIds.length),
  [4, 4, 3, 3],
)
assert.equal(eventCards.cards.W.length, 2, 'Women with 7 players should have 2 cards')
assert.deepEqual(
  eventCards.cards.W.map((c) => c.playerIds.length),
  [4, 3],
)

// Men's cards contain only men; Women's cards contain only women
for (const card of eventCards.cards.M) {
  assert.equal(card.division, 'M')
  assert.match(card.name, /^Men's Card \d+$/)
  assert.ok(card.playerIds.every((id) => id.startsWith('m-')))
}
for (const card of eventCards.cards.W) {
  assert.equal(card.division, 'W')
  assert.match(card.name, /^Women's Card \d+$/)
  assert.ok(card.playerIds.every((id) => id.startsWith('w-')))
}

// ---------------------------------------------------------------------------
// 3. Card Sort Options (Checkin, Standings, Random, Shuffle)
// ---------------------------------------------------------------------------

// Check-in order sort
const orderedMen = mixedEntries.filter((e) => e.division === 'M')
const checkinSorted = sortEntriesForCards({
  entries: orderedMen,
  division: 'M',
  sortMode: 'checkin',
})
assert.deepEqual(
  checkinSorted.map((e) => e.player_id),
  orderedMen.map((e) => e.player_id),
  'Checkin sort preserves arrival order',
)

// Standings sort (similar skill plays together in top cards)
const pastEvents: PPEvent[] = [
  {
    id: 'ev-past-1',
    season_id: 's-1',
    status: 'complete',
    event_date: '2026-11-01',
    name: 'Week 1',
  },
  {
    id: 'ev-past-2',
    season_id: 's-1',
    status: 'complete',
    event_date: '2026-11-08',
    name: 'Week 2',
  },
]

const historicalEntries: Entry[] = [
  // p-pro has 20 points, 2 first places
  makeEntry({ event_id: 'ev-past-1', player_id: 'p-pro', division: 'M', points: 10, place: 1, payout: 50 }),
  makeEntry({ event_id: 'ev-past-2', player_id: 'p-pro', division: 'M', points: 10, place: 1, payout: 50 }),
  // p-mid has 8 points
  makeEntry({ event_id: 'ev-past-1', player_id: 'p-mid', division: 'M', points: 8, place: 2, payout: 30 }),
  // p-novice has 2 points
  makeEntry({ event_id: 'ev-past-1', player_id: 'p-novice', division: 'M', points: 2, place: 5, payout: 0 }),
]

const standingsM = [
  makeEntry({ player_id: 'p-novice', division: 'M', created_at: '2026-11-15T00:00:01' }),
  makeEntry({ player_id: 'p-pro', division: 'M', created_at: '2026-11-15T00:00:02' }),
  makeEntry({ player_id: 'p-mid', division: 'M', created_at: '2026-11-15T00:00:03' }),
  makeEntry({ player_id: 'p-unranked', division: 'M', created_at: '2026-11-15T00:00:04' }),
]

const standingsSorted = sortEntriesForCards({
  entries: standingsM,
  division: 'M',
  sortMode: 'standings',
  allEntries: historicalEntries,
  events: pastEvents,
})

assert.deepEqual(
  standingsSorted.map((e) => e.player_id),
  ['p-pro', 'p-mid', 'p-novice', 'p-unranked'],
  'Standings sort ranks top players first so similar skill plays together',
)

// Random sort and Shuffle
let fakeRandomCalls = 0
const fakeRandom = () => {
  fakeRandomCalls++
  return 0.5
}
const randomCards = splitPlayersIntoCards({
  entries: orderedMen,
  division: 'M',
  cardSize: 4,
  sortMode: 'random',
  randomFn: fakeRandom,
})
assert.equal(randomCards.length, 4)
assert.ok(fakeRandomCalls > 0)

const reshuffled = shuffleDivisionCards({
  cards: randomCards,
  division: 'M',
  targetCardSize: 4,
  entries: orderedMen,
  randomFn: () => 0.1,
})
assert.equal(reshuffled.length, 4)
assert.equal(
  reshuffled.flatMap((c) => c.playerIds).length,
  14,
  'Shuffle retains all players in division',
)

// ---------------------------------------------------------------------------
// 4. Late Check-in Goes to Smallest Card
// ---------------------------------------------------------------------------

// Cards of sizes [4, 4, 3, 3]
const baseCards: PPCard[] = [
  { id: 'M-1', division: 'M', cardNumber: 1, name: "Men's Card 1", playerIds: ['m1', 'm2', 'm3', 'm4'] },
  { id: 'M-2', division: 'M', cardNumber: 2, name: "Men's Card 2", playerIds: ['m5', 'm6', 'm7', 'm8'] },
  { id: 'M-3', division: 'M', cardNumber: 3, name: "Men's Card 3", playerIds: ['m9', 'm10', 'm11'] },
  { id: 'M-4', division: 'M', cardNumber: 4, name: "Men's Card 4", playerIds: ['m12', 'm13', 'm14'] },
]

// Player m15 checks in -> goes to Card 3 (first card with min size 3)
const afterLate1 = assignPlayerToSmallestCard(baseCards, 'm15')
assert.deepEqual(afterLate1[2].playerIds, ['m9', 'm10', 'm11', 'm15'])
assert.deepEqual(afterLate1.map((c) => c.playerIds.length), [4, 4, 4, 3])

// Player m16 checks in -> goes to Card 4 (now smallest at 3)
const afterLate2 = assignPlayerToSmallestCard(afterLate1, 'm16')
assert.deepEqual(afterLate2[3].playerIds, ['m12', 'm13', 'm14', 'm16'])
assert.deepEqual(afterLate2.map((c) => c.playerIds.length), [4, 4, 4, 4])

// Player m17 checks in when all are 4 -> goes to Card 1
const afterLate3 = assignPlayerToSmallestCard(afterLate2, 'm17')
assert.deepEqual(afterLate3[0].playerIds, ['m1', 'm2', 'm3', 'm4', 'm17'])
assert.deepEqual(afterLate3.map((c) => c.playerIds.length), [5, 4, 4, 4])

// ---------------------------------------------------------------------------
// 5. Moving a Player Between Cards
// ---------------------------------------------------------------------------

// Move m1 from Card 1 to Card 3
const moved = movePlayerBetweenCards({
  cards: baseCards,
  division: 'M',
  playerId: 'm1',
  targetCardId: 'M-3',
})
assert.equal(moved[0].playerIds.includes('m1'), false)
assert.equal(moved[2].playerIds.includes('m1'), true)

// Move m2 to a new card
const movedToNew = movePlayerBetweenCards({
  cards: baseCards,
  division: 'M',
  playerId: 'm2',
  targetCardId: 'new',
})
assert.equal(movedToNew.length, 5)
assert.equal(movedToNew[4].name, "Men's Card 5")
assert.deepEqual(movedToNew[4].playerIds, ['m2'])

// Remove player when unchecking in
const removed = removePlayerFromCards(baseCards, 'm1')
assert.equal(removed[0].playerIds.includes('m1'), false)
assert.equal(removed[0].playerIds.length, 3)

// ---------------------------------------------------------------------------
// 6. Local Storage & Week 1 Guard
// ---------------------------------------------------------------------------

const storage = new Map<string, string>()
const mockLocalStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, String(v)),
  removeItem: (k: string) => storage.delete(k),
}
;(globalThis as unknown as { localStorage: typeof mockLocalStorage }).localStorage = mockLocalStorage

const dummyCards = {
  eventId: 'ev-1',
  targetCardSize: 4,
  sortMode: 'checkin' as CardSortMode,
  cards: { M: baseCards, W: [] },
  updatedAt: new Date().toISOString(),
}

// Saving normal event succeeds
assert.equal(saveEventCards('ev-1', dummyCards), true)
assert.ok(storage.has('pp_cards_ev-1'))
const loaded = loadEventCards('ev-1')
assert.equal(loaded?.targetCardSize, 4)
assert.equal(loaded?.cards.M.length, 4)

// Saving Week 1 is strictly refused
assert.equal(
  saveEventCards(WEEK1_EVENT_ID, dummyCards),
  false,
  'Week 1 cards must never be written to storage',
)
assert.equal(storage.has(`pp_cards_${WEEK1_EVENT_ID}`), false)

// calculateSeasonStandingsPoints calculation
const pts = calculateSeasonStandingsPoints(
  'p-pro',
  'M',
  historicalEntries,
  pastEvents,
)
assert.equal(pts.points, 20)
assert.equal(pts.firstPlaces, 2)
assert.equal(pts.winnings, 100)

// View mode loads and saves with fallback
assert.equal(loadScoreViewMode(), 'list')
saveScoreViewMode('card')
assert.equal(loadScoreViewMode(), 'card')
saveScoreViewMode('list')
assert.equal(loadScoreViewMode(), 'list')

// Clear normal event cards succeeds
assert.equal(clearEventCards('ev-1'), true)
assert.equal(storage.has('pp_cards_ev-1'), false)

// Clearing Week 1 is strictly refused
assert.equal(clearEventCards(WEEK1_EVENT_ID), false)

console.log('cards tests defined ✔')
