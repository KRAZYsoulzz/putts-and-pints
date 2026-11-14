import assert from 'node:assert/strict'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { DataProvider } from './store'
import { SpecialEventsProvider } from './special-events-store'
import SpecialEvents from '../pages/SpecialEvents'
import {
  addCardToEvent,
  applyCardHoleScores,
  assignTeamsToCards,
  assignUnassignedParticipants,
  buildSpecialEventSnapshot,
  courseParTotals,
  createBlackFridayDubsPreset,
  drawDoublesTeams,
  emptyHoles,
  filterHistorySpecialEvents,
  formatSpecialTeamName,
  generateCardPins,
  moveParticipantBetweenTeams,
  normalizeSpecialEvent,
  rankSpecialTeams,
  removeEmptyCardFromEvent,
  removeParticipantFromEvent,
  resolveAcePayouts,
  sortSpecialEvents,
  specialEventMoney,
  suggestedTeamPaidPlaces,
  suggestedTeamPayouts,
  type SpecialEvent,
  type SpecialParticipant,
  type SpecialPool,
} from './special-events'

interface MemoryStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createMemoryStorage(): MemoryStorage {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: key => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
}

const LOCAL_EVENTS_KEY = 'pp_special_events_v1'
const LOCAL_PINS_KEY = 'pp_special_pins_v1'
const UNLOCKED_CARDS_SESSION_KEY = 'pp_special_unlocked_cards_v1'

const makeParticipant = (
  id: string,
  name: string,
  pool: SpecialPool,
  paid = true,
  playerId: string | null = null,
): SpecialParticipant => ({
  id,
  playerId,
  name,
  pool,
  paid,
  createdAt: '2026-11-27T09:05:00.000Z',
})

function extractButtonByText(html: string, marker: string): string {
  const idx = html.indexOf(marker)
  assert.ok(idx >= 0, `expected rendered HTML to contain "${marker}"`)
  const start = html.lastIndexOf('<button', idx)
  const end = html.indexOf('</button>', idx)
  assert.ok(start >= 0 && end > start, `expected button wrapping "${marker}"`)
  return html.slice(start, end + '</button>'.length)
}

function renderSpecialEventsHtml(): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        DataProvider,
        null,
        createElement(SpecialEventsProvider, null, createElement(SpecialEvents)),
      ),
    ),
  )
}

const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const prevReactDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'React')
const localStorageMock = createMemoryStorage()
const sessionStorageMock = createMemoryStorage()

const mockWindow = {
  localStorage: localStorageMock,
  sessionStorage: sessionStorageMock,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout,
  clearTimeout,
}

Object.defineProperty(globalThis, 'window', {
  value: mockWindow,
  configurable: true,
  writable: true,
})

Object.defineProperty(globalThis, 'React', {
  value: React,
  configurable: true,
  writable: true,
})

