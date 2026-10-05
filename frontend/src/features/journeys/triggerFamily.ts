/** The List page's 4 trigger-family groups (apps/journeys/listing.py). Tile colours reuse the design system's
 * existing --cat-* category tokens (CategoryTag's loyalty/promotional/seasonal/transactional, otherwise unused by
 * any component yet) rather than inventing new hex values — Blue 600 stays reserved for actions and status tags
 * keep their own locked tag-* tokens, so these are the only spare tinted pair available. Flag to design if a
 * different pairing is wanted; the tokens carry no visible label of their own, so the mapping is silent either way. */
import { Activity, Award, ShoppingBag, Users, type LucideIcon } from 'lucide-react'

import type { JourneyTriggerFamily } from '@/lib/types'

export const FAMILY_META: Record<JourneyTriggerFamily, { label: string; icon: LucideIcon; tile: string }> = {
  CUSTOMER_LIFECYCLE: { label: 'Customer / Lifecycle', icon: Users, tile: 'bg-cat-transactional-bg text-cat-transactional-text' },
  SEGMENT_LOYALTY: { label: 'Segment / Loyalty', icon: Award, tile: 'bg-cat-loyalty-bg text-cat-loyalty-text' },
  COMMERCE_OFFER: { label: 'Commerce / Offer', icon: ShoppingBag, tile: 'bg-cat-promotional-bg text-cat-promotional-text' },
  ENGAGEMENT: { label: 'Engagement', icon: Activity, tile: 'bg-cat-seasonal-bg text-cat-seasonal-text' },
}

export const FAMILY_OPTIONS = (Object.keys(FAMILY_META) as JourneyTriggerFamily[]).map((value) => ({ value, label: FAMILY_META[value].label }))
