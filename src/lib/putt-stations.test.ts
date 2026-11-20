// Run: npx tsx src/lib/putt-stations.test.ts
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from './settings'
import { canConfirmCut, computeNineCommit, totals } from './scoring'
import {
  allCardIdsFromEventCards,
  generateEventCards,
  generateFinal9Cards,
} from './cards'
import { generateCardPins } from './special-events'
import {
  PUTT_STATIONS_9,
  applyStationScoresToEntry,
  clearStationRound,
  emptyNineStations,
  hasPartialStation18,
  nextStationIndexForCard,
  stationProgressLabel,
  summarizeStationRound,
  type StationMake,
} from './putt-stations'
import type { Entry, PPEvent } from './types'

let seq = 0
function makeEntry(patch: Partial<Entry> = {}): Entry {
  seq += 1
  return {
    id: `ent-${seq}`,
    event_id: 'ev-putt-1',
    player_id: `p-${seq}`,
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
    station_scores: null,
    created_at: `2026-11-19T00:00:${String(seq).padStart(2, '0')}Z`,
    ...patch,
  }
}

const fullMakes = (val: 0 | 1 | 2 = 2): StationMake[] =>
  Array.from({ length: 9 }, () => val)

// ---------------------------------------------------------------------------
// 1. Station weights: Basket 1 [1,2,3,4,5] (max 30) & Basket 2 [1,2,3,4] (max 20)
// ---------------------------------------------------------------------------
{
  assert.deepEqual(
    PUTT_STATIONS_9.map(s => s.pointsPerPutt),
    [1, 2, 3, 4, 5, 1, 2, 3, 4],
    'station weights match Basket 1 (1-5) + Basket 2 (1-4)',
  )

  const perfect = summarizeStationRound(fullMakes(2))
  assert.equal(perfect.enteredCount, 9)
  assert.equal(perfect.isComplete, true)
  assert.equal(perfect.basket1Points, 30)
  assert.equal(perfect.basket2Points, 20)
  assert.equal(perfect.totalPoints, 50)
  assert.equal(perfect.isPerfect5, true)
  assert.equal(perfect.isPerfect4, true)
  assert.equal(perfect.isPerfectRound, true)

  const partial = emptyNineStations()
  partial[0] = 2 // 2 * 1pt = 2
  partial[4] = 1 // 1 * 5pts = 5
  const partialSum = summarizeStationRound(partial)
  assert.equal(partialSum.enteredCount, 2)
  assert.equal(partialSum.isComplete, false)
  assert.equal(partialSum.basket1Points, 7)
  assert.equal(partialSum.basket2Points, null)
  assert.equal(partialSum.totalPoints, 7)
  assert.equal(partialSum.isPerfect5, false)

  const zeros = summarizeStationRound(fullMakes(0))
  assert.equal(zeros.enteredCount, 9)
  assert.equal(zeros.isComplete, true)
  assert.equal(zeros.basket1Points, 0)
  assert.equal(zeros.basket2Points, 0)
  assert.equal(zeros.totalPoints, 0)

  const clearedFront = clearStationRound(
    { front: fullMakes(1), back: fullMakes(2) },
    'front',
  )
  assert.ok(clearedFront && !clearedFront.front && clearedFront.back)
  assert.equal(
    clearStationRound({ final: fullMakes(1) }, 'final'),
    null,
    'clearing only round returns null',
  )
}

