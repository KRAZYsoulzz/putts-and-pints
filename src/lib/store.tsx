import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { resolveSettings } from './settings'
import { totals } from './scoring'
import { reportError } from './notify'
import { friendlyError } from './validation'
import type { Division, Entry, LedgerRow, PPEvent, Player, Season, Settings, Tag } from './types'

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
  reload: () => Promise<void>
  patchEntry: (id: string, patch: Partial<Entry>) => Promise<void>
  patchEvent: (id: string, patch: Partial<PPEvent>) => Promise<void>
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
  const money = (n: number) => {
    const v = Number(n)
    return Number.isFinite(v) ? v : 0
  }
  return { ...row, bar_match_men: money(row.bar_match_men), bar_match_women: money(row.bar_match_women), payouts_men: nums(row.payouts_men), payouts_women: nums(row.payouts_women) }
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
  useEffect(() => {
    let cancelled = false
    let generation = 0
    const timers = new Set<number>()

    const applySession = (next: Session | null) => {
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

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) applySession(data.session)
    })
    const { data: auth } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!cancelled) applySession(next)
    })
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
  const seasonsRef = useRef(seasons)
  useEffect(() => { seasonsRef.current = seasons }, [seasons])

  const reload = useCallback(async () => {
    if (writes.current > 0) { reloadQueued.current = true; return }
    const gen = ++reloadGen.current
    const [s, p] = await Promise.all([
      supabase.from('pp_seasons').select('*').order('created_at'),
      supabase.from('pp_players').select('*').order('name'),
    ])
    if (gen !== reloadGen.current) return
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
      const evs = (ev.data ?? []) as PPEvent[]
      const en = evs.length
        ? await supabase.from('pp_entries').select('*').in('event_id', evs.map(e => e.id)).order('created_at')
        : { data: [] }
      nextTags = (t.data ?? []) as Tag[]
      nextEvents = evs.map(normalizeEvent)
      nextEntries = (en.data ?? []) as Entry[]
      nextLedger = (l.data ?? []) as LedgerRow[]
    }
    if (gen !== reloadGen.current) return
    if (writes.current > 0) { reloadQueued.current = true; return }

    setSeasons(allSeasons)
    setPlayers(allPlayers)
    setTags(nextTags)
    setEvents(nextEvents)
    setEntries(nextEntries)
    setLedger(nextLedger)
    setLoading(false)
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

  // Live updates (debounced) so the public view follows along -----------------
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const ch = supabase.channel('pp-live')
    for (const table of ['pp_events', 'pp_entries', 'pp_ledger', 'pp_players', 'pp_tags']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { void reload() }, 500)
      })
    }
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [reload])

  const patchEntry = useCallback(async (id: string, patch: Partial<Entry>) => {
    if (!isAdmin) return
    writes.current += 1
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)))
    const { error } = await supabase.from('pp_entries').update(patch).eq('id', id)
    if (error) {
      console.error(error.message)
      reportError(friendlyError(error.message))
    }
    finishWrite(!!error)
  }, [isAdmin, finishWrite])

  const patchEvent = useCallback(async (id: string, patch: Partial<PPEvent>) => {
    if (!isAdmin) return
    writes.current += 1
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)))
    const { error } = await supabase.from('pp_events').update(patch).eq('id', id)
    if (error) {
      console.error(error.message)
      reportError(friendlyError(error.message))
    }
    finishWrite(!!error)
  }, [isAdmin, finishWrite])

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
    const done = new Set(events.filter(e => e.status === 'complete').map(e => e.id))
    const records: Record<Division, number | null> = { M: null, W: null }
    for (const e of entries) {
      if (!done.has(e.event_id)) continue
      const t = totals(e).total
      if (t != null && (records[e.division] == null || t > (records[e.division] as number))) records[e.division] = t
    }
    return {
      loading, session, isAdmin, seasons, season,
      settings: resolveSettings(season?.settings),
      players, playerById: new Map(players.map(p => [p.id, p])),
      tags, events, entries, ledger,
      liveEvent: [...events].reverse().find(e => e.status !== 'complete') ?? null,
      viewEventId, openEvent,
      records, reload, patchEntry, patchEvent, saveTag, authReady, signOut,
    }
  }, [loading, session, isAdmin, authReady, seasons, players, tags, events, entries, ledger, viewEventId, openEvent, reload, patchEntry, patchEvent, saveTag, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
