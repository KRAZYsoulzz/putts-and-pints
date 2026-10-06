import { useState } from 'react'
import { CheckCircle2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useData, must } from '../lib/store'
import { supabase } from '../lib/supabase'
import { Dialog, MoneyInput, PageHead, fmtDate } from '../components/ui'
import type { Division, Fund } from '../lib/types'

export default function SeasonPage() {
  const { season, events, entries, isAdmin, reload } = useData()
  const [newSeasonModal, setNewSeasonModal] = useState(false)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [carryoverModal, setCarryoverModal] = useState(false)

  // Carryover form state
  const [carryover, setCarryover] = useState({
    prM: 0,
    prW: 0,
    p5M: 0,
    p5W: 0,
    p4M: 0,
    p4W: 0,
    hsM: 0,
    hsW: 0,
  })

  const handleCreateSeason = async () => {
    if (!newSeasonName.trim()) return
    // Deactivate others
    await supabase.from('pp_seasons').update({ active: false }).neq('id', '00000000-0000-0000-0000-000000000000')
    await must(
      supabase.from('pp_seasons').insert({
        name: newSeasonName.trim(),
        active: true,
      }),
    )
    setNewSeasonModal(false)
    setNewSeasonName('')
    reload()
  }

  const handleSaveCarryover = async () => {
    if (!season) return
    const entriesToPost: { division: Division; fund: Fund; amount: number; note: string }[] = [
      { division: 'M', fund: 'perfect_round', amount: carryover.prM, note: 'Carried over from last year' },
      { division: 'W', fund: 'perfect_round', amount: carryover.prW, note: 'Carried over from last year' },
      { division: 'M', fund: 'perfect5', amount: carryover.p5M, note: 'Carried over from last year' },
      { division: 'W', fund: 'perfect5', amount: carryover.p5W, note: 'Carried over from last year' },
      { division: 'M', fund: 'perfect4', amount: carryover.p4M, note: 'Carried over from last year' },
      { division: 'W', fund: 'perfect4', amount: carryover.p4W, note: 'Carried over from last year' },
      { division: 'M', fund: 'high_score', amount: carryover.hsM, note: 'Carried over from last year' },
      { division: 'W', fund: 'high_score', amount: carryover.hsW, note: 'Carried over from last year' },
    ]

    for (const item of entriesToPost) {
      if (item.amount > 0) {
        await must(
          supabase.from('pp_ledger').insert({
            season_id: season.id,
            division: item.division,
            fund: item.fund,
            kind: 'carryover',
            amount: item.amount,
            note: item.note,
          }),
        )
      }
    }

    setCarryoverModal(false)
    alert('Carryover balances saved successfully!')
    reload()
  }

  return (
    <div className="season-page">
      <PageHead eyebrow="Season Management" title="Seasons & Events">
        {isAdmin && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setCarryoverModal(true)}>
              <Sparkles size={16} /> Enter Last Year's Carryovers
            </button>
            <button className="btn btn-primary" onClick={() => setNewSeasonModal(true)}>
              <Plus size={16} /> New Season
            </button>
          </div>
        )}
      </PageHead>

      {/* Active Season Banner */}
      <div className="panel panel-pad section stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="eyebrow">Active Season</div>
            <h2 className="display" style={{ fontSize: 32, marginTop: 4 }}>
              {season?.name ?? 'No active season'}
            </h2>
          </div>
          {season && (
            <span className="chip chip-teal">
              <CheckCircle2 size={12} /> Active
            </span>
          )}
        </div>
      </div>

      {/* Events History Table */}
      <div className="panel section">
        <div className="panel-head">
          <span className="eyebrow">Tournament Events</span>
          <span className="faint" style={{ fontSize: 12 }}>
            {events.length} event{events.length === 1 ? '' : 's'} recorded
          </span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Date</th>
                <th>Status</th>
                <th className="c">Men</th>
                <th className="c">Women</th>
                <th className="c">Total</th>
                {isAdmin && <th className="r bl" style={{ width: 100 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '36px 0' }} className="muted">
                    No tournament events recorded yet in this season.
                  </td>
                </tr>
              ) : (
                events.map((ev) => {
                  const evEntries = entries.filter((e) => e.event_id === ev.id)
                  const mCount = evEntries.filter((e) => e.division === 'M').length
                  const wCount = evEntries.filter((e) => e.division === 'W').length

                  return (
                    <tr key={ev.id}>
                      <td className="strong">{fmtDate(ev.event_date)}</td>
                      <td>
                        <span
                          className={`chip ${
                            ev.status === 'complete' ? 'chip-teal' : 'chip-orange'
                          }`}
                        >
                          {ev.status}
                        </span>
                      </td>
                      <td className="c">{mCount}</td>
                      <td className="c">{wCount}</td>
                      <td className="c strong">{mCount + wCount}</td>
                      {isAdmin && (
                        <td className="r bl">
                          <button
                            className="btn btn-ghost btn-sm btn-danger"
                            onClick={async () => {
                              if (confirm(`Delete tournament on ${ev.event_date}?`)) {
                                await must(supabase.from('pp_events').delete().eq('id', ev.id))
                                reload()
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Season Modal */}
      {newSeasonModal && (
        <Dialog title="Create New Season" onClose={() => setNewSeasonModal(false)}>
          <div className="stack">
            <div className="field">
              <span>Season Name</span>
              <input
                className="input"
                type="text"
                placeholder="e.g. 2026 Season"
                autoFocus
                value={newSeasonName}
                onChange={(e) => setNewSeasonName(e.target.value)}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary btn-block" onClick={handleCreateSeason}>
                Create &amp; Activate
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Last Year's Carryover Balances Modal */}
      {carryoverModal && (
        <Dialog title="Punch in Last Year's Carryover" onClose={() => setCarryoverModal(false)}>
          <div className="stack">
            <p className="muted" style={{ fontSize: 13 }}>
              Enter the carryover amounts from last year to seed the pots for this season.
            </p>

            <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div className="field">
                <span>Men's Perfect Round</span>
                <MoneyInput
                  value={carryover.prM}
                  onChange={(v) => setCarryover((prev) => ({ ...prev, prM: v }))}
                />
              </div>
              <div className="field">
                <span>Women's Perfect Round</span>
                <MoneyInput
                  value={carryover.prW}
                  onChange={(v) => setCarryover((prev) => ({ ...prev, prW: v }))}
                />
              </div>

              <div className="field">
                <span>Men's Perfect 5</span>
                <MoneyInput
                  value={carryover.p5M}
                  onChange={(v) => setCarryover((prev) => ({ ...prev, p5M: v }))}
                />
              </div>
              <div className="field">
                <span>Women's Perfect 5</span>
                <MoneyInput
                  value={carryover.p5W}
                  onChange={(v) => setCarryover((prev) => ({ ...prev, p5W: v }))}
                />
              </div>

              <div className="field">
                <span>Men's Perfect 4</span>
                <MoneyInput
                  value={carryover.p4M}
                  onChange={(v) => setCarryover((prev) => ({ ...prev, p4M: v }))}
                />
              </div>
              <div className="field">
                <span>Women's Perfect 4</span>
                <MoneyInput
                  value={carryover.p4W}
                  onChange={(v) => setCarryover((prev) => ({ ...prev, p4W: v }))}
                />
              </div>

              <div className="field">
                <span>Men's High Score Pot</span>
                <MoneyInput
                  value={carryover.hsM}
                  onChange={(v) => setCarryover((prev) => ({ ...prev, hsM: v }))}
                />
              </div>
              <div className="field">
                <span>Women's High Score Pot</span>
                <MoneyInput
                  value={carryover.hsW}
                  onChange={(v) => setCarryover((prev) => ({ ...prev, hsW: v }))}
                />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-block" onClick={handleSaveCarryover}>
                Save Carryovers to Ledger
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
