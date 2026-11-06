import type { Division } from './types'

/** Tonight → Check In Player → new name. Off until the director turns it on. */
export function freshBuyingTag(): boolean {
  return false
}

export type BuyingTagMoment = 'open' | 'cancel' | 'success' | 'next-player' | 'save-failure'

/**
 * Drop the choice when this player is finished or the next name starts.
 * A failed save keeps whatever the director had selected.
 */
export function buyingTagAfter(current: boolean, moment: BuyingTagMoment): boolean {
  if (moment === 'save-failure') return current
  return false
}

/**
 * One pp_players insert. in_tags is the same flag the Players page writes,
 * so check-in and tag eligibility see it as soon as the roster reloads.
 */
export function newPlayerInsert(name: string, division: Division, buyingTag: boolean) {
  return {
    name,
    division,
    active: true as const,
    in_tags: buyingTag,
  }
}

/** A held number is copied onto tonight's entry only when this player bought a tag. */
export function checkinTagIn(inTags: boolean, held: number | null): number | null {
  return inTags ? held : null
}
