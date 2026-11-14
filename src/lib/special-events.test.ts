import assert from 'node:assert/strict'
import {
  GATEWAY_TRINITY_18_HOLES,
  addCardToEvent,
  assignTeamsToCards,
  buildSpecialEventSnapshot,
  courseParTotals,
  createBlackFridayDubsPreset,
  drawDoublesTeams,
  emptyHoles,
  filterHistorySpecialEvents,
  formatSpecialTeamName,
  formatToPar,
  generateCardPins,
  moveParticipantBetweenTeams,
  nextHoleOrderForCard,
  rankSpecialTeams,
  removeEmptyCardFromEvent,
  resolveAcePayouts,
  specialEventMoney,
  suggestedTeamPaidPlaces,
  suggestedTeamPayouts,
  teamScoreSummary,
  type SpecialParticipant,
  type SpecialPool,
  type SpecialTeam,
} from './special-events'

const p = (id: string, name: string, pool: SpecialPool, paid = true): SpecialParticipant => ({
  id,
  playerId: null,
  name,
  pool,
  paid,
  createdAt: '2026-11-27T09:00:00Z',
})

// 1. Gateway Park - Trinity Side baseline & Black Friday preset
{
  const ev = createBlackFridayDubsPreset('2026-11-27')
  assert.equal(ev.name, 'Black Friday Draw Dubs')
  assert.equal(ev.location, 'Gateway Park - Trinity Side')
  assert.equal(ev.courseHoles.length, 18)
  assert.equal(GATEWAY_TRINITY_18_HOLES.length, 18)
  const par = courseParTotals(ev.courseHoles)
  assert.deepEqual(par, { frontPar: 27, backPar: 29, totalPar: 56, totalDistanceFt: 4996 })
  assert.equal(formatToPar(null), '--')
  assert.equal(formatToPar(0), 'E')
  assert.equal(formatToPar(-3), '-3')
  assert.equal(formatToPar(2), '+2')
}

// 2. Entry fee breakdown ($20 -> $5 Ace, $5 Course Fund, $10 Purse)
{
  const ev = createBlackFridayDubsPreset('2026-11-27')
  const parts = [
    p('a1', 'Alex', 'A', true),
    p('a2', 'Blake', 'A', true),
    p('b1', 'Casey', 'B', true),
    p('b2', 'Drew', 'B', false),
  ]
  const fin = specialEventMoney(parts, ev.config)
  assert.equal(fin.participantCount, 4)
  assert.equal(fin.paidCount, 3)
  assert.equal(fin.unpaidCount, 1)
  assert.equal(fin.unpaidAmount, 20)
  assert.equal(fin.totalEntryPot, 80)
  assert.equal(fin.acePot, 20)
  assert.equal(fin.courseFund, 20)
  assert.equal(fin.payoutPurse, 40)
}

// 3. Random draw: balanced A+B, uneven pools, odd headcount Cali, swaps
{
  const balanced = [p('a1', 'A1', 'A'), p('a2', 'A2', 'A'), p('b1', 'B1', 'B'), p('b2', 'B2', 'B')]
  const draw1 = drawDoublesTeams(balanced, 2, () => 0.42)
  assert.equal(draw1.teams.length, 2)
  assert.equal(draw1.cards.length, 1)
  for (const t of draw1.teams) {
    assert.equal(t.isCali, false)
    const pools = t.participantIds.map(id => balanced.find(x => x.id === id)!.pool).sort()
    assert.deepEqual(pools, ['A', 'B'])
  }

  // Uneven pools + odd total (4 A, 1 B => 1 A+B, 1 A+A, 1 Cali)
  const uneven = [
    p('a1', 'A1', 'A'),
    p('a2', 'A2', 'A'),
    p('a3', 'A3', 'A'),
    p('a4', 'A4', 'A'),
    p('b1', 'B1', 'B'),
  ]
  const draw2 = drawDoublesTeams(uneven, 2, () => 0.2)
  assert.equal(draw2.teams.length, 3)
  assert.equal(draw2.teams.filter(t => t.isCali).length, 1)
  assert.equal(draw2.teams.filter(t => t.participantIds.length === 2).length, 2)

  // Swap partner between two teams & split out Cali
  const swapped = moveParticipantBetweenTeams(draw1.teams, 'a1', draw1.teams[1].id)
  assert.equal(swapped.length, 2)
  assert.ok(swapped[1].participantIds.includes('a1'))

  const caliSplit = moveParticipantBetweenTeams(draw1.teams, 'a1', 'new_cali')
  assert.equal(caliSplit.length, 3)
  assert.equal(caliSplit.filter(t => t.isCali).length, 2)
}

