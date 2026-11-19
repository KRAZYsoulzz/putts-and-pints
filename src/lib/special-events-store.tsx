import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from './supabase'
import { useData } from './store'
import { reportError, reportInfo } from './notify'
import { friendlyError } from './validation'
import {
  applyCardHoleScores,
  generateCardPins,
  normalizeSpecialEvent,
  sortSpecialEvents,
  type SpecialEvent,
} from './special-events'

export type SpecialStorageMode = 'local' | 'supabase'

const LOCAL_EVENTS_KEY = 'pp_special_events_v1'
const LOCAL_PINS_KEY = 'pp_special_pins_v1'
const UNLOCKED_CARDS_SESSION_KEY = 'pp_special_unlocked_cards_v1'

interface SpecialEventsContextValue {
  loading: boolean
  storageMode: SpecialStorageMode
  events: SpecialEvent[]
  activeEvent: SpecialEvent | null
  liveSpecialEvent: SpecialEvent | null
  selectedEventId: string | null
  selectEvent: (id: string | null) => void
  cardPins: Record<string, string>
  hasUnsyncedLocalEvents: boolean
  syncLocalToSupabase: () => Promise<void>
  reload: () => Promise<void>
  saveEvent: (next: SpecialEvent, nextPins?: Record<string, string>) => Promise<boolean>
  deleteEvent: (id: string) => Promise<boolean>
  regenerateCardPin: (eventId: string, cardId: string) => Promise<string | null>
  unlockCardWithPin: (eventId: string, cardId: string, pin: string) => Promise<boolean>
  isCardUnlocked: (eventId: string, cardId: string) => boolean
  submitCardHoleScores: (
    eventId: string,
    cardId: string,
    teamHoles: Record<string, (number | null)[]>,
  ) => Promise<boolean>
}

const SpecialEventsCtx = createContext<SpecialEventsContextValue | null>(null)

function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = (error.code ?? '').toUpperCase()
  const msg = error.message ?? ''
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /pp_special_events|schema cache|does not exist|could not find the table/i.test(msg)
  )
}

function readLocalEvents(): SpecialEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LOCAL_EVENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return sortSpecialEvents(parsed.map(normalizeSpecialEvent))
  } catch {
    return []
  }
}

function writeLocalEvents(events: readonly SpecialEvent[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(events))
  } catch {
    // Ignore quota/private-mode storage errors
  }
}

function readLocalPinsMap(): Record<string, Record<string, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(LOCAL_PINS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalPinsMap(map: Record<string, Record<string, string>>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(map))
  } catch {
    // Ignore storage errors
  }
}