// ---------------------------------------------------------------------------
// 2. Auto P5/P4/PR detection & fat-finger undo preserving manual awards
// ---------------------------------------------------------------------------
{
  // Entry already has manual high_score + manually awarded perfect4 (never in autoAwards).
  // Scoring Basket 1 perfectly auto-adds perfect5; undoing Basket 1 removes ONLY perfect5.
  let manualEnt = makeEntry({ awards: ['high_score', 'perfect4'] })
  const b1Perfect = emptyNineStations()
  for (let i = 0; i < 5; i++) b1Perfect[i] = 2
  manualEnt = applyStationScoresToEntry(manualEnt, '18', { front: b1Perfect })

  assert.equal(manualEnt.r1_b1, 30)
  assert.equal(manualEnt.r1_b2, null)
  assert.equal(manualEnt.score_front, 30)
  assert.equal(manualEnt.score_18, null)
  assert.ok(manualEnt.awards.includes('perfect5'), 'auto adds perfect5 on 30/30 Basket 1')
  assert.ok(manualEnt.awards.includes('high_score'), 'preserves manual high_score')
  assert.ok(manualEnt.awards.includes('perfect4'), 'preserves manual perfect4')
  assert.deepEqual(manualEnt.station_scores?.autoAwards, ['perfect5'])

  const b1Undone = [...b1Perfect]
  b1Undone[4] = 1
  manualEnt = applyStationScoresToEntry(manualEnt, '18', { front: b1Undone })
  assert.equal(manualEnt.score_front, 25)
  assert.equal(manualEnt.awards.includes('perfect5'), false, 'undoes auto perfect5')
  assert.equal(manualEnt.awards.includes('high_score'), true, 'manual high_score remains after undo')
  assert.equal(
    manualEnt.awards.includes('perfect4'),
    true,
    'manual perfect4 (not in prevAuto) is preserved',
  )

  // Fresh entry achieving 50/50 on Front 9 grants P5 + P4 + PR, and undo clears them
  let ent = makeEntry({ awards: ['high_score'] })
  ent = applyStationScoresToEntry(ent, '18', { front: fullMakes(2) })
  assert.equal(ent.score_front, 50)
  assert.ok(ent.awards.includes('perfect5'))
  assert.ok(ent.awards.includes('perfect4'))
  assert.ok(ent.awards.includes('perfect_round'), 'auto adds perfect_round on 50/50')
  assert.ok(ent.station_scores?.autoAwards?.includes('perfect_round'))

  const undoneFront = fullMakes(2)
  undoneFront[4] = 1
  undoneFront[8] = 1
  ent = applyStationScoresToEntry(ent, '18', { front: undoneFront })
  assert.equal(ent.score_front, 41) // 25 + 16
  assert.equal(ent.awards.includes('perfect5'), false, 'undoes auto perfect5')
  assert.equal(ent.awards.includes('perfect4'), false, 'undoes auto perfect4')
  assert.equal(ent.awards.includes('perfect_round'), false, 'undoes auto perfect_round')
  assert.equal(ent.awards.includes('high_score'), true, 'manual high_score remains after undo')

  // Final 9 perfect round auto detection
  let finalist = makeEntry({ made_final: true, score_front: 40, score_back: 40, score_18: 80 })
  finalist = applyStationScoresToEntry(finalist, 'final', { final: fullMakes(2) })
  assert.equal(finalist.f_b1, 30)
  assert.equal(finalist.f_b2, 20)
  assert.equal(finalist.score_final, 50)
  assert.deepEqual(
    [...finalist.awards].sort(),
    ['perfect4', 'perfect5', 'perfect_round'],
    'Final 9 50/50 auto-grants P5, P4, and PR',
  )
  assert.equal(totals(finalist).total, 130)
}

// ---------------------------------------------------------------------------
// 3. Optionality, Cut confirmation & Admin Grid Override
// ---------------------------------------------------------------------------
{
  const paperEntry = makeEntry({
    score_front: 36,
    score_back: 38,
    score_18: 74,
    station_scores: null,
  })
  assert.equal(hasPartialStation18(paperEntry.station_scores), false)
  assert.equal(canConfirmCut([paperEntry]), true, 'paper-card nights pass cut check without station_scores')

  // Partial live card blocks cut confirmation until complete or overridden by admin
  let partialEntry = makeEntry()
  const partialFront = emptyNineStations()
  partialFront[0] = 2
  partialFront[1] = 1
  partialEntry = applyStationScoresToEntry(partialEntry, '18', {
    front: partialFront,
    back: fullMakes(1),
  })
  assert.equal(partialEntry.score_front, 4) // 2*1 + 1*2
  assert.equal(partialEntry.score_back, 25)
  assert.equal(hasPartialStation18(partialEntry.station_scores), true)
  assert.equal(canConfirmCut([paperEntry, partialEntry]), false, 'partial station scoring blocks cut')

  // Admin overrides Front 9 total in the grid -> clears partial station_scores.front & unblocks cut
  const adminPatch = computeNineCommit(partialEntry, 'front', 36)
  const overridden: Entry = {
    ...partialEntry,
    ...adminPatch,
  }
  assert.equal(overridden.score_front, 36)
  assert.equal(hasPartialStation18(overridden.station_scores), false)
  assert.ok(overridden.station_scores?.back, 'preserves complete back 9 stations when only front is edited')
  assert.equal(canConfirmCut([paperEntry, overridden]), true, 'admin override unblocks cut confirmation')

  // Final 9 manual override clears station_scores.final while keeping front/back
  const withFinal = applyStationScoresToEntry(overridden, 'final', { final: fullMakes(1) })
  const clearedFinal = clearStationRound(withFinal.station_scores, 'final')
  assert.equal(clearedFinal?.final, undefined)
  assert.ok(clearedFinal?.back)
}

// ---------------------------------------------------------------------------
// 4. nextStationIndexForCard catches missed stations across players
// ---------------------------------------------------------------------------
{
  const p1Complete = makeEntry({
    station_scores: { front: fullMakes(1), back: fullMakes(1) },
  })
  const p2MissedStop5 = emptyNineStations()
  for (let i = 0; i < 9; i++) {
    p2MissedStop5[i] = i === 4 ? null : 1
  }
  const p2Incomplete = makeEntry({
    station_scores: { front: p2MissedStop5, back: fullMakes(1) },
  })
  assert.equal(
    nextStationIndexForCard('18', [p1Complete, p2Incomplete]),
    4,
    'jumps to station index 4 missed on Player 2',
  )
  assert.equal(
    nextStationIndexForCard('18', [p1Complete, p1Complete]),
    0,
    'returns 0 when all card players finished all 18 stations',
  )

  const finMissing = fullMakes(1)
  finMissing[6] = null
  const finEnt = makeEntry({
    made_final: true,
    station_scores: { final: finMissing },
  })
  assert.equal(
    nextStationIndexForCard('final', [finEnt]),
    6,
    'jumps to missed station in Final 9',
  )
}

