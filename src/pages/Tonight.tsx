import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Check,
  ChevronRight,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Trophy,
  UserPlus,
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
  type Player,
  type PPEvent,
} from '../lib/types'
import { byEntryOrder, cents, effectiveCut, qualifiers, suggestedCut, totals, type Ranked } from '../lib/scoring'
import { balances, divisionResult, eventMoney, nightBonusCost, payoutPool, suggestedPaidPlaces, suggestedPayouts } from '../lib/money'
import { duplicateName, friendlyError, normalizeName, parseTag, payoutIssue, tagTakenTonight } from '../lib/validation'
import { Dialog, DivisionSeg, Menu, MoneyInput, PageHead, ScoreInput, Stat, money, ordinal } from '../components/ui'

const STEPS: { status: EventStatus; label: string }[] = [
  { status: 'checkin', label: '1. Check-in' },
  { status: 'scoring', label: '2. 18 Holes' },
  { status: 'final9', label: '3. Final 9' },
  { status: 'results', label: '4. Results & Payouts' },
]

const DIVS: Division[] = ['M', 'W']

export default function Tonight() {
  const data = useData()
  const {
    isAdmin, season, settings, liveEvent, events, viewEventId, openEvent,
    entries, players, playerById, tags, ledger, records, reload, patchEntry, patchEvent,
  } = data

  const event = (viewEventId ? events.find(e => e.id === viewEventId) : null) ?? liveEvent

  const [division, setDivision] = useState<Division>('M')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null)
  const [addPlayerOpen, setAddPlayerOpen] = useState(false)
  const [searchName, setSearchName] = useState('')
  const [createError, setCreateError] = useState('')
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [barError, setBarError] = useState('')
  const [extraPlaces, setExtraPlaces] = useState<{ key: string; n: number }>({ key: '', n: 0 })
  const [cutOverride, setCutOverride] = useState<{ key: string; value: number } | null>(null)

  const checkingIn = useRef(new Set<string>())
  const prefilled = useRef(new Set<string>())
  const defaultedCut = useRef(new Set<string>())
  const cutRef = useRef<Partial<Record<Division, number>>>({})
  const queue = useRef(Promise.resolve())
  const entriesRef = useRef(entries)
  const settingsRef = useRef(settings)
  useEffect(() => { entriesRef.current = entries }, [entries])
  useEffect(() => { settingsRef.current = settings }, [settings])

  const divEntries = useMemo(
    () => entries.filter(e => e.event_id === event?.id && e.division === division),
    [entries, event?.id, division],
  )
  const orderedEntries = useMemo(() => [...divEntries].sort(byEntryOrder), [divEntries])

  const counts = useMemo(() => {
    const active = entries.filter(e => e.event_id === event?.id)
    return {
      M: active.filter(e => e.division === 'M').length,
      W: active.filter(e => e.division === 'W').length,
    }
  }, [entries, event?.id])

  const moneyCalc = useMemo(() => eventMoney(counts, settings), [counts, settings])
  const barOf = (ev: PPEvent, d: Division) => {
    const n = Number(d === 'M' ? ev.bar_match_men : ev.bar_match_women)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const barAmount = event ? barOf(event, division) : 0
  const bonusCost = useMemo(() => nightBonusCost(divEntries, settings), [divEntries, settings])
  const pool = useMemo(
    () => payoutPool(counts[division], barAmount, settings, bonusCost),
    [counts, division, barAmount, settings, bonusCost],
  )
  const curBalances = useMemo(() => balances(ledger, division), [ledger, division])
  const payoutsList = useMemo(
    () => (division === 'M' ? event?.payouts_men : event?.payouts_women) ?? [],
    [division, event?.payouts_men, event?.payouts_women],
  )

  const result = useMemo(() => divisionResult({
    division,
    entries: divEntries,
    payoutPlaces: payoutsList,
    settings,
    balances: curBalances,
    barMatch: barAmount,
    priorRecord: records[division],
  }), [division, divEntries, payoutsList, settings, curBalances, barAmount, records])

  const rankedById = useMemo(() => new Map(result.ranked.map(r => [r.entry.id, r])), [result])

  const placeKey = `${event?.id ?? ''}|${division}`
  const extraCount = extraPlaces.key === placeKey ? extraPlaces.n : 0

  // Suggest payouts the first time a night reaches results, instead of leaving every place at $0.
  useEffect(() => {
    if (!event || event.status !== 'results' || !isAdmin) return
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
      const rawBar = Number(d === 'M' ? event.bar_match_men : event.bar_match_women)
      const bar = Number.isFinite(rawBar) && rawBar > 0 ? rawBar : 0
      const net = payoutPool(group.length, bar, settings, nightBonusCost(group, settings))
      const next = suggestedPayouts(net, suggestedPaidPlaces(group.length, settings))
      if (d === 'M') patch.payouts_men = next
      else patch.payouts_women = next
    }
    if (patch.payouts_men || patch.payouts_women) void patchEvent(event.id, patch)
  }, [event, entries, isAdmin, settings, patchEvent])

  // A women's cut saved as 0 (empty field at the time, or half of one player
  // rounded down) stays 0 after players arrive, so nobody makes the final.
  // Fill a sensible half-field cut once and mark those qualifiers.
  useEffect(() => {
    if (!event || event.status !== 'final9' || !isAdmin) return
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
      <div>
        <PageHead title="Tonight's Tournament" eyebrow="Putts & Pints">
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => {
              if (!season) {
                reportError('Create or activate a season first, on the Season page.')
                return
              }
              setEventName('')
              setEventDate(new Date().toISOString().slice(0, 10))
              setStartOpen(true)
            }}>
              <Plus size={16} /> Start New Event
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
                bar_match_men: moneyCalc.barSplit.M,
                bar_match_women: moneyCalc.barSplit.W,
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
  const placeRows = Math.max(payoutsList.length, suggestedPlaces, extraCount, counts[division] ? 1 : 0)
  const allocated = cents(payoutsList.reduce((a, b) => a + Number(b), 0))
  const overPool = payoutIssue(payoutsList, pool) === 'over'

  const handleContextMenu = (e: MouseEvent, entry: Entry) => {
    if (!isAdmin || event.status === 'complete') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const toggleAward = async (award: Award) => {
    if (!contextMenu) return
    const cur = contextMenu.entry.awards || []
    const next = cur.includes(award) ? cur.filter(a => a !== award) : [...cur, award]
    await patchEntry(contextMenu.entry.id, { awards: next })
    setContextMenu(null)
  }

  const handleCheckinPlayer = async (pId: string, pDiv: Division) => {
    if (checkingIn.current.has(pId)) return
    if (entries.some(e => e.event_id === event.id && e.player_id === pId)) return
    checkingIn.current.add(pId)
    try {
      const currentTag = tags.find(t => t.player_id === pId)?.tag_number ?? null
      const { error } = await supabase.from('pp_entries').upsert({
        event_id: event.id,
        player_id: pId,
        division: pDiv,
        paid: true,
        tag_in: currentTag,
        awards: [],
      }, { onConflict: 'event_id,player_id', ignoreDuplicates: true })
      if (error) {
        console.error(error.message)
        const message = friendlyError(error.message)
        reportError(message)
        setCreateError(message)
        return
      }
      setAddPlayerOpen(false)
      setSearchName('')
      setCreateError('')
      await reload()
    } finally {
      checkingIn.current.delete(pId)
    }
  }

  const handleCreateAndCheckin = async (name: string, pDiv: Division) => {
    const clean = normalizeName(name)
    if (!clean) { setCreateError('Enter a player name.'); return }
    if (duplicateName(clean, players)) { setCreateError(`“${clean}” is already on the roster.`); return }
    setCreateError('')
    try {
      const created = await must(
        supabase.from('pp_players').insert({ name: clean, division: pDiv, active: true }).select().single(),
      )
      await handleCheckinPlayer(created.id, pDiv)
    } catch (err) {
      setCreateError(messageOf(err))
    }
  }

  const setStatus = (status: EventStatus) => patchEvent(event.id, { status })

  const applyCut = async (cut: number, field: Entry[]) => {
    const ids = qualifiers(field, cut, settingsRef.current)
    for (const ent of field) {
      const should = ids.has(ent.id)
      if (ent.made_final !== should) await patchEntry(ent.id, { made_final: should })
    }
  }

  const applyCutAndProceed = async () => {
    const patch: Partial<PPEvent> = { status: 'final9' }
    for (const d of DIVS) {
      const field = entries.filter(e => e.event_id === event.id && e.division === d)
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

  const savePayout = (idx: number, val: number) => {
    const next = Array.from({ length: Math.max(payoutsList.length, idx + 1) }, (_, i) => Number(payoutsList[i] ?? 0))
    next[idx] = val
    while (next.length > 0 && next[next.length - 1] === 0) next.pop()
    // Rejected amounts are not stored, so the field snaps back. Don't keep a
    // message that still describes the number the director just left.
    if (payoutIssue(next, pool)) return
    void patchEvent(event.id, division === 'M' ? { payouts_men: next } : { payouts_women: next })
  }

  const useSuggested = () => {
    // Split across the place rows on screen, not the default "one per five".
    const next = suggestedPayouts(pool, placeRows)
    void patchEvent(event.id, division === 'M' ? { payouts_men: next } : { payouts_women: next })
  }

  const divisionPayouts = (ev: PPEvent, d: Division) => {
    const stored = d === 'M' ? ev.payouts_men ?? [] : ev.payouts_women ?? []
    if (stored.length > 0) return stored.map(n => Number(n))
    const group = entries.filter(e => e.event_id === ev.id && e.division === d)
    return suggestedPayouts(payoutPool(group.length, barOf(ev, d), settings, nightBonusCost(group, settings)), suggestedPaidPlaces(group.length, settings))
  }

  const handleFinalize = async () => {
    for (const d of DIVS) {
      const group = entries.filter(e => e.event_id === event.id && e.division === d)
      const list = divisionPayouts(event, d)
      const net = payoutPool(group.length, barOf(event, d), settings, nightBonusCost(group, settings))
      if (payoutIssue(list, net)) {
        reportError(`${d === 'M' ? "Men's" : "Women's"} payouts are over the pool or include a negative. Fix them before finalizing.`)
        return
      }
    }
    const ok = await askConfirm(
      'This locks scores and posts the purse, bar match, payouts, and pot records. Finalizing again later replaces this night’s ledger rows.',
      { title: 'Finalize tonight?', confirmLabel: 'Finalize & post' },
    )
    if (!ok) return
    setIsFinalizing(true)
    try {
      const lists = { M: divisionPayouts(event, 'M'), W: divisionPayouts(event, 'W') }
      if ((event.payouts_men ?? []).length === 0 || (event.payouts_women ?? []).length === 0) {
        await patchEvent(event.id, { payouts_men: lists.M, payouts_women: lists.W })
      }
      const rows: Record<string, unknown>[] = []
      const plans = DIVS.map(d => {
        const group = entries.filter(e => e.event_id === event.id && e.division === d)
        return divisionResult({
          division: d,
          entries: group,
          payoutPlaces: lists[d],
          settings,
          balances: balances(ledger, d),
          barMatch: barOf(event, d),
          priorRecord: records[d],
        })
      })
      plans.forEach((plan, i) => {
        const d = DIVS[i]
        for (const r of plan.ledger) {
          rows.push({
            season_id: season!.id,
            event_id: event.id,
            division: d,
            fund: r.fund,
            kind: r.kind,
            amount: r.amount,
            note: r.note,
            player_id: r.player_id,
          })
        }
      })
      await must(supabase.from('pp_ledger').delete().eq('event_id', event.id))
      if (rows.length) await must(supabase.from('pp_ledger').insert(rows))

      for (let i = 0; i < plans.length; i++) {
        const plan = plans[i]
        for (const r of plan.ranked) {
          const ent = r.entry
          const tagOut = plan.tagsOut.get(ent.id) ?? ent.tag_in
          await must(supabase.from('pp_entries').update({
            place: r.place > 0 ? r.place : null,
            payout: plan.payouts.get(ent.id) ?? 0,
            points: plan.points.get(ent.id) ?? 0,
            tag_out: tagOut,
          }).eq('id', ent.id))
          if (tagOut != null && season) {
            const { error } = await supabase.from('pp_tags').upsert(
              { season_id: season.id, player_id: ent.player_id, tag_number: tagOut },
              { onConflict: 'season_id,player_id' },
            )
            if (error) {
              console.error(error.message)
              reportError(friendlyError(error.message))
            }
          }
        }
      }

      await patchEvent(event.id, { status: 'complete' })
      reportInfo('Event finalized. Payouts and pots are on the ledger.')
      reload()
    } catch {
      // must() already showed a readable message
    } finally {
      setIsFinalizing(false)
    }
  }

  const viewingOther = viewEventId != null && liveEvent != null && viewEventId !== liveEvent.id
  const eventLabel = event.name?.trim() || 'Tonight’s Tournament'

  return (
    <div className="tonight-page">
      <PageHead
        eyebrow={`${event.name?.trim() ? `${event.name.trim()} · ` : ''}${event.event_date} · ${event.status}`}
        title={eventLabel}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <DivisionSeg value={division} onChange={d => { setBarError(''); setDivision(d) }} counts={counts} />
          {viewingOther && (
            <button className="btn btn-ghost btn-sm" onClick={() => openEvent(null)}>Back to tonight</button>
          )}
          {isAdmin && event.status === 'complete' && (
            <button className="btn btn-ghost btn-sm" onClick={async () => {
              const ok = await askConfirm(
                'Scores can be edited again. Finalizing a second time replaces this night’s ledger rows.',
                { title: 'Reopen event?', confirmLabel: 'Reopen' },
              )
              if (ok) await patchEvent(event.id, { status: 'results' })
            }}>
              <RotateCcw size={14} /> Reopen Event
            </button>
          )}
        </div>
      </PageHead>

      <div className="stats section">
        <Stat label={`${division === 'M' ? "Men's" : "Women's"} Field`} value={divEntries.length} sub="Players checked in" />
        <Stat
          label="Payout Pool"
          value={money(pool)}
          sub={bonusCost > 0
            ? `${money(settings.entryFee - settings.perfectRoundShare)}/player + ${money(barAmount)} bar − ${money(bonusCost)} bonuses`
            : `${money(settings.entryFee - settings.perfectRoundShare)}/player + ${money(barAmount)} bar`}
        />
        <Stat
          label="Perfect Round Pot"
          value={money(event.status === 'results' || event.status === 'complete' ? result.potAfterEntries : curBalances.perfect_round)}
          sub={event.status === 'results' || event.status === 'complete'
            ? `After tonight’s $2 per entry · Backup ${money(curBalances.backup)} · cap $${settings.perfectRoundCap}`
            : `Backup Pot: ${money(curBalances.backup)} (Cap $${settings.perfectRoundCap})`}
        />
        <Stat
          label="Score To Beat"
          value={records[division] != null ? `${records[division]} pts` : 'No record yet'}
          sub="Beating this wins the high-score bonus"
        />
      </div>

      {isAdmin && event.status !== 'complete' && (
        <div className="steps">
          {STEPS.map(s => (
            <button key={s.status} className={event.status === s.status ? 'on' : ''} onClick={() => setStatus(s.status)}>
              <span className="step-n">{s.label.slice(0, 1)}</span>
              {s.label.slice(3)}
            </button>
          ))}
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
            <button className="btn btn-primary" onClick={() => { setCreateError(''); setAddPlayerOpen(true) }}>
              <UserPlus size={16} /> Check In Player
            </button>
          </div>

          <div className="grid-2">
            <div className="panel">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>Player Name</th>
                      <th className="c" style={{ width: 110 }}>Tag In</th>
                      <th className="c" style={{ width: 80 }}>Paid ($10)</th>
                      <th className="r" style={{ width: 80 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedEntries.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '36px 0' }} className="muted">
                          No players checked into this division yet.
                        </td>
                      </tr>
                    ) : orderedEntries.map((ent, i) => {
                      const p = playerById.get(ent.player_id)
                      return (
                        <tr key={ent.id}>
                          <td className="faint">{i + 1}</td>
                          <td className="strong">{p?.name ?? 'Unknown Player'}</td>
                          <td className="c">
                            <TagInCell
                              entry={ent}
                              name={p?.name ?? 'player'}
                              siblings={nightEntries}
                              onCommit={tag => patchEntry(ent.id, { tag_in: tag })}
                            />
                          </td>
                          <td className="c">
                            <button className={`btn btn-sm ${ent.paid ? 'btn-ghost' : 'btn-danger'}`} onClick={() => patchEntry(ent.id, { paid: !ent.paid })}>
                              {ent.paid ? <Check size={14} color="var(--teal)" /> : 'Unpaid'}
                            </button>
                          </td>
                          <td className="r">
                            <button className="btn btn-ghost btn-sm btn-danger" onClick={async () => {
                              const ok = await askConfirm(`Remove ${p?.name ?? 'this player'} from tonight?`, { title: 'Remove player', confirmLabel: 'Remove', danger: true })
                              if (!ok) return
                              await must(supabase.from('pp_entries').delete().eq('id', ent.id))
                              reload()
                            }}>
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

            <div className="panel panel-pad stack">
              <div className="eyebrow">Night Finances & Match</div>
              <div className="kv"><dt>Total Field (Both Divs)</dt><dd>{counts.M + counts.W} players</dd></div>
              <div className="kv"><dt>Combined Entry Pot</dt><dd>{money(moneyCalc.totalPot)}</dd></div>
              <div className="kv"><dt>Bar Half Match ({settings.barMatchPct}%)</dt><dd style={{ color: 'var(--orange)' }}>+{money(moneyCalc.barMatch)}</dd></div>
              <div style={{ marginTop: 14 }} className="field">
                <span>{division === 'M' ? "Men's" : "Women's"} Bar Match Contribution</span>
                <MoneyInput
                  value={barAmount}
                  aria-label={`${division === 'M' ? "Men's" : "Women's"} bar match`}
                  onReject={setBarError}
                  onChange={val => {
                    setBarError('')
                    void patchEvent(event.id, division === 'M' ? { bar_match_men: val } : { bar_match_women: val })
                  }}
                />
                {barError && <small className="field-error">{barError}</small>}
                <small>Suggested proportional split: {money(moneyCalc.barSplit[division])}</small>
              </div>
              <button style={{ marginTop: 16 }} className="btn btn-primary btn-block" disabled={divEntries.length === 0} onClick={() => setStatus('scoring')}>
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
                Basket 1 is 0–30, Basket 2 is 0–20. Rows stay in check-in order while you type. Right-click a player to award a bonus.
              </p>
            </div>
            <button className="btn btn-primary" onClick={applyCutAndProceed}>
              Go to The Cut & Final 9 <ChevronRight size={16} />
            </button>
          </div>
          <ScoreTable
            rows={orderedEntries}
            rankedById={rankedById}
            playerById={playerById}
            mode="18"
            onContextMenu={handleContextMenu}
            onScore={(id, patch) => patchEntry(id, patch)}
          />
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
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="row" role="group" aria-labelledby="final-cut-label" style={{ background: 'var(--surface-1)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <span id="final-cut-label" className="eyebrow" style={{ marginRight: 6 }}>Qualifiers cut</span>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Fewer qualifiers" onClick={() => stepCut(-1)} disabled={shownCut <= 1}>
                  <Minus size={14} />
                </button>
                <span className="num strong" style={{ margin: '0 8px', fontSize: 16, minWidth: 16, textAlign: 'center' }} aria-live="polite" aria-atomic="true">
                  {shownCut}
                </span>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="More qualifiers" onClick={() => stepCut(1)} disabled={shownCut >= Math.max(1, divEntries.length)}>
                  <Plus size={14} />
                </button>
              </div>
              <button className="btn btn-primary" onClick={() => setStatus('results')}>
                Advance to Results <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <ScoreTable
            rows={orderedEntries}
            rankedById={rankedById}
            playerById={playerById}
            mode="final"
            onContextMenu={handleContextMenu}
            onScore={(id, patch) => patchEntry(id, patch)}
            onToggleFinal={entry => patchEntry(entry.id, { made_final: !entry.made_final })}
          />
        </div>
      )}

      {(event.status === 'results' || event.status === 'complete' || !isAdmin) && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">
                {event.status === 'complete' ? 'Official Results & Standings' : 'Night Results & Payouts'}
              </h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Placements, prize checks, tag moves, and season points. Unfinished rows stay unplaced.
              </p>
            </div>
            {isAdmin && event.status !== 'complete' && (
              <button className="btn btn-primary" disabled={isFinalizing || overPool} onClick={handleFinalize}>
                <Lock size={16} /> {isFinalizing ? 'Finalizing...' : 'Finalize & Post Event'}
              </button>
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
                      const tagOut = result.tagsOut.get(ent.id) ?? ent.tag_in
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
                            {ent.tag_in != null ? <span>#{ent.tag_in} → <strong style={{ color: 'var(--text)' }}>#{tagOut}</strong></span> : 'No tag'}
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
              <div className="kv">
                <dt>Left in the purse</dt>
                <dd style={{ color: pool - allocated < -0.001 ? 'var(--danger)' : 'var(--text)' }}>{money(cents(pool - allocated))}</dd>
              </div>

              {isAdmin && event.status !== 'complete' && (
                <div style={{ marginTop: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Place payout amounts</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={useSuggested}>Use suggested</button>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    {Array.from({ length: placeRows }, (_, idx) => (
                      <div key={idx} className="row" style={{ justifyContent: 'space-between' }}>
                        <span className="muted" style={{ fontSize: 12 }}>{ordinal(idx + 1)} place</span>
                        <div style={{ width: 120 }}>
                          <MoneyInput
                            value={Number(payoutsList[idx] ?? 0)}
                            aria-label={`${ordinal(idx + 1)} place payout`}
                            silentInvalid
                            onChange={val => savePayout(idx, val)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {counts[division] > placeRows && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setExtraPlaces({ key: placeKey, n: placeRows + 1 })}>
                      <Plus size={14} /> Add a paid place
                    </button>
                  )}
                  {overPool && (
                    <small className="field-error">
                      Payouts add up to {money(allocated)}, which is more than the {money(pool)} pool.
                    </small>
                  )}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Tonight's Bonus Winners</div>
                {result.bonuses.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>No bonus awards assigned tonight.</p>
                ) : result.bonuses.map(b => (
                  <div key={b.type} className="kv">
                    <dt>{AWARD_LABEL[b.type]}</dt>
                    <dd style={{ color: 'var(--orange)' }}>
                      {money(b.each)}
                      {b.type === 'perfect_round' ? ' from the pot' : ''}
                      {b.entryIds.length > 1 ? ` (${b.entryIds.length} split)` : ''}
                    </dd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <Menu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <div className="menu-label eyebrow">Award Bonuses: {playerById.get(contextMenu.entry.player_id)?.name}</div>
          {contextMenu.entry.tag_in == null && (
            <div className="menu-note muted" style={{ color: 'var(--danger)', fontSize: 11, padding: '4px 10px' }}>
              Player does not hold a tag (ineligible for bonuses per rules).
            </div>
          )}
          {AWARDS.map(a => {
            const has = contextMenu.entry.awards?.includes(a)
            return (
              <button key={a} className={has ? 'on' : ''} onClick={() => toggleAward(a)}>
                <span className="check">{has ? <Check size={14} /> : null}</span>
                <span>{AWARD_LABEL[a]}</span>
                <span className="hint">
                  {a === 'perfect_round' ? money(result.potAfterEntries)
                    : a === 'high_score' ? money(settings.bonus.highScore)
                    : a === 'perfect5' ? money(settings.bonus.perfect5)
                    : money(settings.bonus.perfect4)}
                </span>
              </button>
            )
          })}
        </Menu>
      )}

      {addPlayerOpen && (
        <Dialog title="Check In Player" onClose={() => { setAddPlayerOpen(false); setCreateError('') }}>
          <div className="stack">
            <div className="field">
              <span>Search Roster</span>
              <input className="input" type="text" placeholder="Type player name..." autoFocus value={searchName} onChange={e => { setSearchName(e.target.value); setCreateError('') }} />
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
              <button className="btn btn-primary btn-block" onClick={() => handleCreateAndCheckin(searchName, division)}>
                <Plus size={14} /> Create &amp; Check In "{normalizeName(searchName)}"
              </button>
            )}
            {searchName.trim() && duplicateName(searchName, players) && !players.some(p => p.division === division && normalizeName(p.name).toLowerCase() === normalizeName(searchName).toLowerCase()) && (
              <small className="field-error">That name is already on the roster.</small>
            )}
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

function TagInCell({ entry, name, siblings, onCommit }: {
  entry: Entry
  name: string
  siblings: Entry[]
  onCommit: (tag: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = draft ?? (entry.tag_in ?? '')
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

function ScoreTable({ rows, rankedById, playerById, mode, onContextMenu, onScore, onToggleFinal }: {
  rows: Entry[]
  rankedById: Map<string, Ranked>
  playerById: Map<string, Player>
  mode: '18' | 'final'
  onContextMenu: (e: MouseEvent, entry: Entry) => void
  onScore: (id: string, patch: Partial<Entry>) => void
  onToggleFinal?: (entry: Entry) => void
}) {
  return (
    <div className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            {mode === '18' ? (
              <>
                <tr>
                  <th style={{ width: 45 }}>Plc</th>
                  <th>Player</th>
                  <th className="c">Tag</th>
                  <th className="group bl" colSpan={3}>Round 1 (First 9)</th>
                  <th className="group bl" colSpan={3}>Round 2 (Second 9)</th>
                  <th className="group bl" style={{ width: 80 }}>18 Total</th>
                  <th className="c bl" style={{ width: 140 }}>Awards</th>
                </tr>
                <tr>
                  <th></th><th></th><th></th>
                  <th className="c bl" style={{ width: 55 }}>B1 (30)</th>
                  <th className="c" style={{ width: 55 }}>B2 (20)</th>
                  <th className="c" style={{ width: 50 }}>9-1</th>
                  <th className="c bl" style={{ width: 55 }}>B1 (30)</th>
                  <th className="c" style={{ width: 55 }}>B2 (20)</th>
                  <th className="c" style={{ width: 50 }}>9-2</th>
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
                  <th className="group bl" colSpan={3}>Final 9</th>
                  <th className="c bl" style={{ width: 90 }}>27 Total</th>
                </tr>
                <tr>
                  <th></th><th></th><th></th>
                  <th className="c bl" title="18 holes, 100 points maximum">/ 100</th>
                  <th className="c bl" style={{ width: 65 }}>B1 (30)</th>
                  <th className="c" style={{ width: 65 }}>B2 (20)</th>
                  <th className="c" title="Final 9, 50 points maximum">/ 50</th>
                  <th className="c bl" title="18 holes plus Final 9, 150 points maximum">/ 150</th>
                </tr>
              </>
            )}
          </thead>
          <tbody>
            {rows.map(ent => {
              const ranked = rankedById.get(ent.id)
              const t = ranked?.totals ?? totals(ent)
              const place = ranked && ranked.place > 0 ? ranked.place : null
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
                    <td className="c faint">{ent.tag_in ? `#${ent.tag_in}` : '—'}</td>
                    <td className="c bl"><ScoreInput value={ent.r1_b1} max={30} onCommit={n => onScore(ent.id, { r1_b1: n })} /></td>
                    <td className="c"><ScoreInput value={ent.r1_b2} max={20} onCommit={n => onScore(ent.id, { r1_b2: n })} /></td>
                    <td className="c sub-total">{t.r1 ?? '—'}</td>
                    <td className="c bl"><ScoreInput value={ent.r2_b1} max={30} onCommit={n => onScore(ent.id, { r2_b1: n })} /></td>
                    <td className="c"><ScoreInput value={ent.r2_b2} max={20} onCommit={n => onScore(ent.id, { r2_b2: n })} /></td>
                    <td className="c sub-total">{t.r2 ?? '—'}</td>
                    <td className="c bl big" style={{ color: t.t18 != null ? 'var(--orange)' : 'var(--text-3)' }}>{t.t18 ?? '—'}</td>
                    <td className="c bl">
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={e => onContextMenu(e, ent)}>
                        <Sparkles size={12} /> Awards
                      </button>
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={ent.id} onContextMenu={e => onContextMenu(e, ent)} className={`${!ent.made_final ? 'out' : ''} ${place === 1 ? 'leader' : ''}`}>
                  <td className="place">{place ?? '—'}</td>
                  <td className="strong">{p?.name}</td>
                  <td className="c">
                    <button className="btn btn-sm btn-ghost" style={{ fontSize: 11 }} onClick={() => onToggleFinal?.(ent)}>
                      {ent.made_final ? <span className="chip chip-teal">Finalist</span> : <span className="faint">Cut</span>}
                    </button>
                  </td>
                  <td className="c bl strong">{t.t18 ?? '—'}</td>
                  <td className="c bl"><ScoreInput value={ent.f_b1} max={30} disabled={!ent.made_final} onCommit={n => onScore(ent.id, { f_b1: n })} /></td>
                  <td className="c"><ScoreInput value={ent.f_b2} max={20} disabled={!ent.made_final} onCommit={n => onScore(ent.id, { f_b2: n })} /></td>
                  <td className="c sub-total">{ent.made_final ? t.f ?? '—' : '—'}</td>
                  <td className="c bl big" style={{ color: t.total != null ? 'var(--orange)' : 'var(--text-3)' }}>{t.total ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
