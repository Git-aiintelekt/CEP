import type { HomeFilters } from './data/types'

export type SectionKey =
  | 'attention' | 'performance' | 'createNew' | 'topBottom' | 'revenueCost' | 'funnel' | 'schedule' | 'journeys' | 'recent' | 'governance' | 'eReceipts'

/** the cards below Marketing Performance, in page order */
export type CardKey = 'topBottom' | 'revenueCost' | 'funnel' | 'schedule' | 'journeys' | 'recent' | 'governance' | 'eReceipts'

/** 'unavailable': the source can't feed it; 'empty': ready with nothing to show by the section's own rule (no journeys, no e-receipts) */
export type Availability = 'ready' | 'unavailable' | 'empty'

/** 'side': the design's Recent Campaigns beside a column of Governance over E-Receipts */
export type RowLayout = 'full' | '2:1' | '1:2' | '1:1' | 'side'

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
  /** the workspace has the journeys feature; without it Active Journeys never shows */
  journeysOn?: boolean
  /** the workspace has e-receipts; without them the E-Receipts tile never shows */
  eReceiptsOn?: boolean
}

const ORDER: CardKey[] = ['topBottom', 'revenueCost', 'funnel', 'schedule', 'journeys', 'recent', 'governance', 'eReceipts']
const SIZE: Record<CardKey, 'wide' | 'half' | 'small'> = {
  topBottom: 'wide', revenueCost: 'wide', recent: 'wide', schedule: 'half', journeys: 'half', funnel: 'small', governance: 'small', eReceipts: 'small',
}
/** with an odd count, the first of these present goes full width; Governance and E-Receipts only when alone */
const FULL_WIDTH_PREFERENCE: CardKey[] = ['recent', 'topBottom', 'revenueCost', 'schedule', 'journeys', 'funnel']

const DESIGN: LayoutRow[] = [
  { name: 'top', layout: 'full', cards: ['topBottom'] },
  { name: 'a', layout: '2:1', cards: ['revenueCost', 'funnel'] },
  { name: 'b', layout: '1:1', cards: ['schedule', 'journeys'] },
  { name: 'c', layout: 'side', cards: ['recent', 'governance', 'eReceipts'] },
]
/** one campaign: no ranking, recent list, journeys or e-receipts by design; Governance moves beside Next 7 Days */
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
 * Which sections show, and how the cards below Marketing Performance sit. Marketing Performance always shows; Needs
 * Attention when it has alerts; Create New when it has a tile.
 */
export function homeLayout({ filters, availability, journeysOn = true, eReceiptsOn = true }: LayoutInput): HomeLayout {
  const singleCampaign = filters.campaignIds.length === 1
  const shows = (key: SectionKey) => (key !== 'journeys' || journeysOn) && (key !== 'eReceipts' || eReceiptsOn) && (availability[key] ?? 'ready') === 'ready'
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
