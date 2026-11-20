import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { allCardIdsFromEventCards, normalizeEventCards, type PPEvtCards } from './cards'
import {
  applyStationScoresToEntry,
  normalizeStationScores,
  type PuttCardRound,
  type StationMake,
} from './putt-stations'
import { generateCardPins } from './special-events'
import { resolveSettings } from './settings'
import { isSeason9Week1, mergeNinePatch, seasonHighScoreRecord, week1AllowsEventPatch, week1AllowsScorePatch } from './scoring'
import { reportError } from './notify'
import { friendlyError } from './validation'
import type { Division, Entry, LedgerRow, PPEvent, Player, Season, Settings, Tag } from './types'

const PP_EVENT_LOCAL_PINS_KEY = 'pp_event_card_pins_v1'
const PP_EVENT_UNLOCKED_PINS_KEY = 'pp_event_unlocked_cards_v1'

function readLocalEventPins(): Record<string, Record<string, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(PP_EVENT_LOCAL_PINS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalEventPins(map: Record<string, Record<string, string>>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PP_EVENT_LOCAL_PINS_KEY, JSON.stringify(map))
  } catch {
    // Ignore storage quota/private-mode errors
  }
}

function readSessionUnlockedEventPins(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(PP_EVENT_UNLOCKED_PINS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSessionUnlockedEventPins(map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(PP_EVENT_UNLOCKED_PINS_KEY, JSON.stringify(map))
  } catch {
    // Ignore sessionStorage errors
  }
}

function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = (error.code ?? '').toUpperCase()
  const msg = error.message ?? ''
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /pp_.*event_card|could not find the function|function .* does not exist/i.test(msg)
  )
}

function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined,
  column: string,
): boolean {
  if (!error) return false
  const code = (error.code ?? '').toUpperCase()
  const msg = error.message ?? ''
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    msg.toLowerCase().includes(column.toLowerCase()) ||
    /schema cache|does not exist/i.test(msg)
  )
}

export type StationPlayerPayload = Record<
  string,
  { front?: StationMake[]; back?: StationMake[]; final?: StationMake[] }
>

