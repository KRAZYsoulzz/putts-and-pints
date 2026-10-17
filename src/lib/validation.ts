import { cents } from './scoring'
import type { Division, Entry, Player, Tag } from './types'

/** Collapse whitespace so "Ann  Lee" and "Ann Lee" are the same name. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function duplicateName(name: string, players: Pick<Player, 'id' | 'name'>[], exceptId?: string): boolean {
  const n = normalizeName(name).toLowerCase()
  if (!n) return false
  return players.some(p => p.id !== exceptId && normalizeName(p.name).toLowerCase() === n)
}

export type TagParse = { ok: true; value: number | null } | { ok: false; error: string }

/** Empty clears the tag. Anything else must be a whole number starting at 1. */
export function parseTag(raw: string): TagParse {
  const t = raw.trim()
  if (t === '') return { ok: true, value: null }
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Tag numbers have to be whole numbers, 1 or higher.' }
  const n = Number(t)
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'Tag numbers start at 1.' }
  return { ok: true, value: n }
}

/** Tag numbers are unique inside a division for the night. */
export function tagTakenTonight(tag: number, entries: Pick<Entry, 'id' | 'division' | 'tag_in'>[], selfId: string, division: Division): boolean {
  return entries.some(e => e.id !== selfId && e.division === division && e.tag_in === tag)
}

/** Starting tags are unique inside a division for the season. */
export function tagTakenOnRoster(
  tag: number,
  tags: Pick<Tag, 'player_id' | 'tag_number'>[],
  players: Pick<Player, 'id' | 'division'>[],
  division: Division,
  exceptPlayerId?: string,
): boolean {
  return tags.some(t => {
    if (t.tag_number !== tag || t.player_id === exceptPlayerId) return false
    return players.find(p => p.id === t.player_id)?.division === division
  })
}

export type MoneyParse = { ok: true; value: number } | { ok: false; error: string }

/** Empty clears to $0. A dash or junk is an error, not a silent $0. */
export function parseMoney(raw: string, allowNegative = false): MoneyParse {
  const t = raw.trim()
  if (t === '' || t === '.') return { ok: true, value: 0 }
  if (!allowNegative && (t === '-' || t === '-.')) return { ok: false, error: 'Amount can’t be negative.' }
  const n = Number(t)
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a dollar amount.' }
  if (!allowNegative && n < 0) return { ok: false, error: 'Amount can’t be negative.' }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

export type PayoutIssue = 'negative' | 'over' | null

/** Place checks can't be negative, and together they can't exceed the night's pool. */
export function payoutIssue(amounts: number[], pool: number): PayoutIssue {
  if (amounts.some(n => !Number.isFinite(n) || n < 0)) return 'negative'
  const sum = cents(amounts.reduce((a, b) => a + (b || 0), 0))
  if (sum - pool > 0.001) return 'over'
  return null
}

/** Turn a Postgres error into something a director can act on. Never the raw constraint name. */
export function friendlyError(message: unknown): string {
  const m = typeof message === 'string' ? message.toLowerCase() : ''
  if (
    m.includes('jwt') || m.includes('jws') || m.includes('not authenticated') ||
    m.includes('permission denied') || m.includes('row-level security') ||
    m.includes('pgrst301') || m.includes('invalid claim')
  ) {
    return 'You are not signed in as a director. Sign in again, then retry that save.'
  }
  if (m.includes('pp_entries_event_id_player_id') || (m.includes('duplicate') && m.includes('pp_entries'))) {
    return 'That player is already checked in.'
  }
  if (m.includes('pp_players_name_unique') || (m.includes('duplicate') && m.includes('pp_players'))) {
    return 'A player with that name is already on the roster.'
  }
  if (m.includes('pp_ledger_fund_check') || m.includes('pp_ledger_kind_check') || (m.includes('pp_events') && m.includes('name') && m.includes('column'))) {
    return 'That save needs the database migration in supabase/003_ledger_and_event_name.sql. Run it in the Supabase SQL editor, then try again.'
  }
  if (m.includes('check constraint') || m.includes('violates check')) {
    return 'That value is outside the allowed range.'
  }
  return 'Something went wrong saving that. Please try again.'
}
