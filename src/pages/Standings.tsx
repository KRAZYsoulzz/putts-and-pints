import { useMemo, useState } from 'react'
import { Tag as TagIcon } from 'lucide-react'
import { useData } from '../lib/store'
import { totals } from '../lib/scoring'
import type { Division } from '../lib/types'
import { DivisionSeg, PageHead, Stat, money, ordinal } from '../components/ui'

export default function Standings() {
  const { season, entries, events, playerById, tags, records } = useData()
  const [division, setDivision] = useState<Division>('M')

  // Completed events in active season
  const completedEventIds = useMemo(
    () => new Set(events.filter((e) => e.status === 'complete').map((e) => e.id)),
    [events],
  )

  // Aggregate stats per player
  const leaderboard = useMemo(() => {
    const statsMap = new Map<
      string,
      {
        playerId: string
        points: number
        winnings: number
        eventsPlayed: number
        firstPlaces: number
        highScore: number
      }
    >()

    for (const ent of entries) {
      if (!completedEventIds.has(ent.event_id) || ent.division !== division) continue
      const existing = statsMap.get(ent.player_id) ?? {
        playerId: ent.player_id,
        points: 0,
        winnings: 0,
        eventsPlayed: 0,
        firstPlaces: 0,
        highScore: 0,
      }

      existing.points += ent.points || 0
      existing.winnings += ent.payout || 0
      existing.eventsPlayed += 1
      if (ent.place === 1) existing.firstPlaces += 1
      const t = totals(ent).total ?? 0
      if (t > existing.highScore) existing.highScore = t

      statsMap.set(ent.player_id, existing)
    }

    return Array.from(statsMap.values()).sort((a, b) => b.points - a.points || b.firstPlaces - a.firstPlaces || b.winnings - a.winnings)
  }, [entries, completedEventIds, division])

  // Current tags for this division
  const activeTags = useMemo(() => {
    return tags
      .filter((t) => {
        const p = playerById.get(t.player_id)
        return p?.division === division
      })
      .sort((a, b) => a.tag_number - b.tag_number)
  }, [tags, playerById, division])

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
          value={leaderboard[0] ? playerById.get(leaderboard[0].playerId)?.name : '—'}
          sub={leaderboard[0] ? `${leaderboard[0].points} season pts` : 'No events yet'}
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
          <div className="panel-head">
            <span className="eyebrow">{division === 'M' ? "Men's" : "Women's"} Points Leaderboard</span>
            <span className="faint" style={{ fontSize: 12 }}>Top 5 earn points each event (10, 8, 6, 4, 2)</span>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 45 }}>Plc</th>
                  <th>Player</th>
                  <th className="c">Events</th>
                  <th className="c">1st Wins</th>
                  <th className="c">Best 27</th>
                  <th className="r bl">Winnings</th>
                  <th className="c bl" style={{ width: 70 }}>Points</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '36px 0' }} className="muted">
                      No completed events yet this season. Points will appear once an event is finalized.
                    </td>
                  </tr>
                ) : (
                  leaderboard.map((item, idx) => {
                    const p = playerById.get(item.playerId)
                    const isLeader = idx === 0
                    return (
                      <tr key={item.playerId} className={isLeader ? 'leader' : ''}>
                        <td className="place">{ordinal(idx + 1)}</td>
                        <td className="strong">{p?.name ?? 'Unknown'}</td>
                        <td className="c">{item.eventsPlayed}</td>
                        <td className="c">{item.firstPlaces > 0 ? `${item.firstPlaces}x` : '—'}</td>
                        <td className="c">{item.highScore > 0 ? item.highScore : '—'}</td>
                        <td className="r bl num" style={{ color: item.winnings > 0 ? 'var(--teal)' : 'var(--text-3)' }}>
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
