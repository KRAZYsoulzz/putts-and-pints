import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  KeyRound,
  Lock,
  MapPin,
  Minus,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trash2,
  Trophy,
  Unlock,
  UserPlus,
  Users,
} from 'lucide-react'
import { useData, must } from '../lib/store'
import { supabase } from '../lib/supabase'
import { useSpecialEvents } from '../lib/special-events-store'
import { askConfirm, messageOf, reportError, reportInfo } from '../lib/notify'
import { duplicateName, normalizeName } from '../lib/validation'
import { newPlayerInsert } from '../lib/newPlayer'
import { clampPaidPlaces } from '../lib/money'
import { cents } from '../lib/scoring'
import type { Division } from '../lib/types'
import {
  addCardToEvent,
  assignTeamsToCards,
  assignUnassignedParticipants,
  buildSpecialEventSnapshot,
  clampHoleStroke,
  cloneGatewayTrinityHoles,
  courseParTotals,
  createBlackFridayDubsPreset,
  createBlankSpecialEvent,
  drawDoublesTeams,
  filterHistorySpecialEvents,
  formatSpecialTeamName,
  formatToPar,
  generateCardPins,
  makeSpecialId,
  moveParticipantBetweenTeams,
  nextHoleOrderForCard,
  rankSpecialTeams,
  removeEmptyCardFromEvent,
  removeParticipantFromEvent,
  resolveAcePayouts,
  specialEventMoney,
  suggestedTeamPaidPlaces,
  suggestedTeamPayouts,
  teamScoreSummary,
  type CourseHole,
  type SpecialCard,
  type SpecialEventSnapshot,
  type SpecialParticipant,
  type SpecialPool,
  type SpecialStatus,
  type SpecialTeam,
  type TeamScoreSummary,
} from '../lib/special-events'
import { Dialog, DivisionSeg, MoneyInput, PageHead, Seg, Stat, Toggle, fmtDate, money, ordinal } from '../components/ui'

const SPECIAL_STEPS: { status: SpecialStatus; label: string }[] = [
  { status: 'checkin', label: '1. Check-in & Pools' },
  { status: 'draw', label: '2. Draw & Cards' },
  { status: 'scoring', label: '3. 18-Hole Scoring' },
  { status: 'results', label: '4. Results & Payouts' },
]

function parScoreLabel(strokes: number, par: number): string {
  const diff = strokes - par
  if (strokes === 1) return 'Ace!'
  if (diff <= -2) return 'Eagle'
  if (diff === -1) return 'Birdie'
  if (diff === 0) return 'Par'
  if (diff === 1) return 'Bogey'
  return `+${diff}`
}

function toParClass(toPar: number | null): string {
  if (toPar == null) return 'faint'
  if (toPar < 0) return 'sp-under'
  if (toPar > 0) return 'sp-over'
  return ''
}