interface Data {
  loading: boolean
  session: Session | null
  isAdmin: boolean
  seasons: Season[]
  season: Season | null
  settings: Settings
  players: Player[]
  playerById: Map<string, Player>
  tags: Tag[]
  events: PPEvent[]
  entries: Entry[]
  ledger: LedgerRow[]
  /** The event in progress (not complete), if any */
  liveEvent: PPEvent | null
  /** An event opened from Season. Falls back to the live event when null. */
  viewEventId: string | null
  openEvent: (id: string | null) => void
  /** Best 27-hole total from completed events, per division */
  records: Record<Division, number | null>
  recordHolders: Record<Division, string[]>
  reload: () => Promise<'applied' | 'busy' | 'error'>
  patchEntry: (id: string, patch: Partial<Entry>) => Promise<boolean>
  patchEvent: (id: string, patch: Partial<PPEvent>) => Promise<void>
  saveCardsToEvent: (id: string, cards: PPEvtCards | null) => Promise<void>
  eventCardPins: Record<string, Record<string, string>>
  regenerateEventCardPin: (eventId: string, cardId: string) => Promise<string | null>
  unlockEventCardWithPin: (eventId: string, cardId: string, pin: string) => Promise<boolean>
  isEventCardUnlocked: (eventId: string, cardId: string) => boolean
  submitEventCardStationScores: (
    eventId: string,
    cardId: string,
    round: PuttCardRound,
    playerStations: StationPlayerPayload,
  ) => Promise<boolean>
  /** Write the season tag immediately and show it on the roster without waiting for an event. */
  saveTag: (playerId: string, tagNumber: number | null) => Promise<void>
  /** True once the first session and director check have finished. */
  authReady: boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<Data | null>(null)

/** Numeric columns sometimes come back as strings. Keep them numbers so inputs and sums stay honest. */
function normalizeEvent(row: PPEvent): PPEvent {
  const nums = (list: number[] | null | undefined) => (list ?? []).map(n => Number(n)).filter(n => Number.isFinite(n))
  const money = (n: number | null | undefined) => {
    const v = Number(n)
    return Number.isFinite(v) ? v : 0
  }
  return {
    ...row,
    bar_match_men: money(row.bar_match_men),
    bar_match_women: money(row.bar_match_women),
    payouts_men: nums(row.payouts_men),
    payouts_women: nums(row.payouts_women),
    pp_closed_men: Boolean(row.pp_closed_men),
    pp_closed_women: Boolean(row.pp_closed_women),
    pp_shared_pots_posted: Boolean(row.pp_shared_pots_posted),
    pp_reserve_p4_men: money(row.pp_reserve_p4_men),
    pp_reserve_p5_men: money(row.pp_reserve_p5_men),
    pp_reserve_p4_women: money(row.pp_reserve_p4_women),
    pp_reserve_p5_women: money(row.pp_reserve_p5_women),
    ...(Object.prototype.hasOwnProperty.call(row, 'cards')
      ? { cards: normalizeEventCards(row.cards) }
      : {}),
  }
}

/** Throw-on-error wrapper. Callers see a short message; the raw database text stays in the console. */
export async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q
  if (error) {
    console.error(error.message)
    const message = friendlyError(error.message)
    reportError(message)
    throw new Error(message)
  }
  return data
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [seasons, setSeasons] = useState<Season[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [events, setEvents] = useState<PPEvent[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [viewEventId, setViewEventId] = useState<string | null>(null)

  // Drop the old client-side "admin" flag. It was a localStorage boolean,
  // not a session, and anyone could set it.
  useEffect(() => {
    localStorage.removeItem('puttsAndPintsAdmin')
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setIsAdmin(false)
  }, [])

  const openEvent = useCallback((id: string | null) => setViewEventId(id), [])

  // Session plus director membership. Other Supabase calls are deferred out
  // of onAuthStateChange so they don't run while the auth client holds its lock.
  // A cold load of /season used to redirect to login: getSession and the first
  // auth event both wrote state, and a null from a refresh race was last, so
  // authReady flipped true with no session while storage still had one.
  useEffect(() => {
    let cancelled = false
    let generation = 0
    let sawInitial = false
    let current: Session | null = null
    const timers = new Set<number>()

    const applySession = (next: Session | null) => {
      current = next
      const gen = ++generation
      setSession(next)
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        void (async () => {
          if (cancelled || gen !== generation) return
          if (!next) {
            setIsAdmin(false)
            setAuthReady(true)
            return
          }
          const { data, error } = await supabase.rpc('pp_is_admin')
          if (cancelled || gen !== generation) return
          setIsAdmin(!error && data === true)
          setAuthReady(true)
        })()
      }, 0)
      timers.add(timer)
    }

    const { data: auth } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, next) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') {
        applySession(null)
        return
      }
      if (event === 'INITIAL_SESSION') {
        sawInitial = true
        if (next) {
          applySession(next)
          return
        }
        // Ask storage again after this callback returns. A refresh that loses
        // the race reports null once; the saved session is often still there.
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          void supabase.auth.getSession().then(({ data }) => {
            if (cancelled || current) return
            applySession(data.session ?? null)
          })
        }, 0)
        timers.add(timer)
        return
      }
      if (next) applySession(next)
    })

    // If the client never emits INITIAL_SESSION, don't leave the gate spinning.
    const fallback = window.setTimeout(() => {
      if (cancelled || sawInitial) return
      sawInitial = true
      void supabase.auth.getSession().then(({ data }) => {
        if (!cancelled) applySession(data.session ?? null)
      })
    }, 4000)
    timers.add(fallback)

    return () => {
      cancelled = true
      for (const timer of timers) window.clearTimeout(timer)
      auth.subscription.unsubscribe()
    }
  }, [])

  // In-flight director edits. A realtime refetch that lands mid-keystroke used to
  // replace the field with a stale row, which is how payouts turned into "00" / "222".
  const writes = useRef(0)
  const reloadQueued = useRef(false)
  const reloadGen = useRef(0)
  const cardsColumnMissing = useRef(false)
  const stationColMissingRef = useRef(false)
  const pinRpcMissingRef = useRef(false)
  const eventPinsRef = useRef<Record<string, Record<string, string>>>({})
  const cardWriteQueueRef = useRef<Map<string, Promise<unknown>>>(new Map())
  const pendingCardWritesRef = useRef<Map<string, number>>(new Map())
  const [eventCardPins, setEventCardPins] = useState<Record<string, Record<string, string>>>({})
  const [unlockedEventPins, setUnlockedEventPins] = useState<Record<string, string>>(() =>
    readSessionUnlockedEventPins(),
  )
  const seasonsRef = useRef(seasons)
  const entriesRef = useRef(entries)
  const eventsRef = useRef(events)
  useEffect(() => { seasonsRef.current = seasons }, [seasons])
  useEffect(() => { entriesRef.current = entries }, [entries])
  useEffect(() => { eventsRef.current = events }, [events])

  const setEventCardPinsSafe = useCallback(
    (updater: (prev: Record<string, Record<string, string>>) => Record<string, Record<string, string>>) => {
      setEventCardPins(prev => {
        const next = updater(prev)
        eventPinsRef.current = next
        return next
      })
    },
    [],
  )

  const reload = useCallback(async (): Promise<'applied' | 'busy' | 'error'> => {
    if (writes.current > 0) { reloadQueued.current = true; return 'busy' }
    const gen = ++reloadGen.current
    const [s, p] = await Promise.all([
      supabase.from('pp_seasons').select('*').order('created_at'),
      supabase.from('pp_players').select('*').order('name'),
    ])
    if (s.error || p.error) { setLoading(false); return 'error' }
    if (gen !== reloadGen.current) return 'busy'
    const allSeasons = (s.data ?? []) as Season[]
    const allPlayers = (p.data ?? []) as Player[]
    const active = allSeasons.find(x => x.active)

    let nextTags: Tag[] = []
    let nextEvents: PPEvent[] = []
    let nextEntries: Entry[] = []
    let nextLedger: LedgerRow[] = []
    if (active) {
      const [t, ev, l] = await Promise.all([
        supabase.from('pp_tags').select('*').eq('season_id', active.id),
        supabase.from('pp_events').select('*').eq('season_id', active.id).order('event_date').order('created_at'),
        supabase.from('pp_ledger').select('*').eq('season_id', active.id).order('created_at'),
      ])
      if (t.error || ev.error || l.error) { setLoading(false); return 'error' }
      const evs = (ev.data ?? []) as PPEvent[]
      const en = evs.length
        ? await supabase.from('pp_entries').select('*').in('event_id', evs.map(e => e.id)).order('created_at')
        : { data: [] as Entry[] | null, error: null }
      if (en.error) { setLoading(false); return 'error' }
      nextTags = (t.data ?? []) as Tag[]
      nextEvents = evs.map(normalizeEvent)
      nextEntries = ((en.data ?? []) as Entry[]).map(e => ({
        ...e,
        ...(Object.prototype.hasOwnProperty.call(e, 'station_scores')
          ? { station_scores: normalizeStationScores(e.station_scores) }
          : {}),
      }))
      nextLedger = (l.data ?? []) as LedgerRow[]
    }
    if (gen !== reloadGen.current) return 'busy'
    if (writes.current > 0) { reloadQueued.current = true; return 'busy' }

    setSeasons(allSeasons)
    setPlayers(allPlayers)
    setTags(nextTags)
    eventsRef.current = nextEvents
    setEvents(nextEvents)
    entriesRef.current = nextEntries
    setEntries(nextEntries)
    setLedger(nextLedger)
    setLoading(false)
    return 'applied'
  }, [])

  const finishWrite = useCallback((failed: boolean) => {
    writes.current = Math.max(0, writes.current - 1)
    if (failed) {
      reloadQueued.current = false
      writes.current = 0
      void reload()
      return
    }
    if (writes.current === 0 && reloadQueued.current) {
      reloadQueued.current = false
      void reload()
    }
  }, [reload])

  useEffect(() => { void reload() }, [reload])

  // Live updates (Realtime + polling/visibility fallback) so leaderboards stay current
  const hasLiveEvent = useMemo(
    () => events.some(e => e.status !== 'complete' && e.status !== 'scheduled'),
    [events],
  )
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const scheduleReload = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { void reload() }, 350)
    }

    const ch = supabase.channel('pp-live')
    for (const table of ['pp_events', 'pp_entries', 'pp_ledger', 'pp_players', 'pp_tags']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload)
    }
    ch.subscribe()

    const onWake = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)

    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
      supabase.removeChannel(ch)
    }
  }, [reload])

  useEffect(() => {
    if (!hasLiveEvent) return
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible' && writes.current === 0) {
        void reload()
      }
    }, 5000)
    return () => window.clearInterval(poll)
  }, [hasLiveEvent, reload])

  const fetchServerEventPins = useCallback(
    async (eventId: string, force = false): Promise<Record<string, string> | null> => {
      if (!isAdmin) return null
      if (pinRpcMissingRef.current) {
        const local = readLocalEventPins()
        setEventCardPinsSafe(() => local)
        return local[eventId] ?? {}
      }
      if (!force && Object.prototype.hasOwnProperty.call(eventPinsRef.current, eventId)) {
        return eventPinsRef.current[eventId]
      }
      const { data, error } = await supabase.rpc('pp_get_event_card_pins', { p_event_id: eventId })
      if (error) {
        if (isMissingFunctionError(error)) {
          pinRpcMissingRef.current = true
          const local = readLocalEventPins()
          setEventCardPinsSafe(() => local)
          return local[eventId] ?? {}
        }
        console.error(error.message)
        return null
      }
      const pins = (data && typeof data === 'object' ? data : {}) as Record<string, string>
      setEventCardPinsSafe(prev => ({ ...prev, [eventId]: pins }))
      return pins
    },
    [isAdmin, setEventCardPinsSafe],
  )

  const patchEntry = useCallback(async (id: string, patch: Partial<Entry>) => {
    if (!isAdmin) return false
    const entry = entriesRef.current.find(e => e.id === id) ?? entries.find(e => e.id === id)
    const entryEvent = entry ? events.find(ev => ev.id === entry.event_id) : null
    if (!week1AllowsScorePatch(entryEvent, patch)) {
      return false
    }
    const touchesNine =
      Object.prototype.hasOwnProperty.call(patch, 'score_front') ||
      Object.prototype.hasOwnProperty.call(patch, 'score_back') ||
      Object.prototype.hasOwnProperty.call(patch, 'score_18')
    let dbPatch: Partial<Entry> = { ...patch }
    if (entry && touchesNine) {
      const merged = mergeNinePatch(entry, patch)
      dbPatch = { ...dbPatch, score_18: merged.score_18 }
      entriesRef.current = entriesRef.current.map(e => (e.id === id ? merged : e))
    } else if (entry) {
      entriesRef.current = entriesRef.current.map(e => (e.id === id ? { ...e, ...patch } : e))
    }
    if (stationColMissingRef.current) {
      delete dbPatch.station_scores
    }
    writes.current += 1
    setEntries(prev => prev.map(e => (e.id === id ? mergeNinePatch(e, dbPatch) : e)))
    let { error } = await supabase.from('pp_entries').update(dbPatch).eq('id', id)
    if (error && Object.prototype.hasOwnProperty.call(dbPatch, 'station_scores') && isMissingColumnError(error, 'station_scores')) {
      stationColMissingRef.current = true
      const fallbackPatch = { ...dbPatch }
      delete fallbackPatch.station_scores
      const retry = await supabase.from('pp_entries').update(fallbackPatch).eq('id', id)
      error = retry.error
    }
    if (error) {
      console.error(error.message)
      reportError(friendlyError(error.message))
    }
    finishWrite(!!error)
    return !error
  }, [isAdmin, entries, events, finishWrite])

  const patchEvent = useCallback(async (id: string, patch: Partial<PPEvent>) => {
    if (!isAdmin) return
    const targetEvent = events.find(ev => ev.id === id)
    if (!week1AllowsEventPatch(targetEvent, patch)) {
      return
    }
    writes.current += 1
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)))
    const { error } = await supabase.from('pp_events').update(patch).eq('id', id)
    if (error) {
      console.error(error.message)
      reportError(friendlyError(error.message))
    }
    finishWrite(!!error)
  }, [isAdmin, events, finishWrite])

  const syncPinsForEventCards = useCallback(
    async (eventId: string, cards: PPEvtCards | null) => {
      const ev = eventsRef.current.find(e => e.id === eventId)
      if (!isAdmin || isSeason9Week1(ev ?? { id: eventId })) return
      const cardIds = allCardIdsFromEventCards(cards)
      if (cardIds.length === 0) {
        if (pinRpcMissingRef.current) {
          const map = readLocalEventPins()
          delete map[eventId]
          writeLocalEventPins(map)
          setEventCardPinsSafe(() => map)
          return
        }
        const { error } = await supabase.rpc('pp_set_event_card_pins', {
          p_event_id: eventId,
          p_pins: {},
        })
        if (error && isMissingFunctionError(error)) {
          pinRpcMissingRef.current = true
          const map = readLocalEventPins()
          delete map[eventId]
          writeLocalEventPins(map)
          setEventCardPinsSafe(() => map)
          return
        }
        if (!error) {
          setEventCardPinsSafe(prev => ({ ...prev, [eventId]: {} }))
        }
        return
      }

      const basePins = await fetchServerEventPins(eventId, true)
      if (basePins === null) return

      const pinsAlreadyMatch =
        Object.keys(basePins).length === cardIds.length &&
        cardIds.every(cid => /^\d{4}$/.test(basePins[cid] ?? ''))
      if (pinsAlreadyMatch) return

      const nextPins = generateCardPins(
        cardIds.map((cid, i) => ({ id: cid, cardNumber: i + 1, startingHole: 1 })),
        basePins,
      )

      if (pinRpcMissingRef.current) {
        const map = readLocalEventPins()
        map[eventId] = nextPins
        writeLocalEventPins(map)
        setEventCardPinsSafe(() => map)
        return
      }

      const { error } = await supabase.rpc('pp_set_event_card_pins', {
        p_event_id: eventId,
        p_pins: nextPins,
      })
      if (error) {
        if (isMissingFunctionError(error)) {
          pinRpcMissingRef.current = true
          const map = readLocalEventPins()
          map[eventId] = nextPins
          writeLocalEventPins(map)
          setEventCardPinsSafe(() => map)
          return
        }
        console.error(error.message)
        return
      }
      setEventCardPinsSafe(prev => ({ ...prev, [eventId]: nextPins }))
    },
    [isAdmin, fetchServerEventPins, setEventCardPinsSafe],
  )

  const activePinTarget = useMemo(() => {
    const picked = viewEventId ? events.find(e => e.id === viewEventId) : null
    return picked ?? events.find(e => e.status !== 'complete' && e.status !== 'scheduled') ?? null
  }, [viewEventId, events])
  const activePinEventId = activePinTarget?.id ?? null
  const activePinCardsStamp = activePinTarget?.cards?.updatedAt ?? ''

  useEffect(() => {
    if (!isAdmin) {
      setEventCardPinsSafe(() => ({}))
      return
    }
    if (!activePinEventId) return
    let cancelled = false
    void fetchServerEventPins(activePinEventId, true).then(pins => {
      if (cancelled || !pins) return
      const ev = eventsRef.current.find(e => e.id === activePinEventId)
      if (!ev || isSeason9Week1(ev) || !ev.cards) return
      const cardIds = allCardIdsFromEventCards(ev.cards)
      if (cardIds.length > 0 && cardIds.some(cid => !/^\d{4}$/.test(pins[cid] ?? ''))) {
        void syncPinsForEventCards(ev.id, ev.cards)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isAdmin, activePinEventId, activePinCardsStamp, fetchServerEventPins, setEventCardPinsSafe, syncPinsForEventCards])

  const saveCardsToEvent = useCallback(async (id: string, cards: PPEvtCards | null) => {
    if (!isAdmin) return
    const targetEvent = eventsRef.current.find(ev => ev.id === id)
    if (isSeason9Week1(targetEvent ?? { id })) return
    eventsRef.current = eventsRef.current.map(e => (e.id === id ? { ...e, cards } : e))
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, cards } : e)))
    if (!cardsColumnMissing.current) {
      writes.current += 1
      const { error } = await supabase.from('pp_events').update({ cards }).eq('id', id)
      if (error) {
        if (isMissingColumnError(error, 'cards')) {
          cardsColumnMissing.current = true
          finishWrite(false)
        } else {
          console.error(error.message)
          reportError(friendlyError(error.message))
          finishWrite(true)
          return
        }
      } else {
        finishWrite(false)
      }
    }
    await syncPinsForEventCards(id, cards)
  }, [isAdmin, finishWrite, syncPinsForEventCards])

  const regenerateEventCardPin = useCallback(
    async (eventId: string, cardId: string): Promise<string | null> => {
      const ev = eventsRef.current.find(e => e.id === eventId)
      if (!isAdmin || isSeason9Week1(ev ?? { id: eventId })) return null
      const cardIds = allCardIdsFromEventCards(ev?.cards)
      if (!cardIds.includes(cardId)) cardIds.push(cardId)

      const currentPins = await fetchServerEventPins(eventId, true)
      if (currentPins === null) {
        reportError('Could not load existing card PINs. Try again.')
        return null
      }

      const prevPin = currentPins[cardId]
      const withoutTarget = { ...currentPins }
      delete withoutTarget[cardId]

      const pseudoCards = cardIds.map((cid, i) => ({ id: cid, cardNumber: i + 1, startingHole: 1 }))
      let nextPins = generateCardPins(pseudoCards, withoutTarget)
      if (prevPin && nextPins[cardId] === prevPin) {
        for (let i = 0; i < 10; i++) {
          const retry = generateCardPins(pseudoCards, withoutTarget)
          if (retry[cardId] !== prevPin) {
            nextPins = retry
            break
          }
        }
      }

      if (pinRpcMissingRef.current) {
        const map = readLocalEventPins()
        map[eventId] = nextPins
        writeLocalEventPins(map)
        setEventCardPinsSafe(() => map)
        return nextPins[cardId] ?? null
      }

      const { error } = await supabase.rpc('pp_set_event_card_pins', {
        p_event_id: eventId,
        p_pins: nextPins,
      })
      if (error) {
        if (isMissingFunctionError(error)) {
          pinRpcMissingRef.current = true
          const map = readLocalEventPins()
          map[eventId] = nextPins
          writeLocalEventPins(map)
          setEventCardPinsSafe(() => map)
          return nextPins[cardId] ?? null
        }
        console.error(error.message)
        reportError(friendlyError(error.message))
        return null
      }
      setEventCardPinsSafe(prev => ({ ...prev, [eventId]: nextPins }))
      return nextPins[cardId] ?? null
    },
    [isAdmin, fetchServerEventPins, setEventCardPinsSafe],
  )

  const unlockEventCardWithPin = useCallback(
    async (eventId: string, cardId: string, rawPin: string): Promise<boolean> => {
      const clean = rawPin.trim()
      if (!/^\d{4}$/.test(clean)) return false

      let ok = false
      if (pinRpcMissingRef.current) {
        ok = readLocalEventPins()[eventId]?.[cardId] === clean
      } else {
        const { data, error } = await supabase.rpc('pp_verify_event_card_pin', {
          p_event_id: eventId,
          p_card_id: cardId,
          p_pin: clean,
        })
        if (error) {
          if (isMissingFunctionError(error)) {
            pinRpcMissingRef.current = true
            ok = readLocalEventPins()[eventId]?.[cardId] === clean
          } else {
            console.error(error.message)
            reportError(friendlyError(error.message))
            return false
          }
        } else {
          ok = data === true
        }
      }

      if (!ok) return false

      const key = `${eventId}:${cardId}`
      const nextMap = { ...readSessionUnlockedEventPins(), [key]: clean }
      writeSessionUnlockedEventPins(nextMap)
      setUnlockedEventPins(nextMap)
      return true
    },
    [],
  )

  const isEventCardUnlocked = useCallback(
    (eventId: string, cardId: string): boolean => {
      if (isAdmin) return true
      const key = `${eventId}:${cardId}`
      const cached = unlockedEventPins[key]
      if (!cached) return false
      if (pinRpcMissingRef.current) {
        return cached === readLocalEventPins()[eventId]?.[cardId]
      }
      return true
    },
    [isAdmin, unlockedEventPins],
  )

  const submitEventCardStationScores = useCallback(
    async (
      eventId: string,
      cardId: string,
      round: PuttCardRound,
      playerStations: StationPlayerPayload,
    ): Promise<boolean> => {
      const ev = eventsRef.current.find(e => e.id === eventId)
      if (!ev) return false
      if (isSeason9Week1(ev) || ev.status === 'complete') {
        reportError('Scores are locked for this event.')
        return false
      }

      // Apply optimistically onto latest entriesRef so consecutive rapid taps accumulate cleanly
      const updatedMap = new Map<string, Entry>()
      const nextEntries = entriesRef.current.map(ent => {
        if (ent.event_id !== eventId) return ent
        const patch = playerStations[ent.player_id]
        if (!patch) return ent
        if (round === 'final' && !ent.made_final) return ent
        const updated = applyStationScoresToEntry(ent, round, patch)
        updatedMap.set(ent.id, updated)
        return updated
      })
      if (updatedMap.size === 0) return false
      entriesRef.current = nextEntries
      setEntries(nextEntries)

      const queueKey = `${eventId}:${cardId}`
      pendingCardWritesRef.current.set(queueKey, (pendingCardWritesRef.current.get(queueKey) ?? 0) + 1)
      writes.current += 1

      const prior = cardWriteQueueRef.current.get(queueKey) ?? Promise.resolve()
      const task = prior
        .catch(() => undefined)
        .then(async (): Promise<boolean> => {
          try {
            const cachedPin = unlockedEventPins[queueKey] ?? readSessionUnlockedEventPins()[queueKey]
            let effectivePin =
              cachedPin || (isAdmin ? eventPinsRef.current[eventId]?.[cardId] : undefined)
            if (isAdmin && !effectivePin) {
              const loadedPins = await fetchServerEventPins(eventId)
              effectivePin = loadedPins?.[cardId]
            }

            if (!pinRpcMissingRef.current && effectivePin) {
              const { data, error } = await supabase.rpc('pp_submit_event_card_scores', {
                p_event_id: eventId,
                p_card_id: cardId,
                p_pin: effectivePin,
                p_round: round,
                p_player_stations: playerStations,
              })

              if (!error) {
                const remaining = (pendingCardWritesRef.current.get(queueKey) ?? 1) - 1
                if (remaining <= 0 && Array.isArray(data)) {
                  const serverById = new Map<string, Entry>()
                  for (const row of data as Entry[]) {
                    if (row?.id) {
                      serverById.set(row.id, {
                        ...row,
                        station_scores: normalizeStationScores(row.station_scores),
                      })
                    }
                  }
                  if (serverById.size > 0) {
                    const merged = entriesRef.current.map(e => serverById.get(e.id) ?? e)
                    entriesRef.current = merged
                    setEntries(merged)
                  }
                }
                finishWrite(false)
                return true
              }

              if (!isMissingFunctionError(error)) {
                console.error(error.message)
                if (/invalid.*pin/i.test(error.message)) {
                  const nextMap = { ...readSessionUnlockedEventPins() }
                  delete nextMap[queueKey]
                  writeSessionUnlockedEventPins(nextMap)
                  setUnlockedEventPins(nextMap)
                  reportError('That Card PIN is no longer valid. Re-enter the PIN from the director.')
                } else {
                  reportError(friendlyError(error.message))
                }
                finishWrite(true)
                return false
              }

              pinRpcMissingRef.current = true
            }

            // Admin fallback when pp_013 SQL RPC is not installed yet or no PIN exists
            if (isAdmin) {
              for (const updated of updatedMap.values()) {
                const dbRow: Partial<Entry> =
                  round === '18'
                    ? {
                        r1_b1: updated.r1_b1,
                        r1_b2: updated.r1_b2,
                        r2_b1: updated.r2_b1,
                        r2_b2: updated.r2_b2,
                        score_front: updated.score_front,
                        score_back: updated.score_back,
                        score_18: updated.score_18,
                        awards: updated.awards,
                        ...(stationColMissingRef.current ? {} : { station_scores: updated.station_scores ?? null }),
                      }
                    : {
                        f_b1: updated.f_b1,
                        f_b2: updated.f_b2,
                        score_final: updated.score_final,
                        awards: updated.awards,
                        ...(stationColMissingRef.current ? {} : { station_scores: updated.station_scores ?? null }),
                      }
                let { error } = await supabase.from('pp_entries').update(dbRow).eq('id', updated.id)
                if (error && !stationColMissingRef.current && isMissingColumnError(error, 'station_scores')) {
                  stationColMissingRef.current = true
                  const withoutStations = { ...dbRow }
                  delete withoutStations.station_scores
                  const retry = await supabase.from('pp_entries').update(withoutStations).eq('id', updated.id)
                  error = retry.error
                }
                if (error) {
                  console.error(error.message)
                  reportError(friendlyError(error.message))
                  finishWrite(true)
                  return false
                }
              }
              finishWrite(false)
              return true
            }

            reportError('Enter the 4-digit Card PIN to submit scores.')
            finishWrite(true)
            return false
          } finally {
            const left = Math.max(0, (pendingCardWritesRef.current.get(queueKey) ?? 1) - 1)
            if (left === 0) pendingCardWritesRef.current.delete(queueKey)
            else pendingCardWritesRef.current.set(queueKey, left)
          }
        })

      cardWriteQueueRef.current.set(queueKey, task)
      return task
    },
    [isAdmin, unlockedEventPins, fetchServerEventPins, finishWrite],
  )

  const saveTag = useCallback(async (playerId: string, tagNumber: number | null) => {
    if (!isAdmin) {
      const message = 'You are not signed in as a director. Sign in again, then retry that save.'
      reportError(message)
      throw new Error(message)
    }
    const season = seasonsRef.current.find(s => s.active)
    if (!season) {
      const message = 'Start a season before assigning a tag. The player can be saved without one.'
      reportError(message)
      throw new Error(message)
    }
    writes.current += 1
    if (tagNumber == null) {
      setTags(prev => prev.filter(t => !(t.season_id === season.id && t.player_id === playerId)))
      const { error } = await supabase.from('pp_tags').delete().eq('season_id', season.id).eq('player_id', playerId)
      if (error) {
        console.error(error.message)
        const message = friendlyError(error.message)
        reportError(message)
        finishWrite(true)
        throw new Error(message)
      }
      finishWrite(false)
      return
    }
    setTags(prev => [
      ...prev.filter(t => t.player_id !== playerId),
      { id: `pending-${playerId}`, season_id: season.id, player_id: playerId, tag_number: tagNumber },
    ])
    const { data, error } = await supabase
      .from('pp_tags')
      .upsert({ season_id: season.id, player_id: playerId, tag_number: tagNumber }, { onConflict: 'season_id,player_id' })
      .select()
      .single()
    if (error) {
      console.error(error.message)
      const message = friendlyError(error.message)
      reportError(message)
      finishWrite(true)
      throw new Error(message)
    }
    setTags(prev => [...prev.filter(t => t.player_id !== playerId), data as Tag])
    finishWrite(false)
  }, [isAdmin, finishWrite])

  // Derived ------------------------------------------------------------------
  const value = useMemo<Data>(() => {
    const season = seasons.find(s => s.active) ?? null
    const playerMap = new Map(players.map(p => [p.id, p]))
    const menHs = seasonHighScoreRecord({ entries, events, division: 'M', playerById: playerMap })
    const womenHs = seasonHighScoreRecord({ entries, events, division: 'W', playerById: playerMap })
    const records: Record<Division, number | null> = { M: menHs.score, W: womenHs.score }
    const recordHolders: Record<Division, string[]> = { M: menHs.holders, W: womenHs.holders }
    return {
      loading, session, isAdmin, seasons, season,
      settings: resolveSettings(season?.settings),
      players, playerById: playerMap,
      tags, events, entries, ledger,
      liveEvent: events.find(e => e.status !== 'complete' && e.status !== 'scheduled') ?? null,
      viewEventId, openEvent,
      records,
      recordHolders,
      reload,
      patchEntry,
      patchEvent,
      saveCardsToEvent,
      eventCardPins,
      regenerateEventCardPin,
      unlockEventCardWithPin,
      isEventCardUnlocked,
      submitEventCardStationScores,
      saveTag,
      authReady,
      signOut,
    }
  }, [
    loading,
    session,
    isAdmin,
    authReady,
    seasons,
    players,
    tags,
    events,
    entries,
    ledger,
    viewEventId,
    openEvent,
    reload,
    patchEntry,
    patchEvent,
    saveCardsToEvent,
    eventCardPins,
    regenerateEventCardPin,
    unlockEventCardWithPin,
    isEventCardUnlocked,
    submitEventCardStationScores,
    saveTag,
    signOut,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
