import type { HomeFilters } from './data/types'

export type SectionKey =
  | 'attention' | 'performance' | 'createNew' | 'revenueCost' | 'funnel' | 'topBottom' | 'schedule' | 'snapshot' | 'recent' | 'governance' | 'eReceipts'

/** the cards below the key figures, in page order */
export type CardKey = 'revenueCost' | 'funnel' | 'topBottom' | 'schedule' | 'snapshot' | 'governance' | 'eReceipts' | 'recent'

/** 'unavailable': the source can't feed it; 'empty': ready with nothing to show by the section's own rule (no e-receipts) */
export type Availability = 'ready' | 'unavailable' | 'empty'

/** 'thirds': three cards side by side from 1200px */
export type RowLayout = 'full' | '2:1' | '1:2' | '1:1' | 'thirds'

export interface LayoutRow {
  name: string
  layout: RowLayout
  cards: CardKey[]
}

export interface HomeLayout {
  singleCampaign: boolean
  /** hidden when there are no alert groups, or alerts can't be read (unavailable, 403); loading and errors show */
  attention: boolean
  createNew: boolean
  /** design: every card the design would show is there; pack: something is missing, so the rest pair up two per row */
  mode: 'design' | 'pack'
  rows: LayoutRow[]
}

interface LayoutInput {
  filters: HomeFilters
  availability: Partial<Record<SectionKey, Availability>>
  /** the workspace has the journeys feature; the snapshot's Journey row needs it, the layout doesn't */
  journeysOn?: boolean
  /** the workspace has e-receipts; without them the E-Receipts tile never shows */
  eReceiptsOn?: boolean
}

const ORDER: CardKey[] = ['revenueCost', 'funnel', 'topBottom', 'schedule', 'snapshot', 'governance', 'eReceipts', 'recent']
const SIZE: Record<CardKey, 'wide' | 'half' | 'small'> = {
  revenueCost: 'wide', recent: 'wide', topBottom: 'half', schedule: 'half', governance: 'half', eReceipts: 'half', funnel: 'small', snapshot: 'small',
}
/** with an odd count, the first of these present goes full width; Governance and E-Receipts only when alone */
const FULL_WIDTH_PREFERENCE: CardKey[] = ['recent', 'revenueCost', 'topBottom', 'schedule', 'funnel', 'snapshot']

/** trial layout (new-theme-style): the chart beside the funnel, the ranking beside Next 7 Days, Recent Campaigns beside
    Governance, then the channel snapshot beside E-Receipts. Every row is two thirds and one third */
const DESIGN: LayoutRow[] = [
  { name: 'a', layout: '2:1', cards: ['revenueCost', 'funnel'] },
  { name: 'b', layout: '1:2', cards: ['topBottom', 'schedule'] },
  { name: 'c', layout: '2:1', cards: ['recent', 'governance'] },
  { name: 'd', layout: '2:1', cards: ['snapshot', 'eReceipts'] },
]
/** one campaign: no ranking, snapshot, recent list or e-receipts by design; Governance moves beside Next 7 Days */
const SINGLE_CAMPAIGN_DESIGN: LayoutRow[] = [
  { name: 'a', layout: '2:1', cards: ['revenueCost', 'funnel'] },
  { name: 'b', layout: '1:1', cards: ['schedule', 'governance'] },
]

/** a pair's widths: a wide card beside a small one takes two thirds; anything else splits evenly */
function pairLayout(left: CardKey, right: CardKey): RowLayout {
  if (SIZE[left] === 'wide' && SIZE[right] === 'small') return '2:1'
  if (SIZE[left] === 'small' && SIZE[right] === 'wide') return '1:2'
  return '1:1'
}

/**
 * The cards two per row when the design can't be kept: in page order, pairs of neighbours; with an odd count one card
 * (by FULL_WIDTH_PREFERENCE) takes a row of its own. A row sits where its first card sits in page order. Never a lone
 * card stretched beside nothing, unless it is the only one.
 */
export function packCards(visible: CardKey[]): LayoutRow[] {
  const cards = ORDER.filter((card) => visible.includes(card))
  if (cards.length === 0) return []
  const full = cards.length === 1 ? cards[0] : cards.length % 2 === 1 ? FULL_WIDTH_PREFERENCE.find((card) => cards.includes(card)) : undefined
  const rest = cards.filter((card) => card !== full)
  const rows: LayoutRow[] = []
  for (let index = 0; index < rest.length; index += 2) rows.push({ name: '', layout: pairLayout(rest[index], rest[index + 1]), cards: [rest[index], rest[index + 1]] })
  if (full) rows.push({ name: '', layout: 'full', cards: [full] })
  return rows
    .sort((a, b) => ORDER.indexOf(a.cards[0]) - ORDER.indexOf(b.cards[0]))
    .map((row, index) => ({ ...row, name: `p${index + 1}` }))
}

/**
 * Which sections show, and how the cards below the key figures sit. The key figures always show; Needs Attention when
 * it has alerts; Create New when it has a tile.
 */
export function homeLayout({ filters, availability, eReceiptsOn = true }: LayoutInput): HomeLayout {
  const singleCampaign = filters.campaignIds.length === 1
  const shows = (key: SectionKey) => (key !== 'eReceipts' || eReceiptsOn) && (availability[key] ?? 'ready') === 'ready'
  const design = singleCampaign ? SINGLE_CAMPAIGN_DESIGN : DESIGN
  const designed = design.flatMap((row) => row.cards)
  const complete = designed.every(shows)
  return {
    singleCampaign,
    attention: shows('attention'),
    createNew: shows('createNew'),
    mode: complete ? 'design' : 'pack',
    rows: complete ? design : packCards(designed.filter(shows)),
  }
}