// 4. Card PIN uniqueness & shotgun hole wraparound
{
  const dummyTeams: SpecialTeam[] = Array.from({ length: 4 }, (_, i) => ({
    id: `t${i + 1}`,
    teamNumber: i + 1,
    participantIds: [`p${i * 2 + 1}`, `p${i * 2 + 2}`],
    isCali: false,
    cardId: null,
    holes: emptyHoles(),
    manualTotal18: null,
    playoffRank: null,
  }))
  const grouped = assignTeamsToCards(dummyTeams, 2)
  assert.equal(grouped.cards.length, 2)
  const pins = generateCardPins(grouped.cards, {}, () => 0.5)
  assert.match(pins[grouped.cards[0].id], /^\d{4}$/)
  assert.match(pins[grouped.cards[1].id], /^\d{4}$/)
  assert.notEqual(pins[grouped.cards[0].id], pins[grouped.cards[1].id])

  const partialHoles = emptyHoles()
  partialHoles[9] = 3  // Hole 10 scored
  partialHoles[10] = 2 // Hole 11 scored
  assert.equal(nextHoleOrderForCard(10, partialHoles), 12)
  for (let i = 9; i < 18; i++) partialHoles[i] = 3
  assert.equal(nextHoleOrderForCard(10, partialHoles), 1, 'wraps from Hole 18 to Hole 1')
}

// 5. Strokes-to-par live leaderboard sorting (-3 thru 5 ranks ABOVE -2 thru 16)
{
  const ev = createBlackFridayDubsPreset('2026-11-27')

  // Team 1: -3 thru 5 (birdied holes 1,2,3; par 4,5 -> 2,2,2,3,3 = 12 strokes vs 15 par = -3)
  const h1 = emptyHoles()
  h1[0] = 2; h1[1] = 2; h1[2] = 2; h1[3] = 3; h1[4] = 3
  const t1: SpecialTeam = {
    id: 't1', teamNumber: 1, participantIds: ['p1', 'p2'], isCali: false,
    cardId: 'card-1', holes: h1, manualTotal18: null, playoffRank: null,
  }

  // Team 2: -2 thru 16 (3 on Par-4 hole 15 and 3 on Par-4 hole 16 = -2; par on rest of 1-16)
  const h2 = emptyHoles()
  for (let i = 0; i < 16; i++) h2[i] = ev.courseHoles[i].par
  h2[14] = 3 // Hole 15 (Par 4) -> birdie (-1)
  h2[15] = 3 // Hole 16 (Par 4) -> birdie (-1)
  const t2: SpecialTeam = {
    id: 't2', teamNumber: 2, participantIds: ['p3', 'p4'], isCali: false,
    cardId: 'card-1', holes: h2, manualTotal18: null, playoffRank: null,
  }

  // Team 3: Finished all 18 holes at 55 strokes (Par 56 => -1)
  const h3 = ev.courseHoles.map(ch => ch.par)
  h3[0] = 2
  const t3: SpecialTeam = {
    id: 't3', teamNumber: 3, participantIds: ['p5', 'p6'], isCali: false,
    cardId: 'card-2', holes: h3, manualTotal18: null, playoffRank: null,
  }

  // Team 4: Director manual 18-hole total override at 50 strokes (Par 56 => -6)
  const t4: SpecialTeam = {
    id: 't4', teamNumber: 4, participantIds: ['p7', 'p8'], isCali: false,
    cardId: 'card-2', holes: emptyHoles(), manualTotal18: 50, playoffRank: null,
  }

  // Team 5: Not started yet
  const t5: SpecialTeam = {
    id: 't5', teamNumber: 5, participantIds: ['p9', 'p10'], isCali: false,
    cardId: 'card-3', holes: emptyHoles(), manualTotal18: null, playoffRank: null,
  }

  // Also test director par/note edit impacting strokes-to-par
  const customHoles = ev.courseHoles.map(ch => (ch.hole === 1 ? { ...ch, par: 4, note: 'Long pin' } : ch))
  assert.equal(teamScoreSummary(t1, ev.courseHoles).toPar, -3)
  assert.equal(teamScoreSummary(t1, customHoles).toPar, -4, 'changing hole par updates toPar immediately')

  const ranked = rankSpecialTeams([t2, t3, t1, t4, t5], ev.courseHoles, [120, 80])
  assert.deepEqual(
    ranked.leaderboard.map(r => [r.team.id, r.summary.toPar, r.place]),
    [
      ['t4', -6, 1],
      ['t1', -3, 2],
      ['t2', -2, 3],
      ['t3', -1, 4],
    ],
    '-6 (Manual 18) > -3 (Thru 5) > -2 (Thru 16) > -1 (Thru 18)',
  )
  assert.equal(ranked.notStarted.length, 1)
  assert.equal(ranked.notStarted[0].team.id, 't5')
  // Only finished teams (t4 and t3) receive official cash payouts!
  assert.equal(ranked.payoutByTeamId.get('t4'), 120)
  assert.equal(ranked.payoutByTeamId.get('t3'), 80)
  assert.equal(ranked.payoutByTeamId.get('t1'), undefined)
}