function readSessionUnlockedPins(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(UNLOCKED_CARDS_SESSION_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSessionUnlockedPins(map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(UNLOCKED_CARDS_SESSION_KEY, JSON.stringify(map))
  } catch {
    // Ignore sessionStorage errors
  }
}

export function SpecialEventsProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useData()
  const [loading, setLoading] = useState(true)
  const [storageMode, setStorageMode] = useState<SpecialStorageMode>('local')
  const [events, setEvents] = useState<SpecialEvent[]>(() => readLocalEvents())
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [adminPinsByEvent, setAdminPinsByEvent] = useState<Record<string, Record<string, string>>>({})
  const [unlockedSessionPins, setUnlockedSessionPins] = useState<Record<string, string>>(() =>
    readSessionUnlockedPins(),
  )
  const [localDraftCount, setLocalDraftCount] = useState<number>(() => readLocalEvents().length)
  const adminPinsRef = useRef<Record<string, Record<string, string>>>({})
  const cardWriteQueueRef = useRef<Map<string, Promise<unknown>>>(new Map())
  const pendingCardWritesRef = useRef<Map<string, number>>(new Map())
  const totalPendingScoreWritesRef = useRef(0)

  const setAdminPinsSafe = useCallback(
    (updater: (prev: Record<string, Record<string, string>>) => Record<string, Record<string, string>>) => {
      setAdminPinsByEvent(prev => {
        const next = updater(prev)
        adminPinsRef.current = next
        return next
      })
    },
    [],
  )

  const fetchServerPins = useCallback(
    async (eventId: string): Promise<Record<string, string> | null> => {
      if (Object.prototype.hasOwnProperty.call(adminPinsRef.current, eventId)) {
        return adminPinsRef.current[eventId]
      }
      const { data, error } = await supabase.rpc('pp_get_special_card_pins', { p_event_id: eventId })
      if (error) {
        console.error(error.message)
        return null
      }
      const pins = (data && typeof data === 'object' ? data : {}) as Record<string, string>
      setAdminPinsSafe(prev => ({ ...prev, [eventId]: pins }))
      return pins
    },
    [setAdminPinsSafe],
  )

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('pp_special_events')
      .select('id, state, updated_at')
      .order('event_date', { ascending: false })

    if (error) {
      if (isMissingTableError(error)) {
        const local = readLocalEvents()
        setStorageMode('local')
        setEvents(local)
        setLocalDraftCount(local.length)
        setLoading(false)
        return
      }
      console.error(error.message)
      setLoading(false)
      return
    }

    const remote = sortSpecialEvents(
      (data ?? [])
        .map(row => row.state as SpecialEvent | null)
        .filter((s): s is SpecialEvent => Boolean(s && s.id))
        .map(normalizeSpecialEvent),
    )
    setStorageMode('supabase')
    setEvents(remote)
    setLocalDraftCount(readLocalEvents().length)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Subscribe to realtime updates when Supabase table exists
  useEffect(() => {
    if (storageMode !== 'supabase') return
    const ch = supabase.channel('pp-special-live')
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pp_special_events' },
      () => {
        if (totalPendingScoreWritesRef.current > 0) return
        void reload()
      },
    )
    ch.subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [storageMode, reload])

  // Cross-tab sync when running in local mode
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === LOCAL_EVENTS_KEY && storageMode === 'local') {
        const local = readLocalEvents()
        setEvents(local)
        setLocalDraftCount(local.length)
      } else if (ev.key === LOCAL_PINS_KEY && storageMode === 'local' && isAdmin) {
        setAdminPinsSafe(() => readLocalPinsMap())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageMode, isAdmin, setAdminPinsSafe])

  const liveSpecialEvent = useMemo(
    () => events.find(e => e.status !== 'complete') ?? null,
    [events],
  )

  const activeEvent = useMemo(() => {
    if (selectedEventId) {
      const found = events.find(e => e.id === selectedEventId)
      if (found) return found
    }
    return liveSpecialEvent ?? events[0] ?? null
  }, [events, selectedEventId, liveSpecialEvent])

  // Load admin-only card PINs for the active event. Non-admins always get {}.
  useEffect(() => {
    if (!isAdmin) {
      setAdminPinsSafe(() => ({}))
      return
    }
    if (!activeEvent) return
    if (storageMode === 'local') {
      setAdminPinsSafe(() => readLocalPinsMap())
      return
    }
    let cancelled = false
    void supabase
      .rpc('pp_get_special_card_pins', { p_event_id: activeEvent.id })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error(error.message)
          return
        }
        const pins = (data && typeof data === 'object' ? data : {}) as Record<string, string>
        setAdminPinsSafe(prev => ({ ...prev, [activeEvent.id]: pins }))
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, activeEvent?.id, storageMode, setAdminPinsSafe])

  const cardPins = useMemo(() => {
    if (!isAdmin || !activeEvent) return {}
    return adminPinsByEvent[activeEvent.id] ?? {}
  }, [isAdmin, activeEvent, adminPinsByEvent])

  const hasUnsyncedLocalEvents = useMemo(() => {
    if (!isAdmin || storageMode !== 'supabase' || localDraftCount === 0) return false
    const remoteIds = new Set(events.map(e => e.id))
    return readLocalEvents().some(le => !remoteIds.has(le.id))
  }, [isAdmin, storageMode, events, localDraftCount])

  const saveEvent = useCallback(
    async (next: SpecialEvent, nextPins?: Record<string, string>): Promise<boolean> => {
      if (!isAdmin) {
        reportError('Sign in as a director to save changes.')
        return false
      }
      const stamped = normalizeSpecialEvent({
        ...next,
        updatedAt: new Date().toISOString(),
      })

      if (storageMode === 'local') {
        const existingLocalPins = readLocalPinsMap()[stamped.id] ?? {}
        const resolvedLocalPins =
          stamped.cards.length > 0
            ? generateCardPins(stamped.cards, nextPins ?? existingLocalPins)
            : (nextPins ?? {})
        const current = readLocalEvents()
        const nextList = sortSpecialEvents([
          ...current.filter(e => e.id !== stamped.id),
          stamped,
        ])
        writeLocalEvents(nextList)
        const pinsMap = readLocalPinsMap()
        pinsMap[stamped.id] = resolvedLocalPins
        writeLocalPinsMap(pinsMap)
        setEvents(nextList)
        setAdminPinsSafe(() => pinsMap)
        setLocalDraftCount(nextList.length)
        return true
      }

      setEvents(prev => sortSpecialEvents([...prev.filter(e => e.id !== stamped.id), stamped]))
      const { error } = await supabase.from('pp_special_events').upsert({
        id: stamped.id,
        name: stamped.name,
        event_date: stamped.eventDate,
        status: stamped.status,
        state: stamped,
        updated_at: stamped.updatedAt,
      })

      if (error) {
        console.error(error.message)
        reportError(friendlyError(error.message))
        void reload()
        return false
      }

      if (stamped.cards.length > 0 || nextPins) {
        let basePins: Record<string, string> | null = nextPins ?? null
        if (!basePins) {
          basePins = await fetchServerPins(stamped.id)
          if (basePins === null) {
            // Never overwrite live server card PINs if existing PINs couldn't be read.
            return true
          }
        }
        const pinsAlreadyMatch =
          !nextPins &&
          Object.keys(basePins).length === stamped.cards.length &&
          stamped.cards.every(c => /^\d{4}$/.test(basePins![c.id] ?? ''))

        if (!pinsAlreadyMatch) {
          const resolvedPins =
            stamped.cards.length > 0 ? generateCardPins(stamped.cards, basePins) : {}
          const { error: pinErr } = await supabase.rpc('pp_set_special_card_pins', {
            p_event_id: stamped.id,
            p_pins: resolvedPins,
          })
          if (pinErr) {
            console.error(pinErr.message)
            reportError(friendlyError(pinErr.message))
          } else {
            setAdminPinsSafe(prev => ({ ...prev, [stamped.id]: resolvedPins }))
          }
        }
      }
      return true
    },
    [isAdmin, storageMode, reload, fetchServerPins, setAdminPinsSafe],
  )

  const deleteEvent = useCallback(
    async (id: string): Promise<boolean> => {
      if (!isAdmin) return false
      if (storageMode === 'local') {
        const nextList = readLocalEvents().filter(e => e.id !== id)
        writeLocalEvents(nextList)
        const pinsMap = readLocalPinsMap()
        delete pinsMap[id]
        writeLocalPinsMap(pinsMap)
        setEvents(nextList)
        setAdminPinsSafe(() => pinsMap)
        setLocalDraftCount(nextList.length)
        if (selectedEventId === id) setSelectedEventId(null)
        return true
      }

      const { error } = await supabase.from('pp_special_events').delete().eq('id', id)
      if (error) {
        console.error(error.message)
        reportError(friendlyError(error.message))
        return false
      }
      if (selectedEventId === id) setSelectedEventId(null)
      await reload()
      return true
    },
    [isAdmin, storageMode, selectedEventId, reload, setAdminPinsSafe],
  )

  const regenerateCardPin = useCallback(
    async (eventId: string, cardId: string): Promise<string | null> => {
      if (!isAdmin) return null
      const ev = events.find(e => e.id === eventId)
      if (!ev) return null

      let currentPins: Record<string, string>
      if (storageMode === 'local') {
        currentPins = readLocalPinsMap()[eventId] ?? {}
      } else {
        const loaded = await fetchServerPins(eventId)
        if (loaded === null) {
          reportError('Could not load existing card PINs. Try again.')
          return null
        }
        currentPins = loaded
      }

      const withoutTarget = { ...currentPins }
      delete withoutTarget[cardId]

      // Ensure new PIN also avoids matching the immediately previous PIN if possible
      const prevPin = currentPins[cardId]
      let nextPins = generateCardPins(ev.cards, withoutTarget)
      if (prevPin && nextPins[cardId] === prevPin) {
        for (let i = 0; i < 10; i++) {
          const retry = generateCardPins(ev.cards, withoutTarget)
          if (retry[cardId] !== prevPin) {
            nextPins = retry
            break
          }
        }
      }

      if (storageMode === 'local') {
        const pinsMap = readLocalPinsMap()
        pinsMap[eventId] = nextPins
        writeLocalPinsMap(pinsMap)
        setAdminPinsSafe(() => pinsMap)
        return nextPins[cardId] ?? null
      }

      const { error } = await supabase.rpc('pp_set_special_card_pins', {
        p_event_id: eventId,
        p_pins: nextPins,
      })
      if (error) {
        console.error(error.message)
        reportError(friendlyError(error.message))
        return null
      }
      setAdminPinsSafe(prev => ({ ...prev, [eventId]: nextPins }))
      return nextPins[cardId] ?? null
    },
    [isAdmin, events, storageMode, fetchServerPins, setAdminPinsSafe],
  )

  const unlockCardWithPin = useCallback(
    async (eventId: string, cardId: string, rawPin: string): Promise<boolean> => {
      const clean = rawPin.trim()
      if (!/^\d{4}$/.test(clean)) return false

      let ok = false
      if (storageMode === 'local') {
        const pins = readLocalPinsMap()[eventId] ?? {}
        ok = pins[cardId] === clean
      } else {
        const { data, error } = await supabase.rpc('pp_verify_special_card_pin', {
          p_event_id: eventId,
          p_card_id: cardId,
          p_pin: clean,
        })
        if (error) {
          console.error(error.message)
          reportError(friendlyError(error.message))
          return false
        }
        ok = data === true
      }

      if (!ok) return false

      const key = `${eventId}:${cardId}`
      const nextMap = { ...readSessionUnlockedPins(), [key]: clean }
      writeSessionUnlockedPins(nextMap)
      setUnlockedSessionPins(nextMap)
      return true
    },
    [storageMode],
  )

  const isCardUnlocked = useCallback(
    (eventId: string, cardId: string): boolean => {
      if (isAdmin) return true
      const key = `${eventId}:${cardId}`
      const cached = unlockedSessionPins[key]
      if (!cached) return false
      if (storageMode === 'local') {
        return cached === readLocalPinsMap()[eventId]?.[cardId]
      }
      return true
    },
    [isAdmin, storageMode, unlockedSessionPins],
  )

  const submitCardHoleScores = useCallback(
    async (
      eventId: string,
      cardId: string,
      teamHoles: Record<string, (number | null)[]>,
    ): Promise<boolean> => {
      const ev = events.find(e => e.id === eventId)
      if (!ev) return false
      if (ev.status === 'complete') {
        reportError('This event is finalized and scores are locked.')
        return false
      }

      const applyPatch = (base: SpecialEvent): SpecialEvent =>
        applyCardHoleScores(base, cardId, teamHoles)

      const cachedPin = unlockedSessionPins[`${eventId}:${cardId}`]

      if (storageMode === 'local') {
        if (!isAdmin) {
          const expected = readLocalPinsMap()[eventId]?.[cardId]
          if (!cachedPin || !expected || cachedPin !== expected) {
            const key = `${eventId}:${cardId}`
            const nextMap = { ...readSessionUnlockedPins() }
            delete nextMap[key]
            writeSessionUnlockedPins(nextMap)
            setUnlockedSessionPins(nextMap)
            reportError('Enter the 4-digit Card PIN to submit scores.')
            return false
          }
        }
        const current = readLocalEvents()
        const target = current.find(e => e.id === eventId) ?? ev
        const updated = applyPatch(target)
        const nextList = sortSpecialEvents([
          ...current.filter(e => e.id !== eventId),
          updated,
        ])
        writeLocalEvents(nextList)
        setEvents(nextList)
        return true
      }

      // Compute sanitized patch and compose optimistically onto latest state
      const sanitized: Record<string, (number | null)[]> = {}
      const optimisticFromEv = applyPatch(ev)
      for (const t of optimisticFromEv.teams) {
        if (t.cardId === cardId && teamHoles[t.id]) {
          sanitized[t.id] = t.holes
        }
      }
      setEvents(prev =>
        sortSpecialEvents(
          prev.map(item => (item.id === eventId ? applyCardHoleScores(item, cardId, sanitized) : item)),
        ),
      )

      const queueKey = `${eventId}:${cardId}`
      pendingCardWritesRef.current.set(queueKey, (pendingCardWritesRef.current.get(queueKey) ?? 0) + 1)
      totalPendingScoreWritesRef.current += 1

      const prior = cardWriteQueueRef.current.get(queueKey) ?? Promise.resolve()
      const task = prior
        .catch(() => undefined)
        .then(async (): Promise<boolean> => {
          try {
            let effectivePin =
              cachedPin || (isAdmin ? adminPinsRef.current[eventId]?.[cardId] : undefined)
            if (isAdmin && !effectivePin) {
              const loaded = await fetchServerPins(eventId)
              effectivePin = loaded?.[cardId]
            }

            if (isAdmin && !effectivePin) {
              const fallbackState = applyCardHoleScores(ev, cardId, sanitized)
              const { error } = await supabase
                .from('pp_special_events')
                .update({
                  state: fallbackState,
                  updated_at: fallbackState.updatedAt,
                })
                .eq('id', eventId)
              if (error) {
                console.error(error.message)
                reportError(friendlyError(error.message))
                void reload()
                return false
              }
              return true
            }

            if (!effectivePin) {
              reportError('Enter the 4-digit Card PIN to submit scores.')
              void reload()
              return false
            }

            const { data, error } = await supabase.rpc('pp_submit_special_card_scores', {
              p_event_id: eventId,
              p_card_id: cardId,
              p_pin: effectivePin,
              p_team_holes: sanitized,
            })

            if (error) {
              console.error(error.message)
              if (/invalid.*pin|pin/i.test(error.message)) {
                const nextMap = { ...readSessionUnlockedPins() }
                delete nextMap[queueKey]
                writeSessionUnlockedPins(nextMap)
                setUnlockedSessionPins(nextMap)
                reportError('That Card PIN is no longer valid. Re-enter the PIN from the director.')
              } else {
                reportError(friendlyError(error.message))
              }
              void reload()
              return false
            }

            const remaining = (pendingCardWritesRef.current.get(queueKey) ?? 1) - 1
            if (remaining <= 0 && data && typeof data === 'object') {
              const updated = normalizeSpecialEvent(data as SpecialEvent)
              setEvents(prev => sortSpecialEvents([...prev.filter(e => e.id !== eventId), updated]))
            }
            return true
          } finally {
            const left = Math.max(0, (pendingCardWritesRef.current.get(queueKey) ?? 1) - 1)
            if (left === 0) pendingCardWritesRef.current.delete(queueKey)
            else pendingCardWritesRef.current.set(queueKey, left)
            totalPendingScoreWritesRef.current = Math.max(0, totalPendingScoreWritesRef.current - 1)
          }
        })

      cardWriteQueueRef.current.set(queueKey, task)
      return task
    },
    [events, storageMode, isAdmin, unlockedSessionPins, fetchServerPins, reload],
  )

  const syncLocalToSupabase = useCallback(async () => {
    if (!isAdmin || storageMode !== 'supabase') return
    const localList = readLocalEvents()
    const remoteIds = new Set(events.map(e => e.id))
    const pending = localList.filter(e => !remoteIds.has(e.id))
    if (pending.length === 0) return

    const pinsMap = readLocalPinsMap()
    const syncedIds = new Set<string>()

    for (const ev of pending) {
      const { error } = await supabase.from('pp_special_events').upsert({
        id: ev.id,
        name: ev.name,
        event_date: ev.eventDate,
        status: ev.status,
        state: ev,
        updated_at: ev.updatedAt || new Date().toISOString(),
      })
      if (error) {
        console.error(error.message)
        reportError(friendlyError(error.message))
        return
      }
      const evPins = pinsMap[ev.id] ?? (ev.cards.length ? generateCardPins(ev.cards) : {})
      if (Object.keys(evPins).length > 0) {
        const { error: pinErr } = await supabase.rpc('pp_set_special_card_pins', {
          p_event_id: ev.id,
          p_pins: evPins,
        })
        if (pinErr) {
          console.error(pinErr.message)
          reportError(friendlyError(pinErr.message))
          return
        }
      }
      syncedIds.add(ev.id)
    }

    const remainingLocal = localList.filter(e => !syncedIds.has(e.id))
    writeLocalEvents(remainingLocal)
    for (const id of syncedIds) delete pinsMap[id]
    writeLocalPinsMap(pinsMap)
    setLocalDraftCount(remainingLocal.length)
    await reload()
    reportInfo(`Synced ${syncedIds.size} special event${syncedIds.size === 1 ? '' : 's'} to Supabase.`)
  }, [isAdmin, storageMode, events, reload])

  const value = useMemo<SpecialEventsContextValue>(
    () => ({
      loading,
      storageMode,
      events,
      activeEvent,
      liveSpecialEvent,
      selectedEventId,
      selectEvent: setSelectedEventId,
      cardPins,
      hasUnsyncedLocalEvents,
      syncLocalToSupabase,
      reload,
      saveEvent,
      deleteEvent,
      regenerateCardPin,
      unlockCardWithPin,
      isCardUnlocked,
      submitCardHoleScores,
    }),
    [
      loading,
      storageMode,
      events,
      activeEvent,
      liveSpecialEvent,
      selectedEventId,
      cardPins,
      hasUnsyncedLocalEvents,
      syncLocalToSupabase,
      reload,
      saveEvent,
      deleteEvent,
      regenerateCardPin,
      unlockCardWithPin,
      isCardUnlocked,
      submitCardHoleScores,
    ],
  )

  return <SpecialEventsCtx.Provider value={value}>{children}</SpecialEventsCtx.Provider>
}

export function useSpecialEvents() {
  const ctx = useContext(SpecialEventsCtx)
  if (!ctx) throw new Error('useSpecialEvents must be used inside SpecialEventsProvider')
  return ctx
}