// ---------------------------------------------------------------------------
// 5. Final 9 Card Generation & Separate Final 9 PINs
// ---------------------------------------------------------------------------
{
  const menEntries = Array.from({ length: 6 }, (_, i) =>
    makeEntry({
      event_id: 'ev-f9',
      player_id: `pm-${i + 1}`,
      division: 'M',
      score_front: 40 - i,
      score_back: 40,
      score_18: 80 - i,
      made_final: i < 4, // Top 4 make cut
    }),
  )
  const womenEntries = Array.from({ length: 4 }, (_, i) =>
    makeEntry({
      event_id: 'ev-f9',
      player_id: `pw-${i + 1}`,
      division: 'W',
      score_front: 35 - i,
      score_back: 35,
      score_18: 70 - i,
      made_final: i < 2, // Top 2 make cut
    }),
  )
  const allEntries = [...menEntries, ...womenEntries]
  const fakeEvent = {
    id: 'ev-f9',
    season_id: 's1',
    event_date: '2026-11-19',
    name: 'Week 3',
  } as PPEvent

  const cards18 = generateEventCards({
    eventId: fakeEvent.id,
    entries: allEntries,
    cardSize: 4,
    sortMode: 'checkin',
  })
  const pins18 = generateCardPins(
    [...cards18.cards.M, ...cards18.cards.W].map(c => ({
      id: c.id,
      cardNumber: c.cardNumber,
      startingHole: 1,
    })),
  )

  const withFinal9 = generateFinal9Cards({
    eventId: fakeEvent.id,
    entries: allEntries,
    existingCards: cards18,
    cardSize: 4,
    settings: DEFAULT_SETTINGS,
  })

  assert.equal(withFinal9.final9Cards?.M.length, 1)
  assert.equal(withFinal9.final9Cards?.W.length, 1)
  assert.deepEqual(
    withFinal9.final9Cards?.M[0].playerIds,
    ['pm-1', 'pm-2', 'pm-3', 'pm-4'],
    'includes only Men finalists ordered by 18-hole score',
  )
  assert.deepEqual(
    withFinal9.final9Cards?.W[0].playerIds,
    ['pw-1', 'pw-2'],
    'includes only Women finalists',
  )
  assert.ok(withFinal9.final9Cards?.M[0].id.startsWith('F9-M-'))
  assert.ok(withFinal9.final9Cards?.W[0].id.startsWith('F9-W-'))

  const ids18 = new Set([...cards18.cards.M, ...cards18.cards.W].map(c => c.id))
  const idsF9 = [...(withFinal9.final9Cards?.M ?? []), ...(withFinal9.final9Cards?.W ?? [])].map(
    c => c.id,
  )
  for (const id of idsF9) {
    assert.equal(ids18.has(id), false, 'Final 9 card ID must never collide with 18-hole card ID')
  }

  const allCardIds = allCardIdsFromEventCards(withFinal9)
  const combinedPins = generateCardPins(
    allCardIds.map((cid, idx) => ({ id: cid, cardNumber: idx + 1, startingHole: 1 })),
    pins18,
  )
  for (const id of ids18) {
    assert.equal(combinedPins[id], pins18[id], `preserves 18-hole PIN for ${id}`)
  }
  for (const id of idsF9) {
    assert.match(combinedPins[id] ?? '', /^\d{4}$/, `mints fresh 4-digit PIN for ${id}`)
  }
}

// ---------------------------------------------------------------------------
// 6. stationProgressLabel indicator formatting
// ---------------------------------------------------------------------------
{
  const four = emptyNineStations()
  four[0] = 1
  four[1] = 2
  four[2] = 0
  four[3] = 2
  assert.equal(stationProgressLabel({ front: four }, 'scoring', false), '4/18')
  assert.equal(
    stationProgressLabel({ front: fullMakes(1), back: fullMakes(2) }, 'scoring', false),
    null,
    'returns null once all 18 stations are scored',
  )

  const threeFinal = emptyNineStations()
  threeFinal[0] = 2
  threeFinal[1] = 1
  threeFinal[2] = 0
  assert.equal(stationProgressLabel({ final: threeFinal }, 'final9', true), '3/9')
  assert.equal(stationProgressLabel({ final: threeFinal }, 'final9', false), null)
}

console.log('Putt Night station scoring tests passed ✔')
