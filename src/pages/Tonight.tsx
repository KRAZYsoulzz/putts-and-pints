import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { effectiveIsAdmin, isProjectorMode, useAutoScroll } from '../lib/projector'
import {
  Check,
  ChevronRight,
  LayoutGrid,
  List,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trophy,
  Tv,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useData, must } from '../lib/store'
import { supabase } from '../lib/supabase'
import { askConfirm, messageOf, reportError, reportInfo } from '../lib/notify'
import {
  AWARD_LABEL,
  AWARD_SHORT,
  AWARDS,
  type Award,
  type Division,
  type Entry,
  type EventStatus,
  type Fund,
  type Player,
  type PPEvent,
} from '../lib/types'
import { applyScoreDirty, byEntryOrder, canAdvanceToStatus, canConfirmCut, cents, computeNineCommit, cutConfirmationReady, displayedBack, displayedFront, effectiveCut, eighteenGridRows, final9EntryOrder, isOpeningTagNight, isSeason9Week1, liveNightTotal, MAX_FINAL, MAX_NINE, mergeNinePatch, qualifiers, suggestedCut, tonightBoard, totals, week1AllowsScorePatch, type Ranked } from '../lib/scoring'
import { completeRefresh, requestRefresh, type ScoreBoard } from '../lib/score-refresh'
import { balances, clampPaidPlaces, displayedPerfectRound, displayedSharedPot, divisionResult, eventLedgerPosted, effectiveBar, eventMoney, nightBonusCost, otherDivisionNights, paidPlaceCount, payoutPool, payoutsForPlaceCount, placeBudget, placeRemainder, postedBonusCost, postedPlaceRemainder, postedRemainderBackup, suggestedPaidPlaces } from '../lib/money'
import { duplicateName, friendlyError, normalizeName, parseTag, payoutIssue, payoutRejectMessage, tagTakenTonight } from '../lib/validation'
import { buyingTagAfter, checkinTagIn, freshBuyingTag, newPlayerInsert } from '../lib/newPlayer'
import {
  canEditDivisionPayouts,
  createCorrectionDraft,
  createEmptyDivisionCloseState,
  executeCorrectionFlow,
  executeDivisionCloseFlow,
  hydrateDivisionCloseState,
  isLatestPostedNight,
  isWeek1Event,
  openPoolDeficit,
  type CorrectionDraft,
  type DivisionCloseState,
} from '../lib/closeout'
import DivisionCloseoutPanel from '../components/DivisionCloseoutPanel'
import CorrectionDraftPanel from '../components/CorrectionDraftPanel'
import { Dialog, DivisionSeg, Menu, MoneyInput, PageHead, ScoreInput, Stat, Toggle, money, ordinal } from '../components/ui'
import {
  assignPlayerToSmallestCard,
  clearEventCards,
  generateEventCards,
  loadCheckinViewMode,
  loadEventCards,
  loadScoreViewMode,
  movePlayerBetweenCards,
  removePlayerFromCards,
  saveCheckinViewMode,
  saveEventCards,
  saveScoreViewMode,
  shuffleDivisionCards,
  type CardSortMode,
  type PPEvtCards,
} from '../lib/cards'

const STEPS: { status: EventStatus; label: string }[] = [
  { status: 'checkin', label: '1. Check-in' },
  { status: 'scoring', label: '2. 18 Holes' },
  { status: 'final9', label: '3. Final 9' },
  { status: 'results', label: '4. Results & Payouts' },
]

const DIVS: Division[] = ['M', 'W']

