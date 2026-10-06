import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useData, must } from '../lib/store'
import { supabase } from '../lib/supabase'
import { totals } from '../lib/scoring'
import { AWARD_LABEL, DIVISIONS, DIVISION_LABEL, type Award, type Division, type Player } from '../lib/types'
import { Dialog, DivisionSeg, PageHead, money, ordinal } from '../components/ui'

export default function Players() {
  const { players, tags, entries, events, isAdmin, reload } = useData()
  const [division, setDivision] = useState<Division>('M')
  const [query, setQuery] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)
  const [addModal, setAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDivision, setNewDivision] = useState<Division>('M')
  const [initialTag, setInitialTag] = useState('')

  // Filter players
  const filtered = useMemo(() => {
    return players
      .filter((p) => p.division === division && p.name.toLowerCase().includes(query.toLowerCase().trim()))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [players, division, query])

  // Player profile stats
  const profileStats = useMemo(() => {
    if (!selectedPlayer) return null
    const playerEntries = entries
      .filter((e) => e.player_id === selectedPlayer.id)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

    const completed = playerEntries.filter((e) => e.place != null)
    const points = completed.reduce((acc, cur) => acc + (cur.points || 0), 0)
    const winnings = completed.reduce((acc, cur) => acc + (cur.payout || 0), 0)
    const currentTag = tags.find((t) => t.player_id === selectedPlayer.id)?.tag_number ?? null

    let best18 = 0
    let best27 = 0
    const awardsCount: Record<Award, number> = {
      perfect_round: 0,
      perfect5: 0,
      perfect4: 0,
      high_score: 0,
    }

    for (const ent of playerEntries) {
      const t = totals(ent)
      if (t.t18 && t.t18 > best18) best18 = t.t18
      if (t.total && t.total > best27) best27 = t.total
      for (const a of ent.awards || []) {
        awardsCount[a] = (awardsCount[a] || 0) + 1
      }
    }

    return {
      entries: playerEntries,
      points,
      winnings,
      currentTag,
      best18,
      best27,
      awardsCount,
    }
  }, [selectedPlayer, entries, tags])

  const handleAddPlayer = async () => {
    if (!newName.trim()) return
    const created = await must(
      supabase
        .from('pp_players')
        .insert({
          name: newName.trim(),
          division: newDivision,
          active: true,
        })
        .select()
        .single(),
    )

    if (initialTag.trim()) {
      const tagNum = parseInt(initialTag.trim(), 10)
      if (!isNaN(tagNum)) {
        const activeSeason = (await supabase.from('pp_seasons').select('id').eq('active', true).single()).data
        if (activeSeason) {
          await supabase.from('pp_tags').insert({
            season_id: activeSeason.id,
            player_id: created.id,
            tag_number: tagNum,
          })
        }
      }
    }

    setAddModal(false)
    setNewName('')
    setInitialTag('')
    reload()
  }

  return (
    <div className="players-page">
      <PageHead eyebrow="Roster & Profiles" title="Players Directory">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <DivisionSeg value={division} onChange={setDivision} />
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setAddModal(true)}>
              <Plus size={16} /> Add Player
            </button>
          )}
        </div>
      </PageHead>

      {/* Search Bar */}
      <div className="section" style={{ maxWidth: 400 }}>
        <div className="combo">
          <input
            className="input"
            type="search"
            placeholder="Search by player name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Players List Grid */}
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 45 }}>#</th>
                <th>Name</th>
                <th className="c" style={{ width: 90 }}>Tag</th>
                <th className="c" style={{ width: 90 }}>Events</th>
                <th className="r bl" style={{ width: 110 }}>Total Winnings</th>
                <th className="c bl" style={{ width: 100 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '36px 0' }} className="muted">
                    No players found in this division matching "{query}".
                  </td>
                </tr>
              ) : (
                filtered.map((p, idx) => {
                  const currentTag = tags.find((t) => t.player_id === p.id)?.tag_number
                  const playerEntries = entries.filter((e) => e.player_id === p.id && e.place != null)
                  const totalWon = playerEntries.reduce((sum, e) => sum + (e.payout || 0), 0)

                  return (
                    <tr
                      key={p.id}
                      className="table-link"
                      onClick={() => setSelectedPlayer(p)}
                    >
                      <td className="faint">{idx + 1}</td>
                      <td className="strong">{p.name}</td>
                      <td className="c">
                        {currentTag ? <span className="chip chip-tag">#{currentTag}</span> : <span className="faint">—</span>}
                      </td>
                      <td className="c faint">{playerEntries.length}</td>
                      <td className="r bl num strong" style={{ color: totalWon > 0 ? 'var(--teal)' : 'var(--text-3)' }}>
                        {totalWon > 0 ? money(totalWon) : '—'}
                      </td>
                      <td className="c bl">
                        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedPlayer(p)}>
                          View Stats →
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

      {/* Player Stats Dialog */}
      {selectedPlayer && profileStats && (
        <Dialog title={selectedPlayer.name} onClose={() => setSelectedPlayer(null)}>
          <div className="stack">
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="chip chip-orange">{DIVISION_LABEL[selectedPlayer.division]}</span>
              {profileStats.currentTag && (
                <span className="chip chip-tag">Holding Tag #{profileStats.currentTag}</span>
              )}
            </div>

            <div className="stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <div className="stat">
                <div className="eyebrow">Season Points</div>
                <div className="stat-value" style={{ color: 'var(--orange)' }}>
                  {profileStats.points}
                </div>
              </div>
              <div className="stat">
                <div className="eyebrow">Career Winnings</div>
                <div className="stat-value" style={{ color: 'var(--teal)' }}>
                  {money(profileStats.winnings)}
                </div>
              </div>
              <div className="stat">
                <div className="eyebrow">Best 18 Score</div>
                <div className="stat-value">{profileStats.best18 || '—'}</div>
              </div>
              <div className="stat">
                <div className="eyebrow">Best 27 Score</div>
                <div className="stat-value">{profileStats.best27 || '—'}</div>
              </div>
            </div>

            {/* Awards Summary */}
            <div style={{ marginTop: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Bonuses Earned</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {(Object.keys(profileStats.awardsCount) as Award[]).map((a) => {
                  const count = profileStats.awardsCount[a]
                  return (
                    <span
                      key={a}
                      className={`chip ${count > 0 ? 'chip-teal' : ''}`}
                      style={{ opacity: count > 0 ? 1 : 0.4 }}
                    >
                      {AWARD_LABEL[a]}: {count}x
                    </span>
                  )
                })}
              </div>
            </div>

            {/* Recent Event History */}
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Event History</div>
              <div className="table-wrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th className="c">18 Thru</th>
                      <th className="c">27 Total</th>
                      <th className="c">Place</th>
                      <th className="r">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileStats.entries.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted c" style={{ padding: '20px 0' }}>
                          No event records found.
                        </td>
                      </tr>
                    ) : (
                      profileStats.entries.map((ent) => {
                        const ev = events.find((e) => e.id === ent.event_id)
                        const t = totals(ent)
                        return (
                          <tr key={ent.id}>
                            <td className="faint">{ev?.event_date ?? 'Event'}</td>
                            <td className="c">{t.t18 ?? '—'}</td>
                            <td className="c">{t.total ?? '—'}</td>
                            <td className="c strong">{ent.place ? ordinal(ent.place) : '—'}</td>
                            <td className="r num" style={{ color: ent.payout > 0 ? 'var(--teal)' : 'var(--text-3)' }}>
                              {ent.payout > 0 ? money(ent.payout) : '—'}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {/* Add New Player Dialog */}
      {addModal && (
        <Dialog title="Add New Player" onClose={() => setAddModal(false)}>
          <div className="stack">
            <div className="field">
              <span>Player Full Name</span>
              <input
                className="input"
                type="text"
                placeholder="e.g. John Doe"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>

            <div className="field">
              <span>Division</span>
              <div className="seg">
                {DIVISIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={newDivision === d ? 'on' : ''}
                    onClick={() => setNewDivision(d)}
                  >
                    {DIVISION_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span>Starting Tag Number (Optional)</span>
              <input
                className="input"
                type="number"
                placeholder="e.g. 12"
                value={initialTag}
                onChange={(e) => setInitialTag(e.target.value)}
              />
            </div>

            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-block" onClick={handleAddPlayer}>
                Save Player
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
