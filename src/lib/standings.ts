import type { Division, Entry, PPEvent, Player } from './types'
import { totals } from './scoring'

export type StandingsSortColumn =
  | 'default'
  | 'player'
  | 'events'
  | 'wins'
  | 'best18'
  | 'best27'
  | 'winnings'
  | 'points'

export type SortDirection = 'asc' | 'desc'

export interface StandingsSortState {
  column: StandingsSortColumn
  direction: SortDirection
}

export interface StandingsPlayerStats {
  playerId: string
  playerName: string
  points: number
  winnings: number
  eventsPlayed: number
  firstPlaces: number
  best18: number | null
  best27: number | null
  /** Official rank from default season tie-breakers. Tied players share place (e.g. 5th, 5th, 7th). */
  place: number
}

/**
 * Calculates Best 18 and Best 27 across a player's completed event entries:
 * - Best 18: Highest initial 18-hole score (totals(e).t18). Null if none.
 * - Best 27: Highest (18 + Final 9) score for events where the player made the final.
 *   Null if the player never played in a Final 9.
 */
export function calculatePlayerBests(entries: readonly Entry[]): {
  best18: number | null
  best27: number | null
} {
  let best18: number | null = null
  let best27: number | null = null

  for (const e of entries) {
    const t = totals(e)
    if (t.t18 != null) {
      if (best18 == null || t.t18 > best18) {
        best18 = t.t18
      }
    }
    // Only entries where the player made the final and has a valid final 9 score count for Best 27
    if (e.made_final && t.f != null && t.t18 != null) {
      const score27 = t.t18 + t.f
      if (best27 == null || score27 > best27) {
        best27 = score27
      }
    }
  }

  return { best18, best27 }
}

/**
 * Compares two players by official season standings default tie-breaker hierarchy:
 * 1. Points desc
 * 2. 1st Wins desc
 * 3. Best 27 desc (players without a Final 9 after those with one)
 * 4. Best 18 desc (players without an 18 score after those with one)
 * 5. Winnings desc
 * 6. Player Name asc (case-insensitive alphabetical)
 */
export function compareDefaultStandings(
  a: StandingsPlayerStats,
  b: StandingsPlayerStats,
): number {
  // 1. Points desc
  if (b.points !== a.points) return b.points - a.points

  // 2. 1st Wins desc
  if (b.firstPlaces !== a.firstPlaces) return b.firstPlaces - a.firstPlaces

  // 3. Best 27 desc (players without a Final 9 after those with one)
  const aHas27 = a.best27 != null
  const bHas27 = b.best27 != null
  if (aHas27 && !bHas27) return -1
  if (!aHas27 && bHas27) return 1
  if (aHas27 && bHas27 && b.best27 !== a.best27) {
    return b.best27! - a.best27!
  }

  // 4. Best 18 desc
  const aHas18 = a.best18 != null
  const bHas18 = b.best18 != null
  if (aHas18 && !bHas18) return -1
  if (!aHas18 && bHas18) return 1
  if (aHas18 && bHas18 && b.best18 !== a.best18) {
    return b.best18! - a.best18!
  }

  // 5. Winnings desc
  if (b.winnings !== a.winnings) return b.winnings - a.winnings

  // 6. Name asc
  return a.playerName.localeCompare(b.playerName, undefined, { sensitivity: 'base' })
}

/**
 * Checks if two players are tied on all official default keys:
 * Points, 1st Wins, Best 27, Best 18, and Winnings.
 */
export function arePlayersTiedOnDefaultKeys(
  a: StandingsPlayerStats,
  b: StandingsPlayerStats,
): boolean {
  return (
    a.points === b.points &&
    a.firstPlaces === b.firstPlaces &&
    a.best27 === b.best27 &&
    a.best18 === b.best18 &&
    a.winnings === b.winnings
  )
}

/**
 * Assigns official competition ranks (1st, 2nd, etc.) based on default standings.
 * Players tied on every default key share a place (e.g. 5th, 5th, 7th).
 * Expects input to be pre-sorted with `compareDefaultStandings`.
 */
export function assignOfficialPlaces(
  sortedRows: readonly StandingsPlayerStats[],
): StandingsPlayerStats[] {
  const result: StandingsPlayerStats[] = []
  for (let i = 0; i < sortedRows.length; i++) {
    const row = { ...sortedRows[i] }
    if (i === 0) {
      row.place = 1
    } else {
      if (arePlayersTiedOnDefaultKeys(row, sortedRows[i - 1])) {
        row.place = result[i - 1].place
      } else {
        row.place = i + 1
      }
    }
    result.push(row)
  }
  return result
}

/**
 * Checks whether a row value is rendered as a dash ('—') in the table:
 * - Best 18: null
 * - Best 27: null
 * - 1st Wins: <= 0
 * - Winnings: <= 0
 */