// 6. Tied payouts, playoff tiebreak, $2-even partner splits, & Ace/CTP splits
{
  const ev = createBlackFridayDubsPreset('2026-11-27')
  const places = suggestedTeamPaidPlaces(12)
  assert.equal(places, 3)
  const checks = suggestedTeamPayouts(200, places)
  assert.equal(checks.reduce((a, b) => a + b, 0), 200)
  for (const c of checks) {
    assert.equal(c % 2, 0, `team check $${c} must be even so 2-player split is whole dollars`)
  }

  const finishedA: SpecialTeam = {
    id: 'fa', teamNumber: 1, participantIds: ['p1', 'p2'], isCali: false,
    cardId: 'c1', holes: emptyHoles(), manualTotal18: 52, playoffRank: null,
  }
  const finishedB: SpecialTeam = {
    id: 'fb', teamNumber: 2, participantIds: ['p3', 'p4'], isCali: false,
    cardId: 'c1', holes: emptyHoles(), manualTotal18: 52, playoffRank: null,
  }
  const tiedRes = rankSpecialTeams([finishedA, finishedB], ev.courseHoles, [120, 60])
  assert.equal(tiedRes.leaderboard[0].tied, true)
  assert.equal(tiedRes.leaderboard[0].place, 1)
  assert.equal(tiedRes.leaderboard[1].place, 1)
  assert.equal(tiedRes.payoutByTeamId.get('fa'), 90)
  assert.equal(tiedRes.payoutByTeamId.get('fb'), 90)

  // Sudden-death playoff resolves tie cleanly
  const playoffRes = rankSpecialTeams(
    [
      { ...finishedA, playoffRank: 2 },
      { ...finishedB, playoffRank: 1 },
    ],
    ev.courseHoles,
    [120, 60],
  )
  assert.equal(playoffRes.leaderboard[0].team.id, 'fb')
  assert.equal(playoffRes.leaderboard[0].place, 1)
  assert.equal(playoffRes.leaderboard[0].tied, false)
  assert.equal(playoffRes.payoutByTeamId.get('fb'), 120)
  assert.equal(playoffRes.payoutByTeamId.get('fa'), 60)

  // Ace / CTP payouts
  assert.deepEqual(
    resolveAcePayouts(100, { mode: 'ctp', winnerParticipantIds: ['p3', 'p4'] }),
    [{ participantId: 'p3', amount: 100 }],
    'CTP is winner takes all',
  )
  assert.deepEqual(
    resolveAcePayouts(100, { mode: 'ace', winnerParticipantIds: ['p1', 'p2'] }),
    [
      { participantId: 'p1', amount: 50 },
      { participantId: 'p2', amount: 50 },
    ],
    '2 Aces split pot evenly',
  )
  assert.deepEqual(
    resolveAcePayouts(100, { mode: 'ace', winnerParticipantIds: ['p1', 'p2', 'p3'] }),
    [
      { participantId: 'p1', amount: 33.34 },
      { participantId: 'p2', amount: 33.33 },
      { participantId: 'p3', amount: 33.33 },
    ],
    '3 Aces split pot to the cent summing to 100',
  )
}

