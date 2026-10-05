/**
 * Home, the marketing command centre (CEP Dashboard v2): the greeting with the Create New buttons beside it, the alert
 * cards, the set-up card, the two heroes and four ring KPIs, then the cards: the designed rows when all are there,
 * otherwise two per row (see homeLayout).
 */
import { Fragment, type ReactNode } from 'react'

import { greetingFor } from '@/lib/format'

import { createNewTiles } from './createNewTiles'
import { useHomeData } from './data/homeDataContext'
import type { HomeFilters, SectionResult } from './data/types'
import { homeLayout, type Availability, type CardKey, type LayoutRow } from './homeLayout'
import { ChannelSnapshot } from './sections/ChannelSnapshot'
import { CreateNew } from './sections/CreateNew'
import { EngagementFunnel } from './sections/EngagementFunnel'
import { EReceiptsTile } from './sections/EReceiptsTile'
import { GovernanceTile } from './sections/GovernanceTile'
import { KeyFigures } from './sections/KeyFigures'
import { NeedsAttention } from './sections/NeedsAttention'
import { NextSevenDays } from './sections/NextSevenDays'
import { RecentCampaigns } from './sections/RecentCampaigns'
import { RevenueCost } from './sections/RevenueCost'
import { SetupCard } from './sections/SetupCard'
import { TopCampaigns } from './sections/TopBottom'
import { useHomeFilters } from './useHomeFilters'

import { PageHelp } from '@/help/HelpPanel'

function availabilityOf<T>(result: SectionResult<T>, isEmpty: (data: T) => boolean = () => false): Availability {
  if (result.status === 'unavailable') return 'unavailable'
  return result.status === 'ready' && isEmpty(result.data) ? 'empty' : 'ready'
}

interface CardProps {
  card: CardKey
  filters: HomeFilters
  onChange: (next: Partial<HomeFilters>) => void
  onClear: () => void
  singleCampaign: boolean
}

function Card({ card, filters, onChange, onClear, singleCampaign }: CardProps) {
  switch (card) {
    case 'revenueCost': return <RevenueCost filters={filters} onChange={onChange} onClear={onClear} singleCampaign={singleCampaign} />
    case 'funnel': return <EngagementFunnel filters={filters} />
    case 'topBottom': return <TopCampaigns filters={filters} />
    case 'schedule': return <NextSevenDays filters={filters} />
    case 'snapshot': return <ChannelSnapshot filters={filters} />
    case 'recent': return <RecentCampaigns filters={filters} />
    case 'governance': return <GovernanceTile filters={filters} />
    case 'eReceipts': return <EReceiptsTile filters={filters} />
  }
}

/** by the page's own width (the rail takes some of the window), as the design measures it */
const COLUMNS: Record<Exclude<LayoutRow['layout'], 'full'>, string> = {
  '2:1': '@min-[1100px]:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]',
  '1:2': '@min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]',
  '1:1': '@min-[840px]:grid-cols-2',
  thirds: '@min-[840px]:grid-cols-2 @min-[1100px]:grid-cols-3',
}

/** one row: a card on its own, or two or three side by side on a wide page (stacked below) */
function CardRow({ row, render }: { row: LayoutRow; render: (card: CardKey) => ReactNode }) {
  return (
    <div data-row={row.name} data-layout={row.layout} className={`grid gap-4 ${row.layout === 'full' ? '' : COLUMNS[row.layout]}`}>
      {row.cards.map((card) => <Fragment key={card}>{render(card)}</Fragment>)}
    </div>
  )
}

export function HomePage() {
  const { source, viewer } = useHomeData()
  const [filters, setFilters, clearFilters] = useHomeFilters()
  const attention = source.useAttention(filters)
  const topBottom = source.useTopBottom(filters)
  const revenueCost = source.useRevenueCost(filters)
  const funnel = source.useFunnel(filters)
  const schedule = source.useSchedule(filters)
  const recent = source.useRecentCampaigns(filters)
  const governance = source.useGovernance(filters)
  const eReceipts = source.useEReceipts(filters)
  const setup = source.useSetup()

  const tiles = createNewTiles(viewer, source.capabilities)
  const layout = homeLayout({
    filters,
    eReceiptsOn: viewer.has('ereceipt'),
    availability: {
      attention: availabilityOf(attention, (data) => data.groups.length === 0),
      createNew: tiles.length ? 'ready' : 'empty',
      topBottom: availabilityOf(topBottom),
      revenueCost: availabilityOf(revenueCost),
      funnel: availabilityOf(funnel),
      schedule: availabilityOf(schedule),
      snapshot: availabilityOf(funnel),
      recent: availabilityOf(recent),
      governance: availabilityOf(governance),
      eReceipts: availabilityOf(eReceipts, (data) => data === null),
    },
  })
  const render = (card: CardKey) => <Card card={card} filters={filters} onChange={setFilters} onClear={clearFilters} singleCampaign={layout.singleCampaign} />
  const greeting = greetingFor(new Date(), viewer.timezone)

  return (
    // the plum wash fills the sheet edge to edge, under the shell's own padding
    <div data-home className="cep-home-wash @container -mx-4 -my-5 flex min-h-full min-w-0 flex-col gap-5 rounded-tl-xl px-4 pt-6 pb-12 md:-mx-8 md:-my-6 md:px-8 md:pt-7">
      <div data-greeting-row className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <span className="flex min-w-0 items-center gap-1.5"><h1 className="min-w-0 truncate font-display text-page-title font-semibold text-ink-900">{viewer.firstName ? `${greeting}, ${viewer.firstName}` : greeting}</h1><PageHelp chapter="home" /></span>
        {layout.createNew && <CreateNew tiles={tiles} />}
      </div>
      {layout.attention && <NeedsAttention result={attention} funnel={funnel} />}
      <SetupCard result={setup} />
      <KeyFigures filters={filters} revenueCost={revenueCost} />
      {layout.rows.map((row) => <CardRow key={row.name} row={row} render={render} />)}
    </div>
  )
}