function LeaderboardDivisionColumn({
  d,
  dEntries,
  board,
  entryMap,
  playerById,
  isProjector,
}: {
  d: Division
  dEntries: Entry[]
  board: ReturnType<typeof tonightBoard>
  entryMap: Map<string, Entry>
  playerById: Map<string, Player>
  isProjector: boolean
}) {
  const scrollRef = useAutoScroll<HTMLDivElement>(isProjector, dEntries)

  const renderRow = (row: typeof board.completed[number]) => {
    const ent = entryMap.get(row.id)
    const p = ent ? playerById.get(ent.player_id) : null
    const playerName = p?.name ?? 'Unknown Player'
    return (
      <tr key={row.id} className={row.place === 1 ? 'leader' : ''}>
        <td className="place col-plc">{row.place != null && row.place > 0 ? ordinal(row.place) : '—'}</td>
        <td className="strong col-player" title={playerName}>
          <span className="player-name">{playerName}</span>
          {ent?.awards && ent.awards.length > 0 && (
            <span className="chips">
              {ent.awards.map(a => <span key={a} className="chip chip-teal">{AWARD_SHORT[a]}</span>)}
            </span>
          )}
        </td>
        <td className="c col-score">{row.front != null ? row.front : '—'}</td>
        <td className="c col-score">{row.back != null ? row.back : '—'}</td>
        <td className="c bl strong col-score">{row.t18 != null ? row.t18 : '—'}</td>
        <td className="c bl col-score">{row.finalNine != null ? row.finalNine : '—'}</td>
        <td className="c bl big col-score">{row.night != null ? row.night : '—'}</td>
      </tr>
    )
  }

  const allEmpty = board.completed.length === 0 && board.partial.length === 0 && board.unscored.length === 0

  return (
    <div className="stack leaderboard-division">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="display" style={{ fontSize: 18 }}>
          {d === 'M' ? "Men's Division" : "Women's Division"}
        </h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {dEntries.length} {dEntries.length === 1 ? 'player' : 'players'}
        </span>
      </div>
      <div className="panel">
        <div className="table-wrap" ref={scrollRef}>
          <table className="table leaderboard-table">
            <thead>
              <tr>
                <th className="col-plc">Plc</th>
                <th className="col-player">Player</th>
                <th className="c col-score">Front 9</th>
                <th className="c col-score">Back 9</th>
                <th className="c bl col-score">18 Total</th>
                <th className="c bl col-score">Final 9</th>
                <th className="c bl col-score">Night Total</th>
              </tr>
            </thead>
            <tbody>
              {allEmpty ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '24px 0' }} className="muted">
                    No players checked into this division yet.
                  </td>
                </tr>
              ) : (
                <>
                  {board.completed.map(row => (
                    <Fragment key={row.id}>
                      {renderRow(row)}
                      {row.id === board.cutAfterId && (
                        <tr className="cut-line">
                          <td
                            colSpan={7}
                            style={{
                              textAlign: 'center',
                              background: 'var(--surface-2)',
                              padding: '2px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'var(--orange)',
                              letterSpacing: '0.04em',
                            }}
                          >
                            Cut line ({board.provisional ? 'provisional' : 'confirmed'})
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {board.partial.map(row => renderRow(row))}
                  {board.unscored.map(row => renderRow(row))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

interface TonightProps {
  projectorMode?: boolean
}

export default function Tonight({ projectorMode }: TonightProps = {}) {
  const data = useData()
  const {
    isAdmin: authIsAdmin, season, settings, liveEvent, events, viewEventId, openEvent, loading,
    entries, players, playerById, tags, ledger, records, reload, patchEntry, patchEvent,
  } = data

  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const isProjector = isProjectorMode(projectorMode, searchParams.toString())
  const isAdmin = effectiveIsAdmin(authIsAdmin, isProjector)

  useEffect(() => {
    if (!isProjector) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        nav('/')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isProjector, nav])

  const event = (viewEventId ? events.find(e => e.id === viewEventId) : null) ?? liveEvent

  const [division, setDivision] = useState<Division>('M')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null)
  const [upDate, setUpDate] = useState('')
  const [upName, setUpName] = useState('')
  const [upEditId, setUpEditId] = useState<string | null>(null)
  const [addPlayerOpen, setAddPlayerOpen] = useState(false)
  const [searchName, setSearchName] = useState('')
  const [buyingTag, setBuyingTag] = useState(freshBuyingTag)
  const [createError, setCreateError] = useState('')
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [barError, setBarError] = useState('')
  const [payoutNote, setPayoutNote] = useState<{ scope: string; text: string } | null>(null)
  const [cutOverride, setCutOverride] = useState<{ key: string; value: number } | null>(null)
  const [scoreSaveCount, setScoreSaveCount] = useState(0)
  const [scoreDirtyCount, setScoreDirtyCount] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null)
  const [closeStates, setCloseStates] = useState<Record<string, DivisionCloseState>>({})
  const [closePreviews, setClosePreviews] = useState<Record<string, string>>({})
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, CorrectionDraft | null>>({})
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const [reopenedDivisions, setReopenedDivisions] = useState<Record<string, boolean>>({})

  const [eventCards, setEventCards] = useState<PPEvtCards | null>(() => {
    if (!event) return null
    return loadEventCards(event.id)
  })
  const [makeCardsOpen, setMakeCardsOpen] = useState(false)
  const [cardSizeInput, setCardSizeInput] = useState(4)
  const [cardSortInput, setCardSortInput] = useState<CardSortMode>('checkin')
  const [scoreViewMode, setScoreViewMode] = useState<'list' | 'card'>(loadScoreViewMode)
  const [checkinViewMode, setCheckinViewMode] = useState<'list' | 'card'>(loadCheckinViewMode)

  useEffect(() => {
    if (!event) {
      setEventCards(null)
      return
    }
    const loaded = loadEventCards(event.id)
    setEventCards(loaded)
    if (loaded?.targetCardSize) setCardSizeInput(loaded.targetCardSize)
    if (loaded?.sortMode) setCardSortInput(loaded.sortMode)
  }, [event?.id])

  const checkingIn = useRef(new Set<string>())
  const dirtyScores = useRef(new Set<string>())
  const scoreSaves = useRef(0)
  const refreshLock = useRef(false)
  const prefilled = useRef(new Set<string>())
  const defaultedCut = useRef(new Set<string>())
  const cutRef = useRef<Partial<Record<Division, number>>>({})
  const paidCountRef = useRef<{ key: string; n: number }>({ key: '', n: 0 })
  const queue = useRef(Promise.resolve())
  const entriesRef = useRef(entries)
  const settingsRef = useRef(settings)
  const payoutNoteTimer = useRef<number | undefined>(undefined)
  useEffect(() => { entriesRef.current = entries }, [entries])
  useEffect(() => () => window.clearTimeout(payoutNoteTimer.current), [])
  useEffect(() => { settingsRef.current = settings }, [settings])

  const scoreBoard = (): ScoreBoard => ({
    server: {},
    local: {},
    draft: dirtyScores.current.size > 0 ? { id: 'open', raw: 'pending' } : null,
    savesInFlight: scoreSaves.current,
    refreshing: refreshLock.current,
    status: refreshStatus,
  })

  const markScoreDirty = (id: string, field: 'front' | 'back' | 'final', dirty: boolean) => {
    dirtyScores.current = applyScoreDirty(dirtyScores.current, id, field, dirty)
    setScoreDirtyCount(dirtyScores.current.size)
  }

  const saveScore = (id: string, patch: Partial<Entry>) => {
    if (isSeason9Week1(event) && !week1AllowsScorePatch(event, patch)) {
      return Promise.resolve(false)
    }
    const latest = entriesRef.current.find(e => e.id === id)
    let nextPatch = patch
    if (
      latest &&
      (Object.prototype.hasOwnProperty.call(patch, 'score_front') ||
        Object.prototype.hasOwnProperty.call(patch, 'score_back') ||
        Object.prototype.hasOwnProperty.call(patch, 'score_18'))
    ) {
      const merged = mergeNinePatch(latest, patch)
      nextPatch = { ...patch, score_18: merged.score_18 }
      entriesRef.current = entriesRef.current.map(e => (e.id === id ? merged : e))
    }
    scoreSaves.current += 1
    setScoreSaveCount(scoreSaves.current)
    return patchEntry(id, nextPatch).finally(() => {
      scoreSaves.current = Math.max(0, scoreSaves.current - 1)
      setScoreSaveCount(scoreSaves.current)
    })
  }

  const refreshScores = async () => {
    const decision = requestRefresh(scoreBoard())
    setRefreshStatus(decision.board.status)
    if (!decision.fetch) return
    refreshLock.current = true
    setIsRefreshing(true)
    try {
      const result = await reload()
      const finished = completeRefresh(
        {
          ...scoreBoard(),
          refreshing: true,
          savesInFlight: result === 'busy' ? Math.max(scoreSaves.current, 1) : scoreSaves.current,
        },
        result === 'applied' ? {} : { error: result === 'busy' ? 'Saving score…' : "Couldn't refresh scores." },
      )
      setRefreshStatus(finished.status)
    } catch (err) {
      console.error(err)
      setRefreshStatus("Couldn't refresh scores.")
    } finally {
      refreshLock.current = false
      setIsRefreshing(false)
    }
  }

  const divEntries = useMemo(
    () => entries.filter(e => e.event_id === event?.id && e.division === division),
    [entries, event?.id, division],
  )
  const orderedEntries = useMemo(() => [...divEntries].sort(byEntryOrder), [divEntries])
  const final9Entries = useMemo(
    () => final9EntryOrder(divEntries, settings),
    [divEntries, settings],
  )

  const counts = useMemo(() => {
    const active = entries.filter(e => e.event_id === event?.id)
    return {
      M: active.filter(e => e.division === 'M').length,
      W: active.filter(e => e.division === 'W').length,
    }
  }, [entries, event?.id])

  const moneyCalc = useMemo(() => eventMoney(counts, settings), [counts, settings])
  // Bar match follows the check-ins unless a director typed an amount.
  const barOf = (ev: PPEvent, d: Division) => {
    const mine = entries.filter(e => e.event_id === ev.id)
    return effectiveBar(ev, d, { M: mine.filter(e => e.division === 'M').length, W: mine.filter(e => e.division === 'W').length }, settings)
  }
  const barAmount = event ? barOf(event, division) : 0
  // First event of the season sets the high-score record and does not pay it.
  const openingNight = Boolean(event && isOpeningTagNight(events, event.id))
  const liveBonusCost = useMemo(() => {
    if (!event) return 0
    return nightBonusCost(divEntries, settings, {
      payHighScore: !openingNight,
      division,
      cohort: otherDivisionNights(division, event.id, entries, ledger),
    })
  }, [divEntries, settings, openingNight, division, event, entries, ledger])
  // A finished night keeps the bonus that was posted. Reopening previews the shared pot.
  const bonusCost = event?.status === 'complete'
    ? postedBonusCost(ledger, event.id, division)
    : liveBonusCost
  const pool = useMemo(
    () => payoutPool(counts[division], barAmount, settings, bonusCost),
    [counts, division, barAmount, settings, bonusCost],
  )
  const curBalances = useMemo(() => balances(ledger, division), [ledger, division])
  // Pots as they stood before this night, so a reopened night is not counted against itself.
  const priorBalances = useMemo(
    () => balances(ledger.filter(r => r.event_id !== event?.id), division),
    [ledger, division, event?.id],
  )
  const payoutsList = useMemo(
    () => (division === 'M' ? event?.payouts_men : event?.payouts_women) ?? [],
    [division, event?.payouts_men, event?.payouts_women],
  )

  const inTags = (playerId: string) => playerById.get(playerId)?.in_tags === true
  const result = useMemo(() => divisionResult({
    division,
    entries: divEntries,
    payoutPlaces: payoutsList,
    settings,
    balances: priorBalances,
    barMatch: barAmount,
    priorRecord: records[division],
    openingNight,
    cohort: event ? otherDivisionNights(division, event.id, entries, ledger) : [],
    tagPlan: event && isOpeningTagNight(events, event.id) ? 'opening' : 'redistribute',
    inTags: (playerId) => playerById.get(playerId)?.in_tags === true,
  }), [division, divEntries, payoutsList, settings, priorBalances, barAmount, records, event, events, entries, ledger, playerById, openingNight])

  const rankedById = useMemo(() => new Map(result.ranked.map(r => [r.entry.id, r])), [result])

  const divCards = useMemo(() => {
    return eventCards?.cards[division] ?? []
  }, [eventCards, division])

  const divCardPlayerIds = useMemo(() => {
    return new Set(divCards.flatMap(c => c.playerIds))
  }, [divCards])

  const placeKey = `${event?.id ?? ''}|${division}`

  // Suggest payouts the first time a night reaches results, instead of leaving every place at $0.
  useEffect(() => {
    if (!event || event.status !== 'results' || !isAdmin || isSeason9Week1(event) || isWeek1Event(event)) return
    if (prefilled.current.has(event.id)) return
    if ((event.payouts_men?.length ?? 0) > 0 && (event.payouts_women?.length ?? 0) > 0) {
      prefilled.current.add(event.id)
      return
    }
    prefilled.current.add(event.id)
    const patch: Partial<PPEvent> = {}
    for (const d of DIVS) {
      const list = d === 'M' ? event.payouts_men : event.payouts_women
      if (list && list.length > 0) continue
      const group = entries.filter(e => e.event_id === event.id && e.division === d)
      const net = payoutPool(group.length, barOf(event, d), settings, nightBonusCost(group, settings, {
        payHighScore: !isOpeningTagNight(events, event.id),
        division: d,
        cohort: otherDivisionNights(d, event.id, entries, ledger),
      }))
      const next = payoutsForPlaceCount(net, suggestedPaidPlaces(group.length, settings))
      if (d === 'M') patch.payouts_men = next
      else patch.payouts_women = next
    }
    if (patch.payouts_men || patch.payouts_women) void patchEvent(event.id, patch)
  }, [event, entries, events, ledger, isAdmin, settings, patchEvent])

  // A women's cut saved as 0 (empty field at the time, or half of one player
  // rounded down) stays 0 after players arrive, so nobody makes the final.
  // Fill a sensible half-field cut once and mark those qualifiers.
  useEffect(() => {
    if (!event || event.status !== 'final9' || !isAdmin || isSeason9Week1(event) || isWeek1Event(event)) return
    for (const d of DIVS) {
      const field = entries.filter(e => e.event_id === event.id && e.division === d)
      if (!field.length) continue
      const stored = d === 'M' ? event.final_cut_men : event.final_cut_women
      if (stored != null && stored >= 1) continue
      const key = `${event.id}|${d}|${field.length}`
      if (defaultedCut.current.has(key)) continue
      defaultedCut.current.add(key)
      const cut = suggestedCut(field.length, settings)
      void patchEvent(event.id, d === 'M' ? { final_cut_men: cut } : { final_cut_women: cut })
      const ids = qualifiers(field, cut, settings)
      for (const ent of field) {
        if (ent.made_final !== ids.has(ent.id)) void patchEntry(ent.id, { made_final: ids.has(ent.id) })
      }
    }
  }, [event, entries, isAdmin, settings, patchEvent, patchEntry])

  if (!event) {
    return (
      <div className={isProjector ? 'projector-page' : ''}>
        <PageHead title="Tonight's Tournament" eyebrow="Putts & Pints">
          {isAdmin && (
            <button className="btn btn-primary" disabled={loading} onClick={() => {
              if (loading) return
              if (!season) {
                reportError('Create or activate a season first, on the Season page.')
                return
              }
              setEventName('')
              setEventDate(new Date().toISOString().slice(0, 10))
              setStartOpen(true)
            }}>
              <Plus size={16} /> {loading ? 'Loading season…' : 'Start New Event'}
            </button>
          )}
          {isProjector && (
            <button className="btn btn-ghost btn-sm projector-exit-btn" onClick={() => nav('/')} title="Exit projector view (Esc)">
              <X size={14} /> Exit (Esc)
            </button>
          )}
        </PageHead>
        <div className="empty panel panel-pad">
          <Trophy size={48} color="var(--orange)" />
          <div className="display" style={{ fontSize: 28, marginTop: 12 }}>No Tournament In Progress</div>
          <p className="muted">
            {isAdmin
              ? 'Start a new event to check players in, set the bar match, and record scores.'
              : 'Standings and pot balances are in the sidebar. Check back once tonight starts.'}
          </p>
          {(isAdmin || events.some(e => e.status === 'scheduled')) && (
            <div style={{ marginTop: 16, textAlign: 'left' }}>
              <div className="display" style={{ fontSize: 20 }}>Upcoming events</div>
              {isAdmin && (
                <form style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }} onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    if (!season) throw new Error('Create or activate a season first, on the Season page.')
                    if (!upDate) throw new Error('Pick a date.')
                    const name = normalizeName(upName) || null
                    if (upEditId) {
                      const target = events.find(ev => ev.id === upEditId)
                      if (isSeason9Week1(target)) {
                        reportError('Week 1 scores stay as played.')
                        return
                      }
                      await must(supabase.from('pp_events').update({ event_date: upDate, name }).eq('id', upEditId).eq('status', 'scheduled').select().single())
                    } else {
                      await must(supabase.from('pp_events').insert({ season_id: season.id, status: 'scheduled', event_date: upDate, name }).select().single())
                    }
                    setUpDate(''); setUpName(''); setUpEditId(null)
                    reload()
                  } catch (err) { reportError(messageOf(err)) }
                }}>
                  <input className="input" type="date" value={upDate} onChange={e => setUpDate(e.target.value)} />
                  <input className="input" placeholder="Event name" value={upName} onChange={e => setUpName(e.target.value)} />
                  <button className="btn btn-primary" type="submit">{upEditId ? 'Save' : 'Add upcoming event'}</button>
                  {upEditId && <button className="btn" type="button" onClick={() => { setUpEditId(null); setUpDate(''); setUpName('') }}>Cancel</button>}
                </form>
              )}
              {events.filter(e => e.status === 'scheduled').map(ev => {
                const isW1 = isSeason9Week1(ev)
                return (
                  <div key={ev.id} style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
                    <span>{ev.event_date}</span>
                    <span style={{ flex: 1 }}>{ev.name ?? ''}</span>
                    {isAdmin && (
                      <button className="btn" disabled={isW1} onClick={async () => {
                        if (isW1) return
                        try {
                          openEvent(null)
                          await must(supabase.from('pp_events').update({
                            status: 'checkin',
                            settings_snapshot: settings,
                            bar_match_men: 0,
                            bar_match_women: 0,
                            bar_match_men_manual: false,
                            bar_match_women_manual: false,
                          }).eq('id', ev.id).select().single())
                          reload()
                        } catch (err) { reportError(messageOf(err)) }
                      }}>Start</button>
                    )}
                    {isAdmin && (
                      <button className="btn" disabled={isW1} onClick={() => {
                        if (isW1) return
                        setUpEditId(ev.id); setUpDate(ev.event_date); setUpName(ev.name ?? '')
                      }}>Edit</button>
                    )}
                    {isAdmin && (
                      <button className="btn" disabled={isW1} onClick={async () => {
                        if (isW1) return
                        if (!(await askConfirm(`Delete ${ev.name ?? 'event'} on ${ev.event_date}?`, { danger: true, confirmLabel: 'Delete' }))) return
                        if (isW1) return
                        try {
                          await must(supabase.from('pp_events').delete().eq('id', ev.id).eq('status', 'scheduled').select())
                          reload()
                        } catch (err) { reportError(messageOf(err)) }
                      }}>Delete</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {startOpen && (
          <StartEventDialog
            name={eventName}
            date={eventDate}
            onName={setEventName}
            onDate={setEventDate}
            onClose={() => setStartOpen(false)}
            onCreate={async () => {
              if (!season) throw new Error('Create or activate a season first, on the Season page.')
              openEvent(null)
              const name = normalizeName(eventName)
              const row: Record<string, unknown> = {
                season_id: season.id,
                status: 'checkin',
                settings_snapshot: settings,
                bar_match_men: 0,
                bar_match_women: 0,
                bar_match_men_manual: false,
                bar_match_women_manual: false,
                event_date: eventDate,
              }
              if (name) row.name = name
              await must(supabase.from('pp_events').insert(row).select().single())
              setStartOpen(false)
              reload()
            }}
          />
        )}
      </div>
    )
  }

  const nightEntries = entries.filter(e => e.event_id === event.id)
  const suggestedPlaces = suggestedPaidPlaces(counts[division], settings)
  const paidPlaces = paidPlaceCount(counts[division], payoutsList.length, settings)
  const allocated = cents(payoutsList.reduce((a, b) => a + Number(b), 0))
  const toPerfectRound = event.status === 'complete'
    ? postedPlaceRemainder(ledger, event.id, division)
    : result.placeRemainderToPot
  const toBackup = event.status === 'complete'
    ? postedRemainderBackup(ledger, event.id, division)
    : result.placeRemainderToBackup
  const purseLeft = cents(pool - allocated - toPerfectRound - toBackup)
  const payoutProblem = payoutIssue(payoutsList, placeBudget(pool))
  const overPool = payoutProblem != null

  const isWeek1Locked = isSeason9Week1(event) || isWeek1Event(event)

  const handleContextMenu = (e: MouseEvent, entry: Entry) => {
    if (!isAdmin || event.status === 'complete' || isWeek1Locked) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const toggleAward = async (award: Award) => {
    if (!contextMenu || isWeek1Locked) return
    const cur = contextMenu.entry.awards || []
    const next = cur.includes(award) ? cur.filter(a => a !== award) : [...cur, award]
    await patchEntry(contextMenu.entry.id, { awards: next })
    setContextMenu(null)
  }

  const handleCheckinPlayer = async (pId: string, pDiv: Division, known?: { in_tags?: boolean }) => {
    if (isWeek1Locked) return false
    if (checkingIn.current.has(pId)) return false
    if (entries.some(e => e.event_id === event.id && e.player_id === pId)) return false
    checkingIn.current.add(pId)
    try {
      const player = players.find(p => p.id === pId)
      const held = tags.find(t => t.player_id === pId)?.tag_number ?? null
      const inTags = (known?.in_tags ?? player?.in_tags) === true
      const { error } = await supabase.from('pp_entries').upsert({
        event_id: event.id,
        player_id: pId,
        division: pDiv,
        paid: true,
        tag_in: checkinTagIn(inTags, held),
        awards: [],
      }, { onConflict: 'event_id,player_id', ignoreDuplicates: true })
      if (error) {
        console.error(error.message)
        const message = friendlyError(error.message)
        reportError(message)
        setCreateError(message)
        return false
      }
      setAddPlayerOpen(false)
      setSearchName('')
      setCreateError('')
      setBuyingTag(current => buyingTagAfter(current, 'success'))
      if (eventCards) {
        const curCards = eventCards.cards[pDiv] ?? []
        if (curCards.length > 0) {
          const updatedCards = assignPlayerToSmallestCard(curCards, pId)
          const updated: PPEvtCards = {
            ...eventCards,
            cards: {
              ...eventCards.cards,
              [pDiv]: updatedCards,
            },
            updatedAt: new Date().toISOString(),
          }
          setEventCards(updated)
          saveEventCards(event.id, updated, event)
        }
      }
      await reload()
      return true
    } finally {
      checkingIn.current.delete(pId)
    }
  }

  const handleCreateAndCheckin = async (name: string, pDiv: Division) => {
    if (isWeek1Locked) return
    const clean = normalizeName(name)
    if (!clean) { setCreateError('Enter a player name.'); return }
    if (duplicateName(clean, players)) { setCreateError(`“${clean}” is already on the roster.`); return }
    setCreateError('')
    try {
      const created = await must(
        supabase.from('pp_players').insert(newPlayerInsert(clean, pDiv, buyingTag)).select().single(),
      )
      const checkedIn = await handleCheckinPlayer(created.id, pDiv, created)
      if (!checkedIn) setBuyingTag(current => buyingTagAfter(current, 'save-failure'))
    } catch (err) {
      setCreateError(messageOf(err))
      setBuyingTag(current => buyingTagAfter(current, 'save-failure'))
    }
  }

  const handleSetScoreViewMode = (mode: 'list' | 'card') => {
    setScoreViewMode(mode)
    saveScoreViewMode(mode)
  }

  const handleSetCheckinViewMode = (mode: 'list' | 'card') => {
    setCheckinViewMode(mode)
    saveCheckinViewMode(mode)
  }

  const handleGenerateCards = (size = cardSizeInput, sort = cardSortInput) => {
    if (!event || isWeek1Locked) return
    const nightEvEntries = entries.filter(e => e.event_id === event.id)
    const generated = generateEventCards({
      eventId: event.id,
      entries: nightEvEntries,
      cardSize: size,
      sortMode: sort,
      allEntries: entries,
      events,
    })
    setEventCards(generated)
    saveEventCards(event.id, generated, event)
    setMakeCardsOpen(false)
    setCheckinViewMode('card')
    reportInfo(`Cards generated for tonight (${size} players per card).`)
  }

  const handleShuffleDivision = () => {
    if (!event || !eventCards || isWeek1Locked) return
    const curCards = eventCards.cards[division] ?? []
    if (curCards.length === 0) return
    const nightEvEntries = entries.filter(e => e.event_id === event.id)
    const shuffledCards = shuffleDivisionCards({
      cards: curCards,
      division,
      targetCardSize: eventCards.targetCardSize,
      entries: nightEvEntries,
    })
    const updated: PPEvtCards = {
      ...eventCards,
      sortMode: 'random',
      cards: {
        ...eventCards.cards,
        [division]: shuffledCards,
      },
      updatedAt: new Date().toISOString(),
    }
    setEventCards(updated)
    saveEventCards(event.id, updated, event)
    reportInfo(`${division === 'M' ? "Men's" : "Women's"} cards reshuffled.`)
  }

  const handleMovePlayer = (playerId: string, targetCardId: string) => {
    if (!event || !eventCards || isWeek1Locked) return
    const curCards = eventCards.cards[division] ?? []
    const updatedDivCards = movePlayerBetweenCards({
      cards: curCards,
      division,
      playerId,
      targetCardId,
    })
    const updated: PPEvtCards = {
      ...eventCards,
      cards: {
        ...eventCards.cards,
        [division]: updatedDivCards,
      },
      updatedAt: new Date().toISOString(),
    }
    setEventCards(updated)
    saveEventCards(event.id, updated, event)
  }

  const handleClearCards = () => {
    if (!event || isWeek1Locked) return
    clearEventCards(event.id, event)
    setEventCards(null)
    setMakeCardsOpen(false)
    reportInfo('Cards cleared for tonight.')
  }

  const setStatus = async (status: EventStatus) => {
    if (isWeek1Locked) return
    const evEntries = entriesRef.current.filter(e => e.event_id === event.id)
    const pending = { dirty: dirtyScores.current.size, saves: scoreSaves.current, refreshing: refreshLock.current }
    if (!canAdvanceToStatus(event.status, status, evEntries, pending, event)) return
    if (status === 'final9' || status === 'results') {
      if (event.status === 'checkin' || event.status === 'scoring') {
        const patch: Partial<PPEvent> = { status }
        for (const d of DIVS) {
          const field = evEntries.filter(e => e.division === d)
          const stored = d === 'M' ? event.final_cut_men : event.final_cut_women
          const cut = effectiveCut(stored, field.length, settings)
          if (field.length > 0 && stored !== cut) {
            if (d === 'M') patch.final_cut_men = cut
            else patch.final_cut_women = cut
          }
          await applyCut(cut, field)
        }
        await patchEvent(event.id, patch)
        return
      }
    }
    await patchEvent(event.id, { status })
  }

  const applyCut = async (cut: number, field: Entry[]) => {
    if (isWeek1Locked) return
    const ids = qualifiers(field, cut, settingsRef.current)
    for (const ent of field) {
      const should = ids.has(ent.id)
      if (ent.made_final !== should) await patchEntry(ent.id, { made_final: should })
    }
  }

  const canProceedToCut = cutConfirmationReady(
    entries.filter(e => e.event_id === event.id),
    { dirty: scoreDirtyCount, saves: scoreSaveCount, refreshing: isRefreshing },
  )

  const applyCutAndProceed = async () => {
    if (isWeek1Locked) return
    const evEntries = entriesRef.current.filter(e => e.event_id === event.id)
    const pending = { dirty: dirtyScores.current.size, saves: scoreSaves.current, refreshing: refreshLock.current }
    if (!cutConfirmationReady(evEntries, pending)) return
    const patch: Partial<PPEvent> = { status: 'final9' }
    for (const d of DIVS) {
      const field = evEntries.filter(e => e.division === d)
      const stored = d === 'M' ? event.final_cut_men : event.final_cut_women
      const cut = effectiveCut(stored, field.length, settings)
      // Don't store 0 for an empty division. That 0 stuck after players checked in.
      if (field.length > 0 && stored !== cut) {
        if (d === 'M') patch.final_cut_men = cut
        else patch.final_cut_women = cut
      }
      await applyCut(cut, field)
    }
    await patchEvent(event.id, patch)
  }

  const cutKey = `${event.id}|${division}`
  const shownCut = cutOverride?.key === cutKey
    ? cutOverride.value
    : effectiveCut(
        division === 'M' ? event.final_cut_men : event.final_cut_women,
        counts[division],
        settings,
      )

  const stepCut = (delta: number) => {
    if (isWeek1Locked) return
    const size = Math.max(1, divEntries.length)
    const base = cutRef.current[division] ?? shownCut
    const next = Math.min(size, Math.max(1, base + delta))
    cutRef.current[division] = next
    setCutOverride({ key: cutKey, value: next })
    const div = division
    const eventId = event.id
    queue.current = queue.current.then(async () => {
      if (cutRef.current[div] !== next) return
      await patchEvent(eventId, div === 'M' ? { final_cut_men: next } : { final_cut_women: next })
      const field = entriesRef.current.filter(e => e.event_id === eventId && e.division === div)
      await applyCut(next, field)
    }).catch(() => { /* patchEvent already reported the failure */ })
  }

  const payoutScope = `${event.id}|${division}`
  const payoutNoteText = payoutNote?.scope === payoutScope ? payoutNote.text : ''

  const clearPayoutNote = () => {
    window.clearTimeout(payoutNoteTimer.current)
    setPayoutNote(null)
  }

  const showPayoutNote = (message: string) => {
    const scope = payoutScope
    setPayoutNote({ scope, text: message })
    window.clearTimeout(payoutNoteTimer.current)
    payoutNoteTimer.current = window.setTimeout(() => {
      setPayoutNote(prev => (prev?.scope === scope ? null : prev))
    }, 4500)
  }

  const closeState = hydrateDivisionCloseState({
    event,
    previous: closeStates[event.id] ?? createEmptyDivisionCloseState(),
  })
  const divLedgerPosted = ledger.some(r => r.event_id === event.id && r.division === division && r.kind === 'entry')
  const otherDiv: Division = division === 'M' ? 'W' : 'M'
  const divReopenKey = `${event.id}|${division}`
  const isDivisionReopened = Boolean(reopenedDivisions[divReopenKey])
  const isLegacyCompleted =
    event.status === 'complete' &&
    (event.pp_close_mode ?? 'legacy') === 'legacy' &&
    !event.pp_closed_men &&
    !event.pp_closed_women
  const isDivisionClosed = !isDivisionReopened && (
    (division === 'M' ? Boolean(event.pp_closed_men) : Boolean(event.pp_closed_women)) ||
    closeState.closed[division] ||
    isLegacyCompleted
  )
  const isOtherDivisionClosed = (
    (otherDiv === 'M' ? Boolean(event.pp_closed_men) : Boolean(event.pp_closed_women)) ||
    closeState.closed[otherDiv] ||
    isLegacyCompleted
  )
  const isSharedPosted =
    Boolean(event.pp_shared_pots_posted) ||
    closeState.sharedPosted ||
    (isDivisionClosed && isOtherDivisionClosed)
  const activeCorrectionDraft = correctionDrafts[divReopenKey] ?? null
  const latestPostedCheck = isLatestPostedNight({ event, events, ledger })
  const canEditPayouts = !isWeek1Locked && canEditDivisionPayouts({
    event,
    divisionClosed: isDivisionClosed,
    reopenViaCorrection: isDivisionReopened || (!isDivisionClosed && divLedgerPosted),
  })
  const entryPurseShare = cents(settings.entryFee - settings.perfectRoundShare)
  const hsLiability = !openingNight && divEntries.some(e => e.awards?.includes('high_score')) ? settings.bonus.highScore : 0
  const sharedReserveOrCharge = !isDivisionClosed && !isOtherDivisionClosed
    ? (divEntries.some(e => e.awards?.includes('perfect4')) ? settings.bonus.perfect4 : 0) +
      (divEntries.some(e => e.awards?.includes('perfect5')) ? settings.bonus.perfect5 : 0)
    : Math.max(0, cents(liveBonusCost - hsLiability))
  const divisionDeficit = openPoolDeficit({
    entryPurse: cents(counts[division] * entryPurseShare),
    bar: barAmount,
    highScoreLiability: hsLiability,
    sharedCharges: sharedReserveOrCharge,
  }).deficit

  const savePayout = (idx: number, val: number) => {
    if (!canEditPayouts) return
    const next = Array.from({ length: Math.max(payoutsList.length, idx + 1) }, (_, i) => Number(payoutsList[i] ?? 0))
    next[idx] = val
    while (next.length > 0 && next[next.length - 1] === 0) next.pop()
    const rejected = payoutRejectMessage(next, pool, placeRemainder(pool))
    if (rejected) {
      // The field snaps back to the saved amount. Say why, then let it fade.
      showPayoutNote(rejected)
      return
    }
    clearPayoutNote()
    paidCountRef.current = { key: placeKey, n: next.length }
    void patchEvent(event.id, division === 'M' ? { payouts_men: next } : { payouts_women: next })
  }

  const stepPaidPlaces = (delta: number) => {
    if (!canEditPayouts) return
    const field = counts[division]
    if (field <= 0) return
    const base = paidCountRef.current.key === placeKey ? paidCountRef.current.n : paidPlaces
    const nextN = clampPaidPlaces(field, base + delta)
    if (nextN === base && payoutsList.length === nextN) return
    paidCountRef.current = { key: placeKey, n: nextN }
    clearPayoutNote()
    const amounts = payoutsForPlaceCount(pool, nextN)
    const div = division
    const eventId = event.id
    const key = placeKey
    queue.current = queue.current.then(async () => {
      // A later click on this same division replaces this one. Switching divisions must still save.
      if (paidCountRef.current.key === key && paidCountRef.current.n !== nextN) return
      await patchEvent(eventId, div === 'M' ? { payouts_men: amounts } : { payouts_women: amounts })
    }).catch(() => { /* patchEvent already reported the failure */ })
  }

  const useSuggested = () => {
    if (!canEditPayouts) return
    // Re-split the current pool across the place count on screen.
    clearPayoutNote()
    const amounts = payoutsForPlaceCount(pool, paidPlaces)
    const key = placeKey
    const div = division
    const eventId = event.id
    paidCountRef.current = { key, n: amounts.length }
    queue.current = queue.current.then(async () => {
      if (paidCountRef.current.key === key && paidCountRef.current.n !== amounts.length) return
      await patchEvent(eventId, div === 'M' ? { payouts_men: amounts } : { payouts_women: amounts })
    }).catch(() => { /* patchEvent already reported the failure */ })
  }

  const divisionPayouts = (ev: PPEvent, d: Division) => {
    const stored = d === 'M' ? ev.payouts_men ?? [] : ev.payouts_women ?? []
    if (stored.length > 0) return stored.map(n => Number(n))
    const group = entries.filter(e => e.event_id === ev.id && e.division === d)
    const payHighScore = !isOpeningTagNight(events, ev.id)
    return payoutsForPlaceCount(
      payoutPool(group.length, barOf(ev, d), settings, nightBonusCost(group, settings, {
        payHighScore,
        division: d,
        cohort: otherDivisionNights(d, ev.id, entries, ledger),
      })),
      suggestedPaidPlaces(group.length, settings),
    )
  }

  const handleCloseDivision = async (targetDiv: Division = division) => {
    if (isWeek1Locked) {
      reportError('Week 1 is locked and cannot be modified.')
      return
    }
    const group = entries.filter(e => e.event_id === event.id && e.division === targetDiv)
    const list = divisionPayouts(event, targetDiv)
    const net = payoutPool(group.length, barOf(event, targetDiv), settings, nightBonusCost(group, settings, {
      payHighScore: !openingNight,
      division: targetDiv,
      cohort: otherDivisionNights(targetDiv, event.id, entries, ledger),
    }))
    if (payoutIssue(list, placeBudget(net))) {
      const name = targetDiv === 'M' ? "Men's" : "Women's"
      reportError(payoutIssue(list, placeBudget(net)) === 'increment'
        ? `${name} place checks have to be multiples of $5.`
        : `${name} place checks are over the $5 payout budget or include a negative.`)
      return
    }

    setIsFinalizing(true)
    try {
      const payoutsM = divisionPayouts(event, 'M')
      const payoutsW = divisionPayouts(event, 'W')
      const allRankedM = divisionResult({
        division: 'M',
        entries: entries.filter(e => e.event_id === event.id && e.division === 'M'),
        payoutPlaces: payoutsM,
        settings,
        balances: balances(ledger.filter(r => r.event_id !== event.id), 'M'),
        barMatch: barOf(event, 'M'),
        priorRecord: records.M,
        openingNight,
        cohort: otherDivisionNights('M', event.id, entries, ledger),
        tagPlan: isOpeningTagNight(events, event.id) ? 'opening' : 'redistribute',
        inTags,
      })
      const allRankedW = divisionResult({
        division: 'W',
        entries: entries.filter(e => e.event_id === event.id && e.division === 'W'),
        payoutPlaces: payoutsW,
        settings,
        balances: balances(ledger.filter(r => r.event_id !== event.id), 'W'),
        barMatch: barOf(event, 'W'),
        priorRecord: records.W,
        openingNight,
        cohort: otherDivisionNights('W', event.id, entries, ledger),
        tagPlan: isOpeningTagNight(events, event.id) ? 'opening' : 'redistribute',
        inTags,
      })
      const closeEntries = [
        ...allRankedM.ranked.map(r => ({
          id: r.entry.id,
          player_id: r.entry.player_id,
          division: 'M' as const,
          created_at: r.entry.created_at ?? '',
          awards: r.entry.awards ?? [],
          place: r.place,
        })),
        ...allRankedW.ranked.map(r => ({
          id: r.entry.id,
          player_id: r.entry.player_id,
          division: 'W' as const,
          created_at: r.entry.created_at ?? '',
          awards: r.entry.awards ?? [],
          place: r.place,
        })),
      ]
      const priorBalM = balances(ledger.filter(r => r.event_id !== event.id), 'M')
      const priorBalW = balances(ledger.filter(r => r.event_id !== event.id), 'W')
      const targetAlreadyPosted = ledger.some(
        r => r.event_id === event.id && r.division === targetDiv && r.kind === 'entry',
      )
      const divLabel = targetDiv === 'M' ? "Men's" : "Women's"
      const previewKey = `${event.id}|${targetDiv}`

      const closeRes = await executeDivisionCloseFlow({
        rpc: (fn, args) => supabase.rpc(fn, args),
        event,
        division: targetDiv,
        settings,
        entries: closeEntries,
        balances: { M: priorBalM, W: priorBalW },
        bar: { M: barOf(event, 'M'), W: barOf(event, 'W') },
        openingNight,
        payouts: { M: payoutsM, W: payoutsW },
        state: closeState,
        divisionAlreadyPosted: targetAlreadyPosted,
        onPreview: summary => {
          setClosePreviews(prev => ({ ...prev, [previewKey]: summary.text }))
        },
        confirmPreview: summary =>
          askConfirm(summary.text, {
            title: `Close ${divLabel} Division?`,
            confirmLabel: `Close ${divLabel} & post`,
          }),
      })

      if (!closeRes.ok) {
        if (closeRes.reason !== 'cancelled') {
          reportError(friendlyError(closeRes.message))
        }
        return
      }

      setCloseStates(prev => ({ ...prev, [event.id]: closeRes.state }))
      setReopenedDivisions(prev => ({ ...prev, [previewKey]: false }))

      await patchEvent(
        event.id,
        targetDiv === 'M'
          ? { payouts_men: payoutsM, bar_match_men: barOf(event, 'M') }
          : { payouts_women: payoutsW, bar_match_women: barOf(event, 'W') },
      )

      const divPlan = targetDiv === 'M' ? allRankedM : allRankedW
      for (const r of divPlan.ranked) {
        const ent = r.entry
        const tagOut = divPlan.tagsOut.get(ent.id) ?? null
        await must(supabase.from('pp_entries').update({
          place: r.place > 0 ? r.place : null,
          payout: divPlan.payouts.get(ent.id) ?? 0,
          points: divPlan.points.get(ent.id) ?? 0,
          tag_out: tagOut,
        }).eq('id', ent.id))
        if (season) {
          if (tagOut != null) {
            await must(supabase.from('pp_tags').upsert(
              { season_id: season.id, player_id: ent.player_id, tag_number: tagOut },
              { onConflict: 'season_id,player_id' },
            ))
          } else if (!inTags(ent.player_id)) {
            await must(supabase.from('pp_tags').delete().eq('season_id', season.id).eq('player_id', ent.player_id))
          }
        }
      }

      reportInfo(
        closeRes.sharedPosted
          ? `${divLabel} division closed and shared Perfect 4/5 pots settled.`
          : `${divLabel} division closed. Shared Perfect 4/5 pots stay held until both divisions close.`,
      )
      await reload()
    } catch {
      // must() already reported the error
    } finally {
      setIsFinalizing(false)
    }
  }

  const startCorrectionDraft = (reopen = false, nextTargetCash?: number) => {
    setCorrectionError(null)
    const bookedCash = cents(
      ledger
        .filter(r => r.event_id === event.id && r.division === division && r.fund === 'purse' && r.kind === 'place_payout')
        .reduce((sum, r) => sum + Math.abs(Number(r.amount)), 0) || allocated,
    )
    const target = nextTargetCash ?? bookedCash
    const draftRes = createCorrectionDraft({
      event,
      division,
      events,
      ledger,
      bookedCash,
      targetCash: target,
      balances: {
        M: balances(ledger, 'M'),
        W: balances(ledger, 'W'),
      },
      originalPayouts: divEntries.map(e => ({
        id: e.id,
        player_id: e.player_id,
        place: e.place,
        payout: e.payout,
      })),
      reopenDivision: reopen,
    })
    if (!draftRes.ok) {
      const msg = draftRes.reason === 'week1_frozen'
        ? 'Week 1 is locked and cannot be corrected.'
        : draftRes.reason === 'chronology'
          ? 'Corrections apply to the latest financially posted night only.'
          : draftRes.reason === 'insolvent'
            ? 'Pot balances do not have enough funds to cover this correction.'
            : 'Night must be financially posted before creating a correction.'
      setCorrectionError(msg)
      reportError(msg)
      return
    }
    setCorrectionDrafts(prev => ({ ...prev, [divReopenKey]: draftRes.draft }))
  }

  const handleApplyCorrection = async () => {
    if (!activeCorrectionDraft || !season) return
    setCorrectionError(null)
    try {
      const corrRes = await executeCorrectionFlow({
        rpc: (fn, args) => supabase.rpc(fn, args),
        event,
        draft: activeCorrectionDraft,
      })
      if (!corrRes.ok) {
        const msg =
          corrRes.reason === 'confirmation_required'
            ? corrRes.message
            : friendlyError(corrRes.message)
        setCorrectionError(msg)
        if (corrRes.reason === 'rpc_error') reportError(msg)
        return
      }
      if (corrRes.reopened) {
        setReopenedDivisions(prev => ({ ...prev, [divReopenKey]: true }))
        setCloseStates(prev => {
          const cur = prev[event.id] ?? closeState
          return {
            ...prev,
            [event.id]: {
              ...cur,
              closed: {
                ...cur.closed,
                [activeCorrectionDraft.division]: false,
              },
            },
          }
        })
      }
      setCorrectionDrafts(prev => ({ ...prev, [divReopenKey]: null }))
      reportInfo(
        corrRes.reopened
          ? 'Correction confirmed and division reopened.'
          : 'Correction confirmed and posted to the ledger.',
      )
      await reload()
    } catch (err) {
      setCorrectionError(messageOf(err))
    }
  }

  // A finalized or reopened night already has its $2s in the ledger. Adding them
  // again is how the card showed $20 while Pots showed $10.
  const nightPosted = eventLedgerPosted(ledger, event.id)
  const previewPot = (event.status === 'results' || event.status === 'complete') && !nightPosted
  const perfectRoundShown = displayedPerfectRound(
    curBalances.perfect_round,
    previewPot ? result.potAfterEntries : curBalances.perfect_round,
    nightPosted,
  )
  const recordedPayout = (fund: Fund) => cents(ledger
    .filter(r => r.event_id === event.id && r.fund === fund && r.kind === 'bonus_payout' && r.division === division)
    .reduce((sum, r) => sum + Math.abs(Number(r.amount)), 0))
  const recordedPerfectRound = recordedPayout('perfect_round')
  const sharedPotNights = [
    { division, entries: divEntries, balances: priorBalances },
    ...otherDivisionNights(division, event.id, entries, ledger),
  ]
  const priorLedger = ledger.filter(r => r.event_id !== event.id)
  const perfect5Pot = displayedSharedPot('perfect5', sharedPotNights, settings, priorLedger)
  const perfect4Pot = displayedSharedPot('perfect4', sharedPotNights, settings, priorLedger)

  const viewingOther = viewEventId != null && liveEvent != null && viewEventId !== liveEvent.id
  const eventLabel = event.name?.trim() || 'Tonight’s Tournament'
  const isPublicLeaderboard = !isAdmin && event.status !== 'complete'

  return (
    <div className={`tonight-page${isPublicLeaderboard ? ' public-view' : ''}${isProjector ? ' projector-page' : ''}`}>
      <PageHead
        eyebrow={`${event.name?.trim() ? `${event.name.trim()} · ` : ''}${event.event_date} · ${event.status}`}
        title={eventLabel}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {!isProjector && (
            <DivisionSeg value={division} onChange={d => { setBarError(''); setDivision(d) }} counts={counts} />
          )}
          {viewingOther && !isProjector && (
            <button className="btn btn-ghost btn-sm" onClick={() => openEvent(null)}>Back to tonight</button>
          )}
          {isAdmin && isDivisionClosed && !isWeek1Locked && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={!latestPostedCheck.latest}
              onClick={() => startCorrectionDraft(true)}
            >
              <RotateCcw size={14} /> Reopen {division === 'M' ? "Men's" : "Women's"} via Correction
            </button>
          )}
          {isAdmin && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => nav('/tv')}
              title="Open Projector View for wall display"
            >
              <Tv size={14} /> Projector view
            </button>
          )}
          {isProjector && (
            <button
              className="btn btn-ghost btn-sm projector-exit-btn"
              onClick={() => nav('/')}
              title="Exit Projector View (Esc)"
            >
              <X size={14} /> Exit (Esc)
            </button>
          )}
        </div>
      </PageHead>

      <div className="stats section">
        <Stat
          label={isProjector ? 'Field' : `${division === 'M' ? "Men's" : "Women's"} Field`}
          value={isProjector ? entries.filter(e => e.event_id === event.id).length : divEntries.length}
          sub={isProjector ? `${counts.M} men · ${counts.W} women checked in` : 'Players checked in'}
        />
        {(!isPublicLeaderboard || settings.potsVisibility?.purse !== false) && (
          <Stat
            label="Payout Pool"
            value={money(pool)}
            sub={bonusCost > 0
              ? `${money(settings.entryFee - settings.perfectRoundShare)}/player + ${money(barAmount)} bar − ${money(bonusCost)} bonuses`
              : `${money(settings.entryFee - settings.perfectRoundShare)}/player + ${money(barAmount)} bar`}
          />
        )}
        {(!isPublicLeaderboard || settings.potsVisibility?.perfect_round !== false) && (
          <Stat
            label="Perfect Round Pot"
            value={money(perfectRoundShown)}
            sub={previewPot
              ? `After tonight’s $2 per entry · Backup ${money(curBalances.backup)} · cap $${settings.perfectRoundCap}`
              : `Backup Pot: ${money(curBalances.backup)} (Cap $${settings.perfectRoundCap})`}
          />
        )}
        {(!isPublicLeaderboard || settings.potsVisibility?.high_score !== false) && (
          <Stat
            label="Score To Beat"
            value={records[division] != null ? `${records[division]} pts` : 'No record yet'}
            sub={openingNight
              ? 'Tonight sets the bar. High score pays $0.'
              : 'Beating this wins the high-score bonus'}
          />
        )}
      </div>

      {isAdmin && event.status !== 'complete' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="steps">
            {STEPS.map(s => (
              <button
                key={s.status}
                disabled={
                  isSeason9Week1(event) ||
                  ((s.status === 'final9' || s.status === 'results') && !canProceedToCut)
                }
                className={event.status === s.status ? 'on' : ''}
                onClick={() => setStatus(s.status)}
              >
                <span className="step-n">{s.label.slice(0, 1)}</span>
                {s.label.slice(3)}
              </button>
            ))}
          </div>
          {isSeason9Week1(event) && (
            <span className="muted" style={{ fontSize: 13 }}>
              Week 1 scores stay as played.
            </span>
          )}
        </div>
      )}

      {isAdmin && event.status === 'checkin' && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">Check-in & Registration</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Check players into the {division === 'M' ? "Men's" : "Women's"} division, record tag numbers, and set the bar match.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="row" role="group" aria-label="Check-in view" style={{ background: 'var(--surface-1)', padding: '2px 4px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${checkinViewMode === 'list' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => handleSetCheckinViewMode('list')}
                >
                  <List size={13} style={{ marginRight: 4 }} /> List
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${checkinViewMode === 'card' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => handleSetCheckinViewMode('card')}
                >
                  <LayoutGrid size={13} style={{ marginRight: 4 }} /> Cards
                </button>
              </div>
              <button
                className="btn btn-ghost"
                disabled={isSeason9Week1(event)}
                onClick={() => setMakeCardsOpen(true)}
              >
                <Users size={16} /> {divCards.length > 0 ? `Cards (${divCards.length})` : 'Make Cards'}
              </button>
              <button className="btn btn-primary" disabled={isSeason9Week1(event)} onClick={() => { if (isSeason9Week1(event)) return; setCreateError(''); setBuyingTag(current => buyingTagAfter(current, 'open')); setAddPlayerOpen(true) }}>
                <UserPlus size={16} /> Check In Player
              </button>
            </div>
          </div>

          <div className="grid-2">
            {checkinViewMode === 'card' ? (
              <div className="panel panel-pad stack" style={{ gap: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h3 className="display" style={{ fontSize: 18, margin: 0 }}>
                      {division === 'M' ? "Men's" : "Women's"} Playing Cards
                    </h3>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {divCards.length > 0
                        ? `${divCards.length} ${divCards.length === 1 ? 'card' : 'cards'} · Target size ${eventCards?.targetCardSize ?? 4} · ${eventCards?.sortMode === 'standings' ? 'Standings sort' : eventCards?.sortMode === 'random' ? 'Random sort' : 'Check-in sort'}`
                        : 'No cards made yet for this division.'}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {eventCards?.sortMode === 'random' && divCards.length > 0 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={isSeason9Week1(event)}
                        onClick={handleShuffleDivision}
                        title="Reshuffle players in this division across cards"
                      >
                        <Shuffle size={14} style={{ marginRight: 4 }} /> Shuffle
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={isSeason9Week1(event) || orderedEntries.length === 0}
                      onClick={() => setMakeCardsOpen(true)}
                    >
                      <RotateCcw size={14} style={{ marginRight: 4 }} /> {divCards.length > 0 ? 'Regenerate' : 'Make Cards'}
                    </button>
                  </div>
                </div>

                {divCards.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }} className="muted stack">
                    <Users size={32} style={{ margin: '0 auto', opacity: 0.5 }} />
                    <p style={{ margin: '6px 0 0' }}>No cards generated for {division === 'M' ? "Men's" : "Women's"} yet.</p>
                    <p style={{ fontSize: 12, margin: '2px 0 12px' }}>
                      {orderedEntries.length} {orderedEntries.length === 1 ? 'player' : 'players'} checked in.
                    </p>
                    {orderedEntries.length > 0 && (
                      <div>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={isSeason9Week1(event)}
                          onClick={() => setMakeCardsOpen(true)}
                        >
                          <Users size={14} style={{ marginRight: 4 }} /> Make Cards
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 12 }}>
                    {divCards.map(c => {
                      const cardEntries = c.playerIds
                        .map(pId => orderedEntries.find(ent => ent.player_id === pId))
                        .filter((ent): ent is Entry => ent != null)
                      return (
                        <div
                          key={c.id}
                          className="stack"
                          style={{
                            background: 'var(--surface-1)',
                            border: '1px solid var(--line)',
                            borderRadius: 8,
                            padding: '10px 12px',
                            gap: 8,
                          }}
                        >
                          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {cardEntries.length} {cardEntries.length === 1 ? 'player' : 'players'}
                            </span>
                          </div>
                          <div className="table-wrap">
                            <table className="table" style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th style={{ width: 35 }}>#</th>
                                  <th>Player Name</th>
                                  <th className="c" style={{ width: 85 }}>Tag In</th>
                                  <th className="c" style={{ width: 75 }}>Paid</th>
                                  <th className="c" style={{ width: 130 }}>Move Card</th>
                                  <th className="r" style={{ width: 70 }}>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cardEntries.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '12px 0' }} className="muted">
                                      Empty card
                                    </td>
                                  </tr>
                                ) : (
                                  cardEntries.map((ent, idx) => {
                                    const p = playerById.get(ent.player_id)
                                    return (
                                      <tr key={ent.id}>
                                        <td className="faint">{idx + 1}</td>
                                        <td className="strong">{p?.name ?? 'Unknown Player'}</td>
                                        <td className="c">
                                          <TagInCell
                                            entry={ent}
                                            name={p?.name ?? 'player'}
                                            siblings={nightEntries}
                                            inTags={p?.in_tags === true}
                                            disabled={isSeason9Week1(event)}
                                            onCommit={tag => {
                                              if (isSeason9Week1(event)) return
                                              patchEntry(ent.id, { tag_in: tag })
                                            }}
                                          />
                                        </td>
                                        <td className="c">
                                          <button
                                            className={`btn btn-sm ${ent.paid ? 'btn-ghost' : 'btn-danger'}`}
                                            disabled={isSeason9Week1(event)}
                                            onClick={() => {
                                              if (isSeason9Week1(event)) return
                                              patchEntry(ent.id, { paid: !ent.paid })
                                            }}
                                          >
                                            {ent.paid ? <Check size={14} color="var(--teal)" /> : 'Unpaid'}
                                          </button>
                                        </td>
                                        <td className="c">
                                          <select
                                            className="select select-sm"
                                            style={{
                                              fontSize: 12,
                                              padding: '2px 6px',
                                              borderRadius: 4,
                                              background: 'var(--surface-2)',
                                              border: '1px solid var(--line)',
                                              color: 'var(--text)',
                                              maxWidth: 125,
                                            }}
                                            value={c.id}
                                            disabled={isSeason9Week1(event)}
                                            onChange={e => handleMovePlayer(ent.player_id, e.target.value)}
                                            aria-label={`Card for ${p?.name ?? 'player'}`}
                                          >
                                            {divCards.map(targetC => (
                                              <option key={targetC.id} value={targetC.id}>
                                                {targetC.name} ({targetC.playerIds.length})
                                              </option>
                                            ))}
                                            <option value="new">+ New Card</option>
                                          </select>
                                        </td>
                                        <td className="r">
                                          <button
                                            className="btn btn-ghost btn-sm btn-danger"
                                            disabled={isSeason9Week1(event)}
                                            onClick={async () => {
                                              if (isSeason9Week1(event)) return
                                              const ok = await askConfirm(
                                                `Remove ${p?.name ?? 'this player'} from tonight?`,
                                                { title: 'Remove player', confirmLabel: 'Remove', danger: true },
                                              )
                                              if (!ok) return
                                              if (isSeason9Week1(event)) return
                                              await must(supabase.from('pp_entries').delete().eq('id', ent.id))
                                              if (eventCards) {
                                                const curCards = eventCards.cards[ent.division] ?? []
                                                const nextCards = removePlayerFromCards(curCards, ent.player_id)
                                                const updated: PPEvtCards = {
                                                  ...eventCards,
                                                  cards: { ...eventCards.cards, [ent.division]: nextCards },
                                                  updatedAt: new Date().toISOString(),
                                                }
                                                setEventCards(updated)
                                                saveEventCards(event.id, updated, event)
                                              }
                                              reload()
                                            }}
                                          >
                                            Remove
                                          </button>
                                        </td>
                                      </tr>
                                    )
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })}

                    {orderedEntries.filter(ent => !divCardPlayerIds.has(ent.player_id)).length > 0 && (
                      <div
                        className="stack"
                        style={{
                          background: 'var(--surface-1)',
                          border: '1px dashed var(--orange)',
                          borderRadius: 8,
                          padding: '10px 12px',
                          gap: 8,
                        }}
                      >
                        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--orange)' }}>
                            Unassigned Players ({orderedEntries.filter(ent => !divCardPlayerIds.has(ent.player_id)).length})
                          </span>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={isSeason9Week1(event)}
                            onClick={() => {
                              if (!eventCards) return
                              let cur = eventCards.cards[division] ?? []
                              const unassigned = orderedEntries.filter(ent => !divCardPlayerIds.has(ent.player_id))
                              for (const un of unassigned) {
                                cur = assignPlayerToSmallestCard(cur, un.player_id)
                              }
                              const updated: PPEvtCards = {
                                ...eventCards,
                                cards: { ...eventCards.cards, [division]: cur },
                                updatedAt: new Date().toISOString(),
                              }
                              setEventCards(updated)
                              saveEventCards(event.id, updated, event)
                            }}
                          >
                            Put in smallest cards
                          </button>
                        </div>
                        <div className="table-wrap">
                          <table className="table" style={{ margin: 0 }}>
                            <tbody>
                              {orderedEntries
                                .filter(ent => !divCardPlayerIds.has(ent.player_id))
                                .map((ent, idx) => {
                                  const p = playerById.get(ent.player_id)
                                  return (
                                    <tr key={ent.id}>
                                      <td className="faint" style={{ width: 35 }}>{idx + 1}</td>
                                      <td className="strong">{p?.name ?? 'Unknown Player'}</td>
                                      <td className="c" style={{ width: 130 }}>
                                        <select
                                          className="select select-sm"
                                          style={{
                                            fontSize: 12,
                                            padding: '2px 6px',
                                            borderRadius: 4,
                                            background: 'var(--surface-2)',
                                            border: '1px solid var(--line)',
                                            color: 'var(--text)',
                                            maxWidth: 125,
                                          }}
                                          value=""
                                          disabled={isSeason9Week1(event)}
                                          onChange={e => handleMovePlayer(ent.player_id, e.target.value)}
                                          aria-label={`Card for ${p?.name ?? 'player'}`}
                                        >
                                          <option value="" disabled>Assign to card…</option>
                                          {divCards.map(targetC => (
                                            <option key={targetC.id} value={targetC.id}>
                                              {targetC.name} ({targetC.playerIds.length})
                                            </option>
                                          ))}
                                          <option value="new">+ New Card</option>
                                        </select>
                                      </td>
                                      <td className="r">
                                        <button
                                          className="btn btn-ghost btn-sm btn-danger"
                                          disabled={isSeason9Week1(event)}
                                          onClick={async () => {
                                            if (isSeason9Week1(event)) return
                                            const ok = await askConfirm(
                                              `Remove ${p?.name ?? 'this player'} from tonight?`,
                                              { title: 'Remove player', confirmLabel: 'Remove', danger: true },
                                            )
                                            if (!ok) return
                                            if (isSeason9Week1(event)) return
                                            await must(supabase.from('pp_entries').delete().eq('id', ent.id))
                                            reload()
                                          }}
                                        >
                                          Remove
                                        </button>
                                      </td>
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
              </div>
            ) : (
              <div className="panel">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>Player Name</th>
                        <th className="c" style={{ width: 110 }}>Tag In</th>
                        <th className="c" style={{ width: 80 }}>Paid ($10)</th>
                        {divCards.length > 0 && <th className="c" style={{ width: 130 }}>Card</th>}
                        <th className="r" style={{ width: 80 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderedEntries.length === 0 ? (
                        <tr>
                          <td colSpan={divCards.length > 0 ? 6 : 5} style={{ textAlign: 'center', padding: '36px 0' }} className="muted">
                            No players checked into this division yet.
                          </td>
                        </tr>
                      ) : orderedEntries.map((ent, i) => {
                        const p = playerById.get(ent.player_id)
                        const playerCard = divCards.find(c => c.playerIds.includes(ent.player_id))
                        return (
                          <tr key={ent.id}>
                            <td className="faint">{i + 1}</td>
                            <td className="strong">{p?.name ?? 'Unknown Player'}</td>
                            <td className="c">
                              <TagInCell
                                entry={ent}
                                name={p?.name ?? 'player'}
                                siblings={nightEntries}
                                inTags={p?.in_tags === true}
                                disabled={isSeason9Week1(event)}
                                onCommit={tag => {
                                  if (isSeason9Week1(event)) return
                                  patchEntry(ent.id, { tag_in: tag })
                                }}
                              />
                            </td>
                            <td className="c">
                              <button
                                className={`btn btn-sm ${ent.paid ? 'btn-ghost' : 'btn-danger'}`}
                                disabled={isSeason9Week1(event)}
                                onClick={() => {
                                  if (isSeason9Week1(event)) return
                                  patchEntry(ent.id, { paid: !ent.paid })
                                }}
                              >
                                {ent.paid ? <Check size={14} color="var(--teal)" /> : 'Unpaid'}
                              </button>
                            </td>
                            {divCards.length > 0 && (
                              <td className="c">
                                <select
                                  className="select select-sm"
                                  style={{
                                    fontSize: 12,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: 'var(--surface-2)',
                                    border: '1px solid var(--line)',
                                    color: 'var(--text)',
                                    maxWidth: 125,
                                  }}
                                  value={playerCard?.id ?? ''}
                                  disabled={isSeason9Week1(event)}
                                  onChange={e => handleMovePlayer(ent.player_id, e.target.value)}
                                  aria-label={`Card for ${p?.name ?? 'player'}`}
                                >
                                  {!playerCard && <option value="">Unassigned</option>}
                                  {divCards.map(targetC => (
                                    <option key={targetC.id} value={targetC.id}>
                                      {targetC.name}
                                    </option>
                                  ))}
                                  <option value="new">+ New Card</option>
                                </select>
                              </td>
                            )}
                            <td className="r">
                              <button
                                className="btn btn-ghost btn-sm btn-danger"
                                disabled={isSeason9Week1(event)}
                                onClick={async () => {
                                  if (isSeason9Week1(event)) return
                                  const ok = await askConfirm(`Remove ${p?.name ?? 'this player'} from tonight?`, { title: 'Remove player', confirmLabel: 'Remove', danger: true })
                                  if (!ok) return
                                  if (isSeason9Week1(event)) return
                                  await must(supabase.from('pp_entries').delete().eq('id', ent.id))
                                  if (eventCards) {
                                    const curCards = eventCards.cards[ent.division] ?? []
                                    const nextCards = removePlayerFromCards(curCards, ent.player_id)
                                    const updated: PPEvtCards = {
                                      ...eventCards,
                                      cards: { ...eventCards.cards, [ent.division]: nextCards },
                                      updatedAt: new Date().toISOString(),
                                    }
                                    setEventCards(updated)
                                    saveEventCards(event.id, updated, event)
                                  }
                                  reload()
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="panel panel-pad stack">
              <div className="eyebrow">Night Finances & Match</div>
              <div className="kv"><dt>Total Field (Both Divs)</dt><dd>{counts.M + counts.W} players</dd></div>
              <div className="kv"><dt>Combined Entry Pot</dt><dd>{money(moneyCalc.totalPot)}</dd></div>
              <div className="kv"><dt>Bar Match ({settings.barMatchPct}%, max {money(settings.barMatchCap)})</dt><dd style={{ color: 'var(--orange)' }}>+{money(moneyCalc.barMatch)}</dd></div>
              <div style={{ marginTop: 14 }} className="field">
                <span>{division === 'M' ? "Men's" : "Women's"} Bar Match Contribution</span>
                <MoneyInput
                  value={barAmount}
                  disabled={isSeason9Week1(event)}
                  aria-label={`${division === 'M' ? "Men's" : "Women's"} bar match`}
                  onReject={setBarError}
                  onChange={val => {
                    if (isSeason9Week1(event)) return
                    setBarError('')
                    void patchEvent(event.id, division === 'M'
                      ? { bar_match_men: val, bar_match_men_manual: true }
                      : { bar_match_women: val, bar_match_women_manual: true })
                  }}
                />
                {barError && <small className="field-error">{barError}</small>}
                {barOf(event, 'M') + barOf(event, 'W') > settings.barMatchCap + 0.001 && (
                  <small className="field-error">Both divisions together are over the {money(settings.barMatchCap)} bar match cap.</small>
                )}
                <small>
                  {(division === 'M' ? event.bar_match_men_manual : event.bar_match_women_manual)
                    ? <>Typed in by hand. Automatic would be {money(moneyCalc.barSplit[division])}.{' '}
                        <button type="button" className="btn btn-ghost btn-sm" disabled={isSeason9Week1(event)} onClick={() => { if (isSeason9Week1(event)) return; void patchEvent(event.id, division === 'M' ? { bar_match_men_manual: false } : { bar_match_women_manual: false }) }}>Use automatic</button></>
                    : <>Automatic from entries: {money(moneyCalc.barSplit[division])}. Type an amount to override.</>}
                </small>
              </div>
              <button style={{ marginTop: 16 }} className="btn btn-primary btn-block" disabled={divEntries.length === 0 || isSeason9Week1(event)} onClick={() => setStatus('scoring')}>
                Start 18-Holes Scoring <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && event.status === 'scoring' && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">18-Holes Scoring Grid</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Front 9 and Back 9, each 0–50, rows staying in check-in order. Right-click a player to award a bonus.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                className="row"
                role="group"
                aria-label="18-hole score view mode"
                style={{ background: 'var(--surface-1)', padding: 2, borderRadius: 6, border: '1px solid var(--line)' }}
              >
                <button
                  type="button"
                  className={`btn btn-sm ${scoreViewMode === 'list' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => handleSetScoreViewMode('list')}
                  aria-pressed={scoreViewMode === 'list'}
                >
                  <List size={13} style={{ marginRight: 4 }} /> List
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${scoreViewMode === 'card' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => handleSetScoreViewMode('card')}
                  aria-pressed={scoreViewMode === 'card'}
                >
                  <LayoutGrid size={13} style={{ marginRight: 4 }} /> Cards
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={isSeason9Week1(event)}
                onClick={() => setMakeCardsOpen(true)}
              >
                <Users size={14} style={{ marginRight: 4 }} /> {divCards.length > 0 ? `Cards (${divCards.length})` : 'Make Cards'}
              </button>
              <RefreshScores
                blocked={() => scoreDirtyCount > 0 || scoreSaveCount > 0 || dirtyScores.current.size > 0 || scoreSaves.current > 0 || refreshLock.current}
                status={refreshStatus}
                onRefresh={refreshScores}
              />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <button
                  className="btn btn-primary"
                  disabled={!canProceedToCut || isSeason9Week1(event)}
                  onClick={applyCutAndProceed}
                >
                  Go to The Cut & Final 9 <ChevronRight size={16} />
                </button>
                {isSeason9Week1(event) ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Week 1 scores stay as played.
                  </span>
                ) : !canProceedToCut ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {!canConfirmCut(nightEntries)
                      ? 'Checked-in players still need a completed 18.'
                      : 'Waiting for score edits to finish saving…'}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {scoreViewMode === 'card' && divCards.length === 0 ? (
            <div className="stack" style={{ gap: 12 }}>
              <div className="banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span>No cards generated yet for {division === 'M' ? "Men's" : "Women's"}. Showing all players in list view.</span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={isSeason9Week1(event)}
                  onClick={() => setMakeCardsOpen(true)}
                >
                  <Users size={13} style={{ marginRight: 4 }} /> Make Cards
                </button>
              </div>
              <ScoreTable
                rows={orderedEntries}
                allRows={orderedEntries}
                rankedById={rankedById}
                playerById={playerById}
                settings={settings}
                mode="18"
                disabledScores={isSeason9Week1(event)}
                onContextMenu={handleContextMenu}
                onScore={saveScore}
                onDirty={markScoreDirty}
              />
            </div>
          ) : scoreViewMode === 'card' ? (
            <div className="stack" style={{ gap: 16 }}>
              {divCards.map(c => {
                const cardEntries = c.playerIds
                  .map(pId => orderedEntries.find(ent => ent.player_id === pId))
                  .filter((ent): ent is Entry => ent != null)
                return (
                  <div key={c.id} className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {cardEntries.length} {cardEntries.length === 1 ? 'player' : 'players'}
                      </span>
                    </div>
                    <ScoreTable
                      rows={cardEntries}
                      allRows={orderedEntries}
                      rankedById={rankedById}
                      playerById={playerById}
                      settings={settings}
                      mode="18"
                      disabledScores={isSeason9Week1(event)}
                      onContextMenu={handleContextMenu}
                      onScore={saveScore}
                      onDirty={markScoreDirty}
                    />
                  </div>
                )
              })}
              {(() => {
                const unassigned = orderedEntries.filter(ent => !divCardPlayerIds.has(ent.player_id))
                if (unassigned.length === 0) return null
                return (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>Unassigned Players</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {unassigned.length} {unassigned.length === 1 ? 'player' : 'players'}
                      </span>
                    </div>
                    <ScoreTable
                      rows={unassigned}
                      allRows={orderedEntries}
                      rankedById={rankedById}
                      playerById={playerById}
                      settings={settings}
                      mode="18"
                      disabledScores={isSeason9Week1(event)}
                      onContextMenu={handleContextMenu}
                      onScore={saveScore}
                      onDirty={markScoreDirty}
                    />
                  </div>
                )
              })()}
            </div>
          ) : (
            <ScoreTable
              rows={orderedEntries}
              allRows={orderedEntries}
              rankedById={rankedById}
              playerById={playerById}
              settings={settings}
              mode="18"
              disabledScores={isSeason9Week1(event)}
              onContextMenu={handleContextMenu}
              onScore={saveScore}
              onDirty={markScoreDirty}
            />
          )}
        </div>
      )}

      {isAdmin && event.status === 'final9' && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">Final 9 Round</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Final 9 is added to the 18-hole score. 18 holes max 100, the Final 9 maxes at 50, and the night maxes at 150.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                className="row"
                role="group"
                aria-label="Final 9 score view mode"
                style={{ background: 'var(--surface-1)', padding: 2, borderRadius: 6, border: '1px solid var(--line)' }}
              >
                <button
                  type="button"
                  className={`btn btn-sm ${scoreViewMode === 'list' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => handleSetScoreViewMode('list')}
                  aria-pressed={scoreViewMode === 'list'}
                >
                  <List size={13} style={{ marginRight: 4 }} /> List
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${scoreViewMode === 'card' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => handleSetScoreViewMode('card')}
                  aria-pressed={scoreViewMode === 'card'}
                >
                  <LayoutGrid size={13} style={{ marginRight: 4 }} /> Cards
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={isSeason9Week1(event)}
                onClick={() => setMakeCardsOpen(true)}
              >
                <Users size={14} style={{ marginRight: 4 }} /> {divCards.length > 0 ? `Cards (${divCards.length})` : 'Make Cards'}
              </button>
              <RefreshScores
                blocked={() => scoreDirtyCount > 0 || scoreSaveCount > 0 || dirtyScores.current.size > 0 || scoreSaves.current > 0 || refreshLock.current}
                status={refreshStatus}
                onRefresh={refreshScores}
              />
              <div className="row" role="group" aria-labelledby="final-cut-label" style={{ background: 'var(--surface-1)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <span id="final-cut-label" className="eyebrow" style={{ marginRight: 6 }}>Qualifiers cut</span>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Fewer qualifiers" onClick={() => stepCut(-1)} disabled={isSeason9Week1(event) || shownCut <= 1}>
                  <Minus size={14} />
                </button>
                <span className="num strong" style={{ margin: '0 8px', fontSize: 16, minWidth: 16, textAlign: 'center' }} aria-live="polite" aria-atomic="true">
                  {shownCut}
                </span>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="More qualifiers" onClick={() => stepCut(1)} disabled={isSeason9Week1(event) || shownCut >= Math.max(1, divEntries.length)}>
                  <Plus size={14} />
                </button>
              </div>
              {isSeason9Week1(event) && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Week 1 scores stay as played.
                </span>
              )}
              <button className="btn btn-primary" disabled={!canProceedToCut || isSeason9Week1(event)} onClick={() => setStatus('results')}>
                Advance to Results <ChevronRight size={16} />
              </button>
            </div>
          </div>
          {scoreViewMode === 'card' && divCards.length === 0 ? (
            <div className="stack" style={{ gap: 12 }}>
              <div className="banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span>No cards generated yet for {division === 'M' ? "Men's" : "Women's"}. Showing all players in list view.</span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={isSeason9Week1(event)}
                  onClick={() => setMakeCardsOpen(true)}
                >
                  <Users size={13} style={{ marginRight: 4 }} /> Make Cards
                </button>
              </div>
              <ScoreTable
                rows={final9Entries}
                allRows={final9Entries}
                rankedById={rankedById}
                playerById={playerById}
                settings={settings}
                mode="final"
                disabledScores={isSeason9Week1(event)}
                onContextMenu={handleContextMenu}
                onScore={saveScore}
                onToggleFinal={entry => {
                  if (isSeason9Week1(event)) return
                  void patchEntry(entry.id, { made_final: !entry.made_final })
                }}
                onDirty={markScoreDirty}
              />
            </div>
          ) : scoreViewMode === 'card' ? (
            <div className="stack" style={{ gap: 16 }}>
              {divCards.map(c => {
                const cardEntries = final9Entries.filter(ent => c.playerIds.includes(ent.player_id))
                return (
                  <div key={c.id} className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {cardEntries.length} {cardEntries.length === 1 ? 'player' : 'players'}
                      </span>
                    </div>
                    <ScoreTable
                      rows={cardEntries}
                      allRows={final9Entries}
                      rankedById={rankedById}
                      playerById={playerById}
                      settings={settings}
                      mode="final"
                      disabledScores={isSeason9Week1(event)}
                      onContextMenu={handleContextMenu}
                      onScore={saveScore}
                      onToggleFinal={entry => {
                        if (isSeason9Week1(event)) return
                        void patchEntry(entry.id, { made_final: !entry.made_final })
                      }}
                      onDirty={markScoreDirty}
                    />
                  </div>
                )
              })}
              {(() => {
                const unassigned = final9Entries.filter(ent => !divCardPlayerIds.has(ent.player_id))
                if (unassigned.length === 0) return null
                return (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>Unassigned Players</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {unassigned.length} {unassigned.length === 1 ? 'player' : 'players'}
                      </span>
                    </div>
                    <ScoreTable
                      rows={unassigned}
                      allRows={final9Entries}
                      rankedById={rankedById}
                      playerById={playerById}
                      settings={settings}
                      mode="final"
                      disabledScores={isSeason9Week1(event)}
                      onContextMenu={handleContextMenu}
                      onScore={saveScore}
                      onToggleFinal={entry => {
                        if (isSeason9Week1(event)) return
                        void patchEntry(entry.id, { made_final: !entry.made_final })
                      }}
                      onDirty={markScoreDirty}
                    />
                  </div>
                )
              })()}
            </div>
          ) : (
            <ScoreTable
              rows={final9Entries}
              allRows={final9Entries}
              rankedById={rankedById}
              playerById={playerById}
              settings={settings}
              mode="final"
              disabledScores={isSeason9Week1(event)}
              onContextMenu={handleContextMenu}
              onScore={saveScore}
              onToggleFinal={entry => {
                if (isSeason9Week1(event)) return
                void patchEntry(entry.id, { made_final: !entry.made_final })
              }}
              onDirty={markScoreDirty}
            />
          )}
        </div>
      )}

      {!isAdmin && event.status !== 'complete' ? (
        <div className="section stack leaderboard-section">
          <div>
            <h2 className="display section-title">Tonight's Leaderboard</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              Live scoring and cut standings. Completed rounds are ranked, followed by partial rounds and players on the course.
            </p>
          </div>
          <div className="leaderboard-grid">
            {DIVS.map(d => {
              const dEntries = entries.filter(e => e.event_id === event.id && e.division === d)
              const savedCut = d === 'M' ? event.final_cut_men : event.final_cut_women
              const board = tonightBoard(dEntries, settings, event.status, savedCut)
              const entryMap = new Map(dEntries.map(ent => [ent.id, ent]))
              return (
                <LeaderboardDivisionColumn
                  key={d}
                  d={d}
                  dEntries={dEntries}
                  board={board}
                  entryMap={entryMap}
                  playerById={playerById}
                  isProjector={isProjector}
                />
              )
            })}
          </div>
        </div>
      ) : (event.status === 'results' || event.status === 'complete') && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">
                {event.status === 'complete' ? 'Official Results & Standings' : 'Night Results & Payouts'}
              </h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Placements, prize checks, tag moves, and season points. Unfinished rows stay unplaced.
                {openingNight && ' High score on this first night sets the season record and pays $0.'}
              </p>
            </div>
            {isAdmin && event.status !== 'complete' && !isWeek1Locked && (
              <div style={{ display: 'flex', gap: 8 }}>
                {!isDivisionClosed && (
                  <button
                    className="btn btn-primary"
                    disabled={isFinalizing || overPool || divisionDeficit > 0}
                    onClick={() => void handleCloseDivision(division)}
                  >
                    <Lock size={16} /> {isFinalizing ? `Closing ${division === 'M' ? "Men's" : "Women's"}...` : `Close ${division === 'M' ? "Men's" : "Women's"} Division`}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid-2">
            <div className="panel">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 45 }}>Plc</th>
                      <th>Player</th>
                      <th className="c">18 Thru</th>
                      <th className="c">Final 9</th>
                      <th className="c bl" style={{ width: 70 }}>Total</th>
                      <th className="r bl" style={{ width: 85 }}>Payout</th>
                      <th className="c bl" style={{ width: 60 }}>Points</th>
                      <th className="c bl" style={{ width: 95 }}>Tag In → Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.ranked.map(r => {
                      const ent = r.entry
                      const p = playerById.get(ent.player_id)
                      const t = r.totals
                      const payoutAmt = result.payouts.get(ent.id) ?? 0
                      const pts = result.points.get(ent.id) ?? 0
                      const tagOut = result.tagsOut.get(ent.id)
                      return (
                        <tr key={ent.id} className={r.place === 1 ? 'leader' : ''} onContextMenu={e => handleContextMenu(e, ent)}>
                          <td className="place">{r.place > 0 ? ordinal(r.place) : '—'}</td>
                          <td className="strong">
                            {p?.name}
                            {ent.awards?.length > 0 && (
                              <span className="chips">
                                {ent.awards.map(a => <span key={a} className="chip chip-teal">{AWARD_SHORT[a]}</span>)}
                              </span>
                            )}
                          </td>
                          <td className="c">{t.t18 ?? '—'}</td>
                          <td className="c">{ent.made_final ? t.f ?? '—' : '—'}</td>
                          <td className="c bl big">{t.total ?? '—'}</td>
                          <td className="r bl num strong" style={{ color: payoutAmt > 0 ? 'var(--teal)' : 'var(--text-3)' }}>
                            {payoutAmt > 0 ? money(payoutAmt) : '—'}
                          </td>
                          <td className="c bl num" style={{ color: pts > 0 ? 'var(--orange)' : 'var(--text-3)' }}>
                            {pts > 0 ? `+${pts}` : '—'}
                          </td>
                          <td className="c bl faint">
                            {tagOut == null
                              ? 'No tag'
                              : ent.tag_in != null
                                ? <span>#{ent.tag_in} → <strong style={{ color: 'var(--text)' }}>#{tagOut}</strong></span>
                                : <strong style={{ color: 'var(--text)' }}>#{tagOut}</strong>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel panel-pad stack">
              <div className="eyebrow">Payout Pool & Allocation</div>
              <div className="kv"><dt>Entry share</dt><dd>{counts[division]} × {money(settings.entryFee - settings.perfectRoundShare)}</dd></div>
              <div className="kv"><dt>Bar match</dt><dd>+{money(barAmount)}</dd></div>
              <div className="kv"><dt>Bonuses awarded</dt><dd>{bonusCost ? `−${money(bonusCost)}` : money(0)}</dd></div>
              <div className="kv"><dt>Available pool</dt><dd style={{ color: 'var(--teal)' }}>{money(pool)}</dd></div>
              <div className="kv"><dt>Allocated</dt><dd>{money(allocated)}</dd></div>
              <div className="kv"><dt>Perfect Round pot</dt><dd>+{money(toPerfectRound)}</dd></div>
              {toBackup > 0 && (
                <div className="kv"><dt>Backup pot</dt><dd>+{money(toBackup)} over the cap</dd></div>
              )}
              <div className="kv">
                <dt>Left in the purse</dt>
                <dd style={{ color: purseLeft < -0.001 ? 'var(--danger)' : 'var(--text)' }}>{money(purseLeft)}</dd>
              </div>

              {isAdmin && canEditPayouts && (
                <div style={{ marginTop: 8 }}>
                  {paidPlaces > 0 && (
                    <>
                      <div className="row" role="group" aria-labelledby="paid-places-label" style={{ background: 'var(--surface-1)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)', marginBottom: 6 }}>
                        <span id="paid-places-label" className="eyebrow" style={{ marginRight: 6 }}>Paid places</span>
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Fewer paid places" onClick={() => stepPaidPlaces(-1)} disabled={isSeason9Week1(event) || paidPlaces <= 1}>
                          <Minus size={14} />
                        </button>
                        <span className="num strong" style={{ margin: '0 8px', fontSize: 16, minWidth: 16, textAlign: 'center' }} aria-live="polite" aria-atomic="true">
                          {paidPlaces}
                        </span>
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="More paid places" onClick={() => stepPaidPlaces(1)} disabled={isSeason9Week1(event) || paidPlaces >= counts[division]}>
                          <Plus size={14} />
                        </button>
                      </div>
                      <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                        Season default is {suggestedPlaces} for {counts[division]} players (1 per {settings.paidEvery}). Suggested checks step by $5. {money(placeRemainder(pool))} goes to the Perfect Round pot.
                      </p>
                    </>
                  )}
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Place payout amounts</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={useSuggested} disabled={paidPlaces <= 0 || isSeason9Week1(event)}>Use suggested</button>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    {Array.from({ length: paidPlaces }, (_, idx) => (
                      <div key={idx} className="row" style={{ justifyContent: 'space-between' }}>
                        <span className="muted" style={{ fontSize: 12 }}>{ordinal(idx + 1)} place</span>
                        <div style={{ width: 120 }}>
                          <MoneyInput
                            value={Number(payoutsList[idx] ?? 0)}
                            disabled={isSeason9Week1(event)}
                            aria-label={`${ordinal(idx + 1)} place payout`}
                            silentInvalid
                            onEdit={clearPayoutNote}
                            onChange={val => savePayout(idx, val)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {payoutProblem === 'increment' && (
                    <small className="field-error">Place checks have to be multiples of $5.</small>
                  )}
                  {payoutProblem === 'over' && (
                    <small className="field-error">
                      Place checks add up to {money(allocated)}, which is more than the {money(placeBudget(pool))} that can be paid in $5 steps. {money(placeRemainder(pool))} goes to the Perfect Round pot.
                    </small>
                  )}
                  {payoutProblem === 'negative' && (
                    <small className="field-error">Payouts can’t be negative.</small>
                  )}
                  {!overPool && payoutNoteText && <small className="field-error">{payoutNoteText}</small>}
                </div>
              )}

              <DivisionCloseoutPanel
                closed={isDivisionClosed}
                sharedPosted={isSharedPosted}
                correctionPending={activeCorrectionDraft != null}
                deficit={divisionDeficit}
                division={division}
                heldReserve={closeState.heldReserve[division]}
                releasedReserve={closeState.released[division]}
                previewText={closePreviews[divReopenKey] ?? null}
                canClose={isAdmin && !isWeek1Locked && !isDivisionClosed && !overPool}
                isClosing={isFinalizing}
                canCorrect={isAdmin && !isWeek1Locked && isDivisionClosed && latestPostedCheck.latest}
                onCloseDivision={isAdmin ? () => void handleCloseDivision(division) : undefined}
                onStartCorrection={isAdmin ? () => startCorrectionDraft(true) : undefined}
              />

              {isAdmin && activeCorrectionDraft && (
                <CorrectionDraftPanel
                  division={division}
                  bookedCash={activeCorrectionDraft.bookedCash}
                  targetCash={activeCorrectionDraft.targetCash}
                  cashDue={activeCorrectionDraft.cashDue}
                  handled={activeCorrectionDraft.handled}
                  acknowledged={activeCorrectionDraft.acknowledged}
                  confirmation={activeCorrectionDraft.confirmation}
                  reopenDivision={activeCorrectionDraft.reopenDivision}
                  error={correctionError}
                  onTargetCashChange={val => startCorrectionDraft(activeCorrectionDraft.reopenDivision, val)}
                  onHandledChange={val => setCorrectionDrafts(prev => ({
                    ...prev,
                    [divReopenKey]: prev[divReopenKey] ? { ...prev[divReopenKey]!, handled: val } : null,
                  }))}
                  onConfirmSettlement={(ack, sentence) => setCorrectionDrafts(prev => ({
                    ...prev,
                    [divReopenKey]: prev[divReopenKey]
                      ? { ...prev[divReopenKey]!, acknowledged: ack, confirmation: sentence }
                      : null,
                  }))}
                  onReopenChange={reopen => setCorrectionDrafts(prev => ({
                    ...prev,
                    [divReopenKey]: prev[divReopenKey] ? { ...prev[divReopenKey]!, reopenDivision: reopen } : null,
                  }))}
                  onApply={() => void handleApplyCorrection()}
                  onCancel={() => {
                    setCorrectionError(null)
                    setCorrectionDrafts(prev => ({ ...prev, [divReopenKey]: null }))
                  }}
                />
              )}

              <div style={{ marginTop: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Tonight's Bonus Winners</div>
                {result.bonuses.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>No bonus awards assigned tonight.</p>
                ) : result.bonuses.map(b => {
                  // A posted night shows what the ledger actually paid, not today's pot.
                  // Reopening previews the next finalize. Perfect Round stays on the posted pot.
                  const recorded = recordedPayout(b.type)
                  const showRecorded = event.status === 'complete' && nightPosted && recorded > 0
                  const each = b.type === 'perfect_round'
                    ? nightPosted
                      ? cents((recordedPerfectRound || curBalances.perfect_round) / Math.max(1, b.entryIds.length))
                      : b.each
                    : showRecorded
                      ? cents(recorded / Math.max(1, b.entryIds.length))
                      : b.each
                  const splitCount = b.splitAmong ?? b.entryIds.length
                  const setsBar = b.type === 'high_score' && openingNight && !(nightPosted && recorded > 0)
                  const detail = setsBar
                    ? `Sets the bar${b.entryIds.length > 1 ? ` (${b.entryIds.length} tied)` : ''}`
                    : `${money(each)}${b.type === 'perfect_round' || b.type === 'perfect5' || b.type === 'perfect4' ? ' from the pot' : ''}${splitCount > 1 ? ` (${splitCount} split)` : ''}`
                  return (
                  <div key={b.type} className="kv">
                    <dt>{AWARD_LABEL[b.type]}</dt>
                    <dd style={{ color: 'var(--orange)' }}>{detail}</dd>
                  </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <Menu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <div className="menu-label eyebrow">Award Bonuses: {playerById.get(contextMenu.entry.player_id)?.name}</div>
          {playerById.get(contextMenu.entry.player_id)?.in_tags !== true && (
            <div className="menu-note muted" style={{ fontSize: 11, padding: '4px 10px' }}>
              Not in tags. Bonuses still count; no tag is assigned.
            </div>
          )}
          {openingNight && (
            <div className="note">First night sets the high-score record and pays $0.</div>
          )}
          {AWARDS.map(a => {
            const has = contextMenu.entry.awards?.includes(a)
            return (
              <button key={a} className={has ? 'on' : ''} onClick={() => toggleAward(a)}>
                <span className="check">{has ? <Check size={14} /> : null}</span>
                <span>{AWARD_LABEL[a]}</span>
                <span className="hint">
                  {a === 'perfect_round' ? money(perfectRoundShown)
                    : a === 'high_score' ? (openingNight ? 'Sets the bar' : money(settings.bonus.highScore))
                    : a === 'perfect5' ? money(perfect5Pot)
                    : money(perfect4Pot)}
                </span>
              </button>
            )
          })}
        </Menu>
      )}

      {addPlayerOpen && (
        <Dialog title="Check In Player" onClose={() => { setAddPlayerOpen(false); setCreateError(''); setBuyingTag(current => buyingTagAfter(current, 'cancel')) }}>
          <div className="stack">
            <div className="field">
              <span>Search Roster</span>
              <input className="input" type="text" placeholder="Type player name..." autoFocus value={searchName} onChange={e => {
                const next = e.target.value
                setSearchName(next)
                setCreateError('')
                if (!normalizeName(next)) setBuyingTag(current => buyingTagAfter(current, 'next-player'))
              }} />
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }} className="stack">
              {players
                .filter(p => p.division === division && p.active && p.name.toLowerCase().includes(searchName.toLowerCase().trim()))
                .map(p => {
                  const already = nightEntries.some(e => e.player_id === p.id)
                  return (
                    <button key={p.id} disabled={already} className="btn btn-ghost" style={{ justifyContent: 'space-between' }} onClick={() => handleCheckinPlayer(p.id, division)}>
                      <span>{p.name}</span>
                      <span className="faint">{already ? 'Already in' : 'Add →'}</span>
                    </button>
                  )
                })}
            </div>
            {createError && <small className="field-error">{createError}</small>}
            {searchName.trim() && !duplicateName(searchName, players) && (
              <>
                <div className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>Buying a tag</span>
                    <div className="muted" style={{ fontSize: 11 }}>Bought a tag this season</div>
                  </div>
                  <Toggle on={buyingTag} onChange={setBuyingTag} label="Buying a tag" />
                </div>
                <button className="btn btn-primary btn-block" onClick={() => handleCreateAndCheckin(searchName, division)}>
                  <Plus size={14} /> Create &amp; Check In "{normalizeName(searchName)}"
                </button>
              </>
            )}
            {searchName.trim() && duplicateName(searchName, players) && !players.some(p => p.division === division && normalizeName(p.name).toLowerCase() === normalizeName(searchName).toLowerCase()) && (
              <small className="field-error">That name is already on the roster.</small>
            )}
          </div>
        </Dialog>
      )}

      {makeCardsOpen && (
        <Dialog title="Make Playing Cards" onClose={() => setMakeCardsOpen(false)}>
          <div className="stack" style={{ gap: 16 }}>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Split tonight's checked-in players into playing groups. Men's and Women's divisions are always grouped separately.
            </p>

            <div className="field">
              <span>Card size (players per group)</span>
              <input
                className="input"
                type="number"
                min={2}
                max={12}
                value={cardSizeInput}
                onChange={e => {
                  const val = parseInt(e.target.value, 10)
                  if (!Number.isNaN(val) && val >= 1) {
                    setCardSizeInput(val)
                  }
                }}
              />
              <span className="muted" style={{ fontSize: 11 }}>
                Recommended: 4. When player counts don't divide evenly, group sizes differ by at most 1 (e.g. 14 players = 4, 4, 3, 3).
              </span>
            </div>

            <div className="field">
              <span>Sort order within division</span>
              <div className="stack" style={{ gap: 8, marginTop: 4 }}>
                <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="cardSort"
                    value="checkin"
                    checked={cardSortInput === 'checkin'}
                    onChange={() => setCardSortInput('checkin')}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Check-in order</div>
                    <div className="muted" style={{ fontSize: 11 }}>Players are placed on cards in the order they checked in tonight.</div>
                  </div>
                </label>

                <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="cardSort"
                    value="standings"
                    checked={cardSortInput === 'standings'}
                    onChange={() => setCardSortInput('standings')}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Standings (Skill-based)</div>
                    <div className="muted" style={{ fontSize: 11 }}>Ranked by season standings so players with similar skill play together.</div>
                  </div>
                </label>

                <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="cardSort"
                    value="random"
                    checked={cardSortInput === 'random'}
                    onChange={() => setCardSortInput('random')}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Random</div>
                    <div className="muted" style={{ fontSize: 11 }}>Shuffled randomly across cards. You can re-shuffle anytime.</div>
                  </div>
                </label>
              </div>
            </div>

            {cardSortInput === 'random' && divCards.length > 0 && (
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-1)', padding: '8px 12px', borderRadius: 6 }}>
                <span style={{ fontSize: 12 }}>Shuffle {division === 'M' ? "Men's" : "Women's"} cards now?</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleShuffleDivision}
                >
                  <Shuffle size={13} style={{ marginRight: 4 }} /> Shuffle {division === 'M' ? "Men" : "Women"}
                </button>
              </div>
            )}

            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              {divCards.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-danger btn-sm"
                  onClick={handleClearCards}
                >
                  Clear Cards
                </button>
              ) : <div />}
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setMakeCardsOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={orderedEntries.length === 0 || isSeason9Week1(event)}
                  onClick={() => handleGenerateCards(cardSizeInput, cardSortInput)}
                >
                  {divCards.length > 0 ? 'Regenerate Cards' : 'Generate Cards'}
                </button>
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function StartEventDialog({ name, date, onName, onDate, onClose, onCreate }: {
  name: string
  date: string
  onName: (v: string) => void
  onDate: (v: string) => void
  onClose: () => void
  onCreate: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog title="Start New Event" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <span>Event name (optional)</span>
          <input className="input" type="text" placeholder="e.g. Week 4" value={name} onChange={e => onName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <span>Date</span>
          <input className="input" type="date" value={date} onChange={e => onDate(e.target.value)} />
        </div>
        {error && <small className="field-error">{error}</small>}
        <button className="btn btn-primary btn-block" disabled={busy || !date} onClick={async () => {
          setBusy(true)
          setError('')
          try { await onCreate() } catch (err) { setError(messageOf(err)) } finally { setBusy(false) }
        }}>
          {busy ? 'Starting…' : 'Start check-in'}
        </button>
      </div>
    </Dialog>
  )
}

function TagInCell({ entry, name, siblings, inTags, disabled, onCommit }: {
  entry: Entry
  name: string
  siblings: Entry[]
  inTags: boolean
  disabled?: boolean
  onCommit: (tag: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = draft ?? (entry.tag_in ?? '')
  if (!inTags || disabled) {
    return (
      <input
        className="score"
        style={{ width: inTags ? 60 : 72 }}
        disabled
        readOnly
        aria-label={`Tag in for ${name}`}
        value={!inTags ? 'No tag' : (entry.tag_in ? `#${entry.tag_in}` : 'None')}
      />
    )
  }
  return (
    <div>
      <input
        className="score"
        style={{ width: 60 }}
        inputMode="numeric"
        aria-label={`Tag in for ${name}`}
        placeholder="None"
        value={shown}
        onFocus={() => { setDraft(entry.tag_in == null ? '' : String(entry.tag_in)); setError(null) }}
        onChange={e => { setError(null); setDraft(e.target.value) }}
        onBlur={() => {
          const raw = draft ?? ''
          setDraft(null)
          const parsed = parseTag(raw)
          if (!parsed.ok) { setError(parsed.error); return }
          if (parsed.value != null && tagTakenTonight(parsed.value, siblings, entry.id, entry.division)) {
            setError(`Tag #${parsed.value} is already used in this division.`)
            return
          }
          setError(null)
          if (parsed.value !== entry.tag_in) onCommit(parsed.value)
        }}
      />
      {error && <small className="field-error">{error}</small>}
    </div>
  )
}

function RefreshScores({ blocked, status, onRefresh }: {
  blocked: () => boolean
  status: string | null
  onRefresh: () => Promise<void>
}) {
  const hold = blocked()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-disabled={hold}
        onMouseDown={e => { if (blocked()) e.preventDefault() }}
        onClick={() => { void onRefresh() }}
      >
        Refresh scores
      </button>
      {status && <span className="muted" role="status" style={{ fontSize: 12, maxWidth: 220, textAlign: 'right' }}>{status}</span>}
    </div>
  )
}

function ScoreTable({ rows, allRows, rankedById, playerById, settings, mode, disabledScores, onContextMenu, onScore, onToggleFinal, onDirty }: {
  rows: Entry[]
  allRows?: Entry[]
  rankedById: Map<string, Ranked>
  playerById: Map<string, Player>
  settings: ReturnType<typeof useData>['settings']
  mode: '18' | 'final'
  disabledScores?: boolean
  onContextMenu: (e: MouseEvent, entry: Entry) => void
  onScore: (id: string, patch: Partial<Entry>) => Promise<boolean>
  onToggleFinal?: (entry: Entry) => void
  onDirty: (id: string, field: 'front' | 'back' | 'final', dirty: boolean) => void
}) {
  const placeRows = allRows ?? rows
  const eighteenPlace = mode === '18'
    ? new Map(eighteenGridRows(placeRows, settings).map(row => [row.id, row.place]))
    : null
  return (
    <div className="panel">
      {disabledScores && (
        <div className="note" style={{ margin: '12px 16px' }}>
          Week 1 scores stay as played.
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            {mode === '18' ? (
              <>
                <tr>
                  <th style={{ width: 45 }}>Plc</th>
                  <th>Player</th>
                  <th className="c">Tag</th>
                  <th className="c bl" style={{ width: 85 }}>Front 9</th>
                  <th className="c bl" style={{ width: 85 }}>Back 9</th>
                  <th className="c bl" style={{ width: 85 }}>18 Total</th>
                  <th className="c bl" style={{ width: 140 }}>Awards</th>
                </tr>
                <tr>
                  <th></th><th></th><th></th>
                  <th className="c bl" title="Front 9, 50 points maximum">/ 50</th>
                  <th className="c bl" title="Back 9, 50 points maximum">/ 50</th>
                  <th className="c bl" title="18 holes, 100 points maximum">/ 100</th>
                  <th className="c bl">Right-Click</th>
                </tr>
              </>
            ) : (
              <>
                <tr>
                  <th style={{ width: 45 }}>Plc</th>
                  <th>Player</th>
                  <th className="c">Status</th>
                  <th className="c bl" style={{ width: 70 }}>18 Total</th>
                  <th className="c bl" style={{ width: 90 }} title="Final 9, 50 points maximum">Final 9 (/ 50)</th>
                  <th className="c bl" style={{ width: 90 }}>27 Total</th>
                </tr>
                <tr>
                  <th></th><th></th><th></th>
                  <th className="c bl" title="18 holes, 100 points maximum">/ 100</th>
                  <th className="c bl" title="Final 9, 50 points maximum">/ 50</th>
                  <th className="c bl" title="18 holes plus Final 9, 150 points maximum">/ 150</th>
                </tr>
              </>
            )}
          </thead>
          <tbody>
            {rows.map(ent => {
              const ranked = rankedById.get(ent.id)
              const t = ranked?.totals ?? totals(ent)
              const from18 = eighteenPlace?.get(ent.id) ?? 0
              const place = mode === '18'
                ? (from18 > 0 ? from18 : null)
                : (ranked && ranked.place > 0 ? ranked.place : null)
              const p = playerById.get(ent.player_id)
              if (mode === '18') {
                return (
                  <tr key={ent.id} onContextMenu={e => onContextMenu(e, ent)} className={place === 1 ? 'leader' : ''}>
                    <td className="place">{place ?? '—'}</td>
                    <td className="strong">
                      {p?.name}
                      {ent.awards?.length > 0 && (
                        <span className="chips">{ent.awards.map(a => <span key={a} className="chip chip-teal">{AWARD_SHORT[a]}</span>)}</span>
                      )}
                    </td>
                    <td className="c faint">{p?.in_tags && ent.tag_in ? `#${ent.tag_in}` : 'No tag'}</td>
                    <td className="c bl">
                      <ScoreInput
                        value={displayedFront(ent)}
                        max={MAX_NINE}
                        disabled={disabledScores}
                        onDirty={dirty => onDirty(ent.id, 'front', dirty)}
                        onCommit={n => onScore(ent.id, computeNineCommit(ent, 'front', n))}
                      />
                    </td>
                    <td className="c bl">
                      <ScoreInput
                        value={displayedBack(ent)}
                        max={MAX_NINE}
                        disabled={disabledScores}
                        onDirty={dirty => onDirty(ent.id, 'back', dirty)}
                        onCommit={n => onScore(ent.id, computeNineCommit(ent, 'back', n))}
                      />
                    </td>
                    <td className="c bl strong">{t.t18 != null ? t.t18 : ''}</td>
                    <td className="c bl">
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} disabled={disabledScores} onClick={e => { if (!disabledScores) onContextMenu(e, ent) }}>
                        <Sparkles size={12} /> Awards
                      </button>
                    </td>
                  </tr>
                )
              }
              const nightTot = liveNightTotal(ent)
              return (
                <tr key={ent.id} onContextMenu={e => onContextMenu(e, ent)} className={`${!ent.made_final ? 'out' : ''} ${place === 1 ? 'leader' : ''}`}>
                  <td className="place">{place ?? '—'}</td>
                  <td className="strong">{p?.name}</td>
                  <td className="c">
                    <button className="btn btn-sm btn-ghost" style={{ fontSize: 11 }} disabled={disabledScores} onClick={() => { if (!disabledScores) onToggleFinal?.(ent) }}>
                      {ent.made_final ? <span className="chip chip-teal">Finalist</span> : <span className="faint">Cut</span>}
                    </button>
                  </td>
                  <td className="c bl strong">{t.t18 ?? '—'}</td>
                  <td className="c bl"><ScoreInput value={ent.made_final ? t.f : null} max={MAX_FINAL} disabled={!ent.made_final || disabledScores} onDirty={dirty => onDirty(ent.id, 'final', dirty)} onCommit={n => onScore(ent.id, { score_final: n })} /></td>
                  <td className="c bl big" style={{ color: nightTot != null ? 'var(--orange)' : 'var(--text-3)' }}>{nightTot != null ? nightTot : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