// 7. Manual card addition/removal & History snapshots
{
  const ev = createBlackFridayDubsPreset('2026-11-27')
  const parts = [
    p('a1', 'Alex', 'A', true),
    p('a2', 'Blake', 'A', true),
    p('b1', 'Casey', 'B', true),
    p('b2', 'Drew', 'B', true),
  ]
  const drawn = drawDoublesTeams(parts, 2, () => 0.4)
  assert.equal(drawn.cards.length, 1)

  const initialPins = generateCardPins(drawn.cards, {}, () => 0.25)
  const cardsWithExtra = addCardToEvent(drawn.cards)
  assert.equal(cardsWithExtra.length, 2)
  assert.equal(cardsWithExtra[1].cardNumber, 2)
  assert.notEqual(cardsWithExtra[1].id, cardsWithExtra[0].id)
  assert.notEqual(cardsWithExtra[1].startingHole, cardsWithExtra[0].startingHole)

  const updatedPins = generateCardPins(cardsWithExtra, initialPins, () => 0.75)
  assert.equal(updatedPins[cardsWithExtra[0].id], initialPins[drawn.cards[0].id], 'existing card PIN is preserved')
  assert.match(updatedPins[cardsWithExtra[1].id], /^\d{4}$/, 'new card receives 4-digit PIN')

  // Attempting to remove a card that still has teams assigned must keep it intact
  const blockedRemove = removeEmptyCardFromEvent(cardsWithExtra, drawn.teams, cardsWithExtra[0].id)
  assert.equal(blockedRemove.length, 2)

  // Adding a 3rd empty card, deleting the middle empty card preserves remaining IDs & renumbers sequentially
  const threeCards = addCardToEvent(cardsWithExtra)
  assert.equal(threeCards.length, 3)
  const afterRemovingMiddle = removeEmptyCardFromEvent(threeCards, drawn.teams, threeCards[1].id)
  assert.equal(afterRemovingMiddle.length, 2)
  assert.deepEqual(afterRemovingMiddle.map(c => c.cardNumber), [1, 2])
  assert.equal(afterRemovingMiddle[0].id, threeCards[0].id)
  assert.equal(afterRemovingMiddle[1].id, threeCards[2].id)

  // History filtering strictly keeps finalized ('complete') events sorted newest first
  const draftCheckin = { ...createBlackFridayDubsPreset('2026-12-01'), id: 'draft-1', status: 'checkin' as const }
  const inScoring = { ...createBlackFridayDubsPreset('2026-12-02'), id: 'scoring-1', status: 'scoring' as const }
  const inResults = { ...createBlackFridayDubsPreset('2026-12-03'), id: 'results-1', status: 'results' as const }

  const pMap = new Map(parts.map(x => [x.id, x]))
  assert.equal(formatSpecialTeamName(drawn.teams[0], pMap).includes('&'), true)

  const hWin = ev.courseHoles.map(ch => ch.par)
  hWin[0] = 2 // -1 (55 strokes on Par 56)
  const hSecond = ev.courseHoles.map(ch => ch.par) // E (56 strokes on Par 56)
  const finalizedOld = {
    ...ev,
    id: 'done-old',
    eventDate: '2026-11-27',
    status: 'complete' as const,
    participants: parts,
    teams: [
      { ...drawn.teams[0], holes: hSecond, manualTotal18: null, playoffRank: null },
      { ...drawn.teams[1], holes: hWin, manualTotal18: null, playoffRank: null },
    ],
    cards: cardsWithExtra,
    payoutPlaces: [40],
    aceResolution: { mode: 'ctp' as const, winnerParticipantIds: ['b1'] },
  }
  const finalizedNew = {
    ...createBlackFridayDubsPreset('2026-12-10'),
    id: 'done-new',
    status: 'complete' as const,
  }

  const historyList = filterHistorySpecialEvents([draftCheckin, finalizedOld, inScoring, inResults, finalizedNew])
  assert.deepEqual(historyList.map(e => e.id), ['done-new', 'done-old'])

  const snap = buildSpecialEventSnapshot(finalizedOld)
  assert.equal(snap.participantCount, 4)
  assert.equal(snap.teamCount, 2)
  assert.equal(snap.totalPar, 56)
  assert.equal(snap.payoutPurse, 40)
  assert.equal(snap.courseFund, 20)
  assert.equal(snap.acePot, 20)
  assert.equal(snap.winners.length, 1)
  assert.equal(snap.winners[0].teamId, drawn.teams[1].id)
  assert.equal(snap.winners[0].toPar, -1)
  assert.equal(snap.winners[0].strokes, 55)
  assert.equal(snap.winners[0].payout, 40)
  assert.equal(snap.podium.length, 2)
  assert.deepEqual(snap.aceOutcome, {
    mode: 'ctp',
    winners: [{ participantId: 'b1', name: 'Casey', amount: 20 }],
  })
}

console.log('Special events tests passed ✔')
