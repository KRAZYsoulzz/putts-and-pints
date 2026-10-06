import { useMemo, useState } from 'react'
import { Edit2, Plus, Trash2 } from 'lucide-react'
import { useData, must } from '../lib/store'
import { supabase } from '../lib/supabase'
import { totals } from '../lib/scoring'
import {
  AWARDS,
  AWARD_LABEL,
  DIVISIONS,
  DIVISION_LABEL,
  type Award,
  type Division,
  type Entry,
  type Player,
} from '../lib/types'
import { Dialog, DivisionSeg, MoneyInput, PageHead, Toggle, money, ordinal } from '../components/ui'

export default function Players() {
  const { players, tags, entries, events, season, isAdmin, reload } = useData()
  const [division, setDivision] = useState<Division>('M')
  const [query, setQuery] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)

  // Add Player State
  const [addModal, setAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDivision, setNewDivision] = useState<Division>('M')
  const [initialTag, setInitialTag] = useState('')

  // Edit Player Profile State
  const [editPlayer, setEditPlayer] = useState<Player | null>(null)
  const [editName, setEditName] = useState('')
  const [editDivision, setEditDivision] = useState<Division>('M')
  const [editActive, setEditActive] = useState(true)
  const [editTag, setEditTag] = useState('')

  // Edit Historical Event Entry State
  const [editEntry, setEditEntry] = useState<Entry | null>(null)
  const [entryForm, setEntryForm] = useState<Partial<Entry>>({})

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

  // Open Edit Player Dialog
  const openEditPlayer = (p: Player) => {
    setEditPlayer(p)
    setEditName(p.name)
    setEditDivision(p.division)
    setEditActive(p.active)
    const curTag = tags.find((t) => t.player_id === p.id)?.tag_number
    setEditTag(curTag ? String(curTag) : '')
  }

  // Save Player Profile Edits
  const handleSavePlayer = async () => {
    if (!editPlayer || !editName.trim()) return

    // 1. Update player table
    await must(
      supabase
        .from('pp_players')
        .update({
          name: editName.trim(),
          division: editDivision,
          active: editActive,
        })
        .eq('id', editPlayer.id),
    )

    // 2. Update tag in pp_tags
    if (season) {
      const tagNum = editTag.trim() ? parseInt(editTag.trim(), 10) : null
      if (tagNum != null && !isNaN(tagNum)) {
        await supabase.from('pp_tags').upsert(
          {
            season_id: season.id,
            player_id: editPlayer.id,
            tag_number: tagNum,
          },
          { onConflict: 'season_id,player_id' },
        )
      } else {
        await supabase
          .from('pp_tags')
          .delete()
          .eq('season_id', season.id)
          .eq('player_id', editPlayer.id)
      }
    }

    setEditPlayer(null)
    if (selectedPlayer?.id === editPlayer.id) {
      setSelectedPlayer({
        ...editPlayer,
        name: editName.trim(),
        division: editDivision,
        active: editActive,
      })
    }
    reload()
  }

  // Delete Player
  const handleDeletePlayer = async () => {
    if (!editPlayer) return
    const hasEntries = entries.some((e) => e.player_id === editPlayer.id)
    const confirmMsg = hasEntries
      ? `Warning: ${editPlayer.name} has tournament entry records. Deleting them will delete all associated scores and history. Are you sure?`
      : `Delete ${editPlayer.name}? This cannot be undone.`

    if (confirm(confirmMsg)) {
      if (hasEntries) {
        await must(supabase.from('pp_entries').delete().eq('player_id', editPlayer.id))
      }
      await must(supabase.from('pp_tags').delete().eq('player_id', editPlayer.id))
      await must(supabase.from('pp_players').delete().eq('id', editPlayer.id))
      setEditPlayer(null)
      setSelectedPlayer(null)
      reload()
    }
  }

  // Open Edit Entry Dialog
  const openEditEntry = (ent: Entry) => {
    setEditEntry(ent)
    setEntryForm({
      r1_b1: ent.r1_b1,
      r1_b2: ent.r1_b2,
      r2_b1: ent.r2_b1,
      r2_b2: ent.r2_b2,
      f_b1: ent.f_b1,
      f_b2: ent.f_b2,
      made_final: ent.made_final,
      place: ent.place,
      payout: ent.payout,
      points: ent.points,
      tag_in: ent.tag_in,
      tag_out: ent.tag_out,
      awards: ent.awards ? [...ent.awards] : [],
    })
  }

  // Save Historical Entry Edits
  const handleSaveEntry = async () => {
    if (!editEntry) return
    await must(supabase.from('pp_entries').update(entryForm).eq('id', editEntry.id))
    setEditEntry(null)
    reload()
  }

  // Delete Historical Entry
  const handleDeleteEntry = async () => {
    if (!editEntry) return
    if (confirm('Delete this event entry completely? Scores and finishes for this night will be removed.')) {
      await must(supabase.from('pp_entries').delete().eq('id', editEntry.id))
      setEditEntry(null)
      reload()
    }
  }

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
        if (season) {
          await supabase.from('pp_tags').insert({
            season_id: season.id,
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
                <th className="c bl" style={{ width: 160 }}>Action</th>
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
                    <tr key={p.id}>
                      <td className="faint">{idx + 1}</td>
                      <td
                        className="strong table-link"
                        onClick={() => setSelectedPlayer(p)}
                        style={{ cursor: 'pointer' }}
                      >
                        {p.name}
                        {!p.active && <span className="chip chip-danger" style={{ marginLeft: 6 }}>Inactive</span>}
                      </td>
                      <td className="c">
                        {currentTag ? <span className="chip chip-tag">#{currentTag}</span> : <span className="faint">—</span>}
                      </td>
                      <td className="c faint">{playerEntries.length}</td>
                      <td className="r bl num strong" style={{ color: totalWon > 0 ? 'var(--teal)' : 'var(--text-3)' }}>
                        {totalWon > 0 ? money(totalWon) : '—'}
                      </td>
                      <td className="c bl">
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedPlayer(p)}>
                            Stats →
                          </button>
                          {isAdmin && (
                            <button
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Edit Player Profile"
                              onClick={() => openEditPlayer(p)}
                            >
                              <Edit2 size={13} />
                            </button>
                          )}
                        </div>
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
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="chip chip-orange">{DIVISION_LABEL[selectedPlayer.division]}</span>
                {profileStats.currentTag && (
                  <span className="chip chip-tag">Holding Tag #{profileStats.currentTag}</span>
                )}
                {!selectedPlayer.active && <span className="chip chip-danger">Inactive</span>}
              </div>

              {isAdmin && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => openEditPlayer(selectedPlayer)}
                >
                  <Edit2 size={13} /> Edit Profile
                </button>
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

            {/* Recent Event History with Edit Entry Option */}
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Event History &amp; Records</div>
              <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th className="c">18 Thru</th>
                      <th className="c">27 Total</th>
                      <th className="c">Place</th>
                      <th className="r">Payout</th>
                      {isAdmin && <th className="c bl" style={{ width: 60 }}>Edit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {profileStats.entries.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 6 : 5} className="muted c" style={{ padding: '20px 0' }}>
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
                            {isAdmin && (
                              <td className="c bl">
                                <button
                                  className="btn btn-ghost btn-sm btn-icon"
                                  title="Edit Event Scores / Data"
                                  onClick={() => openEditEntry(ent)}
                                >
                                  <Edit2 size={13} />
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
          </div>
        </Dialog>
      )}

      {/* Edit Player Profile Dialog */}
      {editPlayer && (
        <Dialog title={`Edit Player: ${editPlayer.name}`} onClose={() => setEditPlayer(null)}>
          <div className="stack">
            <div className="field">
              <span>Full Name</span>
              <input
                className="input"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <span>Division</span>
              <div className="seg">
                {DIVISIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={editDivision === d ? 'on' : ''}
                    onClick={() => setEditDivision(d)}
                  >
                    {DIVISION_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span>Current Tag Number (Leave blank for no tag)</span>
              <input
                className="input"
                type="number"
                placeholder="e.g. 5"
                value={editTag}
                onChange={(e) => setEditTag(e.target.value)}
              />
            </div>

            <div className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Active Player Status</span>
                <div className="muted" style={{ fontSize: 11 }}>Visible in active roster and check-in</div>
              </div>
              <Toggle on={editActive} onChange={setEditActive} label="Active Status" />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSavePlayer}>
                Save Profile
              </button>
              <button className="btn btn-ghost btn-danger" onClick={handleDeletePlayer} title="Delete Player">
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Edit Historical Entry / Scores Dialog */}
      {editEntry && (
        <Dialog title="Edit Event Entry & Scores" onClose={() => setEditEntry(null)}>
          <div className="stack">
            <div className="eyebrow" style={{ color: 'var(--orange)' }}>
              18-Holes Round Scores
            </div>

            <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <div className="field">
                <span>R1 Basket 1 (0–30)</span>
                <input
                  className="input num"
                  type="number"
                  min="0"
                  max="30"
                  value={entryForm.r1_b1 ?? ''}
                  onChange={(e) =>
                    setEntryForm((prev) => ({
                      ...prev,
                      r1_b1: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    }))
                  }
                />
              </div>
              <div className="field">
                <span>R1 Basket 2 (0–20)</span>
                <input
                  className="input num"
                  type="number"
                  min="0"
                  max="20"
                  value={entryForm.r1_b2 ?? ''}
                  onChange={(e) =>
                    setEntryForm((prev) => ({
                      ...prev,
                      r1_b2: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    }))
                  }
                />
              </div>

              <div className="field">
                <span>R2 Basket 1 (0–30)</span>
                <input
                  className="input num"
                  type="number"
                  min="0"
                  max="30"
                  value={entryForm.r2_b1 ?? ''}
                  onChange={(e) =>
                    setEntryForm((prev) => ({
                      ...prev,
                      r2_b1: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    }))
                  }
                />
              </div>
              <div className="field">
                <span>R2 Basket 2 (0–20)</span>
                <input
                  className="input num"
                  type="number"
                  min="0"
                  max="20"
                  value={entryForm.r2_b2 ?? ''}
                  onChange={(e) =>
                    setEntryForm((prev) => ({
                      ...prev,
                      r2_b2: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    }))
                  }
                />
              </div>
            </div>

            <div className="eyebrow" style={{ color: 'var(--teal)', marginTop: 8 }}>
              Final 9 Round
            </div>

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13 }}>Qualified for Final 9</span>
              <Toggle
                on={!!entryForm.made_final}
                onChange={(v) => setEntryForm((prev) => ({ ...prev, made_final: v }))}
              />
            </div>

            {entryForm.made_final && (
              <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <div className="field">
                  <span>Final 9 Basket 1 (0–30)</span>
                  <input
                    className="input num"
                    type="number"
                    min="0"
                    max="30"
                    value={entryForm.f_b1 ?? ''}
                    onChange={(e) =>
                      setEntryForm((prev) => ({
                        ...prev,
                        f_b1: e.target.value === '' ? null : parseInt(e.target.value, 10),
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <span>Final 9 Basket 2 (0–20)</span>
                  <input
                    className="input num"
                    type="number"
                    min="0"
                    max="20"
                    value={entryForm.f_b2 ?? ''}
                    onChange={(e) =>
                      setEntryForm((prev) => ({
                        ...prev,
                        f_b2: e.target.value === '' ? null : parseInt(e.target.value, 10),
                      }))
                    }
                  />
                </div>
              </div>
            )}

            <div className="eyebrow" style={{ marginTop: 8 }}>
              Finish Placements, Winnings &amp; Tags
            </div>

            <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <div className="field">
                <span>Place</span>
                <input
                  className="input num"
                  type="number"
                  placeholder="e.g. 1"
                  value={entryForm.place ?? ''}
                  onChange={(e) =>
                    setEntryForm((prev) => ({
                      ...prev,
                      place: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    }))
                  }
                />
              </div>
              <div className="field">
                <span>Payout ($)</span>
                <MoneyInput
                  value={entryForm.payout ?? 0}
                  onChange={(v) => setEntryForm((prev) => ({ ...prev, payout: v }))}
                />
              </div>
              <div className="field">
                <span>Points</span>
                <input
                  className="input num"
                  type="number"
                  step="0.5"
                  value={entryForm.points ?? 0}
                  onChange={(e) =>
                    setEntryForm((prev) => ({
                      ...prev,
                      points: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <div className="field">
                <span>Tag In</span>
                <input
                  className="input num"
                  type="number"
                  value={entryForm.tag_in ?? ''}
                  onChange={(e) =>
                    setEntryForm((prev) => ({
                      ...prev,
                      tag_in: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    }))
                  }
                />
              </div>
              <div className="field">
                <span>Tag Out</span>
                <input
                  className="input num"
                  type="number"
                  value={entryForm.tag_out ?? ''}
                  onChange={(e) =>
                    setEntryForm((prev) => ({
                      ...prev,
                      tag_out: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    }))
                  }
                />
              </div>
            </div>

            {/* Awards toggles */}
            <div className="field" style={{ marginTop: 4 }}>
              <span>Bonus Awards Assigned</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {AWARDS.map((a) => {
                  const has = entryForm.awards?.includes(a)
                  return (
                    <button
                      key={a}
                      type="button"
                      className={`chip ${has ? 'chip-teal' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        const cur = entryForm.awards || []
                        const next = has ? cur.filter((x) => x !== a) : [...cur, a]
                        setEntryForm((prev) => ({ ...prev, awards: next }))
                      }}
                    >
                      {has ? '✓ ' : ''}{AWARD_LABEL[a]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveEntry}>
                Save Changes
              </button>
              <button className="btn btn-ghost btn-danger" onClick={handleDeleteEntry} title="Delete Entry">
                <Trash2 size={15} /> Delete Entry
              </button>
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
