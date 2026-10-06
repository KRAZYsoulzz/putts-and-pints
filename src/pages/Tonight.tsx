import { useMemo, useState, type MouseEvent } from 'react'
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
import {
  AWARD_LABEL,
  AWARD_SHORT,
  AWARDS,
  type Award,
  type Division,
  type Entry,
  type EventStatus,
} from '../lib/types'
import { suggestedCut, totals } from '../lib/scoring'
import { balances, divisionResult, eventMoney, payoutPool } from '../lib/money'
import { Dialog, DivisionSeg, Menu, MoneyInput, PageHead, Stat, money, ordinal } from '../components/ui'

const STEPS: { status: EventStatus; label: string }[] = [
  { status: 'checkin', label: '1. Check-in' },
  { status: 'scoring', label: '2. 18 Holes' },
  { status: 'final9', label: '3. Final 9' },
  { status: 'results', label: '4. Results & Payouts' },
]

export default function Tonight() {
  const {
    isAdmin,
    season,
    settings,
    liveEvent,
    entries,
    players,
    playerById,
    tags,
    ledger,
    records,
    reload,
    patchEntry,
  } = useData()

  const [division, setDivision] = useState<Division>('M')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null)
  const [addPlayerOpen, setAddPlayerOpen] = useState(false)
  const [searchName, setSearchName] = useState('')
  const [isFinalizing, setIsFinalizing] = useState(false)

  // Current division entries
  const divEntries = useMemo(
    () => entries.filter((e) => e.event_id === liveEvent?.id && e.division === division),
    [entries, liveEvent?.id, division],
  )

  const counts = useMemo(() => {
    const active = entries.filter((e) => e.event_id === liveEvent?.id)
    return {
      M: active.filter((e) => e.division === 'M').length,
      W: active.filter((e) => e.division === 'W').length,
    }
  }, [entries, liveEvent?.id])

  const moneyCalc = useMemo(() => eventMoney(counts, settings), [counts, settings])
  const pool = useMemo(
    () =>
      payoutPool(
        counts[division],
        division === 'M' ? liveEvent?.bar_match_men ?? 0 : liveEvent?.bar_match_women ?? 0,
        settings,
      ),
    [counts, division, liveEvent, settings],
  )

  const curBalances = useMemo(() => balances(ledger, division), [ledger, division])

  // Results calculation for the active division
  const payoutsList = division === 'M' ? liveEvent?.payouts_men ?? [] : liveEvent?.payouts_women ?? []
  const result = useMemo(() => {
    return divisionResult({
      division,
      entries: divEntries,
      payoutPlaces: payoutsList,
      settings,
      balances: curBalances,
      priorRecord: records[division],
    })
  }, [division, divEntries, payoutsList, settings, curBalances, records])

  // If no active event exists
  if (!liveEvent) {
    return (
      <div>
        <PageHead title="Tonight's Tournament" eyebrow="Putts & Pints">
          {isAdmin && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!season) {
                  alert('Please activate or create a season first in Season Management.')
                  return
                }
                await must(
                  supabase
                    .from('pp_events')
                    .insert({
                      season_id: season.id,
                      status: 'checkin',
                      settings_snapshot: settings,
                      bar_match_men: moneyCalc.barSplit.M,
                      bar_match_women: moneyCalc.barSplit.W,
                    })
                    .select()
                    .single(),
                )
                reload()
              }}
            >
              <Plus size={16} /> Start New Event
            </button>
          )}
        </PageHead>

        <div className="empty panel panel-pad">
          <Trophy size={48} color="var(--orange)" />
          <div className="display" style={{ fontSize: 28, marginTop: 12 }}>
            No Tournament In Progress
          </div>
          <p className="muted">
            {isAdmin
              ? 'Click "Start New Event" above to begin check-in, set bar matches, and record scores.'
              : 'Standings and pot balances are available in the sidebar. Check back once tonight starts!'}
          </p>
        </div>
      </div>
    )
  }

  // Handle right click to toggle awards
  const handleContextMenu = (e: MouseEvent, entry: Entry) => {
    if (!isAdmin || liveEvent.status === 'complete') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const toggleAward = async (award: Award) => {
    if (!contextMenu) return
    const cur = contextMenu.entry.awards || []
    const next = cur.includes(award) ? cur.filter((a) => a !== award) : [...cur, award]
    await patchEntry(contextMenu.entry.id, { awards: next })
    setContextMenu(null)
  }

  // Check-in helper: Add player to event
  const handleCheckinPlayer = async (pId: string, pDiv: Division) => {
    // Check if player already registered
    if (entries.some((e) => e.event_id === liveEvent.id && e.player_id === pId)) {
      alert('Player is already checked in.')
      return
    }
    const currentTag = tags.find((t) => t.player_id === pId)?.tag_number ?? null
    await must(
      supabase.from('pp_entries').insert({
        event_id: liveEvent.id,
        player_id: pId,
        division: pDiv,
        paid: true,
        tag_in: currentTag,
        awards: [],
      }),
    )
    setAddPlayerOpen(false)
    setSearchName('')
    reload()
  }

  // Create brand new player & check in
  const handleCreateAndCheckin = async (name: string, pDiv: Division) => {
    if (!name.trim()) return
    const newPlayer = await must(
      supabase
        .from('pp_players')
        .insert({
          name: name.trim(),
          division: pDiv,
          active: true,
        })
        .select()
        .single(),
    )
    await handleCheckinPlayer(newPlayer.id, pDiv)
  }

  const setStatus = async (status: EventStatus) => {
    await must(supabase.from('pp_events').update({ status }).eq('id', liveEvent.id))
    reload()
  }

  // Advance from Cut to Final 9 (apply qualifiers)
  const applyCutAndProceed = async () => {
    // Mark qualifiers in entries for both divisions
    for (const d of ['M', 'W'] as Division[]) {
      const dEntries = entries.filter((e) => e.event_id === liveEvent.id && e.division === d)
      const targetCut =
        d === 'M'
          ? liveEvent.final_cut_men ?? suggestedCut(counts.M, settings)
          : liveEvent.final_cut_women ?? suggestedCut(counts.W, settings)
      const sorted = [...dEntries].sort((a, b) => (totals(b).t18 ?? -1) - (totals(a).t18 ?? -1))
      for (let i = 0; i < sorted.length; i++) {
        const qualified = i < targetCut
        if (sorted[i].made_final !== qualified) {
          await patchEntry(sorted[i].id, { made_final: qualified })
        }
      }
    }
    await setStatus('final9')
  }

  // Finalize Tournament and Post Ledger
  const handleFinalize = async () => {
    if (!confirm('Are you sure you want to finalize tonight? This will lock scores and post payouts & pot records to the ledger.')) {
      return
    }
    setIsFinalizing(true)
    try {
      // 1. Process ledger rows for both divisions
      for (const d of ['M', 'W'] as Division[]) {
        const dEntries = entries.filter((e) => e.event_id === liveEvent.id && e.division === d)
        const dPayouts = d === 'M' ? liveEvent.payouts_men : liveEvent.payouts_women
        const dBalances = balances(ledger, d)
        const dRes = divisionResult({
          division: d,
          entries: dEntries,
          payoutPlaces: dPayouts,
          settings,
          balances: dBalances,
          priorRecord: records[d],
        })

        // Post ledger entries
        if (dRes.ledger.length > 0) {
          const rowsToInsert = dRes.ledger.map((r) => ({
            season_id: season!.id,
            event_id: liveEvent.id,
            division: r.division,
            fund: r.fund,
            kind: r.kind,
            amount: r.amount,
            note: r.note,
            player_id: r.player_id,
          }))
          await must(supabase.from('pp_ledger').insert(rowsToInsert))
        }

        // Write entry placements, points, payouts, tags_out
        for (const r of dRes.ranked) {
          const ent = r.entry
          const place = r.place
          const pay = dRes.payouts.get(ent.id) ?? 0
          const pts = dRes.points.get(ent.id) ?? 0
          const tagOut = dRes.tagsOut.get(ent.id) ?? ent.tag_in

          await must(
            supabase
              .from('pp_entries')
              .update({
                place,
                payout: pay,
                points: pts,
                tag_out: tagOut,
              })
              .eq('id', ent.id),
          )

          // Update player's active tag if changed
          if (tagOut != null) {
            await supabase.from('pp_tags').upsert(
              {
                season_id: season!.id,
                player_id: ent.player_id,
                tag_number: tagOut,
              },
              { onConflict: 'season_id,player_id' },
            )
          }
        }
      }

      // Mark event as complete
      await must(supabase.from('pp_events').update({ status: 'complete' }).eq('id', liveEvent.id))
      alert('Event finalized successfully!')
      reload()
    } catch (err: any) {
      alert(`Finalization error: ${err.message}`)
    } finally {
      setIsFinalizing(false)
    }
  }

  return (
    <div className="tonight-page">
      <PageHead
        eyebrow={`Date: ${liveEvent.event_date} · Event Status: ${liveEvent.status.toUpperCase()}`}
        title="Tonight's Tournament"
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <DivisionSeg value={division} onChange={setDivision} counts={counts} />
          {isAdmin && liveEvent.status === 'complete' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                if (confirm('Reopen this event for editing? Note: ledger records already written may need review in Pots.')) {
                  await setStatus('results')
                }
              }}
            >
              <RotateCcw size={14} /> Reopen Event
            </button>
          )}
        </div>
      </PageHead>

      {/* Top Stats Banner */}
      <div className="stats section">
        <Stat label={`${division === 'M' ? "Men's" : "Women's"} Field`} value={divEntries.length} sub="Players checked in" />
        <Stat
          label="Payout Pool"
          value={money(pool)}
          sub={`$${settings.entryFee - settings.perfectRoundShare}/player + $${
            division === 'M' ? liveEvent.bar_match_men : liveEvent.bar_match_women
          } bar`}
        />
        <Stat
          label="Perfect Round Pot"
          value={money(curBalances.perfect_round)}
          sub={`Backup Pot: ${money(curBalances.backup)} (Cap $${settings.perfectRoundCap})`}
        />
        <Stat
          label="Score To Beat"
          value={records[division] != null ? `${records[division]} pts` : 'No record yet'}
          sub="Beating this wins $10"
        />
      </div>

      {/* Admin Workflow Navigation */}
      {isAdmin && liveEvent.status !== 'complete' && (
        <div className="steps">
          {STEPS.map((s) => (
            <button
              key={s.status}
              className={liveEvent.status === s.status ? 'on' : ''}
              onClick={() => setStatus(s.status)}
            >
              <span className="step-n">{s.label.slice(0, 1)}</span>
              {s.label.slice(3)}
            </button>
          ))}
        </div>
      )}

      {/* STEP 1: CHECK-IN */}
      {isAdmin && liveEvent.status === 'checkin' && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">Check-in & Registration</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Check players into the {division === 'M' ? "Men's" : "Women's"} division, record tag numbers, and adjust bar matching.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setAddPlayerOpen(true)}>
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
                      <th className="c" style={{ width: 90 }}>Tag In</th>
                      <th className="c" style={{ width: 80 }}>Paid ($10)</th>
                      <th className="r" style={{ width: 80 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divEntries.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '36px 0' }} className="muted">
                          No players checked into this division yet. Click "+ Check In Player".
                        </td>
                      </tr>
                    ) : (
                      divEntries.map((ent, i) => {
                        const p = playerById.get(ent.player_id)
                        return (
                          <tr key={ent.id}>
                            <td className="faint">{i + 1}</td>
                            <td className="strong">{p?.name ?? 'Unknown Player'}</td>
                            <td className="c">
                              <input
                                className="score"
                                style={{ width: 60 }}
                                type="number"
                                placeholder="None"
                                value={ent.tag_in ?? ''}
                                onChange={(e) =>
                                  patchEntry(ent.id, {
                                    tag_in: e.target.value ? parseInt(e.target.value, 10) : null,
                                  })
                                }
                              />
                            </td>
                            <td className="c">
                              <button
                                className={`btn btn-sm ${ent.paid ? 'btn-ghost' : 'btn-danger'}`}
                                onClick={() => patchEntry(ent.id, { paid: !ent.paid })}
                              >
                                {ent.paid ? <Check size={14} color="var(--teal)" /> : 'Unpaid'}
                              </button>
                            </td>
                            <td className="r">
                              <button
                                className="btn btn-ghost btn-sm btn-danger"
                                onClick={async () => {
                                  if (confirm(`Remove ${p?.name} from tonight's event?`)) {
                                    await must(supabase.from('pp_entries').delete().eq('id', ent.id))
                                    reload()
                                  }
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

            {/* Event Settings & Bar Match Sidebar */}
            <div className="panel panel-pad stack">
              <div className="eyebrow">Night Finances & Match</div>
              <div className="kv">
                <dt>Total Field (Both Divs)</dt>
                <dd>{counts.M + counts.W} players</dd>
              </div>
              <div className="kv">
                <dt>Combined Entry Pot</dt>
                <dd>{money(moneyCalc.totalPot)}</dd>
              </div>
              <div className="kv">
                <dt>Bar Half Match (50%)</dt>
                <dd style={{ color: 'var(--orange)' }}>+{money(moneyCalc.barMatch)}</dd>
              </div>

              <div style={{ marginTop: 14 }} className="field">
                <span>{division === 'M' ? "Men's" : "Women's"} Bar Match Contribution</span>
                <MoneyInput
                  value={division === 'M' ? liveEvent.bar_match_men : liveEvent.bar_match_women}
                  onChange={async (val) => {
                    if (division === 'M') {
                      await must(supabase.from('pp_events').update({ bar_match_men: val }).eq('id', liveEvent.id))
                    } else {
                      await must(supabase.from('pp_events').update({ bar_match_women: val }).eq('id', liveEvent.id))
                    }
                    reload()
                  }}
                />
                <small>
                  Suggested proportional split: {money(moneyCalc.barSplit[division])}
                </small>
              </div>

              <button
                style={{ marginTop: 16 }}
                className="btn btn-primary btn-block"
                disabled={divEntries.length === 0}
                onClick={() => setStatus('scoring')}
              >
                Start 18-Holes Scoring <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: 18-HOLES SCORING */}
      {isAdmin && liveEvent.status === 'scoring' && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">18-Holes Scoring Grid</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Enter Basket 1 (0–30) and Basket 2 (0–20) for both 9s. Right-click any player row to toggle bonus awards.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={applyCutAndProceed}>
                Go to The Cut & Final 9 <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 45 }}>Plc</th>
                    <th>Player</th>
                    <th className="c">Tag</th>
                    <th className="group bl" colSpan={3}>
                      Round 1 (First 9)
                    </th>
                    <th className="group bl" colSpan={3}>
                      Round 2 (Second 9)
                    </th>
                    <th className="group bl" style={{ width: 80 }}>
                      18 Total
                    </th>
                    <th className="c bl" style={{ width: 140 }}>
                      Awards
                    </th>
                  </tr>
                  <tr>
                    <th></th>
                    <th></th>
                    <th></th>
                    <th className="c bl" style={{ width: 55 }}>B1 (30)</th>
                    <th className="c" style={{ width: 55 }}>B2 (20)</th>
                    <th className="c" style={{ width: 50 }}>9-1</th>
                    <th className="c bl" style={{ width: 55 }}>B1 (30)</th>
                    <th className="c" style={{ width: 55 }}>B2 (20)</th>
                    <th className="c" style={{ width: 50 }}>9-2</th>
                    <th className="c bl">/ 100</th>
                    <th className="c bl">Right-Click</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ranked.map((r) => {
                    const ent = r.entry
                    const p = playerById.get(ent.player_id)
                    const t = r.totals
                    return (
                      <tr
                        key={ent.id}
                        onContextMenu={(e) => handleContextMenu(e, ent)}
                        className={r.place === 1 ? 'leader' : ''}
                      >
                        <td className="place">{r.place}</td>
                        <td className="strong">
                          {p?.name}
                          {ent.awards?.length > 0 && (
                            <span className="chips">
                              {ent.awards.map((a) => (
                                <span key={a} className="chip chip-teal">
                                  {AWARD_SHORT[a]}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="c faint">{ent.tag_in ? `#${ent.tag_in}` : '—'}</td>

                        {/* Round 1 */}
                        <td className="c bl">
                          <input
                            className={`score ${ent.r1_b1 === 30 ? 'perfect' : ''}`}
                            type="number"
                            min="0"
                            max="30"
                            value={ent.r1_b1 ?? ''}
                            onChange={(e) =>
                              patchEntry(ent.id, {
                                r1_b1: e.target.value === '' ? null : Math.min(30, parseInt(e.target.value, 10)),
                              })
                            }
                          />
                        </td>
                        <td className="c">
                          <input
                            className={`score ${ent.r1_b2 === 20 ? 'perfect' : ''}`}
                            type="number"
                            min="0"
                            max="20"
                            value={ent.r1_b2 ?? ''}
                            onChange={(e) =>
                              patchEntry(ent.id, {
                                r1_b2: e.target.value === '' ? null : Math.min(20, parseInt(e.target.value, 10)),
                              })
                            }
                          />
                        </td>
                        <td className="c sub-total">{t.r1 ?? '—'}</td>

                        {/* Round 2 */}
                        <td className="c bl">
                          <input
                            className={`score ${ent.r2_b1 === 30 ? 'perfect' : ''}`}
                            type="number"
                            min="0"
                            max="30"
                            value={ent.r2_b1 ?? ''}
                            onChange={(e) =>
                              patchEntry(ent.id, {
                                r2_b1: e.target.value === '' ? null : Math.min(30, parseInt(e.target.value, 10)),
                              })
                            }
                          />
                        </td>
                        <td className="c">
                          <input
                            className={`score ${ent.r2_b2 === 20 ? 'perfect' : ''}`}
                            type="number"
                            min="0"
                            max="20"
                            value={ent.r2_b2 ?? ''}
                            onChange={(e) =>
                              patchEntry(ent.id, {
                                r2_b2: e.target.value === '' ? null : Math.min(20, parseInt(e.target.value, 10)),
                              })
                            }
                          />
                        </td>
                        <td className="c sub-total">{t.r2 ?? '—'}</td>

                        {/* 18-hole total */}
                        <td className="c bl big" style={{ color: t.t18 != null ? 'var(--orange)' : 'var(--text-3)' }}>
                          {t.t18 ?? '—'}
                        </td>

                        {/* Awards actions */}
                        <td className="c bl">
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={(e) => handleContextMenu(e, ent)}
                          >
                            <Sparkles size={12} /> Awards
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: FINAL 9 & THE CUT */}
      {isAdmin && liveEvent.status === 'final9' && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">Final 9 Round</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Enter scores for qualifiers in the Final 9. Points are added to their 18-hole score.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="row" style={{ background: 'var(--surface-1)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <span className="eyebrow" style={{ marginRight: 6 }}>Qualifiers Cut:</span>
                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={async () => {
                    const current =
                      division === 'M'
                        ? liveEvent.final_cut_men ?? suggestedCut(counts.M, settings)
                        : liveEvent.final_cut_women ?? suggestedCut(counts.W, settings)
                    const next = Math.max(1, current - 1)
                    if (division === 'M') {
                      await must(supabase.from('pp_events').update({ final_cut_men: next }).eq('id', liveEvent.id))
                    } else {
                      await must(supabase.from('pp_events').update({ final_cut_women: next }).eq('id', liveEvent.id))
                    }
                    reload()
                  }}
                >
                  <Minus size={14} />
                </button>
                <span className="num strong" style={{ margin: '0 8px', fontSize: 16 }}>
                  {division === 'M'
                    ? liveEvent.final_cut_men ?? suggestedCut(counts.M, settings)
                    : liveEvent.final_cut_women ?? suggestedCut(counts.W, settings)}
                </span>
                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={async () => {
                    const current =
                      division === 'M'
                        ? liveEvent.final_cut_men ?? suggestedCut(counts.M, settings)
                        : liveEvent.final_cut_women ?? suggestedCut(counts.W, settings)
                    const next = Math.min(divEntries.length, current + 1)
                    if (division === 'M') {
                      await must(supabase.from('pp_events').update({ final_cut_men: next }).eq('id', liveEvent.id))
                    } else {
                      await must(supabase.from('pp_events').update({ final_cut_women: next }).eq('id', liveEvent.id))
                    }
                    reload()
                  }}
                >
                  <Plus size={14} />
                </button>
              </div>

              <button className="btn btn-primary" onClick={() => setStatus('results')}>
                Advance to Results <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 45 }}>Plc</th>
                    <th>Player</th>
                    <th className="c">Status</th>
                    <th className="c bl" style={{ width: 70 }}>18 Total</th>
                    <th className="group bl" colSpan={3}>
                      Final 9
                    </th>
                    <th className="c bl" style={{ width: 90 }}>27 Total</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th></th>
                    <th></th>
                    <th className="c bl"></th>
                    <th className="c bl" style={{ width: 65 }}>B1 (30)</th>
                    <th className="c" style={{ width: 65 }}>B2 (20)</th>
                    <th className="c" style={{ width: 55 }}>Total</th>
                    <th className="c bl">/ 150</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ranked.map((r) => {
                    const ent = r.entry
                    const p = playerById.get(ent.player_id)
                    const t = r.totals
                    const isFinalist = ent.made_final

                    return (
                      <tr
                        key={ent.id}
                        onContextMenu={(e) => handleContextMenu(e, ent)}
                        className={`${!isFinalist ? 'out' : ''} ${r.place === 1 ? 'leader' : ''}`}
                      >
                        <td className="place">{r.place}</td>
                        <td className="strong">{p?.name}</td>
                        <td className="c">
                          <button
                            className={`btn btn-sm ${isFinalist ? 'btn-ghost' : 'btn-ghost'}`}
                            style={{ fontSize: 11 }}
                            onClick={() => patchEntry(ent.id, { made_final: !isFinalist })}
                          >
                            {isFinalist ? <span className="chip chip-teal">Finalist</span> : <span className="faint">Cut</span>}
                          </button>
                        </td>
                        <td className="c bl strong">{t.t18 ?? '—'}</td>

                        {/* Final 9 Entry */}
                        <td className="c bl">
                          <input
                            className={`score ${ent.f_b1 === 30 ? 'perfect' : ''}`}
                            disabled={!isFinalist}
                            type="number"
                            min="0"
                            max="30"
                            value={ent.f_b1 ?? ''}
                            onChange={(e) =>
                              patchEntry(ent.id, {
                                f_b1: e.target.value === '' ? null : Math.min(30, parseInt(e.target.value, 10)),
                              })
                            }
                          />
                        </td>
                        <td className="c">
                          <input
                            className={`score ${ent.f_b2 === 20 ? 'perfect' : ''}`}
                            disabled={!isFinalist}
                            type="number"
                            min="0"
                            max="20"
                            value={ent.f_b2 ?? ''}
                            onChange={(e) =>
                              patchEntry(ent.id, {
                                f_b2: e.target.value === '' ? null : Math.min(20, parseInt(e.target.value, 10)),
                              })
                            }
                          />
                        </td>
                        <td className="c sub-total">{isFinalist ? t.f ?? '—' : '—'}</td>

                        {/* 27-hole Grand Total */}
                        <td className="c bl big" style={{ color: t.total != null ? 'var(--orange)' : 'var(--text-3)' }}>
                          {t.total ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: RESULTS & PAYOUTS (OR READ-ONLY VIEW) */}
      {(liveEvent.status === 'results' || liveEvent.status === 'complete' || !isAdmin) && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2 className="display section-title">
                {liveEvent.status === 'complete' ? 'Official Results & Standings' : 'Night Results & Payouts'}
              </h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Review placements, prize payouts, tag distributions, and season points.
              </p>
            </div>
            {isAdmin && liveEvent.status !== 'complete' && (
              <button
                className="btn btn-primary"
                disabled={isFinalizing}
                onClick={handleFinalize}
              >
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
                    {result.ranked.map((r) => {
                      const ent = r.entry
                      const p = playerById.get(ent.player_id)
                      const t = r.totals
                      const payoutAmt = result.payouts.get(ent.id) ?? 0
                      const pts = result.points.get(ent.id) ?? 0
                      const tagOut = result.tagsOut.get(ent.id) ?? ent.tag_in

                      return (
                        <tr
                          key={ent.id}
                          className={r.place === 1 ? 'leader' : ''}
                          onContextMenu={(e) => handleContextMenu(e, ent)}
                        >
                          <td className="place">{ordinal(r.place)}</td>
                          <td className="strong">
                            {p?.name}
                            {ent.awards?.length > 0 && (
                              <span className="chips">
                                {ent.awards.map((a) => (
                                  <span key={a} className="chip chip-teal">
                                    {AWARD_SHORT[a]}
                                  </span>
                                ))}
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
                            {ent.tag_in != null ? (
                              <span>
                                #{ent.tag_in} → <strong style={{ color: 'var(--text)' }}>#{tagOut}</strong>
                              </span>
                            ) : (
                              'No tag'
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payouts Distribution & Bonuses Summary */}
            <div className="panel panel-pad stack">
              <div className="eyebrow">Payout Pool & Allocation</div>
              <div className="kv">
                <dt>Available Pool</dt>
                <dd style={{ color: 'var(--teal)' }}>{money(pool)}</dd>
              </div>

              {/* Editable Payout Inputs for Les */}
              {isAdmin && liveEvent.status !== 'complete' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
                    Place Payout Amounts ($)
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    {[0, 1, 2, 3].map((idx) => {
                      const cur = payoutsList[idx] ?? 0
                      return (
                        <div key={idx} className="row" style={{ justifyContent: 'space-between' }}>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {ordinal(idx + 1)} Place:
                          </span>
                          <div style={{ width: 110 }}>
                            <MoneyInput
                              value={cur}
                              onChange={async (val) => {
                                const next = [...payoutsList]
                                next[idx] = val
                                while (next.length > 0 && next[next.length - 1] === 0) next.pop()
                                if (division === 'M') {
                                  await must(supabase.from('pp_events').update({ payouts_men: next }).eq('id', liveEvent.id))
                                } else {
                                  await must(supabase.from('pp_events').update({ payouts_women: next }).eq('id', liveEvent.id))
                                }
                                reload()
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Bonus Awards Won Tonight */}
              <div style={{ marginTop: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  Tonight's Bonus Winners
                </div>
                {result.bonuses.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    No bonus awards assigned tonight.
                  </p>
                ) : (
                  result.bonuses.map((b) => (
                    <div key={b.type} className="kv">
                      <dt>{AWARD_LABEL[b.type]}</dt>
                      <dd style={{ color: 'var(--orange)' }}>
                        {money(b.each)} {b.entryIds.length > 1 ? `(${b.entryIds.length} split)` : ''}
                      </dd>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right Click Awards Context Menu */}
      {contextMenu && (
        <Menu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <div className="menu-label eyebrow">
            Award Bonuses: {playerById.get(contextMenu.entry.player_id)?.name}
          </div>
          {contextMenu.entry.tag_in == null && (
            <div className="menu-note muted" style={{ color: 'var(--danger)', fontSize: 11, padding: '4px 10px' }}>
              Player does not hold a tag (ineligible for bonuses per rules).
            </div>
          )}
          {AWARDS.map((a) => {
            const has = contextMenu.entry.awards?.includes(a)
            return (
              <button
                key={a}
                className={has ? 'on' : ''}
                onClick={() => toggleAward(a)}
              >
                <span className="check">{has ? <Check size={14} /> : null}</span>
                <span>{AWARD_LABEL[a]}</span>
                <span className="hint">
                  {a === 'perfect_round'
                    ? money(curBalances.perfect_round)
                    : a === 'high_score'
                    ? `$${settings.bonus.highScore}`
                    : a === 'perfect5'
                    ? `$${settings.bonus.perfect5}`
                    : `$${settings.bonus.perfect4}`}
                </span>
              </button>
            )
          })}
        </Menu>
      )}

      {/* Check In Player Dialog */}
      {addPlayerOpen && (
        <Dialog title="Check In Player" onClose={() => setAddPlayerOpen(false)}>
          <div className="stack">
            <div className="field">
              <span>Search Roster</span>
              <input
                className="input"
                type="text"
                placeholder="Type player name..."
                autoFocus
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
              />
            </div>

            {/* Filtered roster list */}
            <div style={{ maxHeight: 200, overflowY: 'auto' }} className="stack">
              {players
                .filter(
                  (p) =>
                    p.division === division &&
                    p.name.toLowerCase().includes(searchName.toLowerCase().trim()),
                )
                .map((p) => {
                  const already = divEntries.some((e) => e.player_id === p.id)
                  return (
                    <button
                      key={p.id}
                      disabled={already}
                      className="btn btn-ghost"
                      style={{ justifyContent: 'space-between' }}
                      onClick={() => handleCheckinPlayer(p.id, division)}
                    >
                      <span>{p.name}</span>
                      <span className="faint">{already ? 'Already in' : 'Add →'}</span>
                    </button>
                  )
                })}
            </div>

            {searchName.trim() &&
              !players.some(
                (p) => p.name.toLowerCase() === searchName.trim().toLowerCase(),
              ) && (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-primary btn-block"
                    onClick={() => handleCreateAndCheckin(searchName, division)}
                  >
                    <Plus size={14} /> Create &amp; Check In "{searchName.trim()}"
                  </button>
                </div>
              )}
          </div>
        </Dialog>
      )}
    </div>
  )
}
