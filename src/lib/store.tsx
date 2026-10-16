import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { resolveSettings } from './settings'
import { totals } from './scoring'
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
  /** Best 27-hole total from completed events, per division */
  records: Record<Division, number | null>
  reload: () => Promise<void>
  patchEntry: (id: string, patch: Partial<Entry>) => Promise<void>
  /** True once the first session and director check have finished. */
  authReady: boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<Data | null>(null)

/** Throw-on-error wrapper so every write surfaces problems the same way. */
export async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q
  if (error) { alert(error.message); throw error }
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

  // Load ---------------------------------------------------------------------
  const reload = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from('pp_seasons').select('*').order('created_at'),
      supabase.from('pp_players').select('*').order('name'),
    ])
    const allSeasons = (s.data ?? []) as Season[]
    setSeasons(allSeasons)
    setPlayers((p.data ?? []) as Player[])

    const active = allSeasons.find(x => x.active)
    if (!active) { setTags([]); setEvents([]); setEntries([]); setLedger([]); setLoading(false); return }

    const [t, ev, l] = await Promise.all([
      supabase.from('pp_tags').select('*').eq('season_id', active.id),
      supabase.from('pp_events').select('*').eq('season_id', active.id).order('event_date').order('created_at'),
      supabase.from('pp_ledger').select('*').eq('season_id', active.id).order('created_at'),
    ])
    const evs = (ev.data ?? []) as PPEvent[]
    const en = evs.length
      ? await supabase.from('pp_entries').select('*').in('event_id', evs.map(e => e.id)).order('created_at')
      : { data: [] }
    setTags((t.data ?? []) as Tag[])
    setEvents(evs)
    setEntries((en.data ?? []) as Entry[])
    setLedger((l.data ?? []) as LedgerRow[])
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  // Live updates (debounced) so the public view follows along -----------------
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const ch = supabase.channel('pp-live')
    for (const table of ['pp_events', 'pp_entries', 'pp_ledger']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(reload, 500)
      })
    }
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [reload])

  // Optimistic entry edits (score grid) ---------------------------------------
  const patchEntry = useCallback(async (id: string, patch: Partial<Entry>) => {
    if (!isAdmin) return
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)))
    const { error } = await supabase.from('pp_entries').update(patch).eq('id', id)
    if (error) { alert(error.message); reload() }
  }, [isAdmin, reload])

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
      records, reload, patchEntry, authReady, signOut,
    }
  }, [loading, session, isAdmin, authReady, seasons, players, tags, events, entries, ledger, reload, patchEntry, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
