import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, RotateCcw, Tag as TagIcon } from 'lucide-react'
import { useData } from '../lib/store'
import type { Division } from '../lib/types'
import { DivisionSeg, PageHead, Stat, money, ordinal } from '../components/ui'
import {
  buildOfficialStandings,
  nextSortState,
  sortStandingsRows,
  type StandingsSortColumn,
  type StandingsSortState,
} from '../lib/standings'

const COLUMNS: {
  key: StandingsSortColumn
  label: string
  align?: 'c' | 'r'
  borderLeft?: boolean
  width?: number
}[] = [
  { key: 'default', label: 'Plc', width: 45 },
  { key: 'player', label: 'Player' },
  { key: 'events', label: 'Events', align: 'c' },
  { key: 'wins', label: '1st Wins', align: 'c' },
  { key: 'best18', label: 'Best 18', align: 'c' },
  { key: 'best27', label: 'Best 27', align: 'c' },
  { key: 'winnings', label: 'Winnings', align: 'r', borderLeft: true },
  { key: 'points', label: 'Points', align: 'c', borderLeft: true, width: 70 },
]

export default function Standings() {
  const { season, entries, events, playerById, tags, records } = useData()
  const [division, setDivision] = useState<Division>('M')
  const [sortState, setSortState] = useState<StandingsSortState>({
    column: 'default',
    direction: 'desc',
  })

  // Completed events in active season
  const completedEventIds = useMemo(
    () => new Set(events.filter((e) => e.status === 'complete').map((e) => e.id)),
    [events],
  )

  // Official standings sorted by default tie-breakers with shared places
  const officialLeaderboard = useMemo(() => {
    return buildOfficialStandings({
      entries,
      events,
      division,
      playerById,
    })
  }, [entries, events, division, playerById])

  // View leaderboard (sorted by selected column, preserving official place rank)
  const displayedLeaderboard = useMemo(() => {
    return sortStandingsRows(officialLeaderboard, sortState)
  }, [officialLeaderboard, sortState])

  // Current tags for this division
  const activeTags = useMemo(() => {
    return tags
      .filter((t) => {
        const p = playerById.get(t.player_id)
        return p?.division === division
      })
      .sort((a, b) => a.tag_number - b.tag_number)
  }, [tags, playerById, division])

  const handleHeaderClick = (column: StandingsSortColumn) => {
    setSortState((prev) => nextSortState(prev, column))
  }

  return (
    <div className="standings-page">
      <PageHead
        eyebrow={season ? `${season.name} · Official Season Standings` : 'Official Standings'}
        title="Season Standings"
      >
        <DivisionSeg value={division} onChange={setDivision} />
      </PageHead>

      {/* Season Stats Banner */}
      <div className="stats section">
        <Stat
          label="High Score Record"
          value={records[division] != null ? `${records[division]} pts` : 'None yet'}
          sub="Official score to beat"
        />
        <Stat
          label="Leader"
          value={officialLeaderboard[0] ? officialLeaderboard[0].playerName : '—'}
          sub={officialLeaderboard[0] ? `${officialLeaderboard[0].points} season pts` : 'No events yet'}
        />
        <Stat
          label="Events Completed"
          value={completedEventIds.size}
          sub="Rankings updated live"
        />
        <Stat
          label="Active Tag Holders"
          value={activeTags.length}
          sub="Tags in circulation"
        />
      </div>

      <div className="grid-2">
        {/* Main Points Leaderboard */}
        <div className="panel">
          <div
            className="panel-head"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <span className="eyebrow">{division === 'M' ? "Men's" : "Women's"} Points Leaderboard</span>
              <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>
                Top 5 earn points each event (10, 8, 6, 4, 2)
              </span>
            </div>
            {sortState.column !== 'default' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
                onClick={() => setSortState({ column: 'default', direction: 'desc' })}
                title="Reset to official standings"
              >
                <RotateCcw size={12} style={{ marginRight: 4 }} /> Reset sort
              </button>
            )}
          </div>

          <div className="table-wrap">
            <table className="table standings-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => {
                    const isActive = sortState.column === col.key
                    const isPlc = col.key === 'default'
                    const className = [
                      'sortable',
                      col.align ? col.align : '',
                      col.borderLeft ? 'bl' : '',
                      isActive ? 'active-sort' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <th
                        key={col.key}
                        className={className}
                        style={{
                          width: col.width,
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                        onClick={() => handleHeaderClick(col.key)}
                        title={isPlc ? 'Click to reset to default official rank' : `Sort by ${col.label}`}
                        aria-sort={
                          isActive
                            ? sortState.direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                      >
                        <span>{col.label}</span>
                        {isActive && (
                          <span className="sort-arrow">
                            {sortState.direction === 'asc' ? (
                              <ArrowUp size={11} />
                            ) : (
                              <ArrowDown size={11} />
                            )}
                          </span>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {displayedLeaderboard.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{ textAlign: 'center', padding: '36px 0' }}
                      className="muted"
                    >
                      No completed events yet this season. Points will appear once an event is finalized.
                    </td>
                  </tr>
                ) : (
                  displayedLeaderboard.map((item) => {
                    const isLeader = item.place === 1
                    return (
                      <tr key={item.playerId} className={isLeader ? 'leader' : ''}>
                        <td className="place">{ordinal(item.place)}</td>
                        <td className="strong player-cell" title={item.playerName}>
                          {item.playerName}
                        </td>
                        <td className="c">{item.eventsPlayed}</td>
                        <td className="c">{item.firstPlaces > 0 ? `${item.firstPlaces}x` : '—'}</td>
                        <td className="c">{item.best18 != null ? item.best18 : '—'}</td>
                        <td className="c">{item.best27 != null ? item.best27 : '—'}</td>
                        <td
                          className="r bl num"
                          style={{ color: item.winnings > 0 ? 'var(--teal)' : 'var(--text-3)' }}
                        >
                          {item.winnings > 0 ? money(item.winnings) : '—'}
                        </td>
                        <td className="c bl big" style={{ color: 'var(--orange)' }}>
                          {item.points}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tags Ladder Sidebar */}
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">
              <TagIcon size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Current Tag Holders
            </span>
            <span className="faint" style={{ fontSize: 12 }}>#{activeTags[0]?.tag_number ?? '1'} Top Tag</span>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Tag #</th>
                  <th>Current Holder</th>
                </tr>
              </thead>
              <tbody>
                {activeTags.length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'center', padding: '24px 0' }} className="muted">
                      No tags issued yet for this division.
                    </td>
                  </tr>
                ) : (
                  activeTags.map((t) => {
                    const p = playerById.get(t.player_id)
                    return (
                      <tr key={t.id}>
                        <td>
                          <span className={`chip ${t.tag_number === 1 ? 'chip-orange' : 'chip-tag'}`}>
                            #{t.tag_number}
                          </span>
                        </td>
                        <td className="strong">{p?.name ?? 'Unknown'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