export function isDashValue(
  column: StandingsSortColumn,
  row: StandingsPlayerStats,
): boolean {
  switch (column) {
    case 'best18':
      return row.best18 == null
    case 'best27':
      return row.best27 == null
    case 'wins':
      return row.firstPlaces <= 0
    case 'winnings':
      return row.winnings <= 0
    default:
      return false
  }
}

/**
 * Computes the next sort state when a column header is clicked:
 * - Clicking 'default' or 'plc' resets to default.
 * - Clicking the currently active column flips its direction (asc <-> desc).
 * - Clicking a new column initializes direction:
 *   - 'player' starts 'asc' (A to Z)
 *   - Numerical columns start 'desc' (high to low)
 */
export function nextSortState(
  current: StandingsSortState,
  target: StandingsSortColumn,
): StandingsSortState {
  if (target === 'default') {
    return { column: 'default', direction: 'desc' }
  }
  if (current.column === target) {
    return {
      column: target,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    }
  }
  return {
    column: target,
    direction: target === 'player' ? 'asc' : 'desc',
  }
}

/**
 * Sorts standings rows by the selected column and direction:
 * - Dashes always sort last regardless of asc or desc.
 * - Tied values fall back to default season standings order.
 * - The official `place` property is preserved and never altered.
 */
export function sortStandingsRows(
  rows: readonly StandingsPlayerStats[],
  sortState: StandingsSortState,
): StandingsPlayerStats[] {
  if (sortState.column === 'default') {
    return [...rows].sort(compareDefaultStandings)
  }

  const { column, direction } = sortState
  const mult = direction === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    const aDash = isDashValue(column, a)
    const bDash = isDashValue(column, b)

    // Dashes always sort last
    if (aDash && !bDash) return 1
    if (!aDash && bDash) return -1
    if (aDash && bDash) {
      return compareDefaultStandings(a, b)
    }

    let diff = 0
    switch (column) {
      case 'player':
        diff = a.playerName.localeCompare(b.playerName, undefined, { sensitivity: 'base' })
        break
      case 'events':
        diff = a.eventsPlayed - b.eventsPlayed
        break
      case 'wins':
        diff = a.firstPlaces - b.firstPlaces
        break
      case 'best18':
        diff = (a.best18 ?? 0) - (b.best18 ?? 0)
        break
      case 'best27':
        diff = (a.best27 ?? 0) - (b.best27 ?? 0)
        break
      case 'winnings':
        diff = a.winnings - b.winnings
        break
      case 'points':
        diff = a.points - b.points
        break
      default:
        return compareDefaultStandings(a, b)
    }

    if (diff !== 0) {
      return diff * mult
    }

    // Secondary fallback: default season standings comparison
    return compareDefaultStandings(a, b)
  })
}

/**
 * Aggregates entries from completed events in the active season for a division,
 * sorts by official default tie-breakers, and assigns official places.
 */
export function buildOfficialStandings(params: {
  entries: readonly Entry[]
  events: readonly PPEvent[]
  division: Division
  playerById: Map<string, Player>
}): StandingsPlayerStats[] {
  const { entries, events, division, playerById } = params
  const completedIds = new Set(
    events.filter((e) => e.status === 'complete').map((e) => e.id),
  )

  const statsMap = new Map<
    string,
    {
      playerId: string
      points: number
      winnings: number
      eventsPlayed: number
      firstPlaces: number
      entries: Entry[]
    }
  >()

  for (const ent of entries) {
    if (!completedIds.has(ent.event_id) || ent.division !== division) continue
    let row = statsMap.get(ent.player_id)
    if (!row) {
      row = {
        playerId: ent.player_id,
        points: 0,
        winnings: 0,
        eventsPlayed: 0,
        firstPlaces: 0,
        entries: [],
      }
      statsMap.set(ent.player_id, row)
    }
    row.points += Number(ent.points || 0)
    row.winnings += Number(ent.payout || 0)
    row.eventsPlayed += 1
    if (ent.place === 1) row.firstPlaces += 1
    row.entries.push(ent)
  }

  const rawRows: StandingsPlayerStats[] = []
  for (const row of statsMap.values()) {
    const { best18, best27 } = calculatePlayerBests(row.entries)
    const p = playerById.get(row.playerId)
    rawRows.push({
      playerId: row.playerId,
      playerName: p?.name ?? 'Unknown',
      points: row.points,
      winnings: row.winnings,
      eventsPlayed: row.eventsPlayed,
      firstPlaces: row.firstPlaces,
      best18,
      best27,
      place: 1,
    })
  }

  rawRows.sort(compareDefaultStandings)
  return assignOfficialPlaces(rawRows)
}