export default function SpecialEvents() {
  const { isAdmin, players, reload: reloadMainData } = useData()
  const {
    loading,
    storageMode,
    events,
    activeEvent,
    selectEvent,
    cardPins,
    hasUnsyncedLocalEvents,
    syncLocalToSupabase,
    saveEvent,
    deleteEvent,
    regenerateCardPin,
    unlockCardWithPin,
    isCardUnlocked,
    submitCardHoleScores,
  } = useSpecialEvents()

  // New Event Modal
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('Black Friday Draw Dubs')
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [newLocation, setNewLocation] = useState('Gateway Park - Trinity Side')
  const [newEntryFee, setNewEntryFee] = useState(20)
  const [newAceShare, setNewAceShare] = useState(5)
  const [newCourseShare, setNewCourseShare] = useState(5)
  const [newCourseLabel, setNewCourseLabel] = useState('Gatekeepers Course Fund')
  const [newFrontLabel, setNewFrontLabel] = useState('Alternating Shot')
  const [newBackLabel, setNewBackLabel] = useState('Best Shot')
  const [newUseTrinity, setNewUseTrinity] = useState(true)
  const [newNotes, setNewNotes] = useState('9:00 AM sign-up, 9:45 AM draw. Holes 1-9 Alternating Shot, Holes 10-18 Best Shot.')
  const [newError, setNewError] = useState('')

  // Check-in Modal & Pool Filter
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [searchName, setSearchName] = useState('')
  const [checkinPool, setCheckinPool] = useState<SpecialPool>('A')
  const [checkinPaid, setCheckinPaid] = useState(true)
  const [alsoAddRoster, setAlsoAddRoster] = useState(false)
  const [rosterDiv, setRosterDiv] = useState<Division>('M')
  const [checkinError, setCheckinError] = useState('')
  const [poolFilter, setPoolFilter] = useState<'ALL' | SpecialPool>('ALL')

  // Course & Hole Notes Dialog
  const [courseOpen, setCourseOpen] = useState(false)
  const [holeDrafts, setHoleDrafts] = useState<CourseHole[]>([])

  // Swap / Adjust Partner Dialog
  const [adjustParticipantId, setAdjustParticipantId] = useState<string | null>(null)

  // Card Scorer & PIN Dialog
  const [scorerCardId, setScorerCardId] = useState<string | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [activeHole, setActiveHole] = useState(1)
  const [showFullCardTable, setShowFullCardTable] = useState(false)
  const [editingHoleNote, setEditingHoleNote] = useState(false)
  const [holeNoteDraft, setHoleNoteDraft] = useState('')

  // Payout error message
  const [payoutError, setPayoutError] = useState('')

  // View tab (Current / Live vs History snapshots) & expandable scorecard row
  const [tabChoice, setTabChoice] = useState<'auto' | 'current' | 'history'>('auto')
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null)
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)

  const liveEvents = useMemo(() => events.filter(e => e.status !== 'complete'), [events])
  const completedEvents = useMemo(() => filterHistorySpecialEvents(events), [events])
  const viewMode: 'current' | 'history' =
    tabChoice === 'auto'
      ? liveEvents.length > 0 || completedEvents.length === 0
        ? 'current'
        : 'history'
      : tabChoice
  const currentEvent = useMemo(
    () => (activeEvent && activeEvent.status !== 'complete' ? activeEvent : liveEvents[0] ?? null),
    [activeEvent, liveEvents],
  )
  const historyDetailEvent = useMemo(
    () => (historyDetailId ? completedEvents.find(e => e.id === historyDetailId) ?? null : null),
    [completedEvents, historyDetailId],
  )
  const event = viewMode === 'history' ? historyDetailEvent : currentEvent

  const participantById = useMemo(() => {
    const map = new Map<string, SpecialParticipant>()
    if (!event) return map
    for (const p of event.participants) map.set(p.id, p)
    return map
  }, [event])

  const finances = useMemo(() => {
    if (!event) return null
    return specialEventMoney(event.participants, event.config)
  }, [event])

  const parTotals = useMemo(() => {
    if (!event) return { frontPar: 27, backPar: 29, totalPar: 56, totalDistanceFt: 4996 }
    return courseParTotals(event.courseHoles)
  }, [event])

  const rankings = useMemo(() => {
    if (!event) return null
    return rankSpecialTeams(event.teams, event.courseHoles, event.payoutPlaces)
  }, [event])

  const poolCounts = useMemo(() => {
    if (!event) return { A: 0, B: 0 }
    return {
      A: event.participants.filter(p => p.pool === 'A').length,
      B: event.participants.filter(p => p.pool === 'B').length,
    }
  }, [event])

  // Prefill suggested team payouts the first time Results opens with empty payouts
  useEffect(() => {
    if (!event || !isAdmin || event.status !== 'results' || !finances) return
    if (event.teams.length === 0 || event.payoutPlaces.length > 0 || finances.payoutPurse <= 0) return
    const places = suggestedTeamPaidPlaces(event.teams.length)
    const suggested = suggestedTeamPayouts(finances.payoutPurse, places)
    if (suggested.length > 0) {
      void saveEvent({ ...event, payoutPlaces: suggested })
    }
  }, [event, isAdmin, finances, saveEvent])

  const loadBlackFridayFields = () => {
    const preset = createBlackFridayDubsPreset(newDate)
    setNewName(preset.name)
    setNewLocation(preset.location)
    setNewEntryFee(preset.config.entryFee)
    setNewAceShare(preset.config.aceShare)
    setNewCourseShare(preset.config.courseFundShare)
    setNewCourseLabel(preset.config.courseFundLabel)
    setNewFrontLabel(preset.config.front9Label)
    setNewBackLabel(preset.config.back9Label)
    setNewUseTrinity(true)
    setNewNotes(preset.notes ?? '')
    setNewError('')
  }

  const handleCreateQuickBlackFriday = async () => {
    const preset = createBlackFridayDubsPreset()
    const ok = await saveEvent(preset)
    if (ok) {
      selectEvent(preset.id)
      setHistoryDetailId(null)
      setExpandedTeamId(null)
      setTabChoice('current')
    }
  }

  const handleCreateCustomEvent = async () => {
    const cleanName = normalizeName(newName)
    if (!cleanName) {
      setNewError('Enter an event name.')
      return
    }
    if (!newDate) {
      setNewError('Pick an event date.')
      return
    }
    if (cents(newAceShare + newCourseShare) > cents(newEntryFee) + 0.001) {
      setNewError('Ace share plus course fund share cannot exceed the entry fee.')
      return
    }
    setNewError('')
    const created = createBlankSpecialEvent({
      name: cleanName,
      eventDate: newDate,
      location: newLocation,
      useGatewayTrinity: newUseTrinity,
      notes: newNotes.trim() || null,
      config: {
        entryFee: newEntryFee,
        aceShare: newAceShare,
        courseFundShare: newCourseShare,
        courseFundLabel: newCourseLabel.trim() || 'Course Fund',
        front9Label: newFrontLabel.trim() || 'Front 9',
        back9Label: newBackLabel.trim() || 'Back 9',
        teamsPerCard: 2,
      },
    })
    const ok = await saveEvent(created)
    if (ok) {
      selectEvent(created.id)
      setHistoryDetailId(null)
      setExpandedTeamId(null)
      setTabChoice('current')
      setNewOpen(false)
    }
  }

  const teamDisplayName = (team: SpecialTeam): string =>
    formatSpecialTeamName(team, participantById)

  const openCardScorer = (card: SpecialCard) => {
    if (!event) return
    setScorerCardId(card.id)
    setPinInput('')
    setPinError('')
    setShowFullCardTable(false)
    setEditingHoleNote(false)
    const cardTeams = event.teams.filter(t => t.cardId === card.id)
    const leadTeam = cardTeams[0]
    const nextHole = leadTeam
      ? nextHoleOrderForCard(card.startingHole, leadTeam.holes)
      : card.startingHole
    setActiveHole(nextHole)
  }

  const handleCopyPins = async () => {
    if (!event) return
    const lines = event.cards.map(c => {
      const cardTeams = event.teams.filter(t => t.cardId === c.id).map(teamDisplayName).join(' | ')
      return `Card ${c.cardNumber} (Hole ${c.startingHole}) - PIN: ${cardPins[c.id] ?? '----'}${cardTeams ? ` [${cardTeams}]` : ''}`
    })
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      reportInfo('Copied card PINs to clipboard.')
    } catch {
      reportInfo('Card PINs are listed below for each group.')
    }
  }

  const newEventModal = newOpen ? (
    <NewSpecialEventDialog
      newName={newName}
      newDate={newDate}
      newLocation={newLocation}
      newEntryFee={newEntryFee}
      newAceShare={newAceShare}
      newCourseShare={newCourseShare}
      newCourseLabel={newCourseLabel}
      newFrontLabel={newFrontLabel}
      newBackLabel={newBackLabel}
      newUseTrinity={newUseTrinity}
      newNotes={newNotes}
      newError={newError}
      onName={setNewName}
      onDate={setNewDate}
      onLocation={setNewLocation}
      onEntryFee={setNewEntryFee}
      onAceShare={setNewAceShare}
      onCourseShare={setNewCourseShare}
      onCourseLabel={setNewCourseLabel}
      onFrontLabel={setNewFrontLabel}
      onBackLabel={setNewBackLabel}
      onUseTrinity={setNewUseTrinity}
      onNotes={setNewNotes}
      onLoadPreset={loadBlackFridayFields}
      onCreate={() => void handleCreateCustomEvent()}
      onClose={() => setNewOpen(false)}
    />
  ) : null

  const subNav =
    events.length > 0 ? (
      <SpecialSubNav
        viewMode={viewMode}
        liveCount={liveEvents.length}
        completedCount={completedEvents.length}
        showBackToHistory={viewMode === 'history' && Boolean(historyDetailEvent)}
        liveEvents={liveEvents}
        activeLiveEventId={viewMode === 'current' ? event?.id ?? null : null}
        onChangeMode={mode => {
          setTabChoice(mode)
          if (mode === 'history') setHistoryDetailId(null)
          setExpandedTeamId(null)
        }}
        onBackToHistory={() => {
          setHistoryDetailId(null)
          setExpandedTeamId(null)
        }}
        onSelectLiveEvent={id => selectEvent(id)}
      />
    ) : null

  // Empty screen when no Special Events exist yet
  if (events.length === 0) {
    return (
      <div className="special-events-page">
        <PageHead eyebrow="Putts & Pints · Spin-Off Events" title="Special Events">
          {isAdmin && (
            <button
              className="btn btn-primary"
              disabled={loading}
              onClick={() => {
                loadBlackFridayFields()
                setNewOpen(true)
              }}
            >
              <Plus size={16} /> New Special Event
            </button>
          )}
        </PageHead>

        <div className="empty panel panel-pad">
          <Sparkles size={46} color="var(--orange)" />
          <div className="display" style={{ fontSize: 28, marginTop: 10 }}>
            No Special Events Yet
          </div>
          <p className="muted">
            Spin-off events (like Black Friday Draw Dubs) run separately from weekly Putt Night
            standings, tags, and pots.
          </p>
          {isAdmin && (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
              <button className="btn btn-primary" onClick={() => void handleCreateQuickBlackFriday()}>
                <Sparkles size={16} /> Start Black Friday Draw Dubs
              </button>
              <button
                className="btn"
                onClick={() => {
                  loadBlackFridayFields()
                  setNewOpen(true)
                }}
              >
                Customize New Event
              </button>
            </div>
          )}
        </div>

        {newEventModal}
      </div>
    )
  }

  // History Snapshot List (finalized events only)
  if (viewMode === 'history' && !historyDetailEvent) {
    return (
      <div className="special-events-page">
        <PageHead eyebrow="Putts & Pints · Spin-Off Events" title="Event History">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {hasUnsyncedLocalEvents && isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => void syncLocalToSupabase()}>
                <RefreshCw size={14} /> Sync Local Events
              </button>
            )}
            {isAdmin && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  loadBlackFridayFields()
                  setNewOpen(true)
                }}
              >
                <Plus size={15} /> New Event
              </button>
            )}
          </div>
        </PageHead>

        {subNav}

        {completedEvents.length === 0 ? (
          <div className="empty panel panel-pad">
            <Trophy size={40} color="var(--orange)" />
            <div className="display" style={{ fontSize: 24 }}>No Completed Events Yet</div>
            <p className="muted">
              Only finalized special events appear in History. In-progress or draft events remain under Live Event.
            </p>
            {liveEvents.length > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setTabChoice('current')
                  setHistoryDetailId(null)
                }}
              >
                Go to Live Event
              </button>
            )}
          </div>
        ) : (
          <div className="history-grid">
            {completedEvents.map(ev => (
              <SpecialEventHistoryCard
                key={ev.id}
                snapshot={buildSpecialEventSnapshot(ev)}
                onOpenStandings={() => {
                  setHistoryDetailId(ev.id)
                  setExpandedTeamId(null)
                }}
              />
            ))}
          </div>
        )}

        {newEventModal}
      </div>
    )
  }

  // Current tab selected when all saved events are completed
  if (viewMode === 'current' && !currentEvent) {
    return (
      <div className="special-events-page">
        <PageHead eyebrow="Putts & Pints · Spin-Off Events" title="Special Events">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {hasUnsyncedLocalEvents && isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => void syncLocalToSupabase()}>
                <RefreshCw size={14} /> Sync Local Events
              </button>
            )}
            {isAdmin && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  loadBlackFridayFields()
                  setNewOpen(true)
                }}
              >
                <Plus size={15} /> New Event
              </button>
            )}
          </div>
        </PageHead>

        {subNav}

        <div className="empty panel panel-pad">
          <Sparkles size={42} color="var(--orange)" />
          <div className="display" style={{ fontSize: 26 }}>No Active Special Event</div>
          <p className="muted">
            All recorded spin-off events are finalized and archived in History.
          </p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTabChoice('history')
                setHistoryDetailId(null)
              }}
            >
              Browse Event History ({completedEvents.length})
            </button>
            {isAdmin && (
              <>
                <button className="btn btn-primary" onClick={() => void handleCreateQuickBlackFriday()}>
                  <Sparkles size={16} /> Start Black Friday Draw Dubs
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    loadBlackFridayFields()
                    setNewOpen(true)
                  }}
                >
                  Customize New Event
                </button>
              </>
            )}
          </div>
        </div>

        {newEventModal}
      </div>
    )
  }

  if (!event) return null

  // Event-scoped helpers
  const cleanSearch = normalizeName(searchName).toLowerCase()
  const checkedInPlayerIds = new Set(
    event.participants.map(p => p.playerId).filter((id): id is string => Boolean(id)),
  )
  const checkedInLowerNames = new Set(
    event.participants.map(p => normalizeName(p.name).toLowerCase()),
  )
  const matchingRosterPlayers = cleanSearch
    ? players.filter(
        p =>
          p.active &&
          !checkedInPlayerIds.has(p.id) &&
          !checkedInLowerNames.has(normalizeName(p.name).toLowerCase()) &&
          p.name.toLowerCase().includes(cleanSearch),
      )
    : players.filter(
        p =>
          p.active &&
          !checkedInPlayerIds.has(p.id) &&
          !checkedInLowerNames.has(normalizeName(p.name).toLowerCase()),
      )
  const exactRosterMatch = players.find(
    p => normalizeName(p.name).toLowerCase() === cleanSearch,
  )

  const handleAddParticipantFromRoster = async (player: { id: string; name: string }) => {
    setCheckinError('')
    if (checkedInLowerNames.has(normalizeName(player.name).toLowerCase())) {
      setCheckinError(`${player.name} is already checked in.`)
      return
    }
    const nextPart: SpecialParticipant = {
      id: makeSpecialId(),
      playerId: player.id,
      name: player.name,
      pool: checkinPool,
      paid: checkinPaid,
      createdAt: new Date().toISOString(),
    }
    const ok = await saveEvent({
      ...event,
      participants: [...event.participants, nextPart],
    })
    if (ok) {
      setSearchName('')
      setAlsoAddRoster(false)
      setCheckinOpen(false)
    }
  }

  const handleAddWalkupParticipant = async () => {
    const clean = normalizeName(searchName)
    if (!clean) {
      setCheckinError('Enter a player name.')
      return
    }
    if (checkedInLowerNames.has(clean.toLowerCase())) {
      setCheckinError(`${clean} is already checked in for this event.`)
      return
    }
    setCheckinError('')

    let linkedPlayerId: string | null = exactRosterMatch?.id ?? null
    let finalName = exactRosterMatch?.name ?? clean

    if (!exactRosterMatch && alsoAddRoster && isAdmin) {
      if (duplicateName(clean, players)) {
        const existing = players.find(p => normalizeName(p.name).toLowerCase() === clean.toLowerCase())
        linkedPlayerId = existing?.id ?? null
        finalName = existing?.name ?? clean
      } else {
        try {
          const created = await must(
            supabase
              .from('pp_players')
              .insert(newPlayerInsert(clean, rosterDiv, false))
              .select()
              .single(),
          )
          linkedPlayerId = created.id as string
          void reloadMainData()
        } catch (err) {
          setCheckinError(messageOf(err))
          return
        }
      }
    }

    const nextPart: SpecialParticipant = {
      id: makeSpecialId(),
      playerId: linkedPlayerId,
      name: finalName,
      pool: checkinPool,
      paid: checkinPaid,
      createdAt: new Date().toISOString(),
    }
    const ok = await saveEvent({
      ...event,
      participants: [...event.participants, nextPart],
    })
    if (ok) {
      setSearchName('')
      setAlsoAddRoster(false)
      setCheckinOpen(false)
    }
  }

  const handleRunRandomDraw = async () => {
    if (event.participants.length < 2) {
      reportError('Check in at least 2 players before running the draw.')
      return
    }
    const hasScores = event.teams.some(
      t => t.manualTotal18 != null || t.holes.some(h => h != null),
    )
    if (hasScores) {
      const ok = await askConfirm(
        'Teams already have scores entered. Re-drawing teams will clear current team scores and assign new cards.',
        { title: 'Re-draw random teams?', confirmLabel: 'Re-draw teams', danger: true },
      )
      if (!ok) return
    }
    const drawn = drawDoublesTeams(event.participants, event.config.teamsPerCard)
    const nextPins = generateCardPins(drawn.cards, cardPins)
    const paidCount = suggestedTeamPaidPlaces(drawn.teams.length)
    const nextPayouts = finances ? suggestedTeamPayouts(finances.payoutPurse, paidCount) : []
    await saveEvent(
      {
        ...event,
        teams: drawn.teams,
        cards: drawn.cards,
        payoutPlaces: nextPayouts,
      },
      nextPins,
    )
    reportInfo(`Drew ${drawn.teams.length} team${drawn.teams.length === 1 ? '' : 's'} across ${drawn.cards.length} card${drawn.cards.length === 1 ? '' : 's'}.`)
  }

  const handleRegroupCards = async (nextPerCard: number) => {
    const cleanSize = Math.min(6, Math.max(1, Math.trunc(nextPerCard)))
    const grouped = assignTeamsToCards(event.teams, cleanSize)
    const nextPins = generateCardPins(grouped.cards, cardPins)
    await saveEvent(
      {
        ...event,
        config: { ...event.config, teamsPerCard: cleanSize },
        teams: grouped.teams,
        cards: grouped.cards,
      },
      nextPins,
    )
  }

  const handleAddCard = async () => {
    const nextCards = addCardToEvent(event.cards)
    const nextPins = generateCardPins(nextCards, cardPins)
    const ok = await saveEvent({ ...event, cards: nextCards }, nextPins)
    if (ok) reportInfo(`Added Card ${nextCards[nextCards.length - 1].cardNumber}.`)
  }

  const handleRemoveEmptyCard = async (cardId: string) => {
    const nextCards = removeEmptyCardFromEvent(event.cards, event.teams, cardId)
    if (nextCards.length === event.cards.length) return
    const nextPins = generateCardPins(nextCards, cardPins)
    await saveEvent({ ...event, cards: nextCards }, nextPins)
  }

  const filteredParticipants =
    poolFilter === 'ALL'
      ? event.participants
      : event.participants.filter(p => p.pool === poolFilter)

  const scoringCardsWithTeams = event.cards.filter(c => event.teams.some(t => t.cardId === c.id))
  const activeScorerCards = scoringCardsWithTeams.length > 0 ? scoringCardsWithTeams : event.cards
  const assignedParticipantIds = new Set(event.teams.flatMap(t => t.participantIds))
  const unassignedParticipants =
    event.teams.length > 0
      ? event.participants.filter(p => !assignedParticipantIds.has(p.id))
      : []

  const scorerCard = scorerCardId ? event.cards.find(c => c.id === scorerCardId) ?? null : null
  const scorerCardTeams = scorerCard ? event.teams.filter(t => t.cardId === scorerCard.id) : []
  const scorerUnlocked = scorerCard ? isCardUnlocked(event.id, scorerCard.id) : false

  const activeHoleInfo = event.courseHoles[activeHole - 1] ?? {
    hole: activeHole,
    par: 3,
    distanceFt: null,
    note: '',
  }
  const activeHoleFormat = activeHole <= 9 ? event.config.front9Label : event.config.back9Label

  const acePayouts = finances ? resolveAcePayouts(finances.acePot, event.aceResolution) : []
  const allocatedTeamPurse = cents(event.payoutPlaces.reduce((s, v) => s + (Number(v) || 0), 0))
  const purseTotal = finances?.payoutPurse ?? 0
  const overPurse = allocatedTeamPurse - purseTotal > 0.001

  const saveTeamPayout = (idx: number, val: number) => {
    const next = Array.from(
      { length: Math.max(event.payoutPlaces.length, idx + 1) },
      (_, i) => Number(event.payoutPlaces[i] ?? 0),
    )
    next[idx] = val
    while (next.length > 1 && next[next.length - 1] === 0) next.pop()
    const sum = cents(next.reduce((s, v) => s + (Number(v) || 0), 0))
    if (sum - purseTotal > 0.001) {
      setPayoutError(`Payouts total ${money(sum)}, which exceeds the ${money(purseTotal)} purse.`)
      return
    }
    setPayoutError('')
    void saveEvent({ ...event, payoutPlaces: next })
  }

  const stepTeamPlaces = (delta: number) => {
    if (!finances || event.teams.length === 0) return
    const curCount = event.payoutPlaces.length || suggestedTeamPaidPlaces(event.teams.length)
    const nextCount = clampPaidPlaces(event.teams.length, curCount + delta)
    setPayoutError('')
    const nextPayouts = suggestedTeamPayouts(finances.payoutPurse, nextCount)
    void saveEvent({ ...event, payoutPlaces: nextPayouts })
  }

  const setTeamManual18 = (teamId: string, rawVal: string) => {
    const trimmed = rawVal.trim()
    let manualTotal18: number | null = null
    if (trimmed !== '') {
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return
      manualTotal18 = Math.min(200, Math.max(18, Math.trunc(n)))
    }
    void saveEvent({
      ...event,
      teams: event.teams.map(t => (t.id === teamId ? { ...t, manualTotal18 } : t)),
    })
  }

  const setTeamHoleStroke = async (team: SpecialTeam, holeNumber: number, nextStroke: number | null) => {
    if (!scorerCard) return
    const updatedHoles = Array.from({ length: 18 }, (_, idx) =>
      idx === holeNumber - 1 ? clampHoleStroke(nextStroke) : clampHoleStroke(team.holes?.[idx]),
    )
    const payload: Record<string, (number | null)[]> = {}
    for (const ct of scorerCardTeams) {
      payload[ct.id] = ct.id === team.id ? updatedHoles : ct.holes
    }
    await submitCardHoleScores(event.id, scorerCard.id, payload)
  }

  const nextShotgunHole = ((activeHole % 18) + 1)
  const prevShotgunHole = ((activeHole - 2 + 18) % 18) + 1
  const allCardHolesComplete =
    scorerCardTeams.length > 0 &&
    scorerCardTeams.every(t => t.holes.filter(h => h != null).length === 18)

  // Finished teams tied at the same toPar for playoff tiebreak options
  const finishedLeaderboard = rankings?.leaderboard.filter(r => r.summary.isFinished) ?? []
  const tiedToParValues = new Set<number>()
  for (let i = 1; i < finishedLeaderboard.length; i++) {
    if (finishedLeaderboard[i].summary.toPar === finishedLeaderboard[i - 1].summary.toPar) {
      const tp = finishedLeaderboard[i].summary.toPar
      if (tp != null) tiedToParValues.add(tp)
    }
  }

  const adjustParticipant = adjustParticipantId ? participantById.get(adjustParticipantId) ?? null : null
  const adjustSourceTeam = adjustParticipantId
    ? event.teams.find(t => t.participantIds.includes(adjustParticipantId)) ?? null
    : null

  return (
    <div className="special-events-page">
      <PageHead
        eyebrow={
          <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span>Putts &amp; Pints · Spin-Off Event</span>
            <span>·</span>
            <span>{fmtDate(event.eventDate)}</span>
            {event.location && (
              <>
                <span>·</span>
                <span className="row" style={{ gap: 4 }}>
                  <MapPin size={12} /> {event.location}
                </span>
              </>
            )}
            {isAdmin && storageMode === 'local' && (
              <span
                className="chip"
                title="Saved in this browser. Run supabase/pp_011_special_events.sql in Supabase SQL Editor to enable multi-phone live sync."
              >
                Local mode
              </span>
            )}
          </span>
        }
        title={event.name}
      >
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {hasUnsyncedLocalEvents && isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={() => void syncLocalToSupabase()}>
              <RefreshCw size={14} /> Sync Local Events
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setHoleDrafts(event.courseHoles.map(h => ({ ...h })))
              setCourseOpen(true)
            }}
          >
            <NotebookPen size={15} /> {isAdmin ? 'Course & Hole Notes' : `Course (${parTotals.totalPar} Par)`}
          </button>
          {activeScorerCards.length > 0 && event.status !== 'complete' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => openCardScorer(activeScorerCards[0])}
            >
              <KeyRound size={15} /> Score a Card (PIN)
            </button>
          )}
          {isAdmin && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                loadBlackFridayFields()
                setNewOpen(true)
              }}
            >
              <Plus size={15} /> New Event
            </button>
          )}
          {isAdmin && event.status === 'complete' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                const ok = await askConfirm('Reopen this special event to edit scores or payouts?', {
                  title: 'Reopen event?',
                  confirmLabel: 'Reopen',
                })
                if (ok) {
                  const saved = await saveEvent({ ...event, status: 'results' })
                  if (saved) {
                    selectEvent(event.id)
                    setHistoryDetailId(null)
                    setExpandedTeamId(null)
                    setTabChoice('current')
                  }
                }
              }}
            >
              <RotateCcw size={14} /> Reopen
            </button>
          )}
          {isAdmin && (
            <button
              className="btn btn-ghost btn-sm btn-danger btn-icon"
              aria-label="Delete special event"
              title="Delete special event"
              onClick={async () => {
                const ok = await askConfirm(`Delete "${event.name}"? All teams and scores for this special event will be removed.`, {
                  title: 'Delete special event?',
                  confirmLabel: 'Delete',
                  danger: true,
                })
                if (ok) {
                  const deleted = await deleteEvent(event.id)
                  if (deleted && historyDetailId === event.id) {
                    setHistoryDetailId(null)
                    setExpandedTeamId(null)
                  }
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </PageHead>

      {subNav}

      {finances && (
        <div className="stats section">
          <Stat
            label="Field"
            value={`${finances.participantCount}`}
            sub={`Pool A: ${poolCounts.A} · Pool B: ${poolCounts.B}${event.teams.length ? ` · ${event.teams.length} teams` : ''}`}
          />
          <Stat
            label="Team Payout Purse"
            value={money(finances.payoutPurse)}
            sub={`${money(finances.payoutShare)}/player`}
          />
          <Stat
            label="Ace / CTP Pot"
            value={money(finances.acePot)}
            sub={`${money(event.config.aceShare)}/player · CTP if no ace`}
          />
          <Stat
            label={event.config.courseFundLabel || 'Course Fund'}
            value={money(finances.courseFund)}
            sub={`${money(event.config.courseFundShare)}/player · Par ${parTotals.totalPar} (${parTotals.totalDistanceFt.toLocaleString()} ft)`}
          />
        </div>
      )}

      {isAdmin && event.status !== 'complete' && (
        <div className="steps">
          {SPECIAL_STEPS.map((s, idx) => (
            <button
              key={s.status}
              className={event.status === s.status ? 'on' : ''}
              onClick={() => void saveEvent({ ...event, status: s.status })}
            >
              <span className="step-n">{idx + 1}</span>
              {s.label.slice(3)}
            </button>
          ))}
        </div>
      )}

      {/* ====================================================================
          STEP 1: CHECK-IN & POOLS
         ==================================================================== */}
      {isAdmin && event.status === 'checkin' && finances && (
        <div className="section">
          <div className="section-head" style={{ flexWrap: 'wrap' }}>
            <div>
              <h2 className="display section-title">Check-in &amp; Pool Assignment</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Assign each player to Pool A (Open / Advanced) or Pool B (Low-rated / Ladies). Toggle Paid ({money(event.config.entryFee)}) as they check in.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                setCheckinError('')
                setSearchName('')
                setAlsoAddRoster(false)
                setCheckinOpen(true)
              }}
            >
              <UserPlus size={16} /> Check In Player
            </button>
          </div>

          <div className="grid-2">
            <div className="stack">
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <Seg
                  value={poolFilter}
                  onChange={setPoolFilter}
                  options={[
                    { value: 'ALL', label: 'All Players', count: event.participants.length },
                    { value: 'A', label: 'Pool A', count: poolCounts.A },
                    { value: 'B', label: 'Pool B', count: poolCounts.B },
                  ]}
                />
              </div>

              <div className="panel">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}>#</th>
                        <th>Player</th>
                        <th className="c" style={{ width: 120 }}>Pool</th>
                        <th className="c" style={{ width: 96 }}>Paid ({money(event.config.entryFee)})</th>
                        <th className="r" style={{ width: 76 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredParticipants.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '36px 0' }} className="muted">
                            No players checked in yet. Tap Check In Player to add players.
                          </td>
                        </tr>
                      ) : (
                        filteredParticipants.map((p, idx) => (
                          <tr key={p.id}>
                            <td className="faint">{idx + 1}</td>
                            <td>
                              <span className="strong">{p.name}</span>
                              {p.playerId && (
                                <span className="chip hide-sm" style={{ marginLeft: 8 }}>P&amp;P</span>
                              )}
                            </td>
                            <td className="c">
                              <button
                                type="button"
                                className={`btn btn-sm ${p.pool === 'A' ? 'btn-primary' : 'btn-ghost'}`}
                                style={
                                  p.pool === 'B'
                                    ? { border: '1px solid rgba(31, 167, 154, 0.5)', color: 'var(--teal)' }
                                    : undefined
                                }
                                onClick={() => {
                                  const nextPool: SpecialPool = p.pool === 'A' ? 'B' : 'A'
                                  void saveEvent({
                                    ...event,
                                    participants: event.participants.map(item =>
                                      item.id === p.id ? { ...item, pool: nextPool } : item,
                                    ),
                                  })
                                }}
                                title="Tap to switch Pool A / Pool B"
                              >
                                Pool {p.pool}
                              </button>
                            </td>
                            <td className="c">
                              <button
                                type="button"
                                className={`btn btn-sm ${p.paid ? 'btn-ghost' : 'btn-danger'}`}
                                onClick={() =>
                                  void saveEvent({
                                    ...event,
                                    participants: event.participants.map(item =>
                                      item.id === p.id ? { ...item, paid: !item.paid } : item,
                                    ),
                                  })
                                }
                              >
                                {p.paid ? <Check size={14} color="var(--teal)" /> : 'Unpaid'}
                              </button>
                            </td>
                            <td className="r">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-danger"
                                onClick={async () => {
                                  const ok = await askConfirm(`Remove ${p.name} from ${event.name}?`, {
                                    title: 'Remove player?',
                                    confirmLabel: 'Remove',
                                    danger: true,
                                  })
                                  if (!ok) return
                                  await saveEvent(removeParticipantFromEvent(event, p.id))
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="panel panel-pad stack">
              <div className="eyebrow">Event Money Breakdown</div>
              <div className="kv">
                <dt>Total Entry Pot ({finances.participantCount} × {money(event.config.entryFee)})</dt>
                <dd>{money(finances.totalEntryPot)}</dd>
              </div>
              <div className="kv">
                <dt>{event.config.courseFundLabel} ({money(event.config.courseFundShare)}/ea)</dt>
                <dd>{money(finances.courseFund)}</dd>
              </div>
              <div className="kv">
                <dt>Ace Pot / CTP ({money(event.config.aceShare)}/ea)</dt>
                <dd style={{ color: 'var(--teal)' }}>{money(finances.acePot)}</dd>
              </div>
              <div className="kv total">
                <dt>Team Payout Purse ({money(finances.payoutShare)}/ea)</dt>
                <dd style={{ color: 'var(--orange)' }}>{money(finances.payoutPurse)}</dd>
              </div>
              {finances.unpaidCount > 0 && (
                <div className="notice">
                  <Users size={16} />
                  <span>
                    {finances.unpaidCount} unpaid player{finances.unpaidCount === 1 ? '' : 's'} ({money(finances.unpaidAmount)} still due).
                  </span>
                </div>
              )}
              <div className="muted" style={{ fontSize: 12 }}>
                Format: Holes 1-9 {event.config.front9Label} · Holes 10-18 {event.config.back9Label}
              </div>
              <button
                className="btn btn-primary btn-block"
                disabled={event.participants.length < 2}
                onClick={() => void saveEvent({ ...event, status: 'draw' })}
              >
                Continue to Partner Draw <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          STEP 2: PARTNER DRAW & CARD PINS
         ==================================================================== */}
      {isAdmin && event.status === 'draw' && (
        <div className="section">
          <div className="section-head" style={{ flexWrap: 'wrap' }}>
            <div>
              <h2 className="display section-title">Partner Draw &amp; Cards</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Pool A: {poolCounts.A} · Pool B: {poolCounts.B}. Random draw pairs 1 Pool A + 1 Pool B player
                {poolCounts.A !== poolCounts.B
                  ? ', pairs leftover players together, and marks 1 odd player as Cali if needed.'
                  : '.'}
              </p>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => void handleRunRandomDraw()}>
                <Shuffle size={16} /> {event.teams.length > 0 ? 'Re-Draw Random A+B' : 'Draw Random A+B Teams'}
              </button>
              {event.teams.length > 0 && (
                <button
                  className="btn"
                  onClick={() => void saveEvent({ ...event, status: 'scoring' })}
                >
                  Start 18-Hole Scoring <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>

          {event.teams.length > 0 && unassignedParticipants.length > 0 && (
            <div
              className="notice section"
              style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}
            >
              <span>
                <strong>Unassigned late check-in{unassignedParticipants.length === 1 ? '' : 's'}:</strong>{' '}
                {unassignedParticipants.map(p => `${p.name} (Pool ${p.pool})`).join(', ')}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  const assigned = assignUnassignedParticipants(
                    event.participants,
                    event.teams,
                    event.cards,
                    event.config.teamsPerCard,
                  )
                  const nextPins = generateCardPins(assigned.cards, cardPins)
                  const ok = await saveEvent(
                    { ...event, teams: assigned.teams, cards: assigned.cards },
                    nextPins,
                  )
                  if (ok) {
                    reportInfo(
                      `Assigned ${unassignedParticipants.length} late player${unassignedParticipants.length === 1 ? '' : 's'} without changing existing pairs.`,
                    )
                  }
                }}
              >
                Assign to Teams (Keep Existing Pairs)
              </button>
            </div>
          )}

          {event.teams.length === 0 ? (
            <div className="empty panel panel-pad">
              <Shuffle size={40} color="var(--orange)" />
              <div className="display" style={{ fontSize: 24 }}>Ready to Draw Teams</div>
              <p className="muted">
                Tap <strong>Draw Random A+B Teams</strong> above to randomly pair Pool A and Pool B players onto cards and generate 4-digit Card PINs.
              </p>
            </div>
          ) : (
            <div className="grid-2">
              <div className="panel">
                <div className="panel-head">
                  <span className="eyebrow">Drawn Teams ({event.teams.length})</span>
                  <span className="faint" style={{ fontSize: 12 }}>Swap partners or assign cards anytime</span>
                </div>
                <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 64 }}>Team</th>
                        <th>Players</th>
                        <th style={{ width: 125 }}>Card</th>
                        <th className="r" style={{ width: 110 }}>Adjust</th>
                      </tr>
                    </thead>
                    <tbody>
                      {event.teams.map(team => (
                        <tr key={team.id}>
                          <td className="strong">T{team.teamNumber}</td>
                          <td>
                            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                              {team.participantIds.map(pid => {
                                const p = participantById.get(pid)
                                return (
                                  <button
                                    key={pid}
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ height: 26, padding: '0 8px', border: '1px solid var(--line)' }}
                                    onClick={() => setAdjustParticipantId(pid)}
                                    title="Tap to swap partner or move to Cali"
                                  >
                                    <span>{p?.name ?? 'Unknown'}</span>
                                    <span className={`chip ${p?.pool === 'A' ? 'chip-orange' : 'chip-teal'}`}>
                                      {p?.pool ?? '?'}
                                    </span>
                                  </button>
                                )
                              })}
                              {team.isCali && <span className="chip chip-lime">Cali Solo</span>}
                            </div>
                          </td>
                          <td>
                            <select
                              className="select"
                              style={{ height: 30, fontSize: 12 }}
                              aria-label={`Card for Team ${team.teamNumber}`}
                              value={team.cardId ?? ''}
                              onChange={e => {
                                const cardId = e.target.value || null
                                void saveEvent({
                                  ...event,
                                  teams: event.teams.map(t => (t.id === team.id ? { ...t, cardId } : t)),
                                })
                              }}
                            >
                              {event.cards.map(c => (
                                <option key={c.id} value={c.id}>
                                  Card {c.cardNumber} (H{c.startingHole})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="r">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setAdjustParticipantId(team.participantIds[0] ?? null)}
                            >
                              Swap
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel panel-pad stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="eyebrow">Cards &amp; 4-Digit PINs</div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleCopyPins()}>
                    <Copy size={13} /> Copy PINs
                  </button>
                </div>
                <div className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <span className="muted" style={{ fontSize: 12 }}>Teams per Card</span>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      disabled={event.config.teamsPerCard <= 1}
                      onClick={() => void handleRegroupCards(event.config.teamsPerCard - 1)}
                    >
                      <Minus size={14} />
                    </button>
                    <span className="num strong">{event.config.teamsPerCard}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      disabled={event.config.teamsPerCard >= 6}
                      onClick={() => void handleRegroupCards(event.config.teamsPerCard + 1)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                {event.cards.map(card => {
                  const cardTeams = event.teams.filter(t => t.cardId === card.id)
                  return (
                    <div
                      key={card.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--r)',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <span className="strong">Card {card.cardNumber}</span>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="pin-box num">{cardPins[card.id] ?? '----'}</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Regenerate PIN"
                            aria-label={`Regenerate PIN for Card ${card.cardNumber}`}
                            onClick={() => void regenerateCardPin(event.id, card.id)}
                          >
                            <RefreshCw size={13} />
                          </button>
                          {cardTeams.length === 0 && event.cards.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-danger btn-icon"
                              title="Remove empty card"
                              aria-label={`Remove empty Card ${card.cardNumber}`}
                              onClick={() => void handleRemoveEmptyCard(card.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {cardTeams.length} team{cardTeams.length === 1 ? '' : 's'}
                        </span>
                        <label className="row" style={{ gap: 6, fontSize: 12 }}>
                          <span className="muted">Start Hole</span>
                          <select
                            className="select"
                            style={{ width: 78, height: 28, fontSize: 12 }}
                            value={card.startingHole}
                            onChange={e => {
                              const start = Math.min(18, Math.max(1, Number(e.target.value) || 1))
                              void saveEvent({
                                ...event,
                                cards: event.cards.map(c =>
                                  c.id === card.id ? { ...c, startingHole: start } : c,
                                ),
                              })
                            }}
                          >
                            {Array.from({ length: 18 }, (_, i) => i + 1).map(h => (
                              <option key={h} value={h}>
                                #{h}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  )
                })}

                <button
                  type="button"
                  className="btn btn-block"
                  onClick={() => void handleAddCard()}
                >
                  <Plus size={15} /> Add Extra Card
                </button>

                <button
                  className="btn btn-primary btn-block"
                  style={{ marginTop: 6 }}
                  onClick={() => void saveEvent({ ...event, status: 'scoring' })}
                >
                  Start 18-Hole Scoring <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          STEP 3 & PUBLIC LIVE VIEW: 18-HOLE SCORING & LIVE LEADERBOARD
         ==================================================================== */}
      {(event.status === 'scoring' || (!isAdmin && event.status !== 'results' && event.status !== 'complete')) && rankings && (
        <div className="section">
          {activeScorerCards.length > 0 && (
            <div className="panel panel-pad stack section" style={{ marginBottom: 20 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div className="eyebrow">Player Mobile Scorecard</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    Tap your card and enter the 4-digit Card PIN from the director to score Holes 1-9 ({event.config.front9Label}) &amp; 10-18 ({event.config.back9Label}).
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {activeScorerCards.map(card => {
                  const unlocked = isCardUnlocked(event.id, card.id)
                  const cardTeams = event.teams.filter(t => t.cardId === card.id)
                  const leadSummary = cardTeams[0] ? teamScoreSummary(cardTeams[0], event.courseHoles) : null
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={`btn ${unlocked ? 'btn-primary' : ''}`}
                      onClick={() => openCardScorer(card)}
                    >
                      {unlocked ? <Unlock size={14} /> : <Lock size={14} />}
                      <span>
                        Card {card.cardNumber} (Hole {card.startingHole})
                      </span>
                      {leadSummary && leadSummary.thru > 0 && (
                        <span className="chip" style={{ background: 'rgba(0,0,0,0.22)', color: 'inherit', borderColor: 'currentColor' }}>
                          {leadSummary.isFinished ? 'F' : `T${leadSummary.thru}`}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="section-head" style={{ flexWrap: 'wrap' }}>
            <div>
              <h2 className="display section-title">Live Leaderboard (Strokes to Par)</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Sorted by strokes to par (lowest wins, e.g. -3 Thru 5 ranks above -2 Thru 16).
                {isAdmin ? ' Directors can also type a final 18-hole total directly.' : ''}
              </p>
            </div>
            {isAdmin && event.status === 'scoring' && (
              <button
                className="btn btn-primary"
                onClick={() => void saveEvent({ ...event, status: 'results' })}
              >
                Advance to Results &amp; Payouts <ChevronRight size={16} />
              </button>
            )}
          </div>

          {event.teams.length === 0 ? (
            <div className="empty panel panel-pad">
              <Trophy size={36} color="var(--orange)" />
              <div className="display" style={{ fontSize: 22 }}>Waiting on Partner Draw</div>
              <p className="muted">Teams will appear here once check-in and the random partner draw finish.</p>
            </div>
          ) : (
            <div className="panel">
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-place">Plc</th>
                      <th>Team</th>
                      <th className="c">To Par</th>
                      <th className="c">Thru</th>
                      <th className="c hide-sm">F9</th>
                      <th className="c hide-sm">B9</th>
                      <th className="c">Strokes</th>
                      {isAdmin && <th className="c bl" style={{ width: 110 }}>18 Total</th>}
                      {isAdmin && <th className="r" style={{ width: 92 }}>Card</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {[...rankings.leaderboard, ...rankings.notStarted].map(row => {
                      const card = row.team.cardId
                        ? event.cards.find(c => c.id === row.team.cardId)
                        : null
                      return (
                        <tr key={row.team.id} className={row.place === 1 ? 'leader' : ''}>
                          <td className="place">
                            {row.place > 0 ? (row.tied ? `T${row.place}` : ordinal(row.place)) : '--'}
                          </td>
                          <td>
                            <div className="strong">{teamDisplayName(row.team)}</div>
                            <div className="row" style={{ gap: 4, marginTop: 2 }}>
                              {row.team.participantIds.map(pid => {
                                const p = participantById.get(pid)
                                return (
                                  <span key={pid} className="faint" style={{ fontSize: 11 }}>
                                    [{p?.pool ?? '?'}]
                                  </span>
                                )
                              })}
                              {row.team.isCali && <span className="chip chip-lime">Cali</span>}
                            </div>
                          </td>
                          <td className={`c big num ${toParClass(row.summary.toPar)}`}>
                            {formatToPar(row.summary.toPar)}
                          </td>
                          <td className="c num">
                            {row.summary.thru === 0
                              ? '--'
                              : row.summary.isFinished
                                ? 'F'
                                : `${row.summary.thru}`}
                          </td>
                          <td className="c num hide-sm muted">
                            {row.summary.frontStrokes ?? '--'}
                          </td>
                          <td className="c num hide-sm muted">
                            {row.summary.backStrokes ?? '--'}
                          </td>
                          <td className="c num strong">
                            {row.summary.strokes ?? '--'}
                          </td>
                          {isAdmin && (
                            <td className="c bl">
                              <Manual18Input
                                value={row.team.manualTotal18}
                                placeholder={row.summary.officialTotal18 != null ? String(row.summary.officialTotal18) : '18h'}
                                onCommit={val => setTeamManual18(row.team.id, val)}
                              />
                            </td>
                          )}
                          {isAdmin && (
                            <td className="r">
                              {card && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => openCardScorer(card)}
                                >
                                  Card {card.cardNumber}
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          STEP 4: RESULTS, PAYOUTS, ACE / CTP & FINAL SUMMARY
         ==================================================================== */}
      {(event.status === 'results' || event.status === 'complete') && finances && rankings && (
        <div className="section">
          <div className="section-head" style={{ flexWrap: 'wrap' }}>
            <div>
              <h2 className="display section-title">
                {event.status === 'complete' ? 'Official Results & Payouts' : 'Results, Payouts & Ace / CTP'}
              </h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {event.status === 'complete'
                  ? 'Final payouts and pot distributions are locked.'
                  : 'Adjust paid places, settle any cash-place ties by playoff if needed, and assign Ace / CTP.'}
              </p>
            </div>
            {isAdmin && event.status === 'results' && (
              <button
                className="btn btn-primary"
                disabled={overPurse}
                onClick={async () => {
                  const ok = await askConfirm(
                    'Finalize this special event? Card PIN scoring will lock and official results will be posted.',
                    { title: 'Finalize Special Event?', confirmLabel: 'Finalize Event' },
                  )
                  if (ok) {
                    const saved = await saveEvent({ ...event, status: 'complete' })
                    if (saved) {
                      selectEvent(null)
                      setExpandedTeamId(null)
                      setTabChoice('history')
                      setHistoryDetailId(event.id)
                      reportInfo(`${event.name} finalized.`)
                    }
                  }
                }}
              >
                <Check size={16} /> Finalize Event
              </button>
            )}
          </div>

          {rankings.unfinishedCount > 0 && event.status !== 'complete' && (
            <div className="notice section" style={{ marginBottom: 16 }}>
              <Trophy size={16} />
              <span>
                {rankings.unfinishedCount} team{rankings.unfinishedCount === 1 ? '' : 's'} still {rankings.unfinishedCount === 1 ? 'has' : 'have'} incomplete holes. Only finished 18-hole rounds receive official place payouts.
              </span>
            </div>
          )}

          <div className="grid-2">
            {/* Final Standings & Team Cash Splits */}
            <div className="stack">
              <div className="panel">
                <div className="panel-head">
                  <span className="eyebrow">Final Standings &amp; Partner Splits</span>
                  <span className="faint" style={{ fontSize: 12 }}>Par {parTotals.totalPar}</span>
                </div>
                <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="w-place">Plc</th>
                        <th>Team</th>
                        <th className="c">To Par</th>
                        <th className="c">18 Total</th>
                        <th className="r">Team Cash</th>
                        <th className="r hide-sm">Per Player</th>
                        {isAdmin && event.status === 'results' && tiedToParValues.size > 0 && (
                          <th className="r bl">Playoff</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {[...rankings.leaderboard, ...rankings.notStarted].map(row => {
                        const perPlayer =
                          row.payout > 0
                            ? cents(row.payout / Math.max(1, row.team.participantIds.length))
                            : 0
                        const isPlayoffEligible =
                          row.summary.isFinished &&
                          row.summary.toPar != null &&
                          tiedToParValues.has(row.summary.toPar)
                        const hasHoleScores = row.team.holes.some(h => h != null)
                        const isExpanded = expandedTeamId === row.team.id
                        return (
                          <Fragment key={row.team.id}>
                            <tr className={row.place === 1 ? 'leader' : ''}>
                              <td className="place">
                                {row.place > 0 ? (row.tied ? `T${row.place}` : ordinal(row.place)) : '--'}
                              </td>
                              <td>
                                <div className="strong">{teamDisplayName(row.team)}</div>
                                {hasHoleScores && (
                                  <div style={{ marginTop: 4 }}>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      style={{ height: 22, padding: '0 7px', fontSize: 11 }}
                                      onClick={() =>
                                        setExpandedTeamId(prev => (prev === row.team.id ? null : row.team.id))
                                      }
                                    >
                                      {isExpanded ? 'Hide 18h Card' : '18h Scorecard'}
                                    </button>
                                  </div>
                                )}
                                {isAdmin && event.status === 'results' && !row.summary.isFinished && (
                                  <div style={{ marginTop: 4 }}>
                                    <Manual18Input
                                      value={row.team.manualTotal18}
                                      placeholder="Enter 18h"
                                      onCommit={val => setTeamManual18(row.team.id, val)}
                                    />
                                  </div>
                                )}
                              </td>
                              <td className={`c big num ${toParClass(row.summary.toPar)}`}>
                                {formatToPar(row.summary.toPar)}
                              </td>
                              <td className="c num strong">
                                {row.summary.isFinished
                                  ? row.summary.officialTotal18
                                  : row.summary.thru > 0
                                    ? `Thru ${row.summary.thru}`
                                    : '--'}
                              </td>
                              <td className="r num strong" style={{ color: row.payout > 0 ? 'var(--teal)' : undefined }}>
                                {row.payout > 0 ? money(row.payout) : '--'}
                              </td>
                              <td className="r num hide-sm muted">
                                {row.payout > 0
                                  ? row.team.participantIds.length > 1
                                    ? `${money(perPlayer)} ea`
                                    : 'Solo'
                                  : '--'}
                              </td>
                              {isAdmin && event.status === 'results' && tiedToParValues.size > 0 && (
                                <td className="r bl">
                                  {isPlayoffEligible ? (
                                    <select
                                      className="select"
                                      style={{ width: 98, height: 28, fontSize: 11 }}
                                      value={row.team.playoffRank ?? ''}
                                      onChange={e => {
                                        const val = e.target.value ? Number(e.target.value) : null
                                        void saveEvent({
                                          ...event,
                                          teams: event.teams.map(t =>
                                            t.id === row.team.id ? { ...t, playoffRank: val } : t,
                                          ),
                                        })
                                      }}
                                    >
                                      <option value="">Split tie</option>
                                      <option value="1">Playoff #1</option>
                                      <option value="2">Playoff #2</option>
                                      <option value="3">Playoff #3</option>
                                    </select>
                                  ) : (
                                    <span className="faint">--</span>
                                  )}
                                </td>
                              )}
                            </tr>
                            {isExpanded && hasHoleScores && (
                              <tr className="sp-scorecard-detail">
                                <td
                                  colSpan={isAdmin && event.status === 'results' && tiedToParValues.size > 0 ? 7 : 6}
                                  style={{ padding: 8, background: 'var(--bg)' }}
                                >
                                  <TeamHoleScorecard
                                    holes={row.team.holes}
                                    courseHoles={event.courseHoles}
                                    summary={row.summary}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Closeout Summary Card */}
              <div className="panel panel-pad stack">
                <div className="eyebrow">Cash Payout Checklist</div>
                <div className="kv">
                  <dt>{event.config.courseFundLabel}</dt>
                  <dd>{money(finances.courseFund)}</dd>
                </div>
                <div className="kv">
                  <dt>
                    {event.aceResolution.mode === 'ace'
                      ? `Ace Pot (${acePayouts.length} winner${acePayouts.length === 1 ? '' : 's'})`
                      : event.aceResolution.mode === 'ctp'
                        ? 'CTP Payout (No Ace)'
                        : 'Ace / CTP Pot (Pending)'}
                  </dt>
                  <dd style={{ color: 'var(--teal)' }}>
                    {acePayouts.length > 0
                      ? acePayouts
                          .map(ap => `${participantById.get(ap.participantId)?.name ?? 'Winner'} (${money(ap.amount)})`)
                          .join(', ')
                      : money(finances.acePot)}
                  </dd>
                </div>
                <div className="kv">
                  <dt>Team Payouts Allocated</dt>
                  <dd style={{ color: 'var(--orange)' }}>
                    {money(allocatedTeamPurse)} / {money(purseTotal)}
                  </dd>
                </div>
              </div>
            </div>

            {/* Right Column: Editable Team Payouts & Ace / CTP Resolver */}
            <div className="stack">
              <div className="panel panel-pad stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="eyebrow">Team Place Payouts</div>
                  <span className="num strong">{money(purseTotal)} purse</span>
                </div>

                {isAdmin && event.status === 'results' && (
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="muted" style={{ fontSize: 12 }}>Places paid:</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        disabled={(event.payoutPlaces.length || 1) <= 1}
                        onClick={() => stepTeamPlaces(-1)}
                        aria-label="Fewer paid places"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="num strong" style={{ minWidth: 18, textAlign: 'center' }}>
                        {event.payoutPlaces.length}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        disabled={event.payoutPlaces.length >= Math.max(1, event.teams.length)}
                        onClick={() => stepTeamPlaces(1)}
                        aria-label="More paid places"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setPayoutError('')
                        const count = event.payoutPlaces.length || suggestedTeamPaidPlaces(event.teams.length)
                        void saveEvent({
                          ...event,
                          payoutPlaces: suggestedTeamPayouts(purseTotal, count),
                        })
                      }}
                    >
                      Use Suggested
                    </button>
                  </div>
                )}

                {event.payoutPlaces.map((amt, idx) => (
                  <div key={idx} className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                    <span className="strong" style={{ minWidth: 70 }}>{ordinal(idx + 1)} Place</span>
                    {isAdmin && event.status === 'results' ? (
                      <div style={{ flex: 1 }}>
                        <MoneyInput
                          value={amt}
                          silentInvalid
                          aria-label={`${ordinal(idx + 1)} place team payout`}
                          onReject={setPayoutError}
                          onChange={v => saveTeamPayout(idx, v)}
                        />
                      </div>
                    ) : (
                      <span className="num strong">{money(amt)}</span>
                    )}
                    <span className="muted num" style={{ fontSize: 12, minWidth: 66, textAlign: 'right' }}>
                      {money(cents(amt / 2))} / ea
                    </span>
                  </div>
                ))}

                {payoutError && <small className="field-error">{payoutError}</small>}
                {overPurse && (
                  <small className="field-error">
                    Total payouts ({money(allocatedTeamPurse)}) exceed the {money(purseTotal)} purse.
                  </small>
                )}
                {!overPurse && cents(purseTotal - allocatedTeamPurse) > 0.001 && (
                  <small className="muted">
                    {money(cents(purseTotal - allocatedTeamPurse))} remaining in team payout purse.
                  </small>
                )}
              </div>

              <div className="panel panel-pad stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="eyebrow">Ace Pot / CTP ({money(finances.acePot)})</div>
                </div>

                {isAdmin && event.status === 'results' ? (
                  <>
                    <Seg
                      value={event.aceResolution.mode}
                      onChange={mode => {
                        const prevIds = event.aceResolution.winnerParticipantIds
                        const nextIds =
                          mode === 'pending'
                            ? []
                            : mode === 'ctp'
                              ? prevIds.slice(0, 1)
                              : prevIds
                        void saveEvent({
                          ...event,
                          aceResolution: { mode, winnerParticipantIds: nextIds },
                        })
                      }}
                      options={[
                        { value: 'pending', label: 'Pending' },
                        { value: 'ace', label: 'Ace Hit' },
                        { value: 'ctp', label: 'No Ace -> CTP' },
                      ]}
                    />

                    {event.aceResolution.mode === 'ctp' && (
                      <div className="field">
                        <span>CTP Winner (Winner takes all {money(finances.acePot)})</span>
                        <select
                          className="select"
                          value={event.aceResolution.winnerParticipantIds[0] ?? ''}
                          onChange={e =>
                            void saveEvent({
                              ...event,
                              aceResolution: {
                                mode: 'ctp',
                                winnerParticipantIds: e.target.value ? [e.target.value] : [],
                              },
                            })
                          }
                        >
                          <option value="">Select CTP winner...</option>
                          {event.participants.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name} (Pool {p.pool})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {event.aceResolution.mode === 'ace' && (
                      <div className="stack" style={{ gap: 8 }}>
                        <span className="muted" style={{ fontSize: 12 }}>
                          Select everyone who hit an Ace (1 winner takes all; multiple winners split evenly):
                        </span>
                        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {event.participants.map(p => {
                            const checked = event.aceResolution.winnerParticipantIds.includes(p.id)
                            return (
                              <label
                                key={p.id}
                                className="row"
                                style={{
                                  justifyContent: 'space-between',
                                  padding: '6px 10px',
                                  borderRadius: 'var(--r)',
                                  background: checked ? 'var(--teal-dim)' : 'var(--surface-2)',
                                  border: `1px solid ${checked ? 'var(--teal)' : 'var(--line)'}`,
                                  cursor: 'pointer',
                                }}
                              >
                                <span className="row" style={{ gap: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const cur = event.aceResolution.winnerParticipantIds
                                      const next = checked
                                        ? cur.filter(id => id !== p.id)
                                        : [...cur, p.id]
                                      void saveEvent({
                                        ...event,
                                        aceResolution: { mode: 'ace', winnerParticipantIds: next },
                                      })
                                    }}
                                  />
                                  <span className="strong">{p.name}</span>
                                </span>
                                <span className="chip">{`Pool ${p.pool}`}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {event.aceResolution.mode === 'pending' && 'Pending Ace / CTP winner selection.'}
                    {event.aceResolution.mode === 'ctp' &&
                      `CTP Winner: ${
                        event.aceResolution.winnerParticipantIds[0]
                          ? `${participantById.get(event.aceResolution.winnerParticipantIds[0])?.name ?? 'Selected'} (${money(finances.acePot)})`
                          : 'Not selected yet'
                      }`}
                    {event.aceResolution.mode === 'ace' &&
                      (acePayouts.length > 0
                        ? `Ace Hit: ${acePayouts
                            .map(ap => `${participantById.get(ap.participantId)?.name ?? 'Winner'} (${money(ap.amount)})`)
                            .join(', ')}`
                        : 'Ace Hit (selecting winners)')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          DIALOGS
         ==================================================================== */}

      {newEventModal}

      {/* Check-in Player Dialog */}
      {checkinOpen && (
        <Dialog title="Check In Player" onClose={() => setCheckinOpen(false)}>
          <div className="stack">
            <div className="field">
              <span>Pool Assignment</span>
              <Seg
                value={checkinPool}
                onChange={setCheckinPool}
                options={[
                  { value: 'A', label: 'Pool A (Open / Adv)' },
                  { value: 'B', label: 'Pool B (Low / Ladies)' },
                ]}
              />
            </div>

            <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: 13 }}>Paid {money(event.config.entryFee)} entry</span>
              <Toggle on={checkinPaid} onChange={setCheckinPaid} label="Entry paid" />
            </div>

            <div className="field">
              <span>Search Putts &amp; Pints Roster or Type Walk-Up Name</span>
              <div className="combo">
                <input
                  className="input"
                  autoFocus
                  placeholder="Type player name..."
                  value={searchName}
                  onChange={e => {
                    setSearchName(e.target.value)
                    setCheckinError('')
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (exactRosterMatch && !checkedInLowerNames.has(normalizeName(exactRosterMatch.name).toLowerCase())) {
                        void handleAddParticipantFromRoster(exactRosterMatch)
                      } else {
                        void handleAddWalkupParticipant()
                      }
                    }
                  }}
                />
                {matchingRosterPlayers.length > 0 && searchName.trim().length > 0 && (
                  <div className="combo-list" style={{ maxHeight: 190 }}>
                    {matchingRosterPlayers.slice(0, 8).map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => void handleAddParticipantFromRoster(p)}
                      >
                        <span className="strong">{p.name}</span>
                        <span className="faint" style={{ fontSize: 11 }}>
                          {p.division === 'M' ? "Men's" : "Women's"} P&amp;P
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {!exactRosterMatch && normalizeName(searchName).length > 0 && isAdmin && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--r)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                }}
                className="stack"
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="strong" style={{ fontSize: 13 }}>Also add to Putts &amp; Pints roster</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      Off keeps walk-up scoped only to this special event.
                    </div>
                  </div>
                  <Toggle
                    on={alsoAddRoster}
                    onChange={setAlsoAddRoster}
                    label="Also add to Putts & Pints roster"
                  />
                </div>
                {alsoAddRoster && (
                  <div className="field">
                    <span>Putts &amp; Pints Division</span>
                    <DivisionSeg value={rosterDiv} onChange={setRosterDiv} />
                  </div>
                )}
              </div>
            )}

            {checkinError && <small className="field-error">{checkinError}</small>}

            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!normalizeName(searchName)}
              onClick={() => {
                if (exactRosterMatch && !checkedInLowerNames.has(normalizeName(exactRosterMatch.name).toLowerCase())) {
                  void handleAddParticipantFromRoster(exactRosterMatch)
                } else {
                  void handleAddWalkupParticipant()
                }
              }}
            >
              Check In {normalizeName(searchName) ? `"${normalizeName(searchName)}"` : 'Player'} to Pool {checkinPool}
            </button>
          </div>
        </Dialog>
      )}

      {/* Course & Hole Notes Dialog */}
      {courseOpen && (
        <Dialog
          title={`Course & Hole Notes (${event.location || event.name})`}
          onClose={() => setCourseOpen(false)}
          footer={
            isAdmin ? (
              <div className="dialog-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const trinity = cloneGatewayTrinityHoles()
                    setHoleDrafts(prev =>
                      trinity.map((h, i) => ({ ...h, note: prev[i]?.note ?? '' })),
                    )
                  }}
                >
                  Reset Trinity Pars &amp; Distances
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    const ok = await saveEvent({ ...event, courseHoles: holeDrafts })
                    if (ok) {
                      setCourseOpen(false)
                      reportInfo('Course pars and hole notes saved.')
                    }
                  }}
                >
                  Save Course
                </button>
              </div>
            ) : (
              <button type="button" className="btn" onClick={() => setCourseOpen(false)}>Close</button>
            )
          }
        >
          <div className="stack">
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }} >
              <span className="muted">
                Front 9 Par {courseParTotals(holeDrafts).frontPar} · Back 9 Par {courseParTotals(holeDrafts).backPar}
              </span>
              <span className="strong">
                Total Par {courseParTotals(holeDrafts).totalPar} ({courseParTotals(holeDrafts).totalDistanceFt.toLocaleString()} ft)
              </span>
            </div>

            <div className="table-wrap" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 52 }}>Hole</th>
                    <th className="c" style={{ width: 72 }}>Par</th>
                    <th className="c" style={{ width: 84 }}>Dist (ft)</th>
                    <th>Director Note</th>
                  </tr>
                </thead>
                <tbody>
                  {holeDrafts.map((h, idx) => (
                    <tr key={h.hole}>
                      <td className="strong num">#{h.hole}</td>
                      <td className="c">
                        {isAdmin ? (
                          <select
                            className="select"
                            style={{ height: 28, padding: '0 6px', fontSize: 12 }}
                            value={h.par}
                            onChange={e => {
                              const par = Number(e.target.value) || 3
                              setHoleDrafts(prev =>
                                prev.map((item, i) => (i === idx ? { ...item, par } : item)),
                              )
                            }}
                          >
                            {[2, 3, 4, 5].map(p => (
                              <option key={p} value={p}>Par {p}</option>
                            ))}
                          </select>
                        ) : (
                          <span>{h.par}</span>
                        )}
                      </td>
                      <td className="c">
                        {isAdmin ? (
                          <input
                            className="input num"
                            type="number"
                            min={50}
                            max={1500}
                            style={{ height: 28, padding: '0 6px', fontSize: 12, textAlign: 'center' }}
                            value={h.distanceFt ?? ''}
                            onChange={e => {
                              const raw = e.target.value.trim()
                              const dist = raw === '' ? null : Math.max(1, Math.trunc(Number(raw) || 0))
                              setHoleDrafts(prev =>
                                prev.map((item, i) => (i === idx ? { ...item, distanceFt: dist } : item)),
                              )
                            }}
                          />
                        ) : (
                          <span>{h.distanceFt ?? '--'}</span>
                        )}
                      </td>
                      <td>
                        {isAdmin ? (
                          <input
                            className="input"
                            style={{ height: 28, padding: '0 8px', fontSize: 12 }}
                            placeholder="OB, Mando, CTP..."
                            value={h.note}
                            onChange={e => {
                              const note = e.target.value
                              setHoleDrafts(prev =>
                                prev.map((item, i) => (i === idx ? { ...item, note } : item)),
                              )
                            }}
                          />
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>{h.note || '--'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Dialog>
      )}

      {/* Partner Swap / Cali Dialog */}
      {adjustParticipant && adjustSourceTeam && (
        <Dialog
          title={`Adjust ${adjustParticipant.name}`}
          onClose={() => setAdjustParticipantId(null)}
        >
          <div className="stack">
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Move <strong>{adjustParticipant.name}</strong> (Pool {adjustParticipant.pool}) onto another team (swapping partners if that team already has 2 players) or mark as solo Cali.
            </p>
            <div className="stack" style={{ gap: 8, maxHeight: '50vh', overflowY: 'auto' }}>
              {event.teams
                .filter(t => t.id !== adjustSourceTeam.id)
                .map(target => (
                  <div
                    key={target.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--r)',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                    }}
                    className="stack"
                  >
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="strong">Team {target.teamNumber}: {teamDisplayName(target)}</span>
                      {target.participantIds.length === 1 && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={async () => {
                            const nextTeams = moveParticipantBetweenTeams(
                              event.teams,
                              adjustParticipant.id,
                              target.id,
                            )
                            const nextPayouts =
                              event.payoutPlaces.length > nextTeams.length && finances
                                ? suggestedTeamPayouts(
                                    finances.payoutPurse,
                                    clampPaidPlaces(nextTeams.length, event.payoutPlaces.length),
                                  )
                                : event.payoutPlaces
                            await saveEvent({ ...event, teams: nextTeams, payoutPlaces: nextPayouts })
                            setAdjustParticipantId(null)
                          }}
                        >
                          Pair With Cali
                        </button>
                      )}
                    </div>
                    {target.participantIds.length >= 2 && (
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {target.participantIds.map(swapId => {
                          const sp = participantById.get(swapId)
                          return (
                            <button
                              key={swapId}
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ border: '1px solid var(--line-strong)' }}
                              onClick={async () => {
                                const nextTeams = moveParticipantBetweenTeams(
                                  event.teams,
                                  adjustParticipant.id,
                                  target.id,
                                  swapId,
                                )
                                await saveEvent({ ...event, teams: nextTeams })
                                setAdjustParticipantId(null)
                              }}
                            >
                              Swap with {sp?.name ?? 'Player'} ({sp?.pool ?? '?'})
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
            </div>
            {adjustSourceTeam.participantIds.length > 1 && (
              <button
                type="button"
                className="btn btn-block"
                onClick={async () => {
                  const nextTeams = moveParticipantBetweenTeams(
                    event.teams,
                    adjustParticipant.id,
                    'new_cali',
                  )
                  await saveEvent({ ...event, teams: nextTeams })
                  setAdjustParticipantId(null)
                }}
              >
                Split {adjustParticipant.name} Out as Solo Cali
              </button>
            )}
          </div>
        </Dialog>
      )}

      {/* Card Scorecard (PIN Gate + Intuitive Hole-by-Hole Scorer) */}
      {scorerCard && (
        <Dialog
          title={`Card ${scorerCard.cardNumber} Scorecard`}
          onClose={() => setScorerCardId(null)}
        >
          {!scorerUnlocked ? (
            <form
              className="stack"
              onSubmit={async e => {
                e.preventDefault()
                const ok = await unlockCardWithPin(event.id, scorerCard.id, pinInput)
                if (!ok) {
                  setPinError('Incorrect 4-digit PIN. Ask the tournament director for your card PIN.')
                  return
                }
                setPinError('')
                setPinInput('')
              }}
            >
              <div className="panel panel-pad stack" style={{ gap: 6 }}>
                <div className="eyebrow">Teams on Card {scorerCard.cardNumber} (Starts Hole {scorerCard.startingHole})</div>
                {scorerCardTeams.map(t => (
                  <div key={t.id} className="strong" style={{ fontSize: 14 }}>
                    · {teamDisplayName(t)}
                  </div>
                ))}
              </div>
              <div className="field">
                <span>Enter 4-Digit Card PIN</span>
                <input
                  className="input num"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoFocus
                  placeholder="4-digit PIN"
                  style={{ fontSize: 22, letterSpacing: '0.28em', textAlign: 'center', height: 48 }}
                  value={pinInput}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                    setPinInput(digits)
                    setPinError('')
                  }}
                />
                {pinError && <small className="field-error">{pinError}</small>}
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={pinInput.length !== 4}
              >
                <Unlock size={15} /> Unlock Card {scorerCard.cardNumber}
              </button>
            </form>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {/* Card selector if Admin wants to jump cards */}
              {activeScorerCards.length > 1 && (
                <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                  {activeScorerCards.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className={`btn btn-sm ${c.id === scorerCard.id ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => openCardScorer(c)}
                    >
                      Card {c.cardNumber}
                    </button>
                  ))}
                </div>
              )}

              {/* Hole Header & Format Pill */}
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--r)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                }}
                className="stack"
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setActiveHole(prevShotgunHole)
                      setEditingHoleNote(false)
                    }}
                    aria-label="Previous hole"
                  >
                    <ChevronLeft size={16} /> H{prevShotgunHole}
                  </button>
                  <div style={{ textAlign: 'center' }}>
                    <div className="display" style={{ fontSize: 26, lineHeight: 1 }}>
                      Hole {activeHole}
                    </div>
                    <div className="muted num" style={{ fontSize: 12, marginTop: 3 }}>
                      Par {activeHoleInfo.par}
                      {activeHoleInfo.distanceFt ? ` · ${activeHoleInfo.distanceFt} ft` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setActiveHole(nextShotgunHole)
                      setEditingHoleNote(false)
                    }}
                    aria-label="Next hole"
                  >
                    H{nextShotgunHole} <ChevronRight size={16} />
                  </button>
                </div>

                <div className="row" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`chip ${activeHole <= 9 ? 'chip-orange' : 'chip-teal'}`}>
                    Holes {activeHole <= 9 ? '1-9' : '10-18'} · {activeHoleFormat}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ height: 22, fontSize: 11, padding: '0 8px' }}
                      onClick={() => {
                        setHoleNoteDraft(activeHoleInfo.note)
                        setEditingHoleNote(v => !v)
                      }}
                    >
                      <Pencil size={11} /> {activeHoleInfo.note ? 'Edit Note' : 'Add Hole Note'}
                    </button>
                  )}
                </div>

                {editingHoleNote && isAdmin && (
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      className="input"
                      style={{ height: 32, fontSize: 12 }}
                      placeholder={`Note for Hole ${activeHole} (OB, Mando, CTP...)`}
                      value={holeNoteDraft}
                      onChange={e => setHoleNoteDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        const updatedHoles = event.courseHoles.map((ch, idx) =>
                          idx === activeHole - 1 ? { ...ch, note: holeNoteDraft.trim() } : ch,
                        )
                        await saveEvent({ ...event, courseHoles: updatedHoles })
                        setEditingHoleNote(false)
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}

                {activeHoleInfo.note.trim() && !editingHoleNote && (
                  <div className="notice" style={{ padding: '8px 10px', fontSize: 12 }}>
                    <NotebookPen size={14} />
                    <span>
                      <strong>Hole {activeHole} Note:</strong> {activeHoleInfo.note}
                    </span>
                  </div>
                )}
              </div>

              {/* Per-Team Quick Stroke Pad */}
              <div className="stack" style={{ gap: 10 }}>
                {scorerCardTeams.map(team => {
                  const summary = teamScoreSummary(team, event.courseHoles)
                  const currentStroke = clampHoleStroke(team.holes?.[activeHole - 1])
                  const par = activeHoleInfo.par
                  const quickMin = Math.max(1, par - 2)
                  const quickOptions = [quickMin, quickMin + 1, quickMin + 2, quickMin + 3, quickMin + 4]
                  const locked = event.status === 'complete'

                  return (
                    <div key={team.id} className="stroke-pad">
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span className="strong" style={{ fontSize: 15 }}>
                          {teamDisplayName(team)}
                        </span>
                        <span className="num" style={{ fontSize: 13 }}>
                          <strong className={toParClass(summary.toPar)}>
                            {formatToPar(summary.toPar)}
                          </strong>
                          <span className="muted" style={{ marginLeft: 6 }}>
                            {summary.thru > 0 ? `Thru ${summary.thru} (${summary.strokes})` : 'Not started'}
                          </span>
                        </span>
                      </div>

                      <div className="stroke-pills">
                        {quickOptions.map(scoreVal => {
                          const selected = currentStroke === scoreVal
                          return (
                            <button
                              key={scoreVal}
                              type="button"
                              disabled={locked}
                              className={`stroke-pill ${selected ? 'on' : ''}`}
                              onClick={() => void setTeamHoleStroke(team, activeHole, scoreVal)}
                            >
                              <span className="num strong" style={{ fontSize: 16 }}>{scoreVal}</span>
                              <span style={{ fontSize: 10, opacity: 0.85 }}>
                                {parScoreLabel(scoreVal, par)}
                              </span>
                            </button>
                          )
                        })}
                      </div>

                      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon"
                            disabled={locked}
                            aria-label="Decrease strokes"
                            onClick={() => {
                              const base = currentStroke ?? par
                              void setTeamHoleStroke(team, activeHole, Math.max(1, base - 1))
                            }}
                          >
                            <Minus size={14} />
                          </button>
                          <span className="num strong" style={{ minWidth: 26, textAlign: 'center', fontSize: 16 }}>
                            {currentStroke ?? '--'}
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon"
                            disabled={locked}
                            aria-label="Increase strokes"
                            onClick={() => {
                              const base = currentStroke ?? par
                              void setTeamHoleStroke(team, activeHole, Math.min(20, base + 1))
                            }}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        {currentStroke != null && !locked && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void setTeamHoleStroke(team, activeHole, null)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Primary Next Hole CTA */}
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => {
                  if (allCardHolesComplete) {
                    setScorerCardId(null)
                  } else {
                    setActiveHole(nextShotgunHole)
                    setEditingHoleNote(false)
                  }
                }}
              >
                {allCardHolesComplete ? (
                  <>
                    <Check size={16} /> All 18 Holes Complete — View Leaderboard
                  </>
                ) : (
                  <>
                    Next Hole (Hole {nextShotgunHole}) <ChevronRight size={16} />
                  </>
                )}
              </button>

              {/* 18-Hole Scrubber Strip */}
              <div className="hole-scrubber" aria-label="Hole selector">
                {Array.from({ length: 18 }, (_, i) => i + 1).map(holeNum => {
                  const holePar = event.courseHoles[holeNum - 1]?.par ?? 3
                  const leadScore = clampHoleStroke(scorerCardTeams[0]?.holes?.[holeNum - 1])
                  let cls = 'hole-pill'
                  if (holeNum === activeHole) cls += ' active'
                  if (leadScore != null) {
                    if (leadScore < holePar) cls += ' under'
                    else if (leadScore > holePar) cls += ' over'
                    else cls += ' even'
                  }
                  return (
                    <button
                      key={holeNum}
                      type="button"
                      className={cls}
                      onClick={() => {
                        setActiveHole(holeNum)
                        setEditingHoleNote(false)
                      }}
                    >
                      <span>{holeNum}</span>
                    </button>
                  )
                })}
              </div>

              {/* Expandable Full 18-Hole Card Grid */}
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowFullCardTable(v => !v)}
                >
                  {showFullCardTable ? 'Hide 18-Hole Grid' : 'Show Full 18-Hole Grid'}
                </button>
                <span className="faint" style={{ fontSize: 11 }}>
                  {event.status === 'complete' ? 'Scores locked' : 'Saves automatically on tap'}
                </span>
              </div>

              {showFullCardTable && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Hole</th>
                        <th className="c">Par</th>
                        {scorerCardTeams.map(t => (
                          <th key={t.id} className="c">T{t.teamNumber}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 18 }, (_, idx) => {
                        const h = idx + 1
                        const par = event.courseHoles[idx]?.par ?? 3
                        return (
                          <Fragment key={h}>
                            <tr
                              className="table-link"
                              onClick={() => {
                                setActiveHole(h)
                                setEditingHoleNote(false)
                              }}
                            >
                              <td className="strong num">#{h}</td>
                              <td className="c muted num">{par}</td>
                              {scorerCardTeams.map(t => {
                                const val = clampHoleStroke(t.holes?.[idx])
                                return (
                                  <td
                                    key={t.id}
                                    className={`c num strong ${
                                      val == null
                                        ? 'faint'
                                        : val < par
                                          ? 'sp-under'
                                          : val > par
                                            ? 'sp-over'
                                            : ''
                                    }`}
                                  >
                                    {val ?? '--'}
                                  </td>
                                )
                              })}
                            </tr>
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Dialog>
      )}
    </div>
  )
}

function Manual18Input({
  value,
  placeholder,
  onCommit,
}: {
  value: number | null
  placeholder: string
  onCommit: (raw: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value == null ? '' : String(value))

  return (
    <input
      className="score"
      type="number"
      inputMode="numeric"
      min={18}
      max={200}
      placeholder={placeholder}
      aria-label="18-hole total strokes override"
      value={shown}
      onFocus={e => {
        setDraft(value == null ? '' : String(value))
        e.target.select()
      }}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft != null) {
          onCommit(draft)
          setDraft(null)
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function NewSpecialEventDialog({
  newName,
  newDate,
  newLocation,
  newEntryFee,
  newAceShare,
  newCourseShare,
  newCourseLabel,
  newFrontLabel,
  newBackLabel,
  newUseTrinity,
  newNotes,
  newError,
  onName,
  onDate,
  onLocation,
  onEntryFee,
  onAceShare,
  onCourseShare,
  onCourseLabel,
  onFrontLabel,
  onBackLabel,
  onUseTrinity,
  onNotes,
  onLoadPreset,
  onCreate,
  onClose,
}: {
  newName: string
  newDate: string
  newLocation: string
  newEntryFee: number
  newAceShare: number
  newCourseShare: number
  newCourseLabel: string
  newFrontLabel: string
  newBackLabel: string
  newUseTrinity: boolean
  newNotes: string
  newError: string
  onName: (v: string) => void
  onDate: (v: string) => void
  onLocation: (v: string) => void
  onEntryFee: (v: number) => void
  onAceShare: (v: number) => void
  onCourseShare: (v: number) => void
  onCourseLabel: (v: string) => void
  onFrontLabel: (v: string) => void
  onBackLabel: (v: string) => void
  onUseTrinity: (v: boolean) => void
  onNotes: (v: string) => void
  onLoadPreset: () => void
  onCreate: () => void
  onClose: () => void
}) {
  const purseShare = Math.max(0, cents(newEntryFee - newAceShare - newCourseShare))

  return (
    <Dialog title="New Special Event" onClose={onClose}>
      <div className="stack">
        <button
          type="button"
          className="btn btn-block"
          style={{ borderColor: 'var(--orange)', justifyContent: 'center' }}
          onClick={onLoadPreset}
        >
          <Sparkles size={15} color="var(--orange)" /> Load Black Friday Draw Dubs Preset
        </button>

        <div className="field">
          <span>Event Name</span>
          <input
            className="input"
            value={newName}
            onChange={e => onName(e.target.value)}
            placeholder="e.g. Black Friday Draw Dubs"
          />
        </div>

        <div className="grid-cols" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">
            <span>Date</span>
            <input
              className="input"
              type="date"
              value={newDate}
              onChange={e => onDate(e.target.value)}
            />
          </div>
          <div className="field">
            <span>Location</span>
            <input
              className="input"
              value={newLocation}
              onChange={e => onLocation(e.target.value)}
              placeholder="Gateway Park - Trinity Side"
            />
          </div>
        </div>

        <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div className="field">
            <span>Entry Fee</span>
            <MoneyInput value={newEntryFee} onChange={onEntryFee} />
          </div>
          <div className="field">
            <span>Ace / CTP</span>
            <MoneyInput value={newAceShare} onChange={onAceShare} />
          </div>
          <div className="field">
            <span>Course Fund</span>
            <MoneyInput value={newCourseShare} onChange={onCourseShare} />
          </div>
        </div>

        <div className="muted" style={{ fontSize: 12 }}>
          Remaining <strong>{money(purseShare)}/player</strong> goes to the Team Payout Purse.
        </div>

        <div className="field">
          <span>Course Fund Label</span>
          <input
            className="input"
            value={newCourseLabel}
            onChange={e => onCourseLabel(e.target.value)}
          />
        </div>

        <div className="grid-cols" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">
            <span>Holes 1-9 Format</span>
            <input
              className="input"
              value={newFrontLabel}
              onChange={e => onFrontLabel(e.target.value)}
            />
          </div>
          <div className="field">
            <span>Holes 10-18 Format</span>
            <input
              className="input"
              value={newBackLabel}
              onChange={e => onBackLabel(e.target.value)}
            />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13 }}>Use Gateway Park - Trinity pars &amp; distances (Par 56)</span>
          <Toggle on={newUseTrinity} onChange={onUseTrinity} label="Use Gateway Park Trinity layout" />
        </div>

        <div className="field">
          <span>Schedule / Notes (optional)</span>
          <input
            className="input"
            value={newNotes}
            onChange={e => onNotes(e.target.value)}
            placeholder="9am signup, 9:45 draw..."
          />
        </div>

        {newError && <small className="field-error">{newError}</small>}

        <button type="button" className="btn btn-primary btn-block" onClick={onCreate}>
          Create Special Event
        </button>
      </div>
    </Dialog>
  )
}

function SpecialSubNav({
  viewMode,
  liveCount,
  completedCount,
  showBackToHistory,
  liveEvents,
  activeLiveEventId,
  onChangeMode,
  onBackToHistory,
  onSelectLiveEvent,
}: {
  viewMode: 'current' | 'history'
  liveCount: number
  completedCount: number
  showBackToHistory: boolean
  liveEvents: readonly { id: string; name: string; eventDate: string }[]
  activeLiveEventId: string | null
  onChangeMode: (mode: 'current' | 'history') => void
  onBackToHistory: () => void
  onSelectLiveEvent: (id: string) => void
}) {
  return (
    <div className="special-subnav">
      <Seg
        value={viewMode}
        onChange={onChangeMode}
        options={[
          {
            value: 'current',
            label: liveCount > 0 ? 'Live Event' : 'Current',
            count: liveCount > 1 ? liveCount : undefined,
          },
          {
            value: 'history',
            label: 'History',
            count: completedCount,
          },
        ]}
      />
      {showBackToHistory && (
        <button type="button" className="btn btn-sm" onClick={onBackToHistory}>
          <ChevronLeft size={15} /> All Past Events ({completedCount})
        </button>
      )}
      {!showBackToHistory && viewMode === 'current' && liveEvents.length > 1 && activeLiveEventId && (
        <select
          className="select"
          style={{ width: 'auto', minWidth: 180 }}
          aria-label="Select active special event"
          value={activeLiveEventId}
          onChange={e => onSelectLiveEvent(e.target.value)}
        >
          {liveEvents.map(ev => (
            <option key={ev.id} value={ev.id}>
              {ev.name} ({ev.eventDate})
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

function SpecialEventHistoryCard({
  snapshot,
  onOpenStandings,
}: {
  snapshot: SpecialEventSnapshot
  onOpenStandings: () => void
}) {
  const top = snapshot.winners[0] ?? null
  const runnersUp = snapshot.podium.slice(snapshot.winners.length)
  const aceText =
    snapshot.aceOutcome.mode === 'ace' && snapshot.aceOutcome.winners.length > 0
      ? `Ace: ${snapshot.aceOutcome.winners.map(w => `${w.name} (${money(w.amount)})`).join(', ')}`
      : snapshot.aceOutcome.mode === 'ctp' && snapshot.aceOutcome.winners.length > 0
        ? `CTP: ${snapshot.aceOutcome.winners[0].name} (${money(snapshot.aceOutcome.winners[0].amount)})`
        : `${money(snapshot.acePot)} pot`

  return (
    <div className="panel panel-pad history-card">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div className="eyebrow row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span>{fmtDate(snapshot.eventDate)}</span>
              {snapshot.location && (
                <>
                  <span>·</span>
                  <span className="row" style={{ gap: 4 }}>
                    <MapPin size={11} /> {snapshot.location}
                  </span>
                </>
              )}
              <span>· Par {snapshot.totalPar}</span>
            </div>
            <h2 className="display" style={{ fontSize: 24, marginTop: 4 }}>{snapshot.name}</h2>
          </div>
          <span className="chip chip-teal">Official</span>
        </div>

        <div className="history-podium">
          {top ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span className="row" style={{ gap: 6 }}>
                  <Trophy size={15} color="var(--orange)" />
                  <span className="strong">
                    {top.tied ? 'T1st: ' : '1st: '}
                    {snapshot.winners.map(w => w.teamName).join(' / ')}
                  </span>
                </span>
                <span className={`num strong ${toParClass(top.toPar)}`}>
                  {formatToPar(top.toPar)}
                  {top.strokes != null ? ` (${top.strokes})` : ''}
                  {top.payout > 0 ? ` · ${money(top.payout)}` : ''}
                </span>
              </div>
              {runnersUp.length > 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {runnersUp
                    .map(
                      r =>
                        `${r.tied ? `T${r.place}` : ordinal(r.place)} ${r.teamName} (${formatToPar(r.toPar)}${r.payout > 0 ? `, ${money(r.payout)}` : ''})`,
                    )
                    .join(' · ')}
                </div>
              )}
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>No completed team scores recorded.</div>
          )}
        </div>

        <div className="history-metrics">
          <div>
            <div className="faint">Field</div>
            <div className="strong">{snapshot.participantCount} players · {snapshot.teamCount} teams</div>
          </div>
          <div>
            <div className="faint">Team Purse</div>
            <div className="strong num" style={{ color: 'var(--orange)' }}>{money(snapshot.payoutPurse)}</div>
          </div>
          <div>
            <div className="faint">Ace / CTP</div>
            <div className="strong">{aceText}</div>
          </div>
          <div>
            <div className="faint">{snapshot.courseFundLabel}</div>
            <div className="strong num">{money(snapshot.courseFund)}</div>
          </div>
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-block" onClick={onOpenStandings}>
        View Full Standings <ChevronRight size={16} />
      </button>
    </div>
  )
}

function TeamHoleScorecard({
  holes,
  courseHoles,
  summary,
}: {
  holes: readonly (number | null)[]
  courseHoles: readonly CourseHole[]
  summary: TeamScoreSummary
}) {
  const { frontPar, backPar, totalPar } = courseParTotals(courseHoles)
  const frontIndices = Array.from({ length: 9 }, (_, i) => i)
  const backIndices = Array.from({ length: 9 }, (_, i) => i + 9)

  const renderStrokeCell = (idx: number, withLeftBorder = false) => {
    const val = clampHoleStroke(holes[idx])
    const par = courseHoles[idx]?.par ?? 3
    const cls =
      val == null ? 'faint' : val < par ? 'sp-under strong' : val > par ? 'sp-over strong' : ''
    return (
      <td key={idx} className={`num ${withLeftBorder ? 'bl ' : ''}${cls}`}>
        {val ?? '--'}
      </td>
    )
  }

  return (
    <div className="table-wrap" style={{ borderRadius: 'var(--r)' }}>
      <table className="table mini-scorecard">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Hole</th>
            {frontIndices.map(i => <th key={i}>{i + 1}</th>)}
            <th className="bl">F9</th>
            {backIndices.map((i, pos) => <th key={i} className={pos === 0 ? 'bl' : undefined}>{i + 1}</th>)}
            <th className="bl">B9</th>
            <th>Tot</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="muted" style={{ textAlign: 'left' }}>Par</td>
            {frontIndices.map(i => <td key={i} className="muted num">{courseHoles[i]?.par ?? 3}</td>)}
            <td className="bl muted num strong">{frontPar}</td>
            {backIndices.map((i, pos) => (
              <td key={i} className={`muted num${pos === 0 ? ' bl' : ''}`}>{courseHoles[i]?.par ?? 3}</td>
            ))}
            <td className="bl muted num strong">{backPar}</td>
            <td className="muted num strong">{totalPar}</td>
          </tr>
          <tr>
            <td className="strong" style={{ textAlign: 'left' }}>Score</td>
            {frontIndices.map(i => renderStrokeCell(i))}
            <td className="bl strong num">{summary.frontStrokes ?? '--'}</td>
            {backIndices.map((i, pos) => renderStrokeCell(i, pos === 0))}
            <td className="bl strong num">{summary.backStrokes ?? '--'}</td>
            <td className="strong num">{summary.officialTotal18 ?? summary.strokes ?? '--'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