try {
  // =========================================================================
  // STAGE 1 — Scratch Empty State & Course Customization
  // =========================================================================
  const emptyHtml = renderSpecialEventsHtml()
  assert.ok(emptyHtml.includes('No Special Events Yet'), 'fresh app renders empty special events state')
  assert.equal(emptyHtml.includes('Event History'), false, 'fresh app does not show history list')

  let ev: SpecialEvent = createBlackFridayDubsPreset('2026-11-27')
  const basePars = courseParTotals(ev.courseHoles)
  assert.deepEqual(basePars, { frontPar: 27, backPar: 29, totalPar: 56, totalDistanceFt: 4996 })

  // Customize course: note on Hole 7 & Par 4 on Hole 14 (Total Par becomes 57)
  ev = {
    ...ev,
    courseHoles: ev.courseHoles.map(ch => {
      if (ch.hole === 7) return { ...ch, note: 'Mando left of oak' }
      if (ch.hole === 14) return { ...ch, par: 4 }
      return ch
    }),
  }
  assert.equal(courseParTotals(ev.courseHoles).totalPar, 57)

  // =========================================================================
  // STAGE 2 — Check-In, Pool/Paid Toggles, & Participant Removal
  // =========================================================================
  const roster = [
    makeParticipant('p1', 'Alex Rivera', 'A', true, 'pp-1'),
    makeParticipant('p2', 'Blake Chen', 'A', true, 'pp-2'),
    makeParticipant('p3', 'chris', 'A', true, null),
    makeParticipant('p4', 'Devon Brooks', 'A', true, 'pp-4'),
    makeParticipant('p5', 'Evan Diaz', 'A', false, null),
    makeParticipant('p6', 'Frankie Gomez', 'A', true, null),
    makeParticipant('p7', 'Grace Kim', 'B', true, 'pp-7'),
    makeParticipant('p8', 'Hannah Lee', 'B', true, 'pp-8'),
    makeParticipant('p9', 'Iris Patel', 'B', true, null),
    makeParticipant('p10', 'Jordan Temp', 'B', true, null),
  ]
  ev = {
    ...ev,
    participants: roster,
    aceResolution: { mode: 'pending', winnerParticipantIds: ['p10'] },
  }

  // Toggle Frankie A -> B (gives 5 Pool A, 5 Pool B), toggle Evan unpaid -> paid
  ev = {
    ...ev,
    participants: ev.participants.map(p => {
      if (p.id === 'p6') return { ...p, pool: 'B' }
      if (p.id === 'p5') return { ...p, paid: true }
      return p
    }),
  }

  // Remove p10 before draw -> 9 players (5 A, 4 B), clears p10 from ace winners
  ev = removeParticipantFromEvent(ev, 'p10')
  assert.equal(ev.participants.length, 9)
  assert.equal(ev.participants.filter(p => p.pool === 'A').length, 5)
  assert.equal(ev.participants.filter(p => p.pool === 'B').length, 4)
  assert.deepEqual(ev.aceResolution.winnerParticipantIds, [])

  const nineMoney = specialEventMoney(ev.participants, ev.config)
  assert.equal(nineMoney.totalEntryPot, 180)
  assert.equal(nineMoney.acePot, 45)
  assert.equal(nineMoney.courseFund, 45)
  assert.equal(nineMoney.payoutPurse, 90)
  assert.equal(nineMoney.unpaidCount, 0)

  // =========================================================================
  // STAGE 3 — Random Draw, Partner Swaps, Split/Merge Cali, & Late Walk-Up
  // =========================================================================
  ev = { ...ev, status: 'draw' }
  const drawn = drawDoublesTeams(ev.participants, ev.config.teamsPerCard, () => 0.37)
  assert.equal(drawn.teams.length, 5)
  assert.equal(drawn.teams.filter(t => !t.isCali).length, 4)
  assert.equal(drawn.teams.filter(t => t.isCali).length, 1)
  assert.equal(drawn.cards.length, 3)

  let pins = generateCardPins(drawn.cards, {}, () => 0.41)
  assert.equal(Object.keys(pins).length, 3)
  assert.equal(new Set(Object.values(pins)).size, 3)
  ev = { ...ev, teams: drawn.teams, cards: drawn.cards }

  // Swap 1st player of Team 1 with 1st player of Team 2
  const origT1First = ev.teams[0].participantIds[0]
  const origT2First = ev.teams[1].participantIds[0]
  ev = {
    ...ev,
    teams: moveParticipantBetweenTeams(ev.teams, origT1First, ev.teams[1].id, origT2First),
  }
  assert.ok(ev.teams[0].participantIds.includes(origT2First))
  assert.ok(ev.teams[1].participantIds.includes(origT1First))

  // Split 1st player of Team 3 out to solo Cali, then merge both Calis together
  const caliBefore = ev.teams.find(t => t.isCali)!
  const splitTarget = ev.teams[2].participantIds[0]
  ev = { ...ev, teams: moveParticipantBetweenTeams(ev.teams, splitTarget, 'new_cali') }
  assert.equal(ev.teams.length, 6)
  assert.equal(ev.teams.filter(t => t.isCali).length, 3)

  ev = { ...ev, teams: moveParticipantBetweenTeams(ev.teams, splitTarget, caliBefore.id) }
  assert.equal(ev.teams.length, 5)
  assert.equal(ev.teams.filter(t => t.isCali).length, 1)

  // Snapshot existing 2-player pairs, add a 10th late walk-up Pool B player, and assign without reshuffling
  const existingPairSignatures = ev.teams
    .filter(t => t.participantIds.length === 2)
    .map(t => ({ id: t.id, members: [...t.participantIds] }))
  const lateWalkup = makeParticipant('p10_late', 'Taylor Walkup', 'B', true, null)
  ev = { ...ev, participants: [...ev.participants, lateWalkup] }

  const afterLate = assignUnassignedParticipants(
    ev.participants,
    ev.teams,
    ev.cards,
    ev.config.teamsPerCard,
    () => 0.5,
  )
  ev = { ...ev, teams: afterLate.teams, cards: afterLate.cards }
  pins = generateCardPins(ev.cards, pins)
  assert.equal(ev.teams.length, 5)
  assert.equal(ev.teams.filter(t => t.isCali).length, 0, 'late Pool B walkup paired with solo Cali team')
  for (const snapPair of existingPairSignatures) {
    const found = ev.teams.find(t => t.id === snapPair.id)!
    assert.deepEqual(found.participantIds, snapPair.members, 'existing pairs stay intact')
  }

  const tenMoney = specialEventMoney(ev.participants, ev.config)
  assert.equal(tenMoney.totalEntryPot, 200)
  assert.equal(tenMoney.acePot, 50)
  assert.equal(tenMoney.courseFund, 50)
  assert.equal(tenMoney.payoutPurse, 100)

  // =========================================================================
  // STAGE 4 — Changing Cards (+ Extra Card, Move Teams, Start Hole, Remove Empty)
  // =========================================================================
  const cardsWithExtra = addCardToEvent(ev.cards)
  assert.equal(cardsWithExtra.length, 4)
  const extraCard = cardsWithExtra[3]
  assert.equal(extraCard.id, 'card-4')
  assert.equal(extraCard.cardNumber, 4)
  assert.equal(cardsWithExtra.slice(0, 3).some(c => c.startingHole === extraCard.startingHole), false)

  const pinsWithExtra = generateCardPins(cardsWithExtra, pins, () => 0.63)
  assert.equal(pinsWithExtra['card-1'], pins['card-1'])
  assert.equal(pinsWithExtra['card-2'], pins['card-2'])
  assert.equal(pinsWithExtra['card-3'], pins['card-3'])
  assert.match(pinsWithExtra['card-4'], /^\d{4}$/)
  pins = pinsWithExtra

  // Move Team 2 (from Card 1) and Team 5 (from Card 3) onto Card 4, leaving Card 3 empty
  const team1 = ev.teams[0]
  const team2 = ev.teams[1]
  const team3 = ev.teams[2]
  const team4 = ev.teams[3]
  const team5 = ev.teams[4]

  ev = {
    ...ev,
    cards: cardsWithExtra,
    teams: ev.teams.map(t => (t.id === team2.id || t.id === team5.id ? { ...t, cardId: extraCard.id } : t)),
  }

  // Non-empty card-1 cannot be removed; empty card-3 removes cleanly and renumbers remaining cards
  assert.equal(removeEmptyCardFromEvent(ev.cards, ev.teams, 'card-1').length, 4)
  const prunedCards = removeEmptyCardFromEvent(ev.cards, ev.teams, 'card-3')
  assert.equal(prunedCards.length, 3)
  assert.deepEqual(prunedCards.map(c => c.cardNumber), [1, 2, 3])
  assert.equal(prunedCards[2].id, 'card-4')
  assert.deepEqual(
    ev.teams.filter(t => t.cardId === 'card-4').map(t => t.id),
    [team2.id, team5.id],
  )

  // Set Card 2 starting hole to #10, and delete unused card-3 PIN from map via generateCardPins
  ev = {
    ...ev,
    cards: prunedCards.map(c => (c.id === 'card-2' ? { ...c, startingHole: 10 } : c)),
  }
  pins = generateCardPins(ev.cards, pins)
  assert.equal(Object.keys(pins).length, 3)
  assert.equal(pins['card-4'], pinsWithExtra['card-4'])

  // Also verify assignTeamsToCards(teams, 3) regroups 5 teams into 2 cards cleanly on a copy
  const regroupedCopy = assignTeamsToCards(ev.teams, 3)
  assert.equal(regroupedCopy.cards.length, 2)
  assert.equal(regroupedCopy.teams.filter(t => t.cardId === 'card-1').length, 3)
  assert.equal(regroupedCopy.teams.filter(t => t.cardId === 'card-2').length, 2)

  // =========================================================================
  // STAGE 5 — Multi-Card Player PIN Unlock, PIN Invalidation, & Concurrent Scoring
  // =========================================================================
  ev = { ...ev, status: 'scoring' }
  const persistState = (nextEvent: SpecialEvent, nextPins = pins) => {
    localStorageMock.setItem(LOCAL_EVENTS_KEY, JSON.stringify(sortSpecialEvents([nextEvent])))
    localStorageMock.setItem(LOCAL_PINS_KEY, JSON.stringify({ [nextEvent.id]: nextPins }))
  }
  persistState(ev, pins)

  // Initially all cards appear locked to public player view
  let scoringHtml = renderSpecialEventsHtml()
  assert.ok(scoringHtml.includes('Live Leaderboard (Strokes to Par)'))
  assert.ok(scoringHtml.includes('Player Mobile Scorecard'))
  assert.ok(scoringHtml.includes('Card 1 (Hole 1)'))
  assert.ok(scoringHtml.includes('Card 2 (Hole 10)'))
  assert.ok(scoringHtml.includes('Card 3 (Hole'))
  assert.ok(scoringHtml.includes('History<span class="count">0</span>'))
  assert.ok(extractButtonByText(scoringHtml, 'Card 1 (Hole 1)').includes('lucide-lock'))

  // Player unlocks Card 1 in sessionStorage with current PIN
  const oldPin1 = pins['card-1']
  sessionStorageMock.setItem(
    UNLOCKED_CARDS_SESSION_KEY,
    JSON.stringify({ [`${ev.id}:card-1`]: oldPin1 }),
  )
  scoringHtml = renderSpecialEventsHtml()
  const unlockedBtn = extractButtonByText(scoringHtml, 'Card 1 (Hole 1)')
  assert.ok(unlockedBtn.includes('btn-primary'), 'valid cached PIN unlocks Card 1')
  assert.ok(unlockedBtn.includes('lucide-unlock'))

  // Card 1 scores Holes 1-5 for Team 1 at -3 (2, 2, 2, 3, 3 = 12 vs par 15)
  const t1Partial = emptyHoles()
  t1Partial[0] = 2
  t1Partial[1] = 2
  t1Partial[2] = 2
  t1Partial[3] = 3
  t1Partial[4] = 3
  ev = applyCardHoleScores(ev, 'card-1', { [team1.id]: t1Partial })

  // Regenerate Card 1 PIN -> stale old PIN in sessionStorage must immediately re-lock Card 1
  const pinsWithoutCard1 = { ...pins }
  delete pinsWithoutCard1['card-1']
  let regeneratedPins = generateCardPins(ev.cards, pinsWithoutCard1, () => 0.19)
  if (regeneratedPins['card-1'] === oldPin1) {
    regeneratedPins = generateCardPins(ev.cards, pinsWithoutCard1, () => 0.88)
  }
  assert.notEqual(regeneratedPins['card-1'], oldPin1)
  assert.equal(regeneratedPins['card-2'], pins['card-2'])
  assert.equal(regeneratedPins['card-4'], pins['card-4'])
  pins = regeneratedPins
  persistState(ev, pins)

  scoringHtml = renderSpecialEventsHtml()
  assert.ok(
    extractButtonByText(scoringHtml, 'Card 1 (Hole 1)').includes('lucide-lock'),
    'regenerating Card 1 PIN immediately invalidates stale unlocked player session',
  )

  // Updating sessionStorage to new PIN unlocks Card 1 again
  sessionStorageMock.setItem(
    UNLOCKED_CARDS_SESSION_KEY,
    JSON.stringify({ [`${ev.id}:card-1`]: pins['card-1'] }),
  )
  assert.ok(extractButtonByText(renderSpecialEventsHtml(), 'Card 1 (Hole 1)').includes('lucide-unlock'))

  // Concurrently Card 2 (starting Hole 10) scores 16 holes (10-18 and 1-7; skipping Hole 8 & Hole 9)
  // Remember Hole 14 was customized to Par 4, so 16 played holes have Par 51 (57 total - 3 - 3).
  const makeSixteenPar = () => {
    const arr = emptyHoles()
    for (let i = 0; i < 18; i++) {
      if (i === 7 || i === 8) continue
      arr[i] = ev.courseHoles[i].par
    }
    return arr
  }
  const t3Partial = makeSixteenPar()
  t3Partial[0] = 2 // -1
  t3Partial[1] = 2 // -2 (49 strokes vs 51 par)
  const t4Partial = makeSixteenPar()
  t4Partial[0] = 4 // +1 (52 strokes vs 51 par)

  ev = applyCardHoleScores(ev, 'card-2', {
    [team3.id]: t3Partial,
    [team4.id]: t4Partial,
  })
  // Card 1 scores on Team 1 stay untouched
  assert.deepEqual(ev.teams.find(t => t.id === team1.id)!.holes.slice(0, 5), [2, 2, 2, 3, 3])

  // Verify live leaderboard strokes-to-par order: Team 1 (-3 Thru 5) beats Team 3 (-2 Thru 16)!
  const midRankings = rankSpecialTeams(ev.teams, ev.courseHoles, ev.payoutPlaces)
  assert.deepEqual(
    midRankings.leaderboard.map(r => [r.team.id, r.summary.toPar, r.summary.thru, r.place]),
    [
      [team1.id, -3, 5, 1],
      [team3.id, -2, 16, 2],
      [team4.id, 1, 16, 3],
    ],
  )
  assert.equal(midRankings.notStarted.length, 2)

  // Finish 18 holes across separate cards: Team 1 & Team 2 tied at -6 (51), Team 3 at -3 (54), Team 4 at E (57)
  const t1Full = ev.courseHoles.map(ch => ch.par)
  for (let i = 0; i < 6; i++) t1Full[i] -= 1 // 51 (-6)
  ev = applyCardHoleScores(ev, 'card-1', { [team1.id]: t1Full })

  const t2Full = ev.courseHoles.map(ch => ch.par)
  for (let i = 9; i < 15; i++) t2Full[i] -= 1 // 51 (-6)
  ev = applyCardHoleScores(ev, 'card-4', { [team2.id]: t2Full })

  const t3Full = [...t3Partial]
  t3Full[7] = 2 // birdie on Hole 8 -> -3 (54)
  t3Full[8] = 3
  const t4Full = [...t4Partial]
  t4Full[7] = 2 // birdie on Hole 8 brings +1 back to E (57)
  t4Full[8] = 3
  ev = applyCardHoleScores(ev, 'card-2', {
    [team3.id]: t3Full,
    [team4.id]: t4Full,
  })

  // Team 5 on Card 4 receives Director manual 18-hole override at 59 (+2 on Par 57)
  ev = {
    ...ev,
    teams: ev.teams.map(t => (t.id === team5.id ? { ...t, manualTotal18: 59 } : t)),
  }

  // =========================================================================
  // STAGE 6 — Results, Payouts, Tie Splits, Playoff Tiebreaker, & Ace / CTP
  // =========================================================================
  ev = { ...ev, status: 'results' }
  const paidPlaces = suggestedTeamPaidPlaces(ev.teams.length)
  assert.equal(paidPlaces, 1)
  // Adjust to 2 paid places -> [66, 34] ($2-even checks so partners split crisp whole dollars)
  const twoPlacePayouts = suggestedTeamPayouts(tenMoney.payoutPurse, 2)
  assert.deepEqual(twoPlacePayouts, [66, 34])
  ev = { ...ev, payoutPlaces: twoPlacePayouts }

  // Before playoff tiebreak, Team 1 & Team 2 split 1st+2nd ($66 + $34 = $100 -> $50 each)
  const tiedRankings = rankSpecialTeams(ev.teams, ev.courseHoles, ev.payoutPlaces)
  assert.equal(tiedRankings.leaderboard[0].place, 1)
  assert.equal(tiedRankings.leaderboard[1].place, 1)
  assert.equal(tiedRankings.leaderboard[0].tied, true)
  assert.equal(tiedRankings.payoutByTeamId.get(team1.id), 50)
  assert.equal(tiedRankings.payoutByTeamId.get(team2.id), 50)

  // Sudden-death playoff awards 1st ($66) to Team 2 and 2nd ($34) to Team 1
  ev = {
    ...ev,
    teams: ev.teams.map(t => {
      if (t.id === team2.id) return { ...t, playoffRank: 1 }
      if (t.id === team1.id) return { ...t, playoffRank: 2 }
      return t
    }),
  }
  const playoffRankings = rankSpecialTeams(ev.teams, ev.courseHoles, ev.payoutPlaces)
  assert.equal(playoffRankings.leaderboard[0].team.id, team2.id)
  assert.equal(playoffRankings.leaderboard[0].place, 1)
  assert.equal(playoffRankings.leaderboard[0].tied, false)
  assert.equal(playoffRankings.payoutByTeamId.get(team2.id), 66)
  assert.equal(playoffRankings.payoutByTeamId.get(team1.id), 34)
  assert.equal(playoffRankings.payoutByTeamId.get(team3.id), undefined)

  // Verify Ace vs CTP payout resolution rules on $50 Ace Pot
  assert.deepEqual(resolveAcePayouts(50, { mode: 'ctp', winnerParticipantIds: ['p1'] }), [
    { participantId: 'p1', amount: 50 },
  ])
  assert.deepEqual(resolveAcePayouts(50, { mode: 'ace', winnerParticipantIds: ['p7'] }), [
    { participantId: 'p7', amount: 50 },
  ])
  const splitAce = resolveAcePayouts(50, { mode: 'ace', winnerParticipantIds: ['p1', 'p7'] })
  assert.deepEqual(splitAce, [
    { participantId: 'p1', amount: 25 },
    { participantId: 'p7', amount: 25 },
  ])
  ev = {
    ...ev,
    aceResolution: { mode: 'ace', winnerParticipantIds: ['p1', 'p7'] },
  }

  // =========================================================================
  // STAGE 7 — Finalize to History, Snapshot Render, Reopen, & Partial Isolation
  // =========================================================================
  ev = normalizeSpecialEvent({ ...ev, status: 'complete' })
  persistState(ev, pins)

  const historyHtml = renderSpecialEventsHtml()
  assert.ok(historyHtml.includes('Event History'), 'lands on Event History when all events are complete')
  assert.ok(historyHtml.includes('History<span class="count">1</span>'))
  assert.ok(historyHtml.includes('Black Friday Draw Dubs'))
  assert.ok(historyHtml.includes('Official'))
  assert.ok(historyHtml.includes('View Full Standings'))
  assert.ok(historyHtml.includes('-6'))
  assert.ok(historyHtml.includes('$66'))
  assert.ok(historyHtml.includes('Gatekeepers Course Fund'))
  assert.equal(historyHtml.includes('Score a Card (PIN)'), false, 'completed event locks card PIN scoring')

  const snap = buildSpecialEventSnapshot(ev)
  const pMap = new Map(ev.participants.map(p => [p.id, p]))
  const expectedWinnerName = formatSpecialTeamName(
    ev.teams.find(t => t.id === team2.id)!,
    pMap,
  )
  assert.equal(snap.winners[0].teamId, team2.id)
  assert.equal(snap.winners[0].teamName, expectedWinnerName)
  assert.equal(snap.winners[0].toPar, -6)
  assert.equal(snap.winners[0].strokes, 51)
  assert.equal(snap.winners[0].payout, 66)
  assert.equal(snap.courseFund, 50)
  assert.deepEqual(snap.aceOutcome, {
    mode: 'ace',
    winners: [
      { participantId: 'p1', name: 'Alex Rivera', amount: 25 },
      { participantId: 'p7', name: 'Grace Kim', amount: 25 },
    ],
  })

  // Reopen removes from History until finalized again
  const reopened = { ...ev, status: 'results' as const }
  assert.equal(filterHistorySpecialEvents([reopened]).length, 0)
  ev = { ...reopened, status: 'complete' }
  assert.equal(filterHistorySpecialEvents([ev]).length, 1)

  // Second partial event stays live and never leaks into History
  const secondPartial: SpecialEvent = {
    ...createBlackFridayDubsPreset('2026-12-26'),
    name: 'Holiday Hangover Draw Dubs',
    status: 'checkin',
  }
  localStorageMock.setItem(
    LOCAL_EVENTS_KEY,
    JSON.stringify(sortSpecialEvents([ev, secondPartial])),
  )
  assert.deepEqual(
    filterHistorySpecialEvents([ev, secondPartial]).map(x => x.id),
    [ev.id],
    'partial event excluded from History',
  )

  const mixedHtml = renderSpecialEventsHtml()
  assert.ok(mixedHtml.includes('Holiday Hangover Draw Dubs'), 'live partial event takes Current view')
  assert.ok(mixedHtml.includes('History<span class="count">1</span>'), 'History count stays at 1')

  console.log('Special events full E2E lifecycle tests passed ✔')
} finally {
  if (prevDescriptor) {
    Object.defineProperty(globalThis, 'window', prevDescriptor)
  } else {
    delete (globalThis as { window?: unknown }).window
  }
  if (prevReactDescriptor) {
    Object.defineProperty(globalThis, 'React', prevReactDescriptor)
  } else {
    delete (globalThis as { React?: unknown }).React
  }
}
